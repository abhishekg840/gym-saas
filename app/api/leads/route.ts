import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, normalizePhone10, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import { isLeadStage } from '@/lib/crm';

/**
 * /api/leads — the CRM pipeline (Module 3.1).
 *
 *   GET    ?tenant_id=...                     -> { ok, leads[] }
 *   POST   { tenant_id, ...lead }             -> { ok, lead }        (new inquiry)
 *   POST   { action: 'convert', ... }         -> { ok, converted }   (lead -> member)
 *   PATCH  { tenant_id, lead_id, ...patch }   -> { ok, lead }        (stage / follow-up)
 *   DELETE { tenant_id, lead_id }             -> { ok, deleted }
 *
 * The gym is taken from the body/query when it is a well-formed UUID and
 * otherwise from the forgeos_tenant cookie — never from "no filter", which would
 * list every gym's pipeline. The conversion itself runs inside
 * fn_lead_convert_to_member, which re-reads the lead under the same tenant filter
 * and refuses to convert the same lead twice.
 */

const MAX_NAME = 80;
const MAX_NOTES = 1000;
const MAX_SOURCE = 40;
const MAX_EMAIL = 160;

const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

/** Body/query tenant first, cookie second, hard 403 when neither is a UUID. */
function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

/**
 * A date that matches YYYY-MM-DD is not automatically a real day: "2026-13-45"
 * fits the pattern. The round-trip catches that here rather than as a cast error
 * from Postgres.
 */
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

const LEAD_COLUMNS =
  'id, full_name, phone, email, source, status, trial_date, follow_up_date, notes, created_at';

/** Keys a PATCH may touch. Anything else in the body is ignored, not trusted. */
const PATCHABLE = [
  'full_name',
  'phone',
  'email',
  'source',
  'status',
  'trial_date',
  'follow_up_date',
  'notes',
] as const;

export async function GET(request: Request) {
  const tenantId = resolveTenant([new URL(request.url).searchParams.get('tenant_id')], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const { data, error } = await supabase
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return databaseError(error, 'Could not load the lead pipeline.');

  return NextResponse.json({ ok: true, leads: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  // ---- Convert an existing lead -------------------------------------------
  if (body.action === 'convert') {
    const leadId = body.lead_id ?? body.leadId;
    if (!isUuid(leadId)) return badRequest('lead_id must be a valid UUID.');

    const rawPlan = body.plan_id ?? body.planId;
    const planId = isUuid(rawPlan) ? rawPlan : null;

    const rawMember = body.member_id ?? body.memberId;
    const memberId = isUuid(rawMember) ? rawMember : null;

    const amountRaw = body.amount_paid ?? body.amountPaid;
    let amountPaid: number | null = null;
    if (amountRaw !== null && amountRaw !== undefined && amountRaw !== '') {
      amountPaid = Number(amountRaw);
      if (!Number.isFinite(amountPaid) || amountPaid < 0) {
        return badRequest('amount_paid must be a number of 0 or more.');
      }
    }

    const { data, error } = await supabase.rpc('fn_lead_convert_to_member', {
      p_lead_id: leadId,
      p_tenant_id: tenantId,
      p_plan_id: planId,
      p_amount_paid: amountPaid,
      p_member_id: memberId,
    });

    if (error) return databaseError(error, 'Could not convert this lead.');
    return NextResponse.json({ ok: true, converted: data });
  }

  // ---- New inquiry --------------------------------------------------------
  const fullName = String(body.full_name ?? body.fullName ?? '').trim();
  if (!fullName) return badRequest('full_name is required.');
  if (fullName.length > MAX_NAME) {
    return badRequest(`full_name must be ${MAX_NAME} characters or fewer.`);
  }

  const phone = normalizePhone10(String(body.phone ?? ''));
  if (!/^\d{6,15}$/.test(phone)) {
    return badRequest('phone must contain 6 to 15 digits.');
  }

  const emailRaw = String(body.email ?? '').trim();
  if (emailRaw && (emailRaw.length > MAX_EMAIL || !emailRaw.includes('@'))) {
    return badRequest('email does not look like an email address.');
  }

  const source = String(body.source ?? '').trim().slice(0, MAX_SOURCE) || 'walk-in';

  const statusRaw = body.status ?? 'new';
  if (!isLeadStage(statusRaw)) {
    return badRequest(
      'status must be one of: new, contacted, trial_booked, trial_completed, converted, lost.'
    );
  }

  const trial = parseDate(body.trial_date ?? body.trialDate);
  if (trial.invalid) return badRequest('trial_date must be a real date formatted YYYY-MM-DD.');

  const followUp = parseDate(body.follow_up_date ?? body.followUpDate);
  if (followUp.invalid) {
    return badRequest('follow_up_date must be a real date formatted YYYY-MM-DD.');
  }

  const notes = String(body.notes ?? '').trim().slice(0, MAX_NOTES);

  const { data, error } = await supabase
    .from('leads')
    .insert({
      tenant_id: tenantId,
      full_name: fullName,
      phone,
      email: emailRaw || null,
      source,
      status: statusRaw,
      trial_date: trial.value,
      follow_up_date: followUp.value,
      notes: notes || null,
    })
    .select(LEAD_COLUMNS)
    .single();

  if (error) return databaseError(error, 'Could not save this lead.');
  return NextResponse.json({ ok: true, lead: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const leadId = body.lead_id ?? body.leadId;
  if (!isUuid(leadId)) return badRequest('lead_id must be a valid UUID.');

  const patch: Record<string, unknown> = {};

  if (body.full_name !== undefined || body.fullName !== undefined) {
    const fullName = String(body.full_name ?? body.fullName ?? '').trim();
    if (!fullName) return badRequest('full_name cannot be empty.');
    if (fullName.length > MAX_NAME) {
      return badRequest(`full_name must be ${MAX_NAME} characters or fewer.`);
    }
    patch.full_name = fullName;
  }

  if (body.phone !== undefined) {
    const phone = normalizePhone10(String(body.phone));
    if (!/^\d{6,15}$/.test(phone)) return badRequest('phone must contain 6 to 15 digits.');
    patch.phone = phone;
  }

  if (body.email !== undefined) {
    const email = String(body.email ?? '').trim();
    if (email && (email.length > MAX_EMAIL || !email.includes('@'))) {
      return badRequest('email does not look like an email address.');
    }
    patch.email = email || null;
  }

  if (body.source !== undefined) {
    patch.source = String(body.source ?? '').trim().slice(0, MAX_SOURCE) || 'walk-in';
  }

  if (body.status !== undefined) {
    if (!isLeadStage(body.status)) {
      return badRequest(
        'status must be one of: new, contacted, trial_booked, trial_completed, converted, lost.'
      );
    }
    patch.status = body.status;
  }

  if (body.trial_date !== undefined || body.trialDate !== undefined) {
    const trial = parseDate(body.trial_date ?? body.trialDate);
    if (trial.invalid) return badRequest('trial_date must be a real date formatted YYYY-MM-DD.');
    patch.trial_date = trial.value;
  }

  if (body.follow_up_date !== undefined || body.followUpDate !== undefined) {
    const followUp = parseDate(body.follow_up_date ?? body.followUpDate);
    if (followUp.invalid) {
      return badRequest('follow_up_date must be a real date formatted YYYY-MM-DD.');
    }
    patch.follow_up_date = followUp.value;
  }

  if (body.notes !== undefined) {
    patch.notes = String(body.notes ?? '').trim().slice(0, MAX_NOTES) || null;
  }

  if (Object.keys(patch).length === 0) {
    return badRequest(`Nothing to update. Send at least one of: ${PATCHABLE.join(', ')}.`);
  }

  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', leadId)
    .eq('tenant_id', tenantId)
    .select(LEAD_COLUMNS)
    .maybeSingle();

  if (error) return databaseError(error, 'Could not update this lead.');
  // maybeSingle() returns null when the tenant filter excluded the row: that is a
  // 404 on purpose, never an empty success.
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Lead not found in this gym.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, lead: data });
}

export async function DELETE(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const leadId = body.lead_id ?? body.leadId;
  if (!isUuid(leadId)) return badRequest('lead_id must be a valid UUID.');

  const { data, error } = await supabase
    .from('leads')
    .delete()
    .eq('id', leadId)
    .eq('tenant_id', tenantId)
    .select('id')
    .maybeSingle();

  if (error) return databaseError(error, 'Could not delete this lead.');
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Lead not found in this gym.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: true, lead_id: data.id });
}


