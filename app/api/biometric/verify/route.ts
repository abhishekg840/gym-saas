import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendWhatsAppNotification } from '@/lib/whatsapp';
import { isUuid } from '@/lib/session';

// Health probe for the browser / device onboarding checklist.
export async function GET() {
  return NextResponse.json({
    status: 'online',
    message: 'Biometric Cloud Gateway Active. Ready for POST verification from Raspberry Pi.',
  });
}

const MEMBER_COLUMNS =
  'id, full_name, phone, membership_end, status, is_frozen, freeze_end_date, tenant_id';

/**
 * Fingerprint verification endpoint called by the Raspberry Pi gateway.
 *
 * NOTE: biometric_id uniqueness is now (tenant_id, biometric_id), so the same
 * slot number can legitimately exist in two gyms. A device sends its own tenant
 * via the X-Tenant-Id header; without it, an ambiguous slot is refused instead
 * of the server guessing which gym owns the finger.
 */
export async function POST(req: Request) {
  try {
    const { biometric_id } = await req.json();

    if (biometric_id === undefined || biometric_id === null) {
      return NextResponse.json(
        { success: false, error: 'Biometric ID missing' },
        { status: 400 }
      );
    }

    const headerTenant = req.headers.get('x-tenant-id');
    const tenantId = isUuid(headerTenant) ? (headerTenant as string) : null;

    // 1. Fetch member(s) linked to this fingerprint template ID
    let query = supabase.from('members').select(MEMBER_COLUMNS).eq('biometric_id', biometric_id);
    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data: matches, error } = await query.limit(2);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    if (!matches || matches.length === 0) {
      return NextResponse.json(
        {
          success: false,
          allowed: false,
          message: 'Member not registered',
        },
        { status: 404 }
      );
    }

    if (matches.length > 1) {
      return NextResponse.json(
        {
          success: false,
          allowed: false,
          message: 'Biometric slot exists in multiple gyms. Send X-Tenant-Id with this device request.',
        },
        { status: 409 }
      );
    }

    const member = matches[0] as {
      id: string;
      full_name: string;
      phone: string;
      membership_end: string | null;
      is_frozen: boolean;
      tenant_id: string | null;
    };

    // 2. Frozen beats expiry — a frozen pass is a temporary hold, not a dues problem.
    if (member.is_frozen) {
      await supabase.from('attendances').insert([
        {
          tenant_id: member.tenant_id,
          member_id: member.id,
          method: 'biometric',
          status: 'blocked_frozen',
        },
      ]);

      return NextResponse.json({
        success: true,
        allowed: false,
        name: member.full_name,
        message: 'Membership Frozen',
      });
    }

    // 3. Check Expiry
    const isExpired = !member.membership_end || new Date(member.membership_end) < new Date();

    if (isExpired) {
      await supabase.from('attendances').insert([
        {
          tenant_id: member.tenant_id,
          member_id: member.id,
          method: 'biometric',
          status: 'blocked_expired',
        },
      ]);

      return NextResponse.json({
        success: true,
        allowed: false,
        name: member.full_name,
        message: 'Membership Expired',
      });
    }

    // 4. Mark Granted Attendance
    await supabase.from('attendances').insert([
      {
        tenant_id: member.tenant_id,
        member_id: member.id,
        method: 'biometric',
        status: 'granted',
      },
    ]);

    // 5. Trigger WhatsApp Greeting
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
