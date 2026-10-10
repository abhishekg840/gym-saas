/**
 * Entitlement truth for the super-admin control center, the gated API routes,
 * AND the owner-console suspension lock screen.
 *
 * Reads the truth the Postgres RPC exposes per gym (subscription lock + six
 * feature flags + member/device quotas) and turns it into typed decisions.
 * Every guarded call should end here so a wrong tier, a locked gym, or a
 * disabled flag is refused consistently instead of leaking through route-by-
 * route ad hoc checks.
 *
 * This module is intentionally free of any `next/server` import so it can be
 * pulled into a `'use client'` bundle: `resolveGrants`, `isLocked` and
 * `lockReasonLabel` all run in the browser. The authoritative refusal for the
 * API routes — the `deny()` rejector that needs NextResponse — lives in the
 * sibling lib/entitlements-server.ts, imported only by route handlers.
 */

import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';

export type FeatureFlag =
  | 'qr_gate'
  | 'rfid'
  | 'biometric'
  | 'pos_store'
  | 'whatsapp'
  | 'crm';

export type SubscriptionStatus = 'active' | 'suspended' | 'trialing' | 'expired';
export type SubscriptionTier = 'starter' | 'pro' | 'franchise' | 'enterprise';

export interface FeatureFlags {
  qr_gate: boolean;
  rfid: boolean;
  biometric: boolean;
  pos_store: boolean;
  whatsapp: boolean;
  crm: boolean;
}

export interface ResolvedGrants {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  flags: FeatureFlags;
  locked: boolean;
  reason: string;
}

/**
 * Reads fn_resolve_entitlements for a gym and perfuses it into a typed
 * Grants object. Throws a clear error when the gym id is not a uuid so a
 * tampered cookie or URL variable can never turn into a null-realm query.
 */
export async function resolveGrants(tenantId: string): Promise<ResolvedGrants> {
  if (!isUuid(tenantId)) {
    throw new Error('resolveGrants: tenant_id must be a valid UUID.');
  }

  const { data, error } = await supabase.rpc('fn_resolve_entitlements', {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(`resolveGrants: ${error.message}`);
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const flags = (row.flags as Record<string, unknown>) ?? {};

  return {
    tier: row.tier === 'enterprise' ? 'enterprise' : (row.tier as SubscriptionTier) ?? 'starter',
    status: row.status === 'suspended' ? 'suspended' : (row.status as SubscriptionStatus) ?? 'active',
    flags: {
      qr_gate: Boolean(flags.qr_gate),
      rfid: Boolean(flags.rfid),
      biometric: Boolean(flags.biometric),
      pos_store: Boolean(flags.pos_store),
      whatsapp: Boolean(flags.whatsapp),
      crm: Boolean(flags.crm),
    },
    locked: Boolean(row.locked),
    reason: typeof row.reason === 'string' ? row.reason : '',
  };
}

/**
 * True when the browser should refuse to act: the gym is locked (suspended,
 * expired, or unknown). This is the CLIENT mirror of the server's `deny()` in
 * lib/entitlements-server.ts — same decision, no `next/server` import, so it is
 * safe to call from a `'use client'` component.
 *
 * A client gate is UX, not security: the authoritative refusal still happens
 * server-side on every gated route. This only decides whether to show the lock
 * screen instead of a console whose every button would 403.
 */
export function isLocked(grants: ResolvedGrants): boolean {
  return grants.locked || grants.status === 'suspended' || grants.status === 'expired';
}

/**
 * A short, human line for WHY the gym is offline, keyed off the RPC's `reason`
 * (subscription_inactive / subscription_expired / trial_expired / unknown_tenant)
 * so the lock screen can name the cause instead of showing a generic error.
 */
export function lockReasonLabel(grants: ResolvedGrants): string {
  switch (grants.reason) {
    case 'subscription_expired':
      return 'The paid subscription for this gym has run out.';
    case 'trial_expired':
      return 'The free trial has ended and no plan has been added yet.';
    case 'subscription_inactive':
      return 'This gym has been suspended by the platform team.';
    case 'unknown_tenant':
      return 'This gym could not be found on the platform.';
    default:
      return 'This gym is currently offline.';
  }
}


