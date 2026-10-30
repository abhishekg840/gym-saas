import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cronUnauthorized, isCronAuthorized } from '@/lib/cron-auth';

/**
 * GET /api/cron — marks expired members. Scheduled by Vercel Cron, which sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when the project defines
 * CRON_SECRET. Every other caller gets 401 (and in production, so does any
 * caller when the secret is not configured — see lib/cron-auth.ts).
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return cronUnauthorized();

  try {
    const today = new Date().toISOString().split('T')[0];

    // Find all expired or expiring members today
    const { data: expiringMembers, error } = await supabase
      .from('members')
      .select('id, full_name, phone, membership_end')
      .lte('membership_end', today);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Auto mark status to expired
    if (expiringMembers && expiringMembers.length > 0) {
      const ids = expiringMembers.map((m: { id: string }) => m.id);
      await supabase
        .from('members')
        .update({ status: 'expired' })
        .in('id', ids);
    }

    // Auto check-out sweep for open gym sessions > 2 hours
    let autoCheckedOutCount = 0;
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      const todayDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const istMidnight = `${todayDateStr}T00:00:00+05:30`;

      const { data: openEntries } = await supabase
        .from('attendances')
        .select('id, tenant_id, member_id, punch_time, session_id, direction')
        .eq('status', 'granted')
        .gte('punch_time', istMidnight)
        .lte('punch_time', twoHoursAgo);

      if (openEntries && openEntries.length > 0) {
        for (const entry of openEntries) {
          if (entry.direction === 'out') continue;
          const { data: exitPunches } = await supabase
            .from('attendances')
            .select('id')
            .eq('member_id', entry.member_id)
            .eq('direction', 'out')
            .gte('punch_time', entry.punch_time)
            .limit(1);

          if (!exitPunches || exitPunches.length === 0) {
            const checkinTime = new Date(entry.punch_time).getTime();
            const autoCheckoutTime = new Date(checkinTime + 120 * 60000).toISOString();
            const sessionId = entry.session_id || crypto.randomUUID();

            await supabase.from('attendances').insert({
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
          }
        }
      }
    } catch (autoErr) {
      console.error('Error during cron auto-checkout:', autoErr);
    }

    return NextResponse.json({
      success: true,
      expired_members_count: expiringMembers?.length || 0,
      auto_checked_out_sessions: autoCheckedOutCount,
      checked_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}