'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';

/**
 * Live member entries (Module 8.2) — the owner's "Live Member Entries" board.
 *
 * THE BUG THIS FIXES
 * -----------------
 * The log was a one-shot `.select()` on mount. Nothing ever told the desk about
 * the next punch, so a check-in at the gate did not appear until a manual
 * refresh — which for a screen whose entire job is "who walked in right now" is
 * the same as being broken.
 *
 * THREE MECHANISMS, because any one alone fails in the field:
 *
 *   1. REALTIME. A Postgres INSERT on `attendances` filtered by tenant arrives
 *      over the socket and is prepended. This REQUIRES the table to be in the
 *      `supabase_realtime` publication — migration 0011 adds it. Without that the
 *      channel subscribes cleanly and then silently never fires, which is
 *      exactly the failure that was so hard to diagnose.
 *
 *   2. VISIBILITY + FOCUS. A tab that has been in the background misses inserts
 *      (the socket buffers, and some mobile WebViews drop it entirely), so we
 *      re-fetch on `visibilitychange` and on window `focus`.
 *
 *   3. POLLING FLOOR. A 10s poll that only runs when the socket is not healthy
 *      or the document is hidden. Realtime-first with a floor under it, rather
 *      than polling always and pretending the socket is decoration.
 *
 * Every timestamp is rendered in the GYM's timezone (Asia/Kolkata) — a desk
 * abroad must still read the gym's clock.
 */

export interface AttendanceRecord {
  id: string;
  punch_time: string;
  method: string;
  status: string;
  member: {
    full_name: string;
    phone: string;
    biometric_id?: number | null;
  } | null;
}

export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';

const POLL_MS = 10_000;
const MAX_ROWS = 100;

/** Members are embedded through the FK, so one round trip brings the names. */
const ATTENDANCE_SELECT =
  'id, punch_time, method, status, member_id, members(full_name, phone, biometric_id)';

function normalise(row: unknown): AttendanceRecord {
  const item = row as {
    id: string;
    punch_time: string;
    method: string;
    status: string;
    members?: AttendanceRecord['member'] | AttendanceRecord['member'][];
  };
  // PostgREST returns a to-one embed as an object, but a left join can produce an
  // array; normalising both here means no caller has to think about it.
  const member = Array.isArray(item.members) ? item.members[0] : item.members;
  return {
    id: item.id,
    punch_time: item.punch_time,
    method: item.method || 'qr',
    status: item.status || 'granted',
    member: member ?? null,
  };
}

export function useLiveAttendance(tenantId: string | null) {
  const [rows, setRows] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [scopeError, setScopeError] = useState<string | null>(null);

  /**
   * Pull the newest 100. Always a full replace rather than a merge: after a
   * background gap the server's window is authoritative, and splicing a partial
   * response into a stale list is how boards end up showing rows that are gone.
   */
  const fetchRows = useCallback(async (tenant: string) => {
    const { data, error } = await supabase
      .from('attendances')
      .select(ATTENDANCE_SELECT)
      .eq('tenant_id', tenant)
      .order('punch_time', { ascending: false })
      .limit(MAX_ROWS);

    if (error) {
      console.error('Attendance fetch failed:', error.message);
      return false;
    }
    setRows(((data ?? []) as unknown[]).map(normalise));
    return true;
  }, []);

  const start = useCallback(
    async (tenant: string) => {
      setScopeError(null);
      setLoading(true);
      const ok = await fetchRows(tenant);
      setLoading(false);
      if (!ok) setStatus('polling');
    },
    [fetchRows]
  );

  // ---- Realtime subscription -------------------------------------------------
  useEffect(() => {
    if (!isUuid(tenantId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScopeError('Sign in again to load this gym\u2019s live entries.');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    const tenant = tenantId;
    void start(tenant);

    const channel = supabase
      .channel(`attendance:${tenant}`)
      .on(
        // INSERT only: a punch is immutable once written. Listening to UPDATE
        // as well would repaint the table every time a kiosk heartbeat touched
        // a row.
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendances',
          filter: `tenant_id=eq.${tenant}`,
        },
        (payload) => {
          const incoming = normalise(payload.new);
          setRows((current) => {
            // The socket can redeliver on reconnect, and the poll may have
            // inserted the same row a moment earlier. Keyed on the row id, the
            // same punch can never appear twice.
            if (current.some((row) => row.id === incoming.id)) return current;
            return [incoming, ...current].slice(0, MAX_ROWS);
          });
        }
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') setStatus('live');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          setStatus('polling');
        }
      });

    return () => {
      // removeChannel also drops the listeners, so a remount cannot leave two
      // sockets pushing into the same state.
      void supabase.removeChannel(channel);
    };
  }, [tenantId, start]);

  // ---- Background / focus recovery ------------------------------------------
  useEffect(() => {
    if (!isUuid(tenantId)) return;
    const tenant = tenantId;

    function onWake() {
      if (document.visibilityState !== 'visible') {
        setStatus('polling');
        return;
      }
      void fetchRows(tenant);
    }

    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [tenantId, fetchRows]);

  // ---- Polling floor ---------------------------------------------------------
  useEffect(() => {
    if (!isUuid(tenantId)) return;
    const tenant = tenantId;

    const timer = setInterval(() => {
      const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
      // Only poll when the socket is not doing the job.
      if (hidden || status !== 'live') void fetchRows(tenant);
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [tenantId, status, fetchRows]);

  const refresh = useCallback(async () => {
    if (!isUuid(tenantId)) return;
    await fetchRows(tenantId);
  }, [tenantId, fetchRows]);

  return { rows, loading, status, scopeError, refresh };
}

// -----------------------------------------------------------------------------
// Time formatting — always the gym's clock
// -----------------------------------------------------------------------------

const GYM_TZ = 'Asia/Kolkata';

/** "14:32" in IST. */
export function gymClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: GYM_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** "12 Mar, 14:32" in IST — for rows from earlier days. */
export function gymStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: GYM_TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** "2 days ago" / "just now". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((now - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Up to two initials from a member name. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Human label for the connection dot, so "polling" is not a mystery.
 *
 * `dot` and `text` are separate on purpose: the dot is a saturated status colour
 * (it has to be visible from across a desk), while the text sits on a white card
 * and needs the darker 700 weight to pass contrast. Splitting them here stops a
 * page from slicing a classes string apart just to get at a colour.
 */
export const LIVE_STATUS_META: Record<
  LiveStatus,
  { label: string; dot: string; text: string }
> = {
  connecting: { label: 'Connecting…', dot: 'bg-amber-400', text: 'text-amber-700' },
  live: { label: 'Live', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  polling: { label: 'Auto-refresh', dot: 'bg-amber-400', text: 'text-amber-700' },
  offline: { label: 'Offline', dot: 'bg-rose-400', text: 'text-rose-700' },
};