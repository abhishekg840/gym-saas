/**
 * Authentication + enrollment guard used by every surfaced control center and
 * every step that mutates a gym (membership, device, staff, billing).
 *
 *   - A well-formed session is required (guest presses nothing).
 *   - The session's tenant id MUST be a UUID. Anything else is a boundary leak
 *     and is refused rather than turned into a wildcard query.
 *   - If the tenant row does not exist, the tenant scope is dead. Refuse with a
 *     login redirect so a dangling session cannot keep spinning on cached state.
 *
 * This guard owns the small set of decisions that belong at the edge:
 *   - is anyone actually signed in?
 *   - is the tenant id trustworthy?
 *   - if the gym typed away, is it still searchable?
 *
 * Routes with a different contract (Cashfree webhooks, API-key hardware, pen-
 * tation tokens) never call this: they authenticate with their own scheme.
 */

import { supabase } from '@/lib/supabase';
import { readSession, isUuid, TENANT_COOKIE, GymSession } from '@/lib/session';
import { NextResponse } from 'next/server';

export type GuardOutcome = 'ok' | 'redirect' | 'offline';

export interface SessionRecord {
  session: GymSession | null;
  tenantId: string | null;
  tenantName: string | null;
  tenantPhone: string | null;
}

/**
 * Resolve the current visitor into { session, tenantId } while cleaning up a
 * stale guest scope. Returns 'ok' only when both are trustworthy. Cookies are
 * JSON-safe, so a freshly provisioned owner signs straight into their new gym.
 */
export async function guardEngineer(
  request: Request
): Promise<{ outcome: GuardOutcome; record: SessionRecord }> {
  const session = readSession();

  // 1. A real identity is required. A fresh sign-in writes the session and a
  //    tenant cookie in the same reaction; a guest only ever carries garbage.
  if (!session || !session.userId) {
    return { outcome: 'redirect', record: { session: null, tenantId: null, tenantName: null, tenantPhone: null } };
  }

  // 2. The gym scope is whatever the session says. A flattened uuid is all we
  //    need here: the authorisation boundary lives in the RPC, not in the cookie.
  const tenantId = session.tenantId ?? null;
  if (tenantId !== null && !isUuid(tenantId)) {
    return { outcome: 'redirect', record: { session, tenantId: null, tenantName: null, tenantPhone: null } };
  }

  // 3. If we have a tenant id, prove the row still exists. This is the line that
  //    keeps a dangling cookie from widening every query to null.
  if (tenantId) {
    const { data, error } = await supabase
      .from('tenants')
      .select('id, name, phone, slug')
      .eq('id', tenantId)
      .maybeSingle();

    if (error || !data) {
      // Drop the broken scope so the next visit starts clean, then send them to
      // the console: the session stays until they sign out.
      tenantCookie(null);
      return { outcome: 'redirect', record: { session, tenantId: null, tenantName: null, tenantPhone: null } };
    }

    return {
      outcome: 'ok',
      record: {
        session,
        tenantId: data.id as string,
        tenantName: (data.name as string) ?? null,
        tenantPhone: (data.phone as string) ?? null,
      },
    };
  }

  // 4. No tenant scope — a fresh console user with no cookie is fine: we only
  //    need an identity here, and the console surfaces the gym picker.
  return { outcome: 'ok', record: { session, tenantId: null, tenantName: null, tenantPhone: null } };
}

export function tenantCookie(tenantId: string | null): void {
  if (typeof window === 'undefined') return;
  const value = tenantId && isUuid(tenantId) ? tenantId : '';
  document.cookie = `${TENANT_COOKIE}=${value}; path=/; max-age=${value ? 60 * 60 * 24 * 30 : 0}; samesite=lax`;
}

/** A 403 harness for an unauthenticated or unscoped request. */
export function denied(): Response {
  return NextResponse.json(
    {
      ok: false,
      error: 'Sign in to continue',
      code: 'requires_sign_in',
    },
    { status: 403 }
  );
}
