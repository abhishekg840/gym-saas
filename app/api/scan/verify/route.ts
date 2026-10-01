import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { decodePassToken, isPassWindowCurrent, type PassTokenClaims } from '@/lib/passtoken';

/**
 * POST /api/scan/verify — the gate's half of a QR scan.
 *
 * Body: { token: string, tenant_id?: string }
 *   - tenant_id falls back to the forgeos_tenant cookie set at sign-in.
 *
 * The scan is resolved inside the scanning gym's tenant only, and the only things
 * that can refuse a pass are membership facts: a frozen membership, an expired
 * membership, a pass minted outside its rotating window, or a member id that does
 * not belong to this gym.
 *
 * Phase 5 removed the geofence re-check from this route on purpose. Neither the
 * phone nor the gate proves a location any more: the kiosk stands at the entrance,
 * so the person scanning is physically present by definition. A location check
 * that refuses a member standing at the door is a support ticket, not a security
 * control.
 */

interface ParsedToken {
  memberId: string;
  phone10: string;
  /** Decoded base64 claims, or null for legacy `GF:` / bare-digit codes. */
  claims: PassTokenClaims | null;
}

/** Mirrors the token formats the member app has emitted: base64 JSON, "GF:phone:t", or raw digits. */
function parseQrToken(raw: string): ParsedToken | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  let memberId = '';
  let phoneLookup = '';

  // decodePassToken is the single reader for our own format, so it must not be
  // re-implemented here with a looser idea of what a valid token looks like.
  const claims = decodePassToken(text);

  if (text.startsWith('GF:')) {
    phoneLookup = text.split(':')[1] ?? '';
  } else if (claims) {
    memberId = claims.id;
    phoneLookup = claims.ph;
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
  return { memberId, phone10, claims };
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
      { allowed: false, reason: 'No gym selected. Sign in at the kiosk first.' },
      { status: 403 }
    );
  }

  const parsed = parseQrToken(String(payload.token ?? payload.qr ?? ''));
  if (!parsed) {
    return NextResponse.json(
      { allowed: false, reason: 'That is not a gym pass. Ask the member to open their QR code.' },
      { status: 400 }
    );
  }

  try {
    // One lookup, scoped to this gym: a pass from another gym is simply not found.
    let query = supabase
      .from('members')
      .select('id, full_name, phone, membership_end, is_frozen, freeze_end_date, status')
      .eq('tenant_id', tenantId);

    query =
      parsed.memberId && isUuid(parsed.memberId)
        ? query.eq('id', parsed.memberId)
        : query.like('phone', `%${parsed.phone10}`);

    const { data, error } = await query.limit(1).maybeSingle();

    if (error) {
      return NextResponse.json(
        { allowed: false, reason: 'Could not verify this pass. Please use the front desk.' },
        { status: 500 }
      );
    }

    if (!data) {
      await supabase.from('attendances').insert([
        { tenant_id: tenantId, member_id: null, method: 'qr_kiosk', status: 'blocked_unknown' },
      ]);
      return NextResponse.json({
        allowed: false,
        reason: 'This pass does not belong to this gym. See the front desk.',
        member_id: null,
        name: 'Not Found',
        phone: parsed.phone10 || 'N/A',
        expiry: null,
      });
    }

    const member = data as unknown as Record<string, unknown>;

    // Freeze beats expiry: a frozen pass must read "frozen", not "expired".
    if (member.is_frozen) {
      await supabase.from('attendances').insert([
        {
          tenant_id: tenantId,
          member_id: member.id as string,
          method: 'qr_kiosk',
          status: 'blocked_frozen',
        },
      ]);
      return NextResponse.json(
        present(
          member,
          false,
          `Membership frozen${member.freeze_end_date ? ` until ${member.freeze_end_date}` : ''}. See the front desk.`
        ),
        { status: 200 }
      );
    }

    if (!member.membership_end || new Date(member.membership_end as string) < new Date()) {
      await supabase.from('attendances').insert([
        {
          tenant_id: tenantId,
          member_id: member.id as string,
          method: 'qr_kiosk',
          status: 'blocked_expired',
        },
      ]);
      return NextResponse.json(present(member, false, 'Membership expired. Renewal required.'));
    }

    // A token we minted must be fresh: the rotating window is what makes last
    // hour's screenshot useless. Legacy `GF:` and bare-digit codes carry no
    // window, so they are left to the membership checks above.
    if (parsed.claims && !isPassWindowCurrent(parsed.claims.t)) {
      await supabase.from('attendances').insert([
        {
          tenant_id: tenantId,
          member_id: member.id as string,
          method: 'qr_kiosk',
          status: 'blocked_stale',
        },
      ]);
      return NextResponse.json(
        present(member, false, 'This QR code has expired. Ask the member to reopen their pass.')
      );
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
