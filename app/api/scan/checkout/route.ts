import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { isPassWindowCurrent } from '@/lib/passtoken';
import { verifyPassToken } from '@/lib/passtoken-server';
import { resolveGrants } from '@/lib/entitlements';
import { deny } from '@/lib/entitlements-server';
import { databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/scan/checkout — the gate's half of an EXIT (check-out) scan.
 *
 * Body: { token: string, tenant_id?: string }
 *   - tenant_id falls back to the forgeos_tenant cookie set at sign-in.
 *
 * This is the exit twin of /api/scan/verify. It runs the SAME signed-pass gate
 * first — an unsigned or forged token is refused before anything else, exactly
 * like entry — and then hands off to fn_gate_checkout, which re-checks the
 * membership is active (so a tampered/expired pass cannot fabricate a clean
 * walk-out), pairs the most recent same-day ENTRY, stamps the workout duration
 * and writes the OUT row. That OUT row is what drops the member from the live
 * floor count (fn_gym_live_crowd reads the latest punch per member), so the
 * occupancy decrement is the insert itself, not a separate counter.
 *
 * Reply: { allowed, reason, member_id, name, phone, direction:'out',
 *          duration_minutes, checkin_at, checkout_at, paired }
 * A refusal is a 200 — it is an answer, not a transport failure — except for a
 * missing/forged pass (400/403), which mirrors /api/scan/verify.
 */

/** Refused unsigned/legacy payload: there is nothing to trust inside it. */
const LEGACY_PASS_MESSAGE =
  'That is not a gym pass. Ask the member to open their QR code in the app.';
/** Refused bad signature: someone edited or invented this token. */
const FORGED_PASS_MESSAGE =
  'This pass is not valid. Ask the member to reopen their pass in the app.';

/** The check-out path is inside the console, so a non-super-admin cannot walk
 *  an owner's exit. Reject before anything else. */
async function superAdminOnly(tenantId: string): Promise<Response | null> {
  const grants = await resolveGrants(tenantId);
  return deny(grants, () => {
    return NextResponse.json(
      { ok: false, error: 'Only the super-admin may record check-outs.' },
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

  // Signature first, claims second — always in that order, same as entry.
  const verification = verifyPassToken(String(payload.token ?? payload.qr ?? ''));

  if (!verification.ok) {
    void supabase.from('attendances').insert([
      { tenant_id: tenantId, member_id: null, method: 'qr_kiosk_checkout', status: 'blocked_invalid_pass' },
    ]);
    if (verification.reason === 'forged') {
      return NextResponse.json(
        { allowed: false, reason: FORGED_PASS_MESSAGE, member_id: null, name: 'Not Found', phone: 'N/A' },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { allowed: false, reason: LEGACY_PASS_MESSAGE, member_id: null, name: 'Not Found', phone: 'N/A' },
      { status: 400 }
    );
  }

  const claims = verification.claims;
  if (!isUuid(claims.id)) {
    return NextResponse.json(
      { allowed: false, reason: LEGACY_PASS_MESSAGE, member_id: null, name: 'Not Found', phone: 'N/A' },
      { status: 400 }
    );
  }

  // A pass we signed must be fresh: the rotating window is what makes last
  // hour's screenshot useless. Stamped server-side at mint time, so a client
  // cannot choose its own either.
  if (!isPassWindowCurrent(claims.t)) {
    void supabase.from('attendances').insert([
      { tenant_id: tenantId, member_id: claims.id, method: 'qr_kiosk_checkout', status: 'blocked_stale' },
    ]);
    return NextResponse.json({
      allowed: false,
      reason: 'This QR code has expired. Ask the member to reopen their pass.',
      member_id: claims.id,
      name: 'Unknown',
      phone: claims.ph || 'N/A',
    });
  }

  // The membership re-check, the same-day pairing, the duration and the OUT row
  // all happen inside fn_gate_checkout in one transaction.
  const { data, error } = await supabase.rpc('fn_gate_checkout', {
    p_tenant_id: tenantId,
    p_member_id: claims.id,
    p_method: 'qr_kiosk_checkout',
  });

  if (error) return databaseError(error, 'Could not record this check-out.');

  const verdict = (data ?? {}) as Record<string, unknown>;
  const allowed = verdict.access === 'GRANTED';

  return NextResponse.json({
    allowed,
    reason: (verdict.reason as string) ?? (allowed ? 'Session complete.' : 'Check-out refused.'),
    member_id: (verdict.member_id as string) ?? claims.id,
    name: (verdict.member_name as string) ?? 'Unknown',
    phone: claims.ph || 'N/A',
    direction: 'out',
    status: (verdict.status as string) ?? null,
    session_id: (verdict.session_id as string) ?? null,
    duration_minutes: typeof verdict.duration_minutes === 'number' ? verdict.duration_minutes : null,
    checkin_at: (verdict.checkin_at as string) ?? null,
    checkout_at: (verdict.checkout_at as string) ?? null,
    paired: Boolean(verdict.paired),
  });
}
