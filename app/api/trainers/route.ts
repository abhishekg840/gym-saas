import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, normalizePhone10, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * /api/trainers — trainer roster plus the monthly payout report (Module 3.2).
 *
 *   GET    ?tenant_id=...&from=&to=     -> { ok, trainers[], payout }
 *   POST   { tenant_id, name, phone, ... } -> { ok, trainer }
 *   PATCH  { tenant_id, trainer_id, ...}   -> { ok, trainer }
 *   DELETE { tenant_id, trainer_id }       -> { ok, deleted }
 *
 * The payout numbers come from fn_trainer_payout_report rather than being summed
 * in the browser: commission is money, and money is calculated in one place. The
 * GET always returns both keys, so the roster view and the payout view share one
 * round trip.
 */

const MAX_NAME = 80;
const MAX_SPECIALITY = 80;
const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

const TRAINER_COLUMNS =
  'id, name, phone, specialization, commission_rate_percent, is_active, created_at';

function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

/** Optional YYYY-MM-DD which must also be a real calendar day. */
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

/** 0-100, two decimals. Returns null when the caller sent something unparseable. */
function parseCommission(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 100) / 100;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = resolveTenant([url.searchParams.get('tenant_id')], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const from = parseDate(url.searchParams.get('from'));
  if (from.invalid) return badRequest('from must be a real date formatted YYYY-MM-DD.');

  const to = parseDate(url.searchParams.get('to'));
  if (to.invalid) return badRequest('to must be a real date formatted YYYY-MM-DD.');

  const [trainersResult, payoutResult] = await Promise.all([
    supabase
      .from('trainers')
      .select(TRAINER_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true }),
    supabase.rpc('fn_trainer_payout_report', {
      p_tenant_id: tenantId,
      p_from: from.value,
      p_to: to.value,
    }),
  ]);

  if (trainersResult.error) return databaseError(trainersResult.error, 'Could not load the trainer roster.');
  if (payoutResult.error) return databaseError(payoutResult.error, 'Could not build the payout report.');

  return NextResponse.json({
    ok: true,
    trainers: trainersResult.data ?? [],
    payout: payoutResult.data ?? null,
  });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const name = String(body.name ?? '').trim();
  if (!name) return badRequest('name is required.');
  if (name.length > MAX_NAME) return badRequest(`name must be ${MAX_NAME} characters or fewer.`);

  const phone = normalizePhone10(String(body.phone ?? ''));
  if (!/^\d{6,15}$/.test(phone)) return badRequest('phone must contain 6 to 15 digits.');

  const specialization =
    String(body.specialization ?? '').trim().slice(0, MAX_SPECIALITY) || null;

  // Default 20%: a missing rate must never silently mean "keep everything".
  const commission = body.commission_rate_percent ?? body.commissionRatePercent ?? 20;
  const rate = parseCommission(commission);
  if (rate === null) {
    return badRequest('commission_rate_percent must be a number between 0 and 100.');
  }

  const { data, error } = await supabase
    .from('trainers')
    .insert({
      tenant_id: tenantId,
      name,
      phone,
      specialization,
      commission_rate_percent: rate,
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    })
    .select(TRAINER_COLUMNS)
    .single();

  if (error) return databaseError(error, 'Could not add this trainer.');
  return NextResponse.json({ ok: true, trainer: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const trainerId = body.trainer_id ?? body.trainerId;
  if (!isUuid(trainerId)) return badRequest('trainer_id must be a valid UUID.');

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) return badRequest('name cannot be empty.');
    if (name.length > MAX_NAME) return badRequest(`name must be ${MAX_NAME} characters or fewer.`);
    patch.name = name;
  }

  if (body.phone !== undefined) {
    const phone = normalizePhone10(String(body.phone));
    if (!/^\d{6,15}$/.test(phone)) return badRequest('phone must contain 6 to 15 digits.');
    patch.phone = phone;
  }

  if (body.specialization !== undefined) {
    patch.specialization = String(body.specialization ?? '').trim().slice(0, MAX_SPECIALITY) || null;
  }

  if (body.commission_rate_percent !== undefined || body.commissionRatePercent !== undefined) {
    const rate = parseCommission(body.commission_rate_percent ?? body.commissionRatePercent);
    if (rate === null) {
      return badRequest('commission_rate_percent must be a number between 0 and 100.');
    }
    patch.commission_rate_percent = rate;
  }

  if (body.is_active !== undefined || body.isActive !== undefined) {
    patch.is_active = Boolean(body.is_active ?? body.isActive);
  }

  if (Object.keys(patch).length === 0) {
    return badRequest(
      'Nothing to update. Send name, phone, specialization, commission_rate_percent or is_active.'
    );
  }

  const { data, error } = await supabase
    .from('trainers')
    .update(patch)
    .eq('id', trainerId)
    .eq('tenant_id', tenantId)
    .select(TRAINER_COLUMNS)
    .maybeSingle();

  if (error) return databaseError(error, 'Could not update this trainer.');
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Trainer not found in this gym.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, trainer: data });
}

export async function DELETE(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const trainerId = body.trainer_id ?? body.trainerId;
  if (!isUuid(trainerId)) return badRequest('trainer_id must be a valid UUID.');

  // pt_subscriptions cascades on delete, so removing a trainer who has ever sold
  // a package would erase their PT history and the commission owed on it. Refuse
  // and point at the reversible action instead.
  const { count, error: countError } = await supabase
    .from('pt_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('trainer_id', trainerId);

  if (countError) return databaseError(countError, 'Could not check this trainer\'s PT history.');

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `This trainer has ${count} PT package(s) on record. Deactivate them instead of deleting, so the payout history stays intact.`,
      },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from('trainers')
    .delete()
    .eq('id', trainerId)
    .eq('tenant_id', tenantId)
    .select('id')
    .maybeSingle();

  if (error) return databaseError(error, 'Could not remove this trainer.');
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Trainer not found in this gym.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: true, trainer_id: data.id });
}

