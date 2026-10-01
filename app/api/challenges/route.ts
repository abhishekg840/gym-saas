import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * /api/challenges — gym challenges for the owner console (Module 7.4).
 *
 *   GET  ?tenant_id=...                    -> { ok, challenges[] } (counts, no member)
 *   POST { tenant_id?, challenge }         -> { ok, challenge }
 *   DELETE { tenant_id?, challenge_id }    -> { ok, deleted }
 *
 * Member-side reads and joins never come here: they go through the SECURITY
 * DEFINER RPCs (fn_challenge_list / fn_challenge_join / fn_challenge_board) so
 * participants stay revoked from PostgREST. This route only manages the
 * challenge rows themselves, scoped exactly like /api/leads.
 */

const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

/** YYYY-MM-DD that is also a real calendar day (2026-13-45 is not). */
function parseDate(raw: unknown): { value: string | null; invalid: boolean } {
  if (raw === null || raw === undefined || raw === '') return { value: null, invalid: false };
  const text = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { value: null, invalid: true };
  const [year, month, day] = text.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return real ? { value: text, invalid: false } : { value: null, invalid: true };
}

export async function GET(request: Request) {
  const tenantId = resolveTenant([new URL(request.url).searchParams.get('tenant_id')], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const { data, error } = await supabase.rpc('fn_challenge_list', {
    p_tenant_id: tenantId,
    p_member_id: null,
  });
  if (error) return databaseError(error, 'Could not load challenges.');

  return NextResponse.json({ ok: true, challenges: Array.isArray(data) ? data : [] });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const title = String(body.title ?? '').trim().slice(0, 120);
  if (title.length < 3) return badRequest('title must be at least 3 characters.');

  const kind = body.kind;
  if (kind !== 'attendance' && kind !== 'weight_loss') {
    return badRequest("kind must be 'attendance' or 'weight_loss'.");
  }

  const description = String(body.description ?? '').trim().slice(0, 500) || null;

  const start = parseDate(body.start_date ?? body.startDate);
  const end = parseDate(body.end_date ?? body.endDate);
  if (start.invalid || end.invalid) {
    return badRequest('start_date and end_date must be real dates formatted YYYY-MM-DD.');
  }
  if (!start.value || !end.value) return badRequest('start_date and end_date are required.');
  if (end.value < start.value) return badRequest('end_date cannot be before start_date.');

  const target = Number(body.target_value ?? body.targetValue ?? (kind === 'attendance' ? 30 : 5));
  if (!Number.isFinite(target) || target <= 0 || target > 1000) {
    return badRequest('target_value must be a positive number (check-ins, or kg to lose).');
  }

  const { data, error } = await supabase
    .from('gym_challenges')
    .insert({
      tenant_id: tenantId,
      title,
      kind,
      description,
      start_date: start.value,
      end_date: end.value,
      target_value: Math.round(target * 100) / 100,
      is_active: true,
    })
    .select()
    .maybeSingle();

  if (error) return databaseError(error, 'Could not launch this challenge.');
  return NextResponse.json({ ok: true, challenge: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const challengeId = body.challenge_id ?? body.challengeId;
  if (!isUuid(challengeId)) return badRequest('challenge_id must be a valid UUID.');

  const { data, error } = await supabase
    .from('gym_challenges')
    .delete()
    .eq('id', challengeId)
    .eq('tenant_id', tenantId)
    .select('id')
    .maybeSingle();

  if (error) return databaseError(error, 'Could not delete this challenge.');
  if (!data) return badRequest('Challenge not found in this gym.', 404);

  return NextResponse.json({ ok: true, deleted: true, challenge_id: data.id });
}
