import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendWhatsAppNotification } from '@/lib/whatsapp';

export async function GET() {
  const reports = {
    expiryRemindersSent: 0,
    inactivityAlertsSent: 0,
    errors: [] as string[],
  };

  try {
    const today = new Date();

    // ----------------------------------------------------
    // 1. 3-DAYS ADVANCE EXPIRY NOTIFICATION
    // ----------------------------------------------------
    const target3Days = new Date();
    target3Days.setDate(today.getDate() + 3);
    const targetDateStr = target3Days.toISOString().split('T')[0];

    const { data: expiringMembers, error: expError } = await supabase
      .from('members')
      .select('id, full_name, phone, membership_end, amount_paid')
      .eq('membership_end', targetDateStr);

    if (expError) {
      reports.errors.push(`Expiry fetch error: ${expError.message}`);
    } else if (expiringMembers) {
      for (const m of expiringMembers) {
        const upiLink = `upi://pay?pa=paytmqr@paytm&pn=GlitchFiestaGym&am=${m.amount_paid || 1500}&cu=INR`;
        const text = `Hey ${m.full_name}! 👋\n\nYour membership at GlitchFiesta Fitness ends in *3 Days* (${m.membership_end}).\n\nAvoid any gate disruption by renewing in advance via direct UPI:\n💳 ${upiLink}\n\nKeep moving! 💪`;

        await sendWhatsAppNotification({ phone: m.phone, message: text });
        reports.expiryRemindersSent++;
      }
    }

    // ----------------------------------------------------
    // 2. 5-DAYS INACTIVE RETENTION / CHURN ALERT
    // ----------------------------------------------------
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(today.getDate() - 5);

    // Active members fetch karo
    const { data: activeMembers } = await supabase
      .from('members')
      .select('id, full_name, phone')
      .gte('membership_end', today.toISOString().split('T')[0]);

    if (activeMembers) {
      for (const member of activeMembers) {
        // Member ki latest attendance check karo
        const { data: recentAttendance } = await supabase
          .from('attendances')
          .select('scanned_at')
          .eq('member_id', member.id)
          .eq('status', 'granted')
          .order('scanned_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Agar attendance nahi hai ya 5 din se pehle ki hai
        const isAbsent5Days =
          !recentAttendance || new Date(recentAttendance.scanned_at) < fiveDaysAgo;

        if (isAbsent5Days) {
          const churnNudge = `Hey ${member.full_name}! 🏋️\n\nWe noticed you haven't checked into the gym in the last 5 days. Consistency is where the magic happens!\n\nYour spot is waiting—let's hit a solid session today. See you on the floor! 💥`;

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
    const msg = err instanceof Error ? errorMsg(err) : 'Unknown cron error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}