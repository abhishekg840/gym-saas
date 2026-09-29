import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';

/**
 * POST /api/membership/actions
 *
 * The only sanctioned path for freeze / unfreeze / transfer. It does not trust
 * the caller: the tenant id must be a UUID, and every Postgres function it
 * calls re-checks that the target member actually belongs to that tenant.
 *
 * Body: { action, member_id, tenant_id, start_date?, end_date?, to_name?, to_phone?, to_plan_id? }
 */

const ACTIONS = ['freeze', 'unfreeze', 'transfer'] as const;
type Action = (typeof ACTIONS)[number];

/** Postgres SQLSTATE -> HTTP status. Keeps DB errors from leaking as 500s. */
const STATUS_BY_SQLSTATE: Record<string, number> = {
  '22023': 400, // invalid parameter (bad date, bad phone)
  '22P02': 400, // invalid text representation (bad uuid)
  P0002: 404, // no data found -> member is not in this gym
  '45001': 409, // already frozen / not frozen / already transferred
  '45002': 422, // nothing left to transfer
  '45003': 409, // recipient phone already a member of this gym
  '23505': 409, // unique violation (composite tenant key)
  '23503': 400, // foreign key (unknown plan / tenant)
};

function bad(message: string, status = 400, code?: string) {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad('Request body must be valid JSON.');
  }

  const action = String(payload.action ?? '') as Action;
  if (!ACTIONS.includes(action)) {
    return bad(`Unknown action "${action}". Expected one of: ${ACTIONS.join(', ')}.`);
  }

  const memberId = String(payload.member_id ?? '');
  if (!isUuid(memberId)) return bad('member_id must be a valid UUID.');

  // Prefer the explicit body value, fall back to the tenant cookie. Never fall
  // back to "no filter": a missing tenant is a hard 403.
  const tenantId = String(payload.tenant_id ?? '') || readTenantCookie(request);
  if (!tenantId || !isUuid(tenantId)) {
    return bad('Missing or malformed tenant_id. Sign in again to refresh your gym scope.', 403);
  }

  /**
   * Dates arrive as optional YYYY-MM-DD strings. Returns { value, invalid } so a
   * malformed value is a clean 400 instead of a Postgres cast error.
   */
  const optionalDate = (
    key: string
  ): { value: string | null; invalid: boolean } => {
    const value = payload[key];
    if (value === null || value === undefined || value === '') {
      return { value: null, invalid: false };
    }
    const text = String(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? { value: text, invalid: false }
      : { value: null, invalid: true };
  };

  try {
    let result: { data: unknown; error: { message: string; code?: string } | null };

    if (action === 'freeze') {
      const start = optionalDate('start_date');
      if (start.invalid) return bad('start_date must be formatted YYYY-MM-DD.');
      result = await supabase.rpc('fn_freeze_membership', {
        p_member_id: memberId,
        p_tenant_id: tenantId,
        p_start_date: start.value,
      });
    } else if (action === 'unfreeze') {
      const end = optionalDate('end_date');
      if (end.invalid) return bad('end_date must be formatted YYYY-MM-DD.');
      result = await supabase.rpc('fn_unfreeze_membership', {
        p_member_id: memberId,
        p_tenant_id: tenantId,
        p_end_date: end.value,
      });
    } else {
      const toName = String(payload.to_name ?? '').trim();
      const toPhone = String(payload.to_phone ?? '').replace(/[^0-9]/g, '');
      if (!toName) return bad('to_name is required for a transfer.');
      if (!/^\d{10}$/.test(toPhone)) return bad('to_phone must be a 10-digit number.');

      const rawPlan = payload.to_plan_id;
      const toPlanId = typeof rawPlan === 'string' && isUuid(rawPlan) ? rawPlan : null;

      result = await supabase.rpc('fn_transfer_membership', {
        p_member_id: memberId,
        p_tenant_id: tenantId,
        p_to_name: toName,
        p_to_phone: toPhone,
        p_to_plan_id: toPlanId,
      });
    }

    if (result.error) {
      const status = STATUS_BY_SQLSTATE[result.error.code ?? ''] ?? 500;
      return NextResponse.json(
        { ok: false, error: result.error.message, code: result.error.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true, ...(result.data as object) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
