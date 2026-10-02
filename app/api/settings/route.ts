import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * /api/settings — the gym's operating-hours schedule (Module 4.1.2).
 *
 *   GET  ?tenant_id=...           -> { ok, operating_hours }
 *   POST { tenant_id?, hours }    -> { ok, operating_hours }  (saved schedule)
 *
 * This is the write path that finally replaces the hardcoded 05:00-23:00 the
 * member app used to show. Reads go straight to public.tenants (a column, not a
 * revoked table, so no RPC is needed); writes go through
 * fn_tenant_set_operating_hours, which normalises the shape so a malformed
 * schedule is rejected at the database instead of rendering "undefined" as the
 * closing time on every member's phone.
 */

const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export async function GET(request: Request) {
  const tenantId =
    isUuid(new URL(request.url).searchParams.get('tenant_id')) ||
    readTenantCookie(request);

  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const { data, error } = await supabase
    .from('tenants')
    .select('operating_hours')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) return databaseError(error, 'Could not load your opening hours.');
  if (!data) return badRequest('Gym not found.', 404);

  return NextResponse.json({ ok: true, operating_hours: data.operating_hours ?? null });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = isUuid(body.tenant_id) || isUuid(body.tenantId)
    ? String(body.tenant_id ?? body.tenantId)
    : readTenantCookie(request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  // Accept the schedule whole or wrapped in `hours`, so the same route serves a
  // plain form post and the JSON settings client.
  const source = (body.hours && typeof body.hours === 'object'
    ? body.hours
    : body.operating_hours ?? body) as Record<string, unknown>;

  if (Array.isArray(source) || typeof source !== 'object' || source === null) {
    return badRequest('Operating hours must be an object keyed by day (mon…sun).');
  }

  // Pre-validate the days the owner actually sent, so the error names the day
  // instead of surfacing the database's generic message.
  for (const [day, value] of Object.entries(source)) {
    if (!(DAYS as readonly string[]).includes(day)) continue;
    const entry = value as Record<string, unknown>;
    for (const field of ['open', 'close'] as const) {
      const time = String(entry?.[field] ?? '').trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return badRequest(`Use 24-hour times like 06:30 for ${day.toUpperCase()} ${field}.`);
      }
    }
  }

  const { data, error } = await supabase.rpc('fn_tenant_set_operating_hours', {
    p_tenant_id: tenantId,
    p_hours: source,
  });
  if (error) return databaseError(error, 'Could not save your opening hours.');

  return NextResponse.json({ ok: true, operating_hours: data });
}