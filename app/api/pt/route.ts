import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import type { PtSubscription } from '@/lib/crm';

/**
 * /api/pt — personal-training packages (Module 3.3).
 *
 *   GET  ?tenant_id=...                     -> { ok, subscriptions[] }
 *   POST { action: 'log_session',        ... } -> { ok, punch }         (+1 session)
 *   POST { action: 'create_subscription',... } -> { ok, subscription }  (sell a block)
 *
 * A session punch is never a client-side increment: fn_pt_log_session locks the
 * subscription row, refuses to punch a cancelled or exhausted block, and flips
 * the package to 'completed' on the last session.
 */

const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

const PT_COLUMNS =
  'id, member_id, trainer_id, total_sessions, completed_sessions, amount_paid, ' +
  'start_date, end_date, status, created_at, members(full_name, phone), trainers(name)';

interface RawRow {
  id: string;
  member_id: string;
  trainer_id: string;
  total_sessions: number;
  completed_sessions: number;
  amount_paid: number;
  start_date: string;
  end_date: string;
  status: PtSubscription['status'];
  created_at: string;
  members?: { full_name: string; phone: string } | { full_name: string; phone: string }[] | null;
  trainers?: { name: string } | { name: string }[] | null;
}

/** PostgREST returns an embedded to-one relation as an object or a 1-item array. */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

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

  const { data, error } = await supabase
    .from('pt_subscriptions')
    .select(PT_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) return databaseError(error, 'Could not load PT packages.');

  const subscriptions: PtSubscription[] = (data ?? []).map((row: unknown) => {
    const item = row as RawRow;
    const member = firstOf(item.members);
    const trainer = firstOf(item.trainers);
    return {
      id: item.id,
      member_id: item.member_id,
      trainer_id: item.trainer_id,
      total_sessions: item.total_sessions,
      completed_sessions: item.completed_sessions,
      amount_paid: Number(item.amount_paid),
      start_date: item.start_date,
      end_date: item.end_date,
      status: item.status,
      created_at: item.created_at,
      member_name: member?.full_name ?? null,
      member_phone: member?.phone ?? null,
      trainer_name: trainer?.name ?? null,
    };
  });

  return NextResponse.json({ ok: true, subscriptions });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const action = String(body.action ?? 'log_session');

  // ---- Punch one delivered session ----------------------------------------
  if (action === 'log_session') {
    const subscriptionId = body.subscription_id ?? body.subscriptionId;
    if (!isUuid(subscriptionId)) return badRequest('subscription_id must be a valid UUID.');

    const { data, error } = await supabase.rpc('fn_pt_log_session', {
      p_subscription_id: subscriptionId,
      p_tenant_id: tenantId,
    });

    if (error) return databaseError(error, 'Could not record this PT session.');
    return NextResponse.json({ ok: true, punch: data });
  }

  // ---- Sell a block of sessions -------------------------------------------
  if (action === 'create_subscription') {
    const memberId = body.member_id ?? body.memberId;
    if (!isUuid(memberId)) return badRequest('member_id must be a valid UUID.');

    const trainerId = body.trainer_id ?? body.trainerId;
    if (!isUuid(trainerId)) return badRequest('trainer_id must be a valid UUID.');

    const sessionsRaw = body.total_sessions ?? body.totalSessions;
    const totalSessions = Number(sessionsRaw);
    if (!Number.isInteger(totalSessions) || totalSessions < 1 || totalSessions > 1000) {
      return badRequest('total_sessions must be a whole number between 1 and 1000.');
    }

    const amountRaw = body.amount_paid ?? body.amountPaid ?? 0;
    const amountPaid = Number(amountRaw);
    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      return badRequest('amount_paid must be a number of 0 or more.');
    }

    const start = parseDate(body.start_date ?? body.startDate);
    if (start.invalid) return badRequest('start_date must be a real date formatted YYYY-MM-DD.');

    const end = parseDate(body.end_date ?? body.endDate);
    if (end.invalid) return badRequest('end_date must be a real date formatted YYYY-MM-DD.');

    const { data, error } = await supabase.rpc('fn_pt_create_subscription', {
      p_tenant_id: tenantId,
      p_member_id: memberId,
      p_trainer_id: trainerId,
      p_total_sessions: totalSessions,
      p_amount_paid: amountPaid,
      p_start_date: start.value,
      p_end_date: end.value,
    });

    if (error) return databaseError(error, 'Could not create this PT package.');

    // The RPC answers with the snake_case receipt; the UI wants the same shape as
    // the GET list, so the names are mapped once, here.
    const receipt = (data ?? {}) as Record<string, unknown>;
    const subscription: PtSubscription = {
      id: String(receipt.subscription_id ?? ''),
      member_id: String(receipt.member_id ?? memberId),
      trainer_id: String(receipt.trainer_id ?? trainerId),
      total_sessions: Number(receipt.total_sessions ?? totalSessions),
      completed_sessions: Number(receipt.completed_sessions ?? 0),
      amount_paid: Number(receipt.amount_paid ?? amountPaid),
      start_date: String(receipt.start_date ?? start.value ?? ''),
      end_date: String(receipt.end_date ?? end.value ?? ''),
      status: (receipt.status as PtSubscription['status']) ?? 'active',
      created_at: new Date().toISOString(),
      member_name: (receipt.member_name as string) ?? null,
      member_phone: (receipt.member_phone as string) ?? null,
      trainer_name: (receipt.trainer_name as string) ?? null,
    };

    return NextResponse.json({ ok: true, subscription, receipt }, { status: 201 });
  }

  return badRequest(`Unknown action "${action}". Expected log_session or create_subscription.`);
}

