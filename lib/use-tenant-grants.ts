'use client';

import { useEffect, useState } from 'react';
import { resolveGrants, isLocked, lockReasonLabel, type ResolvedGrants } from '@/lib/entitlements';
import { isUuid, readSession } from '@/lib/session';

/**
 * useTenantGrants — the client half of the entitlement gate.
 *
 * The server refuses a locked gym on every gated route (lib/entitlements-server
 * .ts). That stops the data, but it leaves the owner staring at a console whose
 * every button silently 403s. This hook re-reads fn_resolve_entitlements in the
 * browser so the console can swap itself for the suspension lock screen — the
 * honest "your gym is offline, here is why" — instead of a wall of dead actions.
 *
 * FAIL-OPEN IS DELIBERATE. A transient RPC or network error returns `locked:
 * false`, never `true`: a flaky connection must never lock a paying gym out of
 * their own console. The authoritative refusal is still server-side, so failing
 * open here costs nothing — the worst case is the console renders and the next
 * action is refused with a clear message, exactly as before this hook existed.
 *
 * It re-polls on an interval so a mid-session suspension (an admin flips the
 * switch while the owner has the console open) is picked up without a reload.
 */

export interface TenantGrantsState {
  /** True until the first read resolves (there is no session, or it is in flight). */
  loading: boolean;
  /** The resolved grants, or null when there is no tenant scope yet / the read failed. */
  grants: ResolvedGrants | null;
  /** The single decision the console needs: show the lock screen instead of the UI. */
  locked: boolean;
  /** A human one-liner for WHY, from the RPC's reason code. */
  reasonLabel: string;
  /** Re-run the read now (used by the lock screen's "Check again"). */
  refresh: () => void;
}

/** Re-read cadence. Long enough to be cheap, short enough that a suspension lands promptly. */
const POLL_MS = 30_000;

export function useTenantGrants(): TenantGrantsState {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [grants, setGrants] = useState<ResolvedGrants | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // The session lives in localStorage, so the tenant id is only readable after
  // hydration — read it once here and let the fetch effect key off it.
  useEffect(() => {
    const session = readSession();
    setTenantId(isUuid(session?.tenantId) ? (session!.tenantId as string) : null);
  }, []);

  useEffect(() => {
    // No tenant scope (a fresh console user, or a super admin): nothing to gate,
    // and nothing to poll. Leave the console alone.
    if (!tenantId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const resolved = await resolveGrants(tenantId as string);
        if (!cancelled) setGrants(resolved);
      } catch {
        // Fail open: keep whatever we had (or null) rather than inventing a lock.
        if (!cancelled) setGrants((prev) => prev);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tenantId, nonce]);

  const locked = grants ? isLocked(grants) : false;
  const reasonLabel = grants ? lockReasonLabel(grants) : '';

  return {
    loading,
    grants,
    locked,
    reasonLabel,
    refresh: () => setNonce((n) => n + 1),
  };
}
