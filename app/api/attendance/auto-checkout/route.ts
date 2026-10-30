import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import { isUuid } from '@/lib/session';

/**
 * /api/attendance/auto-checkout
 *
 * Background Auto Check-Out Worker & Session Inspector:
 * - GET:
 *   - If member_id provided: inspects member's active session and elapsed workout minutes.
 *   - Otherwise: runs auto-checkout sweep across all open sessions > 2 hours.
 * - POST:
 *   - action: 'checkout' -> immediately checks out a member.
 *   - action: 'extend'   -> extends member's workout session.
 *   - action: 'sweep'    -> triggers automated background auto check-out for all sessions > 2 hours.
 */

interface OpenSessionRow {
  id: string;
  tenant_id: string;
  member_id: string;
  punch_time: string;
  session_id: string | null;
  status: string;
  direction: string | null;
  method: string | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get('member_id');
  const tenantId = searchParams.get('tenant_id');

  // 1. Specific Member Active Session Inspection (used by Member PWA)
  if (memberId && isUuid(memberId)) {
    try {
      // Find latest granted punch today
      const todayDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const istMidnight = `${todayDateStr}T00:00:00+05:30`;

      let query = supabaseAdmin
        .from('attendances')
        .select('*')
        .eq('member_id', memberId)
        .eq('status', 'granted')
        .gte('punch_time', istMidnight)
        .order('punch_time', { ascending: false })
        .limit(1);

      if (tenantId && isUuid(tenantId)) {
        query = query.eq('tenant_id', tenantId);
      }

      const { data: rows, error } = await query;
      if (error) return databaseError(error, 'Failed to fetch member attendance');

      const latest = rows && rows.length > 0 ? (rows[0] as OpenSessionRow) : null;
      const isOpen = Boolean(latest && (latest.direction === 'in' || !latest.direction));

      if (!isOpen || !latest) {
        return NextResponse.json({
          ok: true,
          has_active_session: false,
          session: null,
        });
      }

      const checkinAt = new Date(latest.punch_time);
      const elapsedMs = Math.max(0, Date.now() - checkinAt.getTime());
      const elapsedMinutes = Math.floor(elapsedMs / 60000);

      return NextResponse.json({
        ok: true,
        has_active_session: true,
        session: {
          attendance_id: latest.id,
          session_id: latest.session_id,
          tenant_id: latest.tenant_id,
          member_id: latest.member_id,
          checkin_at: latest.punch_time,
          elapsed_minutes: elapsedMinutes,
          is_near_expiry: elapsedMinutes >= 105, // 1 hr 45 min threshold for prompt
          is_expired: elapsedMinutes >= 120,     // 2 hr threshold for auto-checkout
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching session';
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // 2. Default GET: Run the Auto Check-Out Worker Sweep
  return runAutoCheckoutSweep(tenantId ?? undefined);
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const action = String(payload.action ?? 'sweep').toLowerCase();
  const memberId = payload.member_id ? String(payload.member_id) : null;
  const tenantId = payload.tenant_id ? String(payload.tenant_id) : null;

  // Immediate Member Check-Out from PWA Popup
  if (action === 'checkout') {
    if (!memberId || !isUuid(memberId)) {
      return badRequest('member_id is required for checkout action');
    }

    try {
      // Find open IN punch today
      const todayDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const istMidnight = `${todayDateStr}T00:00:00+05:30`;

      const { data: rows, error: readErr } = await supabaseAdmin
        .from('attendances')
        .select('*')
        .eq('member_id', memberId)
        .eq('status', 'granted')
        .gte('punch_time', istMidnight)
        .order('punch_time', { ascending: false })
        .limit(1);

      if (readErr) return databaseError(readErr, 'Error checking session');

      const latest = rows && rows.length > 0 ? (rows[0] as OpenSessionRow) : null;
      if (!latest || latest.direction === 'out') {
        return NextResponse.json({
          ok: true,
          checked_out: true,
          message: 'No active session was open.',
        });
      }

      const now = new Date();
      const checkinTime = new Date(latest.punch_time).getTime();
      const durationMinutes = Math.max(1, Math.floor((now.getTime() - checkinTime) / 60000));
      const sessionId = latest.session_id || crypto.randomUUID();

      // Ensure open session had session_id
      if (!latest.session_id) {
        await supabaseAdmin
          .from('attendances')
          .update({ session_id: sessionId })
          .eq('id', latest.id);
      }

      const { data: outRow, error: outErr } = await supabaseAdmin
        .from('attendances')
        .insert({
          tenant_id: latest.tenant_id,
          member_id: memberId,
          punch_time: now.toISOString(),
          direction: 'out',
          status: 'granted',
          method: 'pwa_member_checkout',
          session_id: sessionId,
          duration_minutes: durationMinutes,
        })
        .select()
        .single();

      if (outErr) return databaseError(outErr, 'Failed to complete check-out');

      return NextResponse.json({
        ok: true,
        checked_out: true,
        session_id: sessionId,
        duration_minutes: durationMinutes,
        checkout_at: now.toISOString(),
        attendance_id: outRow.id,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Checkout failed';
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // Extend active session from PWA Popup
  if (action === 'extend') {
    if (!memberId || !isUuid(memberId)) {
      return badRequest('member_id is required for extend action');
    }

    try {
      const todayDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const istMidnight = `${todayDateStr}T00:00:00+05:30`;

      const { data: rows, error: readErr } = await supabaseAdmin
        .from('attendances')
        .select('*')
        .eq('member_id', memberId)
        .eq('status', 'granted')
        .gte('punch_time', istMidnight)
        .order('punch_time', { ascending: false })
        .limit(1);

      if (readErr) return databaseError(readErr, 'Error checking session');

      const latest = rows && rows.length > 0 ? (rows[0] as OpenSessionRow) : null;
      if (!latest || latest.direction === 'out') {
        return badRequest('No active session found to extend');
      }

      // Update punch_time by 60 minutes or add extension timestamp
      // Moving punch_time by 60 minutes extends the 2-hour window safely!
      const newPunchTime = new Date(Date.now() - 30 * 60000).toISOString(); // resets elapsed time to 30 min
      await supabaseAdmin
        .from('attendances')
        .update({ punch_time: newPunchTime })
        .eq('id', latest.id);

      return NextResponse.json({
        ok: true,
        extended: true,
        message: 'Session extended by 1 hour. Keep crushing your workout!',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Extend failed';
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // Action: 'sweep' -> Run Background Auto Check-Out
  return runAutoCheckoutSweep(tenantId ?? undefined);
}

/**
 * Core Sweep Engine:
 * Finds attendance sessions where check-in occurred > 2 hours ago with NO exit.
 * Automatically inserts an OUT row with status = 'auto_checked_out' and duration_minutes = 120.
 */
async function runAutoCheckoutSweep(tenantId?: string) {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const todayDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const istMidnight = `${todayDateStr}T00:00:00+05:30`;

    // 1. Fetch entries from today that are older than 2 hours
    let query = supabaseAdmin
      .from('attendances')
      .select('*')
      .eq('status', 'granted')
      .gte('punch_time', istMidnight)
      .lte('punch_time', twoHoursAgo)
      .order('punch_time', { ascending: true });

    if (tenantId && isUuid(tenantId)) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data: candidates, error: cErr } = await query;
    if (cErr) return databaseError(cErr, 'Failed to query open attendances');

    const list = (candidates || []) as OpenSessionRow[];
    let autoCheckedOutCount = 0;
    const closedSessions: Array<{ member_id: string; session_id: string | null; duration_minutes: number }> = [];

    // 2. For each candidate entry, check if an exit punch already exists after it
    for (const entry of list) {
      if (entry.direction === 'out') continue;

      const { data: exitPunches } = await supabaseAdmin
        .from('attendances')
        .select('id')
        .eq('member_id', entry.member_id)
        .eq('direction', 'out')
        .gte('punch_time', entry.punch_time)
        .limit(1);

      // If an exit already exists, this entry is already closed
      if (exitPunches && exitPunches.length > 0) continue;

      // Close open entry!
      const checkinTime = new Date(entry.punch_time).getTime();
      const autoCheckoutTime = new Date(checkinTime + 120 * 60000).toISOString();
      const sessionId = entry.session_id || crypto.randomUUID();

      if (!entry.session_id) {
        await supabaseAdmin
          .from('attendances')
          .update({ session_id: sessionId })
          .eq('id', entry.id);
      }

      await supabaseAdmin.from('attendances').insert({
        tenant_id: entry.tenant_id,
        member_id: entry.member_id,
        punch_time: autoCheckoutTime,
        direction: 'out',
        status: 'auto_checked_out',
        method: 'auto_checkout_cron',
        session_id: sessionId,
        duration_minutes: 120,
      });

      autoCheckedOutCount++;
      closedSessions.push({
        member_id: entry.member_id,
        session_id: sessionId,
        duration_minutes: 120,
      });
    }

    return NextResponse.json({
      ok: true,
      auto_checked_out_count: autoCheckedOutCount,
      closed_sessions: closedSessions,
      checked_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Auto-checkout sweep failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
