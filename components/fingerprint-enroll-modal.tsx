'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Fingerprint,
  Loader2,
  Power,
  RefreshCw,
  ScanLine,
  Usb,
  X,
} from 'lucide-react';
import {
  ENROLLMENT_STEPS,
  cancelFingerprintEnrollment,
  fetchFingerprintState,
  formatIdle,
  isTerminalOnline,
  startFingerprintEnrollment,
  terminalIdleSeconds,
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

/**
 * Liveness dot and chip, mirroring app/hardware/page.tsx.
 *
 * Written out rather than imported because these maps carry Tailwind class names,
 * and the two screens must never disagree about whether a reader is live — that
 * disagreement is the entire bug this guard exists to close. The rule itself
 * (ONLINE_WINDOW_SECONDS) IS shared, via isTerminalOnline.
 */
const LIVE_DOT = {
  online: 'bg-emerald-500',
  offline: 'bg-line-strong',
} as const;

/**
 * The one word an owner acts on.
 *
 * A stale heartbeat outranks the stored status: `error` and `maintenance` are
 * database values that only move when the device next talks, so a reader that
 * died a minute ago can still be filed as "Ready" and would send the desk
 * looking in the wrong place.
 */
function terminalChip(
  terminal: FingerprintTerminal,
  now: number
): { label: string; tone: string } {
  if (!isTerminalOnline(terminal, now)) return { label: 'Offline', tone: 'vy-chip-slate' };
  if (terminal.status === 'error') return { label: 'Needs attention', tone: 'vy-chip-rose' };
  if (terminal.status === 'maintenance') return { label: 'Ready', tone: 'vy-chip-amber' };
  return { label: 'Online', tone: 'vy-chip-emerald' };
}

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
  /** True only while the terminal list is genuinely in flight. */
  const [loadingTerminals, setLoadingTerminals] = useState(true);
  /** Why the list could not be read — never the same thing as "it was empty". */
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * One clock for the whole render, stamped at the moment of the read.
   *
   * State rather than an inline Date.now(), which the compiler rejects during
   * render — and this is the more honest version anyway: every terminal is
   * judged against the SAME instant, so the list can never show two readers as
   * online and offline a millisecond apart. It stays frozen until the next read,
   * which also stops a live reader from flickering to "offline" while the desk
   * is reading the screen. "Check again" re-stamps it.
   */
  const [now, setNow] = useState(0);

  /** Only for the "no terminal registered" escape hatch out to /hardware. */
  const router = useRouter();

  /** The live job token, so the poll watches THIS job and not the newest one. */
  const jobTokenRef = useRef<string | null>(null);
  /** Guards onEnrolled against firing twice on a fast re-render. */
  const notifiedRef = useRef(false);
  /** Bumped per read, so a slow first load cannot overwrite a fast retry. */
  const loadRunRef = useRef(0);

  /**
   * Read the terminals this gym can enrol on and apply the result.
   *
   * WHY THIS IS NOT `terminals.length === 0`
   * ----------------------------------------
   * An empty list and an unreadable list are different facts about the gym, and
   * the desk acts on them differently: one means "go register a terminal", the
   * other means "this console could not reach the server, try again". Collapsing
   * the two is what let a failed read render as a confident claim that no
   * terminal exists. So `terminals` is only ever written by a SUCCESSFUL read,
   * and a failed one always lands in `loadError` instead.
   *
   * NOTHING BETWEEN HERE AND THE FETCH MAY SET STATE
   * ----------------------------------------------
   * The mount path runs this from inside an effect, and a synchronous update
   * there is a cascading render. The run id is claimed first (a ref, not state)
   * so a retry started while this read is in flight still wins on arrival.
   */
  const loadTerminals = useCallback(async () => {
    loadRunRef.current += 1;
    const runId = loadRunRef.current;

    const result = tenantId ? await fetchFingerprintState(tenantId, null) : null;

    // A retry (or the modal closing) has already taken ownership of the state.
    if (runId !== loadRunRef.current) return;

    // Re-stamp the clock so liveness is judged as of this read, not of mount.
    const stamped = Date.now();
    setNow(stamped);
    setLoadingTerminals(false);

    if (!result) {
      setLoadError('Sign in to the gym console before enrolling a fingerprint.');
      return;
    }

    if (!result.ok) {
      setLoadError(result.error ?? 'Could not load the fingerprint terminals.');
      return;
    }

    setTerminals(result.terminals);
    // Default to a terminal that can actually ANSWER. POST falls back to the
    // freshest heartbeat when deviceId is null, but preselecting a dead reader
    // would let the desk start a capture that then waits out the whole expiry.
    // A retry keeps the desk's existing choice if it is still on the list.
    setDeviceId((current) =>
      result.terminals.some((t) => t.id === current)
        ? current
        : (result.terminals.find((t) => isTerminalOnline(t, stamped))?.id ?? null)
    );
  }, [tenantId]);

  /**
   * Retry from an event handler.
   *
   * The "clearing" updates live here rather than at the top of loadTerminals so
   * that the mount path stays free of synchronous state writes. A failed read
   * used to leave the desk permanently stuck here, because nothing on screen
   * could produce a second attempt.
   */
  const retryTerminals = useCallback(() => {
    setLoadingTerminals(true);
    setLoadError(null);
    void loadTerminals();
  }, [loadTerminals]);

  /** Load once when the modal opens; Retry re-runs this on demand. */
  useEffect(() => {
    // Awaited at the call site on purpose: the compiler only treats updates as
    // asynchronous when it can see an await here, and loadTerminals writes
    // state once its own fetch resolves.
    void (async () => {
      await loadTerminals();
    })();

    // Bumping the run id on unmount stops a late response from writing state.
    return () => {
      loadRunRef.current += 1;
    };
  }, [loadTerminals]);

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

  /**
   * Closing mid-capture must actually release the reserved slot.
   *
   * A useCallback because the Escape handler below depends on it, and a plain
   * function here would rebuild that listener on every render.
   */
  const close = useCallback(() => {
    runIdRef.current += 1;
    const tenant = tenantId;
    const token = jobTokenRef.current;
    if (tenant && token && (state === 'running' || state === 'starting')) {
      void cancelFingerprintEnrollment(tenant, token);
    }
    onClose();
  }, [tenantId, state, onClose]);

  /**
   * Escape closes this dialog, and only this one.
   *
   * The parent RFID dialog registers no key handler, so the topmost dialog is the
   * only thing Escape reaches: closing here cannot cascade into the parent and
   * throw away a card the desk already tapped. Closing mid-capture is safe
   * because this is the same path the X button takes — the slot is released.
   *
   * The backdrop is deliberately NOT a click target. A ten-second capture and a
   * stray click outside the card are far too close together to risk here.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  /**
   * The way out of a gym with no reader registered.
   *
   * Close FIRST, then navigate: close() is what cancels any reservation and
   * tells the parent to drop this child, and pushing the route first would
   * unmount the parent out from under an in-flight cancel.
   */
  const goToHardware = useCallback(() => {
    close();
    router.push('/hardware');
  }, [close, router]);

  const running = state === 'running' || state === 'starting';
  const done = state === 'succeeded';
  const failed = state === 'failed';
  const currentIndex = done ? STAGE_ORDER.length - 1 : stageIndex(job?.stage);

  /**
   * Liveness of what is actually chosen, all judged against the single clock
   * stamped by the last read.
   */
  const selectedTerminal = terminals.find((t) => t.id === deviceId) ?? null;
  const selectedIdle = selectedTerminal ? terminalIdleSeconds(selectedTerminal, now) : null;
  const selectedOnline = selectedTerminal ? isTerminalOnline(selectedTerminal, now) : false;
  const anyOnline = terminals.some((t) => isTerminalOnline(t, now));

  /** The CTA is live only when there is a reader that can actually reply. */
  const canStart =
    !loadingTerminals &&
    loadError === null &&
    selectedTerminal !== null &&
    selectedOnline;

  /** Spelled out under the button, because a disabled button explains nothing. */
  const blockedReason = canStart
    ? null
    : loadingTerminals
      ? 'Loading terminals…'
      : loadError
        ? 'The terminal list could not be loaded.'
        : selectedTerminal === null
          ? 'Select a terminal to continue.'
          : `${selectedTerminal.device_name} last checked in ${formatIdle(
              selectedIdle
            )}. Power it on before enrolling.`;

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
      <div
        className="vy-modal max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fp-enroll-title"
      >
        <div className="vy-modal-head">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
              <Fingerprint className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2
                id="fp-enroll-title"
                className="text-[15px] font-semibold tracking-tight text-ink"
              >
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
            <div className="space-y-4">
              <span className="vy-label">Terminal</span>
              {/* Four distinct outcomes. Painting "no terminal" while the read is
                  in flight, or after it failed, is how a perfectly healthy gym
                  ends up looking misconfigured. */}
              {loadingTerminals ? (
                <p className="vy-panel flex items-center gap-2 text-[13px] text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading terminals…
                </p>
              ) : loadError ? (
                <div className="space-y-3">
                  <p className="vy-notice vy-notice-bad">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{loadError}</span>
                  </p>
                  <button
                    type="button"
                    onClick={retryTerminals}
                    className="vy-btn vy-btn-secondary w-full"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </button>
                </div>
              ) : terminals.length === 0 ? (
                /* The one state with no way forward from inside this dialog, so it
                   carries the only button that leaves it. */
                <div className="vy-empty px-5 py-7">
                  <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-wash text-muted">
                    <Usb className="h-5 w-5" />
                  </span>
                  <p className="text-[13px] font-semibold text-ink">
                    No fingerprint terminal registered
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    This gym has no R307 reader on file. Register one on the Hardware tab
                    and it will appear here.
                  </p>
                  <button
                    type="button"
                    onClick={goToHardware}
                    className="vy-btn vy-btn-brand mt-4"
                  >
                    Go to Hardware tab <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* A native <option> cannot carry a status dot, and the dot is
                      the point: the desk needs liveness BEFORE choosing, not after.
                      Real radios keep arrow-key selection and the focus ring free. */}
                  <fieldset className="space-y-2">
                    <legend className="sr-only">Fingerprint terminal</legend>
                    {[...terminals]
                      .sort(
                        (a, b) =>
                          Number(isTerminalOnline(b, now)) - Number(isTerminalOnline(a, now))
                      )
                      .map((t) => {
                        const online = isTerminalOnline(t, now);
                        const chip = terminalChip(t, now);
                        const selected = deviceId === t.id;
                        return (
                          <label key={t.id} className="block cursor-pointer">
                            <input
                              type="radio"
                              name="fp-terminal"
                              value={t.id}
                              checked={selected}
                              onChange={() => setDeviceId(t.id)}
                              className="peer sr-only"
                            />
                            <span
                              className={`flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand ${
                                selected ? 'border-brand bg-brand/5' : 'border-line bg-surface'
                              }`}
                            >
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${
                                  online ? LIVE_DOT.online : LIVE_DOT.offline
                                }`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-ink">
                                  {t.device_name}
                                </span>
                                <span className="block text-[11px] text-faint">
                                  Last heartbeat {formatIdle(terminalIdleSeconds(t, now))}
                                </span>
                              </span>
                              <span className={`vy-chip shrink-0 ${chip.tone}`}>{chip.label}</span>
                              {selected && <Check className="h-4 w-4 shrink-0 text-brand" />}
                            </span>
                          </label>
                        );
                      })}
                  </fieldset>

                  {/* Registering a reader is not the same as it being switched on.
                      Without this the desk starts a capture that sits at "Connecting
                      to terminal…" for the full ten-minute expiry, with nothing on
                      screen to say why. */}
                  {!anyOnline && (
                    <div className="space-y-3">
                      <p className="vy-notice vy-notice-warn">
                        <Power className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          None of this gym&apos;s terminals is checking in. Power the reader
                          on — enrollment cannot start until it answers.
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={retryTerminals}
                        className="vy-btn vy-btn-secondary w-full"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Check again
                      </button>
                    </div>
                  )}

                  {anyOnline && selectedTerminal && !selectedOnline && (
                    <p className="vy-notice vy-notice-warn">
                      <Power className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {selectedTerminal.device_name} last checked in {formatIdle(selectedIdle)}.
                        Wake it up, or pick a terminal that is online.
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* About the member, not the terminal — so it waits for a resolved list rather
                  than stacking under a load error it cannot explain. */}
              {currentSlot != null &&
                currentSlot > 0 &&
                !loadingTerminals &&
                loadError === null && (
                  <p className="vy-panel flex items-start gap-2 text-[12px] leading-relaxed text-muted">
                    <Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" />
                    <span>
                      Currently assigned:{' '}
                      <span className="font-semibold tabular-nums text-ink">
                        Slot #{currentSlot}
                      </span>{' '}
                      — re-enrolling will replace this template.
                    </span>
                  </p>
                )}

              {/* The blocked state is NEUTRAL, not a half-faded brand green. `bg-brand`
                  at 50% opacity over white still reads as "go", and this is the one
                  control the desk must understand will not work — so it loses the
                  accent entirely instead of dimming it. */}
              <div>
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={!canStart}
                  className={`vy-btn vy-btn-lg w-full ${
                    canStart
                      ? 'vy-btn-brand'
                      : 'cursor-not-allowed border border-line bg-subtle text-muted hover:bg-subtle'
                  }`}
                >
                  <ScanLine className="h-4 w-4" /> Start enrollment
                </button>
                {blockedReason && (
                  <p className="mt-2 text-center text-[11px] leading-relaxed text-faint">
                    {blockedReason}
                  </p>
                )}
              </div>
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