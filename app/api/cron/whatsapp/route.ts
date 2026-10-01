import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendWhatsAppNotification, waMessages } from '@/lib/whatsapp';

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
 */
export async function GET() {
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

    // Gym names for the message copy — one read, then a Map lookup per member.
    const { data: tenants } = await supabase.from('tenants').select('id, name');
    const gymName = new Map(
      (tenants ?? []).map((tenant) => [tenant.id as string, (tenant.name as string) || 'your gym'])
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
      const upiLink = `upi://pay?pa=paytmqr@paytm&pn=GlitchFiestaGym&am=${member.amount_paid || 1500}&cu=INR`;
      await sendWhatsAppNotification({
        phone: member.phone,
        message: waMessages.expiry({
          name: member.full_name,
          gymName: gymName.get(member.tenant_id ?? '') ?? 'your gym',
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
          gymName: gymName.get(member.tenant_id ?? '') ?? 'your gym',
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
          const gym = gymName.get(member.tenant_id ?? '') ?? 'the gym';
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
