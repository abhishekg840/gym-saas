import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, normalizePhone10 } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import { PASS_WINDOW_MS, type PassGeoProof } from '@/lib/passtoken';
import { signPassToken } from '@/lib/passtoken-server';

/**
 * POST /api/member/pass/mint — the ONLY way a gate pass comes into existence.
 *
 * Body: { id: string, ph: string, geo?: PassGeoProof }
 * Reply: { ok: true, token, ttl_ms } | { ok: false, error }
 *
 * Why this exists (P0-2): the member app used to build the QR string in the
 * browser with plain btoa, which anyone could reproduce for any member id.
 * Signing has to happen where the key lives, so the claims now travel here,
 * are re-checked against the members table, get a SERVER-stamped window index
 * (a client cannot mint a pass valid for next week), and leave signed with
 * HMAC-SHA256.
 *
 * Residual trust note: without a server session (P0-4) the proof of identity
 * is "knows this member's id and phone" — strictly stronger than the old
 * "knows a phone number", and the kiosk still re-checks freeze, expiry and
 * window at scan time.
 */
const MEMBER_FIELDS = 'id, phone';

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const memberId = isUuid(body.id ?? body.member_id ?? body.memberId)
    ? String(body.id ?? body.member_id ?? body.memberId)
    : null;
  const phone10 = normalizePhone10(String(body.ph ?? body.phone ?? ''));

  if (!memberId) return badRequest('A valid member id is required to mint a pass.');
  if (phone10.length !== 10) return badRequest('A valid member phone number is required.');

  // Optional location proof: kept only if every measurable field is a real
  // number — a proof we cannot re-measure is worse than no proof.
  let geo: PassGeoProof | undefined;
  if (body.geo !== undefined && body.geo !== null) {
    const raw = body.geo as Record<string, unknown>;
    const num = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const lat = num(raw.lat);
    const lon = num(raw.lon);
    const distance = num(raw.distance_meters);
    if (!raw || typeof raw !== 'object' || lat === null || lon === null || distance === null) {
      return badRequest('Location proof is malformed.');
    }
    geo = {
      lat,
      lon,
      accuracy_meters: num(raw.accuracy_meters),
      distance_meters: distance,
      radius_meters: num(raw.radius_meters) ?? 0,
    };
  }

  try {
    const { data, error } = await supabase
      .from('members')
      .select(MEMBER_FIELDS)
      .eq('id', memberId)
      .maybeSingle();

    if (error) return databaseError(error, 'Could not mint this pass.');
    if (!data) {
      return NextResponse.json(
        { ok: false, error: 'No membership found for this pass.' },
        { status: 404 }
      );
    }

    // The claim must match the member row, or a leaked id alone would be a
    // forgeable pass. Normalise both sides: legacy rows store +91 prefixes.
    const storedPhone = normalizePhone10(String((data as { phone?: unknown }).phone ?? ''));
    if (storedPhone !== phone10) {
      console.warn('[pass/mint] phone claim does not match member row; refused.');
      return NextResponse.json(
        { ok: false, error: 'This pass does not belong to that member.' },
        { status: 403 }
      );
    }

    const token = signPassToken({
      id: memberId,
      ph: phone10,
      t: Math.floor(Date.now() / PASS_WINDOW_MS),
      ...(geo ? { geo } : {}),
    });

    if (!token) {
      // Fail closed: an unsigned pass would be exactly the forgery P0-2 exists
      // to remove. Set AUTH_SECRET on the deployment to restore minting.
      return NextResponse.json(
        { ok: false, error: 'Pass signing is not configured on this server (set AUTH_SECRET).' },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true, token, ttl_ms: PASS_WINDOW_MS });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Pass minting failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}