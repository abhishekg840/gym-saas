'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Keyboard,
  Loader2,
  Radio,
  RefreshCw,
  ScanLine,
  X,
  AlertTriangle,
} from 'lucide-react';
import { normalizeCardUid, useTapToEnroll } from '@/lib/tap-to-enroll';

/**
 * "Link RFID / Bio" modal (Phase 12) — the tap-to-enroll surface.
 *
 * Two binding modes, because the desk genuinely needs both:
 *
 *   📡 Tap on Terminal — zero typing. Arms the reader for 60s and fills the field
 *      from the physical card. This removes the most common data-entry error at a
 *      gym: typing a card serial from a screenshot instead of reading the card.
 *
 *   ⌨️ Enter Manually — for a card the owner has in hand but no live reader for
 *      (issued at another branch, or a reader that is offline).
 *
 * The captured value is NORMALISED before display (uppercase, separators
 * stripped) — the same normalisation fn_member_link_hardware applies on save, so
 * what the owner sees is exactly what gets stored.
 */

const INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono uppercase tracking-wide text-slate-900 placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15';

interface RfidLinkModalProps {
  tenantId: string | null;
  memberId: string;
  memberName: string;
  /** Pre-filled card, when re-linking an existing member. */
  initialUid?: string | null;
  initialBiometricId?: number | null;
  onClose: () => void;
  onSave: (input: { rfidUid: string | null; biometricId: number | null }) => Promise<void>;
}

/**
 * A short confirmation chime on a successful capture.
 *
 * Best-effort and fully guarded: AudioContext is blocked until a user gesture in
 * some browsers, and a chime is never important enough to throw over.
 */
function chime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => void ctx.close();
  } catch {
    /* decorative only */
  }
}
export default function RfidLinkModal({
  tenantId,
  memberId,
  memberName,
  initialUid = null,
  initialBiometricId = null,
  onClose,
  onSave,
}: RfidLinkModalProps) {
  const [mode, setMode] = useState<'tap' | 'manual'>('tap');

  // Manual-entry state lives here, not in the hook, so switching modes never
  // loses what was typed.
  const [manualUid, setManualUid] = useState(initialUid ?? '');
  const [bioSlot, setBioSlot] = useState(
    initialBiometricId != null ? String(initialBiometricId) : ''
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * The gym's next free fingerprint slot, fetched once on open.
   *
   * fn_next_biometric_slot allocates this under an advisory lock, so it is safe
   * even when two desks open this dialog at the same moment. Offered as a
   * placeholder rather than a hard value on purpose: forcing a number into the
   * field would make an owner who wants to edit an existing slot have to delete
   * digits first, and a blank field is an obvious "leave alone" signal.
   */
  const [nextSlot, setNextSlot] = useState<number | null>(null);

  useEffect(() => {
    if (!tenantId || initialBiometricId != null) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/hardware/slots?tenant_id=' + encodeURIComponent(tenantId), {
          credentials: 'same-origin',
        });
        const result = (await response.json()) as { ok?: boolean; slot?: number };
        if (!cancelled && result.ok && typeof result.slot === 'number') {
          setNextSlot(result.slot);
        }
      } catch {
        /* the placeholder is a convenience, never a requirement */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, initialBiometricId]);

  const enroll = useTapToEnroll(tenantId, (uid) => {
    // A tap writes the SAME field manual entry writes to, so saving is identical
    // either way and the owner never has to think about which mode they used.
    setManualUid(uid);
    chime();
  });

  // Carried for the caller's benefit and future per-member device scoping; the
  // save payload itself is assembled by the parent.
  void memberId;

  const effectiveUid = mode === 'tap' ? (enroll.capturedUid ?? '') : normalizeCardUid(manualUid);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        rfidUid: effectiveUid || null,
        biometricId: bioSlot.trim() === '' ? null : Number(bioSlot.trim()),
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save. Please retry.');
    } finally {
      setSaving(false);
    }
  }

  const captured = enroll.status === 'captured';

  function close() {
    // Never leave the terminal armed if the owner just closes the dialog.
    void enroll.cancel();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">Link RFID / Bio</h2>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{memberName}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {/* ---- Mode switch ------------------------------------------------ */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode('tap')}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                mode === 'tap'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              Tap on Terminal
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                mode === 'manual'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Keyboard className="h-3.5 w-3.5" />
              Enter Manually
            </button>
          </div>

          {mode === 'tap' ? (
            <div className="space-y-3">
              {/* ---- Waiting / arming ---------------------------------------- */}
              {!captured && enroll.status !== 'error' && (
                <button
                  type="button"
                  onClick={() => void enroll.arm()}
                  disabled={enroll.status === 'arming' || enroll.status === 'waiting'}
                  className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-7 transition hover:bg-emerald-50 disabled:cursor-wait"
                >
                  {enroll.status === 'waiting' ? (
                    <>
                      <span className="relative flex h-12 w-12 items-center justify-center">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white">
                          <ScanLine className="h-6 w-6" />
                        </span>
                      </span>
                      <span className="text-sm font-bold text-emerald-900">
                        Waiting for card tap…
                      </span>
                      <span className="text-[11px] text-emerald-700">
                        {enroll.device?.device_name ?? 'Terminal'} · {enroll.secondsLeft}s left
                      </span>
                    </>
                  ) : enroll.status === 'arming' ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-900">Arming terminal…</span>
                    </>
                  ) : (
                    <>
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-emerald-600 ring-1 ring-emerald-200">
                        <Radio className="h-6 w-6" />
                      </span>
                      <span className="text-sm font-bold text-emerald-900">Tap on Terminal</span>
                      <span className="text-[11px] text-emerald-700">
                        Arms the front-desk reader for 60 seconds
                      </span>
                    </>
                  )}
                </button>
              )}

              {/* ---- Captured ------------------------------------------------ */}
              {captured && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-emerald-900">Card Connected ✅</p>
                      <p className="mt-0.5 break-all font-mono text-lg font-bold tracking-widest text-emerald-700">
                        {enroll.capturedUid}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={enroll.reset}
                    className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 hover:text-emerald-900"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Tap a different card
                  </button>
                </div>
)}

              {/* ---- Timed out ----------------------------------------------- */}
              {enroll.status === 'timeout' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <p className="text-sm font-bold text-amber-900">No card tapped</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700">
                        The 60-second window closed. Listen again, or switch to manual entry.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void enroll.arm()}
                    className="mt-2.5 text-[11px] font-semibold text-amber-800 hover:text-amber-950"
                  >
                    Listen again
                  </button>
                </div>
              )}

              {/* ---- Error ---------------------------------------------------- */}
              {enroll.status === 'error' && enroll.error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                    <div>
                      <p className="text-sm font-bold text-rose-900">Could not arm terminal</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-rose-700">
                        {enroll.error}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMode('manual')}
                    className="mt-2.5 text-[11px] font-semibold text-rose-800 hover:text-rose-950"
                  >
                    Enter the card manually instead
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Card UID / serial
              </label>
              <input
                value={manualUid}
                onChange={(event) => setManualUid(normalizeCardUid(event.target.value))}
                placeholder="B8BDD712 or B8:BD:D7:12"
                maxLength={64}
                className={INPUT}
              />
              <p className="mt-1.5 text-[11px] text-slate-400">
                Colons and spaces are removed and letters are uppercased automatically.
              </p>
            </div>
          )}

          {/* ---- Fingerprint slot ------------------------------------------- */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Fingerprint slot (optional)
            </label>
            <input
              value={bioSlot}
              onChange={(event) =>
                setBioSlot(event.target.value.replace(/[^0-9]/g, '').slice(0, 7))
              }
              inputMode="numeric"
              placeholder={nextSlot ? `Next free: ${nextSlot}` : 'e.g. 42'}
              className={INPUT}
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              Leave blank to keep the current slot, or clear it from the roster to remove it.
            </p>
          </div>

          {saveError && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700"
            >
              {saveError}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={close}
            className="rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || (!effectiveUid && !bioSlot)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Save credential
          </button>
        </footer>
      </div>
    </div>
  );
}