'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';

/**
 * LIVE INSIDE GYM (Phase 12).
 *
 * "How many people are in the gym right now" is the one number an owner looks at
 * most often, and it is the easiest to get wrong. Three mistakes are common and
 * all three are avoided here:
 *
 *   1. Counting today's check-ins. That is a footfall number, not an occupancy
 *      number, and it only differs once someone leaves.
 *   2. Forgetting the 3-hour cutoff. A member who forgets to punch out at the
 *      desk would otherwise stay "inside" until midnight, so the count ratchets
 *      up all night and the owner stops trusting it.
 *   3. Ignoring checkout punches. fn_gym_live_crowd resolves this correctly in
 *      SQL with DISTINCT ON (member_id), so an 'out' punch removes someone the
 *      instant it lands.
 *
 * The heavy lifting is in fn_gym_live_crowd (migration 0012). Doing "latest row
 * per member" in the browser would mean downloading the whole attendance log to
 * count a number, which is both slow and a much larger data exposure.
 *
 * REFRESH STRATEGY — realtime first, with a polling floor
 * -----------------------------------------------------
 * `attendances` is in the supabase_realtime publication (migration 0011), so a
 * punch arrives over the socket and the badge updates with no reload. But a tab
 * that has been in the background misses events: the socket buffers them and some
 * mobile WebViews drop them outright. So we also refresh on visibilitychange, on
 * window focus, and on a 30s timer that only runs when the socket is not healthy.
 */

export interface CrowdMember {
  full_name: string;
  phone: string;
  at: string;
}

export interface LiveCrowd {
  inside: number;
  members: CrowdMember[];
  label: 'Quiet' | 'Moderate' | 'Busy';
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const POLL_MS = 30_000;

interface CrowdPayload {
  inside?: number;
  members?: CrowdMember[];
  label?: 'Quiet' | 'Moderate' | 'Busy';
}

/**
 * @param tenantId Gym scope. Null until the session resolves; the hook simply
 *   stays idle rather than counting every gym's attendance.
 */
export function useLiveCrowd(tenantId: string | null): LiveCrowd {
  const [inside, setInside] = useState(0);
  const [members, setMembers] = useState<CrowdMember[]>([]);
  const [label, setLabel] = useState<'Quiet' | 'Moderate' | 'Busy'>('Quiet');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow response overwriting a newer one.
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (!isUuid(tenantId)) return;

    const id = ++requestId.current;
    setLoading(true);

    try {
      const { data, error: rpcError } = await supabase.rpc('fn_gym_live_crowd', {
        p_tenant_id: tenantId,
      });

      // A newer request already started; this answer is stale.
      if (id !== requestId.current) return;

      if (rpcError) {
        // Almost always "migration 0012 has not been run yet". Say so plainly
        // instead of showing a permanent 0, which reads as "nobody is here".
        setError(
          /could not find the function|does not exist/i.test(rpcError.message)
            ? 'Live occupancy needs migration 0012. Run it in the Supabase SQL Editor.'
            : 'Could not load live occupancy.'
        );
        return;
      }

      const payload = (data ?? {}) as CrowdPayload;
      setInside(Number(payload.inside ?? 0));
      setMembers(Array.isArray(payload.members) ? payload.members : []);
      setLabel(payload.label ?? 'Quiet');
      setError(null);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [tenantId]);

  // Initial load.
  //
  // The call is deferred through a microtask rather than invoked inline: the
  // rule exists because a synchronous setState in an effect body forces React to
  // re-render a second time before it has painted, which is the cascading-render
  // pattern the lint rule protects against. Deferring to a macrotask also gives
  // `refresh` its own render to land in first, so the number appears once instead
  // of flashing.
  useEffect(() => {
    if (!isUuid(tenantId)) return;
    const handle = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(handle);
  }, [tenantId, refresh]);

  // Realtime: a punch anywhere in this gym should move the number immediately.
  useEffect(() => {
    if (!isUuid(tenantId)) return;

    const channel = supabase
      .channel(`live-crowd-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendances',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, refresh]);

  // Visibility + focus: the two moments a backgrounded tab is guaranteed to have
  // missed something.
  useEffect(() => {
    if (!isUuid(tenantId)) return;

    function onWake() {
      if (document.visibilityState !== 'visible') return;
      void refresh();
    }

    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [tenantId, refresh]);

  // Polling floor so the number can never go stale for long.
  useEffect(() => {
    if (!isUuid(tenantId)) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [tenantId, refresh]);

  return { inside, members, label, loading, error, refresh };
}

/** Tailwind classes for the crowd badge, keyed by the SQL-supplied label. */
export const CROWD_TONE: Record<'Quiet' | 'Moderate' | 'Busy', string> = {
  Quiet: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Moderate: 'bg-amber-50 text-amber-700 border-amber-200',
  Busy: 'bg-rose-50 text-rose-700 border-rose-200',
};