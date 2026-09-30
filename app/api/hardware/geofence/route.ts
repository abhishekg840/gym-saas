import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import {
  DEFAULT_GEOFENCE_RADIUS,
  parseCoordinate,
  type GymGeofence,
} from '@/lib/geofence';

/**
 * /api/hardware/geofence — Module 2.2 configuration side.
 *
 *   GET  ?tenant_id=...   -> { ok, geofence }
 *   POST { tenant_id, latitude, longitude, geofence_radius_meters, enforce_geofence }
 *
 * These are the four columns 0003 adds to public.tenants. The owner sets them
 * once from the Hardware Console; the member pass reads them on every open.
 *
 * tenants carries no api key and the app already exposes gym identity (name,
 * phone) to this role, so a direct tenant-scoped UPDATE is in keeping with the
 * rest of the app. The scope still comes from the session cookie when the body
 * omits it, and a non-UUID tenant is a hard 403 rather than an unscoped update.
 */

const TENANT_FIELDS =
  'id, name, latitude, longitude, geofence_radius_meters, enforce_geofence';

function present(row: Record<string, unknown>): GymGeofence {
  return {
    tenant_id: String(row.id),
    tenant_name: (row.name as string) ?? 'this gym',
    latitude: parseCoordinate(row.latitude),
    longitude: parseCoordinate(row.longitude),
    geofence_radius_meters: Number(row.geofence_radius_meters) || DEFAULT_GEOFENCE_RADIUS,
    enforce_geofence: Boolean(row.enforce_geofence),
  };
}

/** Accepts a number, a numeric string, or null (which clears the coordinate). */
function optionalCoordinate(raw: unknown): { value: number | null; invalid: boolean } {
  if (raw === null || raw === undefined || raw === '') return { value: null, invalid: false };
  const value = parseCoordinate(raw);
  return value === null ? { value: null, invalid: true } : { value, invalid: false };
}

export async function GET(request: Request) {
  const tenantId =
    new URL(request.url).searchParams.get('tenant_id') ?? readTenantCookie(request);
  if (!isUuid(tenantId)) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  const { data, error } = await supabase
    .from('tenants')
    .select(TENANT_FIELDS)
    .eq('id', tenantId)
    .maybeSingle();

  if (error) return databaseError(error, 'Could not load the geofence settings.');
  if (!data) return badRequest('That gym does not exist.', 404);

  return NextResponse.json({ ok: true, geofence: present(data as Record<string, unknown>) });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = body.tenant_id ?? body.tenantId ?? readTenantCookie(request);
  if (!isUuid(tenantId)) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  const latitude = optionalCoordinate(body.latitude);
  if (latitude.invalid) {
    return badRequest('latitude must be a number between -90 and 90.');
  }
  const longitude = optionalCoordinate(body.longitude);
  if (longitude.invalid) {
    return badRequest('longitude must be a number between -180 and 180.');
  }

  // Half a coordinate pair is the classic paste mistake, and it would leave the
  // gate comparing a real latitude against a null longitude forever.
  if ((latitude.value === null) !== (longitude.value === null)) {
    return badRequest('latitude and longitude must be saved together.');
  }

  const rawRadius = body.geofence_radius_meters ?? body.radiusMeters;
  let radius = DEFAULT_GEOFENCE_RADIUS;
  if (rawRadius !== null && rawRadius !== undefined && rawRadius !== '') {
    const value = Number(rawRadius);
    if (!Number.isFinite(value)) return badRequest('geofence_radius_meters must be a number.');
    radius = Math.round(value);
    if (radius < 10 || radius > 20000) {
      return badRequest('geofence_radius_meters must be between 10 and 20000.');
    }
  }

  const enforce =
    body.enforce_geofence ?? body.enforceGeofence ?? false;
  if (typeof enforce !== 'boolean') {
    return badRequest('enforce_geofence must be true or false.');
  }

  // Refusing to arm an unmarked gym is the difference between "geofence off" and
  // "every member locked out", so it is worth a second round trip to say so.
  if (enforce && latitude.value === null) {
    return badRequest(
      'Save the gym coordinates before switching geofence enforcement on.'
    );
  }

  const { data, error } = await supabase
    .from('tenants')
    .update({
      latitude: latitude.value,
      longitude: longitude.value,
      geofence_radius_meters: radius,
      enforce_geofence: enforce,
    })
    .eq('id', tenantId)
    .select(TENANT_FIELDS)
    .maybeSingle();

  if (error) return databaseError(error, 'Could not save the geofence settings.');
  if (!data) return badRequest('That gym does not exist.', 404);

  return NextResponse.json({ ok: true, geofence: present(data as Record<string, unknown>) });
}
