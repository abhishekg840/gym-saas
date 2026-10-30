import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import { verifyPassToken, type PassTokenClaims } from '@/lib/passtoken-server';
import { isPassWindowCurrent } from '@/lib/passtoken';

/**
 * POST /api/attendance/scan
 *
 * Smart Check-In / Check-Out Toggle Engine:
 * - Detects whether the member has an active check-in today without an exit.
 * - If NO active check-in: Logs a Check-In (direction = 'in').
 * - If ACTIVE check-in exists (< 4 hours): Automatically logs a Check-Out (direction = 'out')
 *   with workout duration calculated, without requiring manual toggle.
 * - If ACTIVE check-in is stale (>= 4 hours): Automatically auto-checks out the abandoned
 *   session (2 hours duration cap) and starts a new Check-In.
 */

function getIstMidnightIso(): string {
  const istDateString = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return `${istDateString}T00:00:00+05:30`;
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  let tenantId = String(payload.tenant_id ?? '') || readTenantCookie(request);
  let memberId = String(payload.member_id ?? '');
  const rawToken = String(payload.token ?? payload.qr ?? '');
  const mode = String(payload.mode ?? 'auto').toLowerCase(); // 'auto' | 'in' | 'out'
  const method = String(payload.method ?? 'qr_kiosk_auto');

  // 1. Resolve member from signed token if provided
  if (rawToken) {
    const verification = verifyPassToken(rawToken);
    if (!verification.ok) {
      if (verification.reason === 'forged') {
        return NextResponse.json(
          { allowed: false, reason: 'This pass is not valid. Ask the member to reopen their pass.', member_id: null },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { allowed: false, reason: 'This QR code is invalid or expired. Please refresh your pass.' },
        { status: 400 }
      );
    }

    const claims = verification.claims as PassTokenClaims;
    if (!isUuid(claims.id)) {
      return badRequest('Invalid member ID in token claims');
    }
    memberId = claims.id;

    // Check pass rotating window
    if (!isPassWindowCurrent(claims.t)) {
      return NextResponse.json({
        allowed: false,
        reason: 'This QR code has expired. Please reopen the pass in the member app.',
        member_id: memberId,
      });
    }
  }

  if (!isUuid(memberId)) {
    return badRequest('Valid member_id or signed pass token is required');
  }

  // 2. Lookup member record to verify active status and tenant
  const { data: member, error: memErr } = await supabaseAdmin
    .from('members')
    .select('id, tenant_id, full_name, phone, status, is_frozen, freeze_end_date, membership_end')
    .eq('id', memberId)
    .single();

  if (memErr || !member) {
    return NextResponse.json(
      { allowed: false, reason: 'Member not found. Check phone or registration.' },
      { status: 404 }
    );
  }

  if (!tenantId || !isUuid(tenantId)) {
    tenantId = member.tenant_id;
  }

  // 3. Verify Membership validity
  const todayDateStr = new Date().toISOString().slice(0, 10);
  if (member.is_frozen) {
    const freezeUntil = member.freeze_end_date ? ` until ${member.freeze_end_date}` : '';
    return NextResponse.json({
      allowed: false,
      reason: `Membership is frozen${freezeUntil}. Please see front desk.`,
      member_id: member.id,
      name: member.full_name,
      phone: member.phone,
    });
  }

  if (member.status === 'transferred' || member.status === 'inactive') {
    return NextResponse.json({
      allowed: false,
      reason: `Membership is ${member.status}. Please see front desk.`,
      member_id: member.id,
      name: member.full_name,
      phone: member.phone,
    });
  }

  if (member.membership_end && member.membership_end < todayDateStr) {
    return NextResponse.json({
      allowed: false,
      reason: 'Membership expired. Renewal required for floor entry.',
      member_id: member.id,
      name: member.full_name,
      phone: member.phone,
    });
  }

  // 4. Query Member's latest granted punch today (IST)
  const istMidnight = getIstMidnightIso();
  const { data: todayPunches, error: punchErr } = await supabaseAdmin
    .from('attendances')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .eq('status', 'granted')
    .gte('punch_time', istMidnight)
    .order('punch_time', { ascending: false })
    .limit(1);

  if (punchErr) {
    return databaseError(punchErr, 'Failed to inspect attendance history');
  }

  const latestPunch = todayPunches && todayPunches.length > 0 ? todayPunches[0] : null;
  const now = new Date();
  const nowIso = now.toISOString();

  // 5. Smart Decision: IN or OUT?
  const hasOpenCheckin = latestPunch && (latestPunch.direction === 'in' || !latestPunch.direction);

  if (hasOpenCheckin) {
    const punchTime = new Date(latestPunch.punch_time).getTime();
    const elapsedMinutes = Math.max(1, Math.floor((now.getTime() - punchTime) / 60000));
    const elapsedHours = elapsedMinutes / 60;

    // A: Manual override forced IN, or session is over 4 hours old -> treat previous as auto checked out, start NEW check-in
    if (mode === 'in' || (mode === 'auto' && elapsedHours >= 4)) {
      const sessionId = latestPunch.session_id || crypto.randomUUID();

      // Close stale session if > 4 hours
      if (elapsedHours >= 4) {
        await supabaseAdmin.from('attendances').insert({
          tenant_id: tenantId,
          member_id: memberId,
          punch_time: new Date(punchTime + 120 * 60000).toISOString(),
          direction: 'out',
          status: 'auto_checked_out',
          method: 'auto_timeout',
          session_id: sessionId,
          duration_minutes: 120,
        });
      }

      // Open new session
      const newSessionId = crypto.randomUUID();
      const { data: inRow, error: inErr } = await supabaseAdmin
        .from('attendances')
        .insert({
          tenant_id: tenantId,
          member_id: memberId,
          punch_time: nowIso,
          direction: 'in',
          status: 'granted',
          method,
          session_id: newSessionId,
        })
        .select()
        .single();

      if (inErr) return databaseError(inErr, 'Failed to record check-in');

      return NextResponse.json({
        ok: true,
        allowed: true,
        direction: 'in',
        action: 'check_in',
        member_id: member.id,
        name: member.full_name,
        phone: member.phone,
        session_id: newSessionId,
        checkin_at: nowIso,
        attendance_id: inRow.id,
        reason: 'Access Approved. Welcome to the gym!',
      });
    }

    // B: mode is 'out' OR (mode is 'auto' AND elapsedHours < 4) -> LOG CHECK-OUT
    const sessionId = latestPunch.session_id || crypto.randomUUID();

    // Ensure entry row has session_id
    if (!latestPunch.session_id) {
      await supabaseAdmin
        .from('attendances')
        .update({ session_id: sessionId })
        .eq('id', latestPunch.id);
    }

    const { data: outRow, error: outErr } = await supabaseAdmin
      .from('attendances')
      .insert({
        tenant_id: tenantId,
        member_id: memberId,
        punch_time: nowIso,
        direction: 'out',
        status: 'granted',
        method,
        session_id: sessionId,
        duration_minutes: elapsedMinutes,
      })
      .select()
      .single();

    if (outErr) return databaseError(outErr, 'Failed to record check-out');

    return NextResponse.json({
      ok: true,
      allowed: true,
      direction: 'out',
      action: 'check_out',
      member_id: member.id,
      name: member.full_name,
      phone: member.phone,
      session_id: sessionId,
      checkin_at: latestPunch.punch_time,
      checkout_at: nowIso,
      duration_minutes: elapsedMinutes,
      attendance_id: outRow.id,
      reason: `Session complete (${elapsedMinutes} min). See you tomorrow, ${member.full_name.split(' ')[0]}!`,
    });
  }

  // 6. No open check-in exists today:
  if (mode === 'out') {
    return NextResponse.json({
      allowed: false,
      reason: 'No active entry check-in found for this member today.',
      member_id: member.id,
      name: member.full_name,
      phone: member.phone,
    });
  }

  // LOG NEW CHECK-IN
  const newSessionId = crypto.randomUUID();
  const { data: inRow, error: inErr } = await supabaseAdmin
    .from('attendances')
    .insert({
      tenant_id: tenantId,
      member_id: memberId,
      punch_time: nowIso,
      direction: 'in',
      status: 'granted',
      method,
      session_id: newSessionId,
    })
    .select()
    .single();

  if (inErr) return databaseError(inErr, 'Failed to record check-in');

  return NextResponse.json({
    ok: true,
    allowed: true,
    direction: 'in',
    action: 'check_in',
    member_id: member.id,
    name: member.full_name,
    phone: member.phone,
    session_id: newSessionId,
    checkin_at: nowIso,
    attendance_id: inRow.id,
    reason: 'Access Approved. Welcome!',
  });
}
