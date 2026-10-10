'use client';

import { useEffect, useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { ShieldCheck, ShieldAlert, Dumbbell, RefreshCw, Camera, ArrowLeft, Volume2, LogIn, LogOut, Flame } from 'lucide-react';
import Link from 'next/link';
import { readSession } from '@/lib/session';

/** Which way the next scan is read: an entry (Check-In) or an exit (Check-Out). */
type ScanMode = 'in' | 'out';

interface VerificationResult {
  allowed: boolean;
  name: string;
  phone: string;
  expiry: string;
  reason: string;
  member_id?: string | null;
  /** 'in' or 'out' — the direction this scan was recorded as. */
  direction?: ScanMode;
  /** Workout duration in whole minutes, present only on a paired OUT scan. */
  duration_minutes?: number | null;
}

export default function GymScanner() {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Dual-gate mode. Defaults to Entry, which is by far the common case at a
  // kiosk. Held in a ref too, because the camera callback below is created once
  // inside a mount-only effect and must read the CURRENT mode without that
  // effect re-running (which would tear down and restart the camera).
  const [mode, setMode] = useState<ScanMode>('in');
  const modeRef = useRef<ScanMode>('in');

  const isProcessingRef = useRef(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastScannedTokenRef = useRef<string>('');
  const lastScannedTimeRef = useRef<number>(0);
  const autoResetTimerRef = useRef<NodeJS.Timeout | null>(null);

  /** Switch gate direction. Clears the repeat-scan guard so the very next pass
   *  reads as the new direction instead of being swallowed by the cooldown. */
  function chooseMode(next: ScanMode) {
    modeRef.current = next;
    setMode(next);
    lastScannedTokenRef.current = '';
    if (autoResetTimerRef.current) clearTimeout(autoResetTimerRef.current);
    setResult(null);
    setVerifying(false);
    isProcessingRef.current = false;
  }


  function getAudioContext() {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  function playSound(type: 'success' | 'denied') {
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      }
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  }

  function resetScanner() {
    if (autoResetTimerRef.current) clearTimeout(autoResetTimerRef.current);
    setResult(null);
    setVerifying(false);
    isProcessingRef.current = false;
  }

  useEffect(() => {
    function unlockAudio() {
      getAudioContext();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    }
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    const html5QrCode = new Html5Qrcode('qr-reader');
    scannerRef.current = html5QrCode;

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
    };

    html5QrCode
      .start(
        { facingMode: 'environment' },
        config,
        async (decodedText) => {
          // 1. Agar abhi result display ho raha hai to camera frames ignore karo
          if (isProcessingRef.current) return;

          const now = Date.now();
          // 2. Same pass repeat scan rokne ke liye 8s cooldown
          if (
            lastScannedTokenRef.current === decodedText &&
            now - lastScannedTimeRef.current < 8000
          ) {
            return;
          }

          isProcessingRef.current = true;
          lastScannedTokenRef.current = decodedText;
          lastScannedTimeRef.current = now;
          setVerifying(true);

          try {
            // The gate decision lives on the server: it scopes the member lookup to
            // this gym's tenant and refuses frozen memberships. The kiosk only renders.
            // Check-Out hits a different endpoint that pairs the entry and stamps the
            // workout duration; Check-In is the classic verify path.
            const direction = modeRef.current;
            const endpoint = direction === 'out' ? '/api/scan/checkout' : '/api/scan/verify';
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                token: decodedText,
                tenant_id: readSession()?.tenantId ?? null,
              }),
            });

            const verdict = (await response.json()) as {
              allowed?: boolean;
              reason?: string;
              name?: string;
              phone?: string;
              expiry?: string | null;
              member_id?: string | null;
              duration_minutes?: number | null;
            };

            if (typeof verdict.allowed !== 'boolean') {
              playSound('denied');
              setResult({
                allowed: false,
                name: verdict.name || 'Rejected',
                phone: verdict.phone || '',
                expiry: 'N/A',
                direction,
                reason: verdict.reason || `Gate rejected the scan (HTTP ${response.status}).`,
              });
            } else {
              playSound(verdict.allowed ? 'success' : 'denied');
              setResult({
                allowed: verdict.allowed,
                name: verdict.name || 'Unknown',
                phone: verdict.phone || 'N/A',
                expiry: verdict.expiry || 'N/A',
                direction,
                duration_minutes:
                  typeof verdict.duration_minutes === 'number' ? verdict.duration_minutes : null,
                reason:
                  verdict.reason ||
                  (direction === 'out'
                    ? 'Session complete. See you tomorrow!'
                    : verdict.allowed
                      ? 'Access Approved. Welcome!'
                      : 'Access Denied.'),
                member_id: verdict.member_id ?? null,
              });

              // Attendance is already recorded server-side; this only pings the feed.
              // The welcome chime is an ENTRY thing — an exit is not a "welcome".
              if (verdict.allowed && verdict.member_id && direction === 'in') {
                fetch('/api/notifications/checkin', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: verdict.name,
                    phone: verdict.phone,
                    timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                  }),
                }).catch(() => {});
              }
            }
          } catch {
            playSound('denied');
            setResult({
              allowed: false,
              name: 'Gate Unreachable',
              phone: '',
              expiry: '',
              reason: 'Could not reach the gate service. Check the network and retry.',
            });
          } finally {
            setVerifying(false);
            // 3. 5 second baad automatically ready hoga agle scan ke liye
            autoResetTimerRef.current = setTimeout(() => {
              resetScanner();
            }, 5000);
          }
        },
        () => {}
      )
      .catch((err) => {
        console.error('Camera startup error:', err);
        setCameraError('Camera access denied or device not found. Please allow camera permissions.');
      });

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      if (autoResetTimerRef.current) clearTimeout(autoResetTimerRef.current);
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  return (
    <div 
      onClick={() => getAudioContext()} 
      className="min-h-screen bg-surface text-ink flex flex-col items-center justify-center p-4 cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-center justify-between w-full max-w-md mb-4">
        <Link
          href="/admin"
          className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition rounded-xl border border-line bg-surface px-3 py-1.5 rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
            <Dumbbell className="w-5 h-5" />
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink tracking-tight">Kiosk Scanner</h1>
        </div>
      </div>

      {/* Dual-gate toggle: Check-In (Entry) vs Check-Out (Exit). Entry is the
          default because it is the common case; the operator flips to Exit when
          a member is leaving. Tapping switches the endpoint the next scan posts
          to (see the camera callback above). */}
      <div
        role="group"
        aria-label="Scan direction"
        className="mb-6 grid w-full max-w-md grid-cols-2 gap-2"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            chooseMode('in');
          }}
          aria-pressed={mode === 'in'}
          className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition ${
            mode === 'in'
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]'
              : 'border-line bg-surface text-muted hover:text-ink'
          }`}
        >
          <LogIn className="w-4 h-4" /> 🟢 Check-In
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            chooseMode('out');
          }}
          aria-pressed={mode === 'out'}
          className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition ${
            mode === 'out'
              ? 'border-rose-500/40 bg-rose-500/15 text-rose-300 shadow-[0_0_0_1px_rgba(244,63,94,0.25)]'
              : 'border-line bg-surface text-muted hover:text-ink'
          }`}
        >
          <LogOut className="w-4 h-4" /> 🔴 Check-Out
        </button>
      </div>


      <div className="w-full max-w-md rounded-xl border border-line bg-surface rounded-3xl p-6 shadow-2xl relative">
        {result && (
          <div
            className={`absolute inset-0 z-20 rounded-3xl p-6 flex flex-col items-center justify-center text-center backdrop-blur-md ${
              result.allowed ? 'bg-emerald-950/95 text-emerald-100' : 'bg-rose-950/95 text-rose-100'
            }`}
          >
            {result.allowed ? (
              result.direction === 'out' ? (
                <LogOut className="w-20 h-20 text-emerald-400 mb-3" />
              ) : (
                <ShieldCheck className="w-20 h-20 text-emerald-400 mb-3" />
              )
            ) : (
              <ShieldAlert className="w-20 h-20 text-rose-400 mb-3" />
            )}

            <h2 className="text-2xl font-black mb-1">
              {!result.allowed
                ? 'ACCESS DENIED'
                : result.direction === 'out'
                  ? 'SESSION COMPLETE'
                  : 'ACCESS GRANTED'}
            </h2>
            <p className="text-sm font-semibold opacity-90 mb-4">
              {result.allowed && result.direction === 'out'
                ? `See you tomorrow, ${result.name.split(' ')[0]}!`
                : result.reason}
            </p>

            {/* Workout duration badge — only on a paired exit. */}
            {result.allowed && result.direction === 'out' && typeof result.duration_minutes === 'number' && (
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/15 px-5 py-2.5">
                <Flame className="w-5 h-5 text-amber-300" />
                <span className="text-base font-black text-amber-200 tabular-nums">
                  🔥 Workout Duration: {result.duration_minutes} mins
                </span>
              </div>
            )}

            <div
              className={`bg-black/40 border rounded-2xl p-4 w-full text-left space-y-2 mb-6 text-sm ${
                result.allowed ? 'border-emerald-500/20' : 'border-rose-500/20'
              }`}
            >
              <div className="flex justify-between">
                <span className={result.allowed ? 'text-emerald-200/70' : 'text-rose-200/70'}>
                  Member:
                </span>
                <span className="font-semibold text-white">{result.name}</span>
              </div>
              <div className="flex justify-between">
                <span className={result.allowed ? 'text-emerald-200/70' : 'text-rose-200/70'}>
                  Phone:
                </span>
                <span className="font-mono font-semibold text-white">{result.phone}</span>
              </div>
              <div className="flex justify-between">
                <span className={result.allowed ? 'text-emerald-200/70' : 'text-rose-200/70'}>
                  Expiry Date:
                </span>
                <span className="font-semibold text-white">{result.expiry}</span>
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                resetScanner();
              }}
              className="w-full bg-ink text-white font-bold py-3 rounded-xl transition hover:bg-black flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Scan Next
            </button>
          </div>
        )}

        {cameraError ? (
          <div className="p-6 text-center text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
            <Camera className="w-10 h-10 mx-auto mb-2 text-rose-400" />
            <p className="font-medium text-sm">{cameraError}</p>
            <p className="text-[12px] text-muted mt-2">
              Browser address bar mein camera allow karein aur reload karein.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-black min-h-[300px] flex items-center justify-center">
            <div id="qr-reader" className="w-full"></div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-[11px] text-faint">
          <span className="flex items-center gap-1">
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> Audio Chime Active
          </span>
          {verifying && <span className="text-emerald-400 animate-pulse">Verifying...</span>}
        </div>
      </div>
    </div>
  );
}