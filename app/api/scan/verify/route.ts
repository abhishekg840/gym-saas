import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';

/**
 * POST /api/scan/verify
 *
 * Server-side gate check for the QR kiosk. Replaces the old client-side query,
 * which scanned every gym's members table. A scan is now resolved inside the
 * scanning gym's tenant only, and a frozen membership is refused at the gate.
 *
 * Body: { token: string, tenant_id?: string }
 *   - tenant_id falls back to the forgeos_tenant cookie set at login.
 */

interface ParsedToken {
  memberId: string;
  phone10: string;
}

/** Mirrors the token formats the member app emits: base64 JSON, "GF:phone:t", or raw digits. */
function parseQrToken(raw: string): ParsedToken | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  let memberId = '';
  let phoneLookup = '';

  if (text.startsWith('GF:')) {
    phoneLookup = text.split(':')[1] ?? '';
  } else {
    try {
      const payload = JSON.parse(atob(text)) as { id?: string; ph?: string };
      memberId = typeof payload.id === 'string' ? payload.id : '';
      phoneLookup = typeof payload.ph === 'string' ? payload.ph : '';
    } catch {
      phoneLookup = text;
    }
  }

  const digits = phoneLookup.replace(/[^0-9]/g, '');
  const phone10 = digits.length >= 10 ? digits.slice(-10) : digits;

  if (!memberId && phone10.length < 6) return null;
  return { memberId, phone10 };
}

/** Strips the DB row down to what the kiosk is allowed to see. */
function present(member: Record<string, unknown>, allowed: boolean, reason: string) {
  return {
    allowed,
    reason,
    member_id: (member.id as string) ?? null,
    name: (member.full_name as string) ?? 'Unknown',
    phone: (member.phone as string) ?? 'N/A',
    expiry: (member.membership_end as string) ?? null,
    is_frozen: Boolean(member.is_frozen),
    days_left: member.membership_end
      ? Math.ceil((new Date(member.membership_end as string).getTime() - Date.now()) / 86_400_000)
      : 0,
  };
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ allowed: false, reason: 'Invalid request payload.' }, { status: 400 });
  }

  const tenantId = String(payload.tenant_id ?? '') || readTenantCookie(request);
  if (!tenantId || !isUuid(tenantId)) {
    return NextResponse.json(
      { allowed: false, reason: 'This scanner is not linked to a gym. Sign in again.' },
      { status: 403 }
    );
  }

  const parsed = parseQrToken(String(payload.token ?? ''));
  if (!parsed) {
    return NextResponse.json({ allowed: false, reason: 'Unreadable QR code.' }, { status: 400 });
  }

  try {
    // Tenant filter is applied first, so a QR from Gym B never resolves at Gym A's gate.
    let query = supabase
      .from('members')
      .select('id, full_name, phone, membership_end, status, is_frozen, freeze_end_date, tenant_id')
      .eq('tenant_id', tenantId);

    query = parsed.memberId
      ? query.or(`id.eq.${parsed.memberId},phone.eq.${parsed.phone10}`)
      : query.or(`phone.eq.${parsed.phone10},phone.ilike.%${parsed.phone10}%`);

    const { data, error } = await query.limit(2).maybeSingle();

    if (error) {
      return NextResponse.json({ allowed: false, reason: 'Gate database unavailable.' }, { status: 500 });
    }

    // maybeSingle() yields null when the OR filter matched more than one member.
    if (!data) {
      const { data: candidates } = await (parsed.memberId
        ? supabase.from('members').select('id').eq('tenant_id', tenantId).or(`id.eq.${parsed.memberId},phone.eq.${parsed.phone10}`)
        : supabase.from('members').select('id').eq('tenant_id', tenantId).or(`phone.eq.${parsed.phone10},phone.ilike.%${parsed.phone10}%`));

      if (candidates && candidates.length > 1) {
        return NextResponse.json({ allowed: false, reason: 'Ambiguous code — ask the member to reopen their pass.' }, { status: 409 });
      }

      return NextResponse.json({
        allowed: false,
        reason: 'No member of this gym matches that code.',
        name: 'Not Found',
        phone: parsed.phone10 || 'N/A',
        expiry: null,
      });
    }

    const member = data as unknown as Record<string, unknown>;

    // Freeze beats expiry: a frozen pass must read "frozen", not "expired".
    if (member.is_frozen) {
      await supabase.from('attendances').insert([
        { tenant_id: tenantId, member_id: member.id as string, method: 'qr_kiosk', status: 'blocked_frozen' },
      ]);
      return NextResponse.json(
        present(member, false, `Membership frozen${member.freeze_end_date ? ` until ${member.freeze_end_date}` : ''}. See the front desk.`),
        { status: 200 }
      );
    }

    if (!member.membership_end || new Date(member.membership_end as string) < new Date()) {
      await supabase.from('attendances').insert([
        { tenant_id: tenantId, member_id: member.id as string, method: 'qr_kiosk', status: 'blocked_expired' },
      ]);
      return NextResponse.json(present(member, false, 'Membership expired. Renewal required.'));
    }

    await supabase.from('attendances').insert([
      { tenant_id: tenantId, member_id: member.id as string, method: 'qr_kiosk', status: 'granted' },
    ]);

    return NextResponse.json(present(member, true, 'Access approved. Welcome back!'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gate verification failed';
    return NextResponse.json({ allowed: false, reason: message }, { status: 500 });
  }
}
