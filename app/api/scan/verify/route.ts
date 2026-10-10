import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { databaseError, readJsonBody } from '@/lib/sqlstate';
import { resolveGrants } from '@/lib/entitlements';
import { deny } from '@/lib/entitlements-server';
import { verifyPassToken, type PassTokenClaims } from '@/lib/passtoken-server';

/**
 * POST /api/scan/verify — the gate's entry twin of /api/scan/checkout.
 *
 * A bare always-granted gate is a door rigged open: a visitor could walk in
 * with a printed screen capture and the live floor count would never move.
 * So this endpoint verifies the pass token first (a stale or forged token is
 * refused before anything else), then hands the member to fn_gate_auto_punch,
 * which decides direction, pairs the most recent same-day OUT, stamps the
 * workout duration and returns the two PUNCH rows.
 *
 * The direction is auto-detected from the attendance history, so the same
 * endpoint serves entry and exit — the button on the screen matters only for
 * the UI label, not for the door decision. A paired OUT is the expensive case
 * (it writes the OUT row + moves the live crowd count), and both the entry
 * punch and the OUT run in one transaction, so nothing races at a busy
 * membership desk.
 *
 * Reply: { allowed, reason, member_id, name, phone, duration_minutes,
 *          direction: 'in'|'out', checkin_at, checkout_at, paired, membership_end }
 *
 *   direction:   'in' when this scan is the newest row (entry), 'out' when it
 *                is the paired OUT that closes the session.
 *   paired:      true only when the OUT closed a same-day session.
 *   duration_minutes: 0 unless paired=true, i.e. the OUT wrote the duration.
 *
 * A refusal is a 200 — it is an answer, not a transport failure. A missing or
 * forged token is 400/403, same as the checkout route.
 */

const EXPIRED_PASS_MESSAGE = 'This QR code has expired. Ask the member to reopen their pass.';

/** The gate path is inside the console, so a non-super-admin cannot see or
 *  shape anyone's attendance record. Reject before anything else. */
async function autoPunchOnly(tenantId: string): Promise<Response | null> {
  const grants = await resolveGrants(tenantId);
  return deny(grants, () => {
    return NextResponse.json(
      { ok: false, error: 'Only the super-admin may use the auto-gate.' },
      { status: 403 }
    );
  });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const tenantId = String(payload.tenant_id ?? '') || readTenantCookie(request);
  if (!tenantId || !isUuid(tenantId)) {
    return NextResponse.json(
      { allowed: false, reason: 'No gym selected. Sign in at the kiosk first.' },
      { status: 403 }
    );
  }

  // Signature first, claims second — always in that order, same as checkout.
  const verification = verifyPassToken(String(payload.token ?? payload.qr ?? ''));

  if (!verification.ok) {
    void supabase.from('attendances').insert([
      { tenant_id: tenantId, member_id: null, method: 'qr_kiosk_verify', status: 'blocked_invalid_pass' },
    ]);
    if (verification.reason === 'forged') {
      return NextResponse.json(
        { allowed: false, reason: 'This pass is not valid. Ask the member to reopen their pass.', member_id: null, name: 'Not Found', phone: 'N/A' },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { allowed: false, reason: 'This pass is not valid. Ask the member to open their QR code in the app.' },
      { status: 400 }
    );
  }

  const claims = verification.claims as PassTokenClaims;
  if (!isUuid(claims.id)) {
    return NextResponse.json(
      { allowed: false, reason: 'That is not a gym pass. Ask the member to open their QR code in the app.' },
      { status: 400 }
    );
  }

  // The pass carries its own window: a stamp minted an hour ago is a stale
  // screenshot, and is refused before it reaches the RPC. The gate re-checks
  // the floor anyway, so an expired pass is a cheap no-op.
  if (!isPassWindowCurrent(claims.t)) {
    void supabase.from('attendances').insert([
      { tenant_id: tenantId, member_id: claims.id, method: 'qr_kiosk_verify', status: 'blocked_stale' },
    ]);
    return NextResponse.json({
      allowed: false,
      reason: EXPIRED_PASS_MESSAGE,
      member_id: claims.id,
      name: 'Unknown',
      phone: claims.ph || 'N/A',
    });
  }

  // The one decision that closes every session: entry or exit. Inside
  // fn_gate_auto_punch so a tampered client cannot push the direction.
  const { data, error } = await supabase.rpc('fn_gate_auto_punch', {
    p_tenant_id: tenantId,
    p_member_id: claims.id,
    p_method: 'qr_kiosk_verify',
  });

  if (error) return databaseError(error, 'Could not record this scan.');

  const verdict = (data ?? {}) as Record<string, unknown>;
  const allowed = verdict.access === 'GRANTED';

  return NextResponse.json({
    allowed,
    reason: (verdict.reason as string) ?? (allowed ? 'Pass valid.' : 'Scan refused.'),
    member_id: (verdict.member_id as string) ?? claims.id,
    name: (verdict.member_name as string) ?? 'Unknown',
    phone: claims.ph || 'N/A',
    direction: verdict.direction ?? null,
    session_id: (verdict.session_id as string) ?? null,
    duration_minutes: typeof verdict.duration_minutes === 'number' ? verdict.duration_minutes : null,
    checkin_at: (verdict.checkin_at as string) ?? null,
    checkout_at: (verdict.checkout_at as string) ?? null,
    paired: Boolean(verdict.paired),
    membership_end: (verdict.membership_end as string) ?? null,
  });
}

/** Fresh enough to act on right now. Mirrors lib/passtoken.isPassWindowCurrent. */
function isPassWindowCurrent(timestamp: number): boolean {
  if (!Number.isFinite(timestamp)) return false;
  const current = Math.floor(Date.now() / 30_000);
  return Math.abs(current - timestamp) <= 2;
}
