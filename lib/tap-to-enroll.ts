'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';

/**
 * TAP-TO-ENROLL (Phase 12).
 *
 * The goal is zero typing: the owner clicks "Tap on Terminal", the reader is armed
 * for 60 seconds, and the member's card field fills itself in the moment the card
 * touches the reader.
 *
 * WHY THIS POLLS INSTEAD OF USING REALTIME
 * ----------------------------------------
 * The brief asked for a Supabase Realtime subscription on `hardware_devices`. That
 * cannot work as written, and it is worth being explicit about why:
 *
 *   - `hardware_devices` is REVOKED from anon/authenticated (Phase 2) because it
 *     holds `api_key`. The anon key is compiled into every build, so granting read
 *     access would hand every gym's machine credential to anyone opening devtools.
 *   - The owner console authenticates against `gym_users`, NOT Supabase Auth, so
 *     it holds the ANON role. Migration 0012 enables RLS + Realtime on that table
 *     for `authenticated` only — which means a socket would subscribe cleanly and
 *     then never fire. That is the exact failure lib/live-attendance.ts documents.
 *
 * So this polls a tenant-scoped SECURITY DEFINER RPC that returns only enrollment
 * fields. Migration 0012 leaves Realtime enabled for `authenticated`, so if the
 * console ever moves to Supabase Auth this becomes a socket with no change to the
 * caller's contract.
 *
 * The poll is fast (900ms) while armed and stops completely once captured, so a
 * backgrounded tab never spins at that rate.
 */

export interface EnrollmentDevice {
  id: string;
  device_name: string;
  device_type: string;
  status: string;
  enrollment_mode: boolean;
  last_scanned_uid: string | null;
  last_scanned_at: string | null;
  enrollment_expires_at: string | null;
}

export type EnrollmentStatus = 'idle' | 'arming' | 'waiting' | 'captured' | 'timeout' | 'error';

export interface UseTapToEnroll {
  status: EnrollmentStatus;
  /** The tapped card, normalised to uppercase hex — ready to save. */
  capturedUid: string | null;
  device: EnrollmentDevice | null;
  /** Seconds left on the arm window; 0 when not armed. */
  secondsLeft: number;
  error: string | null;
  /**
   * Arms a terminal for the 60-second window. `purpose: 'card'` (what the RFID
   * link modal always passes) tells the server to arm the CARD READER — a
   * non-biometric terminal — because a tap only captures on the device that
   * physically received it: fn_hardware_capture_enrollment writes last_scanned_uid
   * only when the tapped device's own row is armed.
   */
  arm: (deviceId?: string | null, purpose?: 'card') => Promise<void>;
  cancel: () => Promise<void>;
  /** Clears a capture so the owner can retry without re-arming. */
  reset: () => void;
  setManualUid: (uid: string) => void;
}

const FAST_POLL_MS = 900;

/**
 * Normalises a card identifier for storage and display.
 *
 * Strips colons/whitespace and uppercases, so an RC522 reporting "B8:BD:D7:12"
 * and someone pasting "b8bdd712" produce the identical value. The same rule is
 * applied server-side in fn_hardware_capture_enrollment and
 * fn_member_link_hardware, so this is cosmetic consistency, not correctness.
 */
export function normalizeCardUid(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 64);
}

export function useTapToEnroll(
  tenantId: string | null,
  onCaptured?: (uid: string) => void
): UseTapToEnroll {
  const [status, setStatus] = useState<EnrollmentStatus>('idle');
  const [capturedUid, setCapturedUid] = useState<string | null>(null);
  const [device, setDevice] = useState<EnrollmentDevice | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Read by the poll loop without making the loop re-subscribe on every change.
  const deviceIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<number>(0);
  // Kept in a ref rather than captured directly so `poll` stays stable while
  // still calling the LATEST callback. Assigning during render is what React 19's
  // react-hooks/refs rule forbids, so it happens inside an effect instead.
  const onCapturedRef = useRef(onCaptured);
  useEffect(() => {
    onCapturedRef.current = onCaptured;
  }, [onCaptured]);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
/** One poll tick. Returns true when the caller should keep polling. */
  const poll = useCallback(async (): Promise<boolean> => {
    const tenant = tenantId;
    if (!isUuid(tenant)) return false;

    try {
      // Deliberately UNSCOPED — read every terminal of this gym on each tick.
      // The ESP32 posts its tap with whatever API key it holds, and while our
      // window is open that capture can land on a different row than the one
      // this console armed (the RFID reader and the fingerprint unit are
      // separate devices with separate keys). Asking for one device_id here
      // was exactly how the tap went unseen.
      const response = await fetch(
        `/api/hardware/enrollment?tenant_id=${encodeURIComponent(tenant)}`,
        { credentials: 'same-origin', cache: 'no-store' }
      );
      const result = (await response.json()) as {
        ok?: boolean;
        devices?: EnrollmentDevice[];
        error?: string;
      };

      if (!response.ok || !result.ok) {
        // Missing migration 0012 is by far the most likely cause.
        setError(result.error ?? 'Could not read terminal state. Is migration 0012 applied?');
        setStatus('error');
        return false;
      }

      const devices = result.devices ?? [];

      // The terminal we armed (its id is spelled `device_id` by
      // fn_hardware_begin_enrollment, `id` by other builds) — used ONLY to pick
      // the row the countdown reads.
      const scoped = deviceIdRef.current
        ? devices.find((d) => d.id === deviceIdRef.current) ?? null
        : null;

      // Capture acceptance scans EVERY terminal of the gym, not just the armed
      // one, so whichever terminal key the ESP32 used to send the tap the UID
      // is seen immediately. Safe because freshness is checked per row below:
      // only fn_hardware_capture_enrollment ever writes last_scanned_uid, it
      // only fires while that device itself is armed, and the window is the
      // one this modal just opened.
      const watched = devices;

      // Count down against the terminal that is actually armed when we can
      // identify it; only then fall back to the first row.
      const display = scoped ?? devices.find((d) => d.enrollment_mode) ?? devices[0] ?? null;
      setDevice(display);

      // A capture counts only if it is FRESH. Without this check the stale
      // last_scanned_uid left by a previous enrollment would satisfy the very
      // first poll and silently fill in the WRONG card — the single most
      // dangerous bug this flow could have. Only fn_hardware_capture_enrollment
      // ever writes last_scanned_uid, so any fresh value IS an enrollment tap.
      for (const candidate of watched) {
        const uid = normalizeCardUid(candidate.last_scanned_uid);
        const scannedAt = candidate.last_scanned_at
          ? Date.parse(candidate.last_scanned_at)
          : NaN;
        const fresh =
          uid !== '' && !Number.isNaN(scannedAt) && Date.now() - scannedAt < 60_000;

        if (fresh) {
          stopPolling();
          setCapturedUid(uid);
          setStatus('captured');
          setSecondsLeft(0);

          // Consume the capture: null this row's last_scanned_uid so a FUTURE
          // modal opening cannot refill from a tap already shown here. Best
          // effort — the freshness gate above and fn_hardware_begin_enrollment's
          // clear-on-arm still cover a dropped call. An RPC rather than a
          // direct .update(): hardware_devices is revoked from anon and this
          // client IS the anon key.
          void supabase.rpc('fn_hardware_clear_enrollment_capture', {
            p_tenant_id: tenant,
            p_device_id: candidate.id,
          });

          onCapturedRef.current?.(uid);
          return false;
        }
      }

      if (display?.enrollment_mode) {
        const expires = display.enrollment_expires_at
          ? Date.parse(display.enrollment_expires_at)
          : NaN;

        if (!Number.isNaN(expires) && Date.now() > expires) {
          stopPolling();
          setStatus('timeout');
          setSecondsLeft(0);
          return false;
        }

        setSecondsLeft(
          Number.isNaN(expires) ? 0 : Math.max(0, Math.ceil((expires - Date.now()) / 1000))
        );
        return true;
      }

      // Disarmed with no capture: the window elapsed server-side.
      if (deadlineRef.current && Date.now() > deadlineRef.current) {
        stopPolling();
        setStatus('timeout');
        setSecondsLeft(0);
        return false;
      }

      return true;
    } catch {
      // One dropped request must not end an armed window early — keep
      // polling until the deadline, then surface the timeout honestly.
      if (deadlineRef.current && Date.now() > deadlineRef.current) {
        setError('Lost connection to the terminal. Check your network.');
        setStatus('error');
        return false;
      }
      return true;
    }
  }, [tenantId, stopPolling]);

  /**
   * Schedules the next fast tick.
   *
   * Uses a ref rather than calling `scheduleFast()` from inside its own body:
   * a useCallback that references itself captures the variable BEFORE it is
   * initialised, which is what React 19's react-hooks/immutability rule flags —
   * and it is a real bug, not just a lint nit, because the self-reference can
   * point at a stale closure from a previous render. The ref always holds the
   * current function.
   */
  const scheduleFastRef = useRef<() => void>(() => {});

  const scheduleFast = useCallback(() => {
    stopPolling();
    timerRef.current = setTimeout(() => {
      void (async () => {
        if (await poll()) scheduleFastRef.current();
      })();
    }, FAST_POLL_MS);
  }, [poll, stopPolling]);

  useEffect(() => {
    scheduleFastRef.current = scheduleFast;
  }, [scheduleFast]);

  const arm = useCallback(
    async (deviceId?: string | null, purpose?: 'card') => {
      if (!isUuid(tenantId)) {
        setError('Sign in to the gym console before enrolling a card.');
        setStatus('error');
        return;
      }

      setStatus('arming');
      setError(null);
      setCapturedUid(null);
      setDevice(null);

      try {
        const response = await fetch('/api/hardware/enrollment', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant_id: tenantId,
            device_id: deviceId ?? null,
            seconds: 60,
            ...(purpose ? { purpose } : {}),
          }),
        });

        const result = (await response.json()) as {
          ok?: boolean;
          // fn_hardware_begin_enrollment spells the primary key `device_id`
          // (some builds also return `id`). Reading only `.id` used to store
          // `undefined` here, which silently dropped the device scope from
          // every poll below — see the note in poll() for why that hid taps.
          device?: { id?: string; device_id?: string; enrollment_expires_at?: string };
          error?: string;
        };

        if (!response.ok || !result.ok || !result.device) {
          setError(result.error ?? 'Could not arm that terminal.');
          setStatus('error');
          return;
        }

        deviceIdRef.current = result.device.id ?? result.device.device_id ?? null;
        deadlineRef.current = result.device.enrollment_expires_at
          ? Date.parse(result.device.enrollment_expires_at)
          : Date.now() + 60_000;

        setSecondsLeft(60);
        setStatus('waiting');
        scheduleFast();
      } catch {
        setError('Could not reach the server. Check your connection.');
        setStatus('error');
      }
    },
    [tenantId, scheduleFast]
  );

  const cancel = useCallback(async () => {
    stopPolling();
    const tenant = tenantId;
    const deviceId = deviceIdRef.current;

    deviceIdRef.current = null;
    deadlineRef.current = 0;
    setStatus('idle');
    setSecondsLeft(0);
    setError(null);

    if (!isUuid(tenant) || !deviceId) return;

    // Best effort. Leaving a terminal armed after the owner walks away would keep
    // swallowing real member entries as "enrollments", so clearing it matters.
    try {
      await supabase.rpc('fn_hardware_begin_enrollment', {
        p_tenant_id: tenant,
        p_device_id: deviceId,
        p_seconds: 15,
      });
    } catch {
      /* ignore — the SQL-side expiry clears it anyway */
    }
  }, [tenantId, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setStatus('idle');
    setCapturedUid(null);
    setSecondsLeft(0);
    setError(null);
  }, [stopPolling]);

  const setManualUid = useCallback((uid: string) => {
    const clean = normalizeCardUid(uid);
    setCapturedUid(clean || null);
    setStatus(clean ? 'captured' : 'idle');
  }, []);

  // Never leave a poll running after the modal closes.
  useEffect(() => stopPolling, [stopPolling]);

  return { status, capturedUid, device, secondsLeft, error, arm, cancel, reset, setManualUid };
}