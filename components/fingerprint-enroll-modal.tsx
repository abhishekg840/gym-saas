'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  Loader2,
  RefreshCw,
  ScanLine,
  X,
} from 'lucide-react';
import {
  ENROLLMENT_STEPS,
  cancelFingerprintEnrollment,
  fetchFingerprintState,
  startFingerprintEnrollment,
  type FingerprintJob,
  type FingerprintStage,
  type FingerprintTerminal,
} from '@/lib/fingerprint-enroll';

/**
 * Register Fingerprint — the live R307/R307S ceremony (Phase 17).
 *
 * WHY THIS IS NOT THE RFID MODAL
 * ------------------------------
 * A card tap is one event: arm the reader, the card arrives, done. A fingerprint
 * is a handshake with a machine that has to be told what to do and has to answer
 * — seven distinct states, several seconds each, and two ways to fail (no finger,
 * or two different fingers). None of that fits in "type a number, save it", so
 * this is a separate surface that mirrors the sensor rather than pretending the
 * work is instant.
 *
 * WHAT THE MODAL DOES NOT DO
 * --------------------------
 * It never writes a slot itself. The server reserved the slot when the job was
 * created and binds it when the device reports success; this component only
 * starts the job, watches it, and reports the outcome. That is why closing the
 * modal mid-capture cannot leave a half-enrolled member on the roster.
 */

/** How often the desk re-reads the job while a capture is running. */
const POLL_MS = 900;

/** Stage order, so "how far along" is an index rather than a set of rules. */
const STAGE_ORDER: FingerprintStage[] = ENROLLMENT_STEPS.map((s) => s.stage);

function stageIndex(stage: FingerprintStage | undefined): number {
  const i = STAGE_ORDER.indexOf(stage ?? 'queued');
  return i < 0 ? 0 : i;
}

interface FingerprintEnrollModalProps {
  tenantId: string | null;
  memberId: string;
  memberName: string;
  /** The slot already on file, if this member has one (re-enrollment). */
  currentSlot?: number | null;
  onClose: () => void;
  /** Called once the slot is genuinely bound, so the caller can refresh the roster. */
  onEnrolled: (slot: number) => Promise<void> | void;
}

export default function FingerprintEnrollModal({
  tenantId,
  memberId,
  memberName,
  currentSlot = null,
  onClose,
  onEnrolled,
}: FingerprintEnrollModalProps) {
  const [terminals, setTerminals] = useState<FingerprintTerminal[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [job, setJob] = useState<FingerprintJob | null>(null);
  const [state, setState] = useState<
    'idle' | 'starting' | 'running' | 'succeeded' | 'failed'
  >('idle');
  const [error, setError] = useState<string | null>(null);

  /** The live job token, so the poll watches THIS job and not the newest one. */
  const jobTokenRef = useRef<string | null>(null);
  /** Guards onEnrolled against firing twice on a fast re-render. */
  const notifiedRef = useRef(false);

  /** Load the terminals this gym can enrol on, once, when the modal opens. */
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    void (async () => {
      const result = await fetchFingerprintState(tenantId, null);
      if (cancelled) return;
      setTerminals(result.terminals);
      // Default to the first terminal; POST falls back to the freshest heartbeat
      // anyway when deviceId is null, so this only affects the visible label.
      setDeviceId((current) => current ?? result.terminals[0]?.id ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

const finish = useCallback(
    async (finalJob: FingerprintJob) => {
      setJob(finalJob);
      if (notifiedRef.current) return;
      notifiedRef.current = true;
      setState('succeeded');
      await onEnrolled(finalJob.slot);
    },
    [onEnrolled]
  );

  /** Poll the job until it reaches a terminal state. Returns keep-polling. */
  const poll = useCallback(async (): Promise<boolean> => {
    const tenant = tenantId;
    if (!tenant) return false;

    const result = await fetchFingerprintState(tenant, jobTokenRef.current);
    if (!result.ok || !result.job) return false;

    const current = result.job;

    if (current.status === 'succeeded') {
      await finish(current);
      return false;
    }

    if (current.status === 'failed' || current.status === 'cancelled') {
      setJob(current);
      setState('failed');
      setError(
        current.message ??
          (current.status === 'cancelled'
            ? 'The enrollment was cancelled.'
            : 'The terminal could not complete this enrollment.')
      );
      return false;
    }

    setJob(current);
    setState('running');
    return true;
  }, [tenantId, finish]);

  /**
 * The poll loop, as ONE effect rather than a self-rescheduling timer.
 *
 * The timer has to re-arm itself, but a useCallback cannot reference its own
 * binding, and the two earlier shapes are both rejected by the compiler:
 * a mutable self-ref (react-hooks/immutability) and a helper function declared
 * after use (accessed-before-declared).
 *
 * So the loop is expressed as what it actually is: "while this job is still
 * running, wait POLL_MS and read it again". `runId` is a plain ref holding a
 * counter; incrementing it is how start() and close() cancel an in-flight loop
 * without a timer handle, and the effect's own cleanup stops it on unmount.
 */
const runIdRef = useRef(0);

  async function start() {
    if (!tenantId) {
      setError('Sign in to the gym console before enrolling a fingerprint.');
      return;
    }

    // A new run invalidates any loop still in flight from a previous attempt.
    runIdRef.current += 1;

    setState('starting');
    setError(null);

    const result = await startFingerprintEnrollment(tenantId, memberId, deviceId);

    if (!result.ok || !result.job) {
      setState('failed');
      setError(result.error ?? 'Could not start the enrollment.');
      return;
    }

    // Watch THIS job specifically — another desk may enroll someone else while
    // this capture is running.
    jobTokenRef.current = result.job.job_token;
    setJob({
      ...result.job,
      status: 'pending',
      stage: 'queued',
      message: null,
      error_code: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    } as FingerprintJob);
    setState('running');
  }

  /** Closing mid-capture must actually release the reserved slot. */
  function close() {
    runIdRef.current += 1;
    const tenant = tenantId;
    const token = jobTokenRef.current;
    if (tenant && token && (state === 'running' || state === 'starting')) {
      void cancelFingerprintEnrollment(tenant, token);
    }
    onClose();
  }

  const running = state === 'running' || state === 'starting';
  const done = state === 'succeeded';
  const failed = state === 'failed';
  const currentIndex = done ? STAGE_ORDER.length - 1 : stageIndex(job?.stage);

  /**
   * The poll loop, as ONE effect rather than a self-rescheduling timer.
   *
   * The timer has to re-arm itself, but a useCallback cannot reference its own
   * binding, and the two obvious alternatives are both rejected by the
   * compiler: a mutable self-ref (react-hooks/immutability) and a helper declared
   * after use (accessed-before-declared).
   *
   * So the loop is written as what it actually is — "while this job is still
   * running, wait POLL_MS and read it again". `runIdRef` is bumped by start() and
   * close() to cancel an in-flight loop without holding a timer handle, and this
   * effect's own cleanup stops it on unmount.
   */
  useEffect(() => {
    if (!running) return;

    const runId = runIdRef.current;
    let cancelled = false;

    const tick = async () => {
      const keepGoing = await poll();
      if (cancelled || runId !== runIdRef.current || !keepGoing) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (!cancelled && runId === runIdRef.current) void tick();
    };

    void tick();

    return () => {
      cancelled = true;
    };
  }, [running, poll]);

return (
    <div className="vy-scrim">
      <div className="vy-modal max-w-md">
        <div className="vy-modal-head">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
              <Fingerprint className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                Register Fingerprint
              </h2>
              <p className="truncate text-[12px] text-muted">{memberName}</p>
            </div>
          </div>
          <button onClick={close} aria-label="Close" className="vy-icon-btn">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="vy-modal-body space-y-4">
          {/* Terminal picker — hidden once a capture is running, because the slot
              is already reserved on a specific sensor by then. */}
          {state === 'idle' && (
            <div>
              <label className="vy-label" htmlFor="fp-terminal">
                Terminal
              </label>
              {terminals.length === 0 ? (
                <p className="vy-notice vy-notice-bad">
                  <span>
                    No fingerprint terminal is registered for this gym. Add one on the
                    Hardware tab first.
                  </span>
                </p>
              ) : (
                <select
                  id="fp-terminal"
                  value={deviceId ?? ''}
                  onChange={(e) => setDeviceId(e.target.value || null)}
                  className="vy-select"
                >
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.device_name}
                      {t.status === 'online' ? ' · online' : ' · offline'}
                    </option>
                  ))}
                </select>
              )}

              {currentSlot != null && currentSlot > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  {memberName} already uses slot {currentSlot}. Enrolling again frees that
                  slot and stores the new finger instead.
                </p>
              )}

              <button
                type="button"
                onClick={() => void start()}
                disabled={terminals.length === 0}
                className="vy-btn vy-btn-lg vy-btn-brand w-full"
              >
                <ScanLine className="h-4 w-4" /> Start enrollment
              </button>
            </div>
          )}

          {state === 'starting' && (
            <p className="flex items-center justify-center gap-2 py-4 text-[12px] text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reserving a slot…
            </p>
          )}

{/* Live ceremony: the current step large, the whole sequence underneath so the
              member can see there are two more steps left rather than a stuck bar. */}
          {running && (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-subtle p-4 text-center">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-line bg-surface">
                  <Fingerprint
                    className={`h-8 w-8 text-violet-600 ${
                      currentIndex >= 1 && currentIndex <= 3 ? 'animate-pulse' : ''
                    }`}
                  />
                </div>
                <p className="text-[15px] font-semibold tracking-tight text-ink">
                  {ENROLLMENT_STEPS[currentIndex]?.title ?? 'Starting…'}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  {job?.message ?? ENROLLMENT_STEPS[currentIndex]?.detail}
                </p>
                {job && (
                  <p className="mt-2 text-[11px] text-faint">
                    {job.device_name} · slot {job.slot}
                  </p>
                )}
              </div>

              <ol className="space-y-1">
                {ENROLLMENT_STEPS.map((step, i) => {
                  const reached = i <= currentIndex;
                  const active = i === currentIndex;
                  return (
                    <li
                      key={step.stage}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] transition ${
                        active ? 'bg-wash text-ink' : reached ? 'text-muted' : 'text-faint'
                      }`}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {reached ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
                        )}
                      </span>
                      <span className="font-medium">{step.title}</span>
                    </li>
                  );
                })}
              </ol>

              <p className="text-[11px] leading-relaxed text-faint">
                Keep the finger flat and still. The terminal needs two scans of the
                <span className="font-semibold text-muted"> same finger</span> to build a
                reliable template.
              </p>
            </div>
          )}

          {/* Success — the slot is bound by now, not when this renders. */}
          {done && job && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-600" />
                <p className="text-[15px] font-semibold text-emerald-900">
                  Fingerprint registered!
                </p>
                <p className="mt-1 text-[13px] text-emerald-800">
                  {job.member_name} → slot{' '}
                  <span className="font-semibold tabular-nums">{job.slot}</span>
                </p>
                <p className="mt-1 text-[11px] text-emerald-700">{job.device_name}</p>
              </div>
              <button onClick={close} className="vy-btn vy-btn-lg vy-btn-primary w-full">
                Done
              </button>
            </div>
          )}

          {/* Failure — nothing was bound, so "Try again" is safe and honest. */}
          {failed && (
            <div className="space-y-4">
              <div className="vy-notice vy-notice-bad">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Fingerprint not registered</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed">{error}</p>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-faint">
                Nothing was saved to the member profile. Try again, and make sure the same
                finger is used for both scans.
              </p>
              <div className="flex gap-2">
                <button onClick={close} className="vy-btn vy-btn-lg vy-btn-secondary flex-1">
                  Close
                </button>
                <button
                  onClick={() => {
                    notifiedRef.current = false;
                    jobTokenRef.current = null;
                    setJob(null);
                    setState('idle');
                    setError(null);
                  }}
                  className="vy-btn vy-btn-lg vy-btn-brand flex-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Try again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}