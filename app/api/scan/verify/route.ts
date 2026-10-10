import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { isPassWindowCurrent } from '@/lib/passtoken';
import { verifyPassToken } from '@/lib/passtoken-server';

/**
 * POST /api/scan/verify — the gate's half of a QR scan.
 *
 * Body: { token: string, tenant_id?: string }
 *   - tenant_id falls back to the forgeos_tenant cookie set at sign-in.
 *
 * SIGNED PASSES ONLY (P0-2)
 * -------------------------
 * The token's HMAC signature is verified BEFORE a single claim inside it is
 * read. Unsigned payloads — bare phone strings, `GF:phone:t`, or plain base64
 * JSON claims — are refused and logged as `blocked_invalid_pass`; they used to
 * be accepted for any gym, which made "know a member's phone number" equal to
 * "hold their gate pass". A signature that does not check out (403) is treated
 * as an outright forgery attempt. The only thing that can refuse a VALID pass
 * is a membership fact: frozen, expired, or outside its rotating window.
 *
 * Phase 5 removed the geofence re-check from this route on purpose. Neither the
 * phone nor the gate proves a location any more: the kiosk stands at the entrance,
 * so the person scanning is physically present by definition. A location check
 * that refuses a member standing at the door is a support ticket, not a security
 * control.
 */

/** Refused unsigned/legacy payload: there is nothing to trust inside it. */
const LEGACY_PASS_MESSAGE =
  'That is not a gym pass. Ask the member to open their QR code in the app.';
/** Refused bad signature: someone edited or invented this token. */
const FORGED_PASS_MESSAGE =
  'This pass is not valid. Ask the member to reopen their pass in the app.';

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

/** A refusal we can attribute to the scanning gym but not to any member. */
function refuseUnattributed(tenantId: string, reason: string, status: number) {
  void supabase.from('attendances').insert([
    { tenant_id: tenantId, member_id: null, method: 'qr_kiosk', status: 'blocked_invalid_pass' },
  ]);
  return NextResponse.json(
    { allowed: false, reason, member_id: null, name: 'Not Found', phone: 'N/A', expiry: null },
    { status }
  );
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

  // Signature first, claims second — always in that order.
  const verification = verifyPassToken(String(payload.token ?? payload.qr ?? ''));
  if (!verification.ok) {
    if (verification.reason === 'unconfigured') {
      // Not the scanner's fault and not an attack: this deployment has no key
      // to check against. Say so instead of logging a phantom forgery.
      return NextResponse.json(
        {
          allowed: false,
          reason: 'Gate passes are temporarily unavailable. Please use the front desk.',
        },
        { status: 503 }
      );
    }

    if (verification.reason === 'forged') {
      console.warn('[scan/verify] signature mismatch refused at the kiosk.');
      return refuseUnattributed(tenantId, FORGED_PASS_MESSAGE, 403);
    }

    // 'unsigned' (legacy bare-phone / GF: / unsigned JSON) or 'malformed'.
    return refuseUnattributed(tenantId, LEGACY_PASS_MESSAGE, 400);
  }

  const claims = verification.claims;
  if (!isUuid(claims.id)) {
    return refuseUnattributed(tenantId, LEGACY_PASS_MESSAGE, 400);
  }

  try {
    // One lookup, scoped to this gym: a pass from another gym is simply not found.
    const { data, error } = await supabase
      .from('members')
      .select('id, full_name, phone, membership_end, is_frozen, freeze_end_date, status')
      .eq('tenant_id', tenantId)
      .eq('id', claims.id)
      .limit(1)
      .maybeSingle();

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
        phone: claims.ph || 'N/A',
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

    // A pass we signed must be fresh: the rotating window is what makes last
    // hour's screenshot useless. The window index was stamped server-side at
    // mint time, so a client cannot choose its own either.
    if (!isPassWindowCurrent(claims.t)) {
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
      {
        tenant_id: tenantId,
        member_id: member.id as string,
        method: 'qr_kiosk',
        status: 'granted',
        direction: 'in',
        // Mint a session id at entry so an exit (/api/scan/checkout ->
        // fn_gate_checkout) can pair to THIS punch and stamp a duration, even
        // when several sessions happen across one day.
        session_id: crypto.randomUUID(),
      },
    ]);

    return NextResponse.json(present(member, true, 'Access approved. Welcome back!'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gate verification failed';
    return NextResponse.json({ allowed: false, reason: message }, { status: 500 });
  }
}
