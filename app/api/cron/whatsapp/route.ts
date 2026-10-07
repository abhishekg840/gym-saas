import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendWhatsAppNotification, waMessages } from '@/lib/whatsapp';
import { cronUnauthorized, isCronAuthorized } from '@/lib/cron-auth';

/**
 * GET /api/cron/whatsapp — the retention engine (Module 9.2), scheduled at
 * 03:00 daily via vercel.json.
 *
 *   1. Expiry reminders 3 days BEFORE the end date, and again ON the day
 *      (both composed by waMessages.expiry so the copy lives in one place).
 *   2. The 5-day inactivity nudge for members who stopped showing up.
 *
 * Each message goes through the optional gateway webhook; without
 * WHATSAPP_GATEWAY_URL the dispatcher returns a wa.me deep link instead.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
 * when the project defines CRON_SECRET; everything else is 401.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return cronUnauthorized();

  const reports = {
    expiryRemindersSent: 0,
    todayRemindersSent: 0,
    inactivityAlertsSent: 0,
    errors: [] as string[],
  };

  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const inDays = (days: number): string => {
      const target = new Date();
      target.setDate(today.getDate() + days);
      return target.toISOString().split('T')[0];
    };

    // Gym identity + payment details for the message copy — one read, then a
    // Map lookup per member. The UPI VPA is per-tenant now (P0-4): a gym that
    // never configured one gets the neutral "renew at the front desk" copy
    // rather than somebody else's payment QR.
    const { data: tenants } = await supabase.from('tenants').select('id, name, upi_id');
    const gyms = new Map<string, { name: string; upiId: string | null }>(
      (tenants ?? []).map((tenant) => [
        tenant.id as string,
        {
          name: (tenant.name as string) || 'your gym',
          upiId:
            typeof tenant.upi_id === 'string' && tenant.upi_id.trim()
              ? tenant.upi_id.trim()
              : null,
        },
      ])
    );

    const loadExpiring = async (dateStr: string) => {
      const { data, error } = await supabase
        .from('members')
        .select('id, full_name, phone, membership_end, amount_paid, tenant_id')
        .eq('membership_end', dateStr);
      if (error) reports.errors.push(`Expiry fetch error (${dateStr}): ${error.message}`);
      return data ?? [];
    };

    // ---- 1a. Three days out ------------------------------------------------
    for (const member of await loadExpiring(inDays(3))) {
      const gym = gyms.get(member.tenant_id ?? '');
      // The tenant's own VPA only. Without one, renewUrl stays undefined and
      // the template simply omits the Quick renew line — the front-desk
      // sentence carries the message instead.
      const upiLink = gym?.upiId
        ? `upi://pay?pa=${encodeURIComponent(gym.upiId)}&pn=${encodeURIComponent(gym.name)}&am=${member.amount_paid || 1500}&cu=INR`
        : undefined;
      await sendWhatsAppNotification({
        phone: member.phone,
        message: waMessages.expiry({
          name: member.full_name,
          gymName: gym?.name ?? 'your gym',
          endDate: String(member.membership_end),
          daysLeft: 3,
          renewUrl: upiLink,
        }),
      });
      reports.expiryRemindersSent++;
    }

    // ---- 1b. On the expiry date itself -------------------------------------
    for (const member of await loadExpiring(todayStr)) {
      await sendWhatsAppNotification({
        phone: member.phone,
        message: waMessages.expiry({
          name: member.full_name,
          gymName: gyms.get(member.tenant_id ?? '')?.name ?? 'your gym',
          endDate: String(member.membership_end),
          daysLeft: 0,
        }),
      });
      reports.todayRemindersSent++;
    }

    // ---- 2. 5-days inactive retention / churn alert -------------------------
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(today.getDate() - 5);

    const { data: activeMembers } = await supabase
      .from('members')
      .select('id, full_name, phone, tenant_id')
      .gte('membership_end', todayStr);

    if (activeMembers) {
      for (const member of activeMembers) {
        const { data: recentAttendance } = await supabase
          .from('attendances')
          .select('scanned_at')
          .eq('member_id', member.id)
          .eq('status', 'granted')
          .order('scanned_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const isAbsent5Days =
          !recentAttendance || new Date(recentAttendance.scanned_at) < fiveDaysAgo;

        if (isAbsent5Days) {
          const gym = gyms.get(member.tenant_id ?? '')?.name ?? 'the gym';
          const churnNudge = `Hey ${member.full_name}! 🏋️\n\nWe noticed you haven't checked into ${gym} in the last 5 days. Consistency is where the magic happens!\n\nYour spot is waiting—let's hit a solid session today. See you on the floor! 💥`;
          await sendWhatsAppNotification({ phone: member.phone, message: churnNudge });
          reports.inactivityAlertsSent++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: reports,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown cron error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
