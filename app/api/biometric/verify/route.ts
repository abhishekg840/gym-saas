import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendWhatsAppNotification } from '@/lib/whatsapp';

// Browser me test karne ke liye GET method
export async function GET() {
  return NextResponse.json({
    status: 'online',
    message: 'Biometric Cloud Gateway Active. Ready for POST verification from Raspberry Pi.',
  });
}

// Raspberry Pi se fingerprint verify karne ke liye POST method
export async function POST(req: Request) {
  try {
    const { biometric_id } = await req.json();

    if (biometric_id === undefined || biometric_id === null) {
      return NextResponse.json(
        { success: false, error: 'Biometric ID missing' },
        { status: 400 }
      );
    }

    // 1. Fetch member linked to this fingerprint template ID
    const { data: member, error } = await supabase
      .from('members')
      .select('id, full_name, phone, membership_end, status')
      .eq('biometric_id', biometric_id)
      .maybeSingle();

    if (error || !member) {
      return NextResponse.json(
        {
          success: false,
          allowed: false,
          message: 'Member not registered',
        },
        { status: 404 }
      );
    }

    // 2. Check Expiry
    const isExpired = new Date(member.membership_end) < new Date();

    if (isExpired) {
      await supabase.from('attendances').insert([
        { member_id: member.id, method: 'biometric', status: 'blocked_expired' },
      ]);

      return NextResponse.json({
        success: true,
        allowed: false,
        name: member.full_name,
        message: 'Membership Expired',
      });
    }

    // 3. Mark Granted Attendance
    await supabase.from('attendances').insert([
      { member_id: member.id, method: 'biometric', status: 'granted' },
    ]);

    // 4. Trigger WhatsApp Greeting
    sendWhatsAppNotification({
      phone: member.phone,
      message: `Welcome to the gym, ${member.full_name}! 💪 Your biometric attendance has been recorded.`,
    }).catch((err) => console.error('WhatsApp notify error:', err));

    return NextResponse.json({
      success: true,
      allowed: true,
      name: member.full_name,
      message: 'Attendance Successful',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}