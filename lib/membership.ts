import { normalizePhone10, readSession, type GymSession } from '@/lib/session';

/**
 * Typed client for /api/membership/actions.
 *
 * The dashboard never mutates a membership directly: it asks the API route,
 * which forwards to a Postgres function that re-checks tenant ownership and
 * performs the write inside a single transaction.
 */

export type MembershipAction = 'freeze' | 'unfreeze' | 'transfer';

export interface MembershipResult {
  ok: boolean;
  error?: string;
  code?: string;
  member_id?: string;
  full_name?: string;
  is_frozen?: boolean;
  freeze_start_date?: string | null;
  freeze_end_date?: string | null;
  days_added?: number;
  total_freeze_days?: number;
  membership_end?: string | null;
  status?: string;
  message?: string;
  transfer_id?: string;
  transferred_days?: number;
  from_member_id?: string;
  from_name?: string;
  to_member_id?: string;
  to_name?: string;
  to_phone?: string;
  to_membership_end?: string | null;
}

/**
 * Pulls the acting operator's tenant out of the stored session.
 * Returns null when nobody is logged in or the session predates multi-tenancy,
 * which the caller turns into a visible error instead of an unscoped request.
 */
export function requireTenantScope(session: GymSession | null): string | null {
  if (!session) return null;
  if (session.role === 'super_admin') return null; // handled by caller
  return session.tenantId ?? null;
}

async function post(payload: Record<string, unknown>): Promise<MembershipResult> {
  const response = await fetch('/api/membership/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });

  let body: MembershipResult;
  try {
    body = (await response.json()) as MembershipResult;
  } catch {
    return { ok: false, error: `Server returned an invalid response (${response.status}).` };
  }

  if (!response.ok && !body.error) {
    return { ok: false, error: `Request failed with status ${response.status}.` };
  }
  return body;
}

export function freezeMembership(memberId: string, tenantId: string, startDate?: string) {
  return post({
    action: 'freeze' satisfies MembershipAction,
    member_id: memberId,
    tenant_id: tenantId,
    start_date: startDate ?? null,
  });
}

export function unfreezeMembership(memberId: string, tenantId: string, endDate?: string) {
  return post({
    action: 'unfreeze' satisfies MembershipAction,
    member_id: memberId,
    tenant_id: tenantId,
    end_date: endDate ?? null,
  });
}

export function transferMembership(input: {
  memberId: string;
  tenantId: string;
  toName: string;
  toPhone: string;
  toPlanId?: string | null;
}) {
  return post({
    action: 'transfer' satisfies MembershipAction,
    member_id: input.memberId,
    tenant_id: input.tenantId,
    to_name: input.toName.trim(),
    to_phone: normalizePhone10(input.toPhone),
    to_plan_id: input.toPlanId ?? null,
  });
}

/** Reads today's ISO date without shipping a date library. */
export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export { readSession };
