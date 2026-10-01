import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/member/checkin — geo-fenced mobile self check-in (Module 8.2).
 *
 * Body: { member_id, latitude, longitude, accuracy?, branch_id? }
 *
 * The phone captures the fix (Capacitor Geolocation on Android, navigator on
 * the web — see app/member/page.tsx) and the server re-derives the distance
 * from the tenant's saved coordinates inside fn_member_self_checkin BEFORE any
 * attendance row exists. Membership checks run in the same transaction: frozen
 * beats expired, expired beats geofence, and an armed fence without a fix
 * fails closed.
 *
 * Reply: { ok, access: "GRANTED" | "DENIED", reason, streak?, distance_meters? }
 * A DENIED verdict is still a 200 — it is an answer, not a transport failure —
 * except for validation (400) and a missing member (404).
 */

const toNumber = (raw: unknown): number | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isFinite(value) ? value : null;
};

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const memberId = body.member_id ?? body.memberId;
  if (!isUuid(memberId)) return badRequest('member_id must be a valid UUID.');

  const latitude = toNumber(body.latitude ?? body.lat);
  const longitude = toNumber(body.longitude ?? body.lon ?? body.lng);
  if (latitude === null || longitude === null) {
    return badRequest('latitude and longitude are required for a self check-in.');
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return badRequest('latitude/longitude are out of range.');
  }

  const accuracy = toNumber(body.accuracy);
  const rawBranch = body.branch_id ?? body.branchId;
  const branchId = isUuid(rawBranch) ? rawBranch : null;

  const { data, error } = await supabase.rpc('fn_member_self_checkin', {
    p_member_id: memberId,
    p_lat: latitude,
    p_lon: longitude,
    p_accuracy: accuracy,
    p_branch_id: branchId,
  });

  if (error) return databaseError(error, 'Could not record your check-in.');

  const verdict = (data ?? {}) as Record<string, unknown>;
  const granted = verdict.access === 'GRANTED';

  return NextResponse.json({
    ok: true,
    access: verdict.access ?? 'DENIED',
    reason: verdict.reason ?? 'Check-in refused.',
    status: verdict.status ?? null,
    member_name: verdict.member_name ?? null,
    membership_end: verdict.membership_end ?? null,
    attendance_id: verdict.attendance_id ?? null,
    distance_meters: verdict.distance_meters ?? null,
    radius_meters: verdict.radius_meters ?? null,
    geofence_enforced: Boolean(verdict.geofence_enforced),
    streak: verdict.streak ?? null,
    granted,
  });
}
