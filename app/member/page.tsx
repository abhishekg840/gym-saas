'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  evaluateGeofence,
  formatDistance,
  geolocationErrorMessage,
  type GeoFix,
  type GeofenceVerdict,
  type GymGeofence,
} from '@/lib/geofence';
import { PASS_WINDOW_MS, type PassGeoProof } from '@/lib/passtoken';
import { mintGatePass } from '@/lib/passmint';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import {
  Dumbbell,
  ShieldCheck,
  ShieldAlert,
  Receipt,
  Clock,
  CreditCard,
  ExternalLink,
  Phone,
  Navigation,
  MapPin,
  Lock,
  Timer,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

/** What /api/member/pass hands back for the member who just matched. */
interface PassMember {
  id: string;
  full_name: string;
  phone: string;
  tenant_id: string | null;
  tenant_name: string;
  upi_id: string | null;
  membership_end: string | null;
  status: string;
  is_frozen: boolean;
  freeze_end_date: string | null;
  total_freeze_days: number;
  amount_paid: number;
  days_left: number;
  is_expired: boolean;
}

/** Where the phone last said it was. */
interface Fix {
  lat: number;
  lon: number;
  accuracy: number | null;
  at: number;
}

type LocStatus = 'idle' | 'locating' | 'ready' | 'error';

/** Why the pass is currently locked, in member-facing words. */
interface PassLock {
  title: string;
  message: string;
  /** Amber (still trying) rather than red (refused). */
  warn: boolean;
}

const QR_WINDOW_MS = PASS_WINDOW_MS;

/**
 * Asks the server for the signed token the kiosk at the gate reads: the claims
 * (member id, phone, optional geofence proof) travel to /api/member/pass/mint,
 * which stamps the 30-second window itself and appends the HMAC signature —
 * nothing is signed in the browser, so a QR string can no longer be forged
 * from the app bundle. Returns null when the verdict is not `unlocked`, which
 * means a locked screen cannot produce a scannable string even if the JSX gate
 * above it were wrong — the lock and the credential are then the same decision.
 */
async function mintPass(
  member: PassMember,
  verdict: GeofenceVerdict,
  fix: Fix | null
): Promise<string | null> {
  if (!verdict.unlocked) return null;

  // Only present when we actually measured a distance; the proof rides along so
  // the token still records where the pass was unlocked.
  const geo: PassGeoProof | undefined =
    fix && verdict.distance_meters !== null
      ? {
          lat: fix.lat,
          lon: fix.lon,
          accuracy_meters: fix.accuracy,
          distance_meters: verdict.distance_meters,
          radius_meters: verdict.radius_meters,
        }
      : undefined;

  return mintGatePass({ id: member.id, ph: member.phone, ...(geo ? { geo } : {}) });
}

export default function MemberSelfServicePortal() {
  const [phoneInput, setPhoneInput] = useState('');
  const [member, setMember] = useState<PassMember | null>(null);
  const [geofence, setGeofence] = useState<GymGeofence | null>(null);
  const [matchCount, setMatchCount] = useState(1);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [qrPayload, setQrPayload] = useState('');
  const [countdown, setCountdown] = useState(30);
  const [invoices, setInvoices] = useState<{ id: string; amount: number; issued_at: string }[]>([]);

  const [locStatus, setLocStatus] = useState<LocStatus>('idle');
  const [locMessage, setLocMessage] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);

  const watchIdRef = useRef<number | null>(null);
  /** Set when the watch runs through the Capacitor plugin, which uses string ids. */
  const pluginWatchIdRef = useRef<string | null>(null);

  // --- Sign in: one server call, which also brings the gym's geofence config.
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/member/pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        member?: PassMember;
        geofence?: GymGeofence | null;
        match_count?: number;
      };

      if (!res.ok || !json.ok || !json.member) {
        setLoginError(json.error || 'Could not open your pass. Try again shortly.');
        return;
      }

      setMember(json.member);
      setGeofence(json.geofence ?? null);
      setMatchCount(json.match_count ?? 1);
      setLocStatus('idle');
      setLocMessage(null);
      setFix(null);

      // Receipts stay a plain client read; nothing here reaches past this member.
      const { data: invList } = await supabase
        .from('invoices')
        .select('id, amount, issued_at')
        .eq('member_id', json.member.id)
        .order('issued_at', { ascending: false });
      setInvoices(invList ?? []);
    } catch {
      setLoginError('Network problem — could not reach the gym.');
    } finally {
      setLoading(false);
    }
  }

  // --- Location: ask once, then keep a live fix so walking in unlocks itself.
  const locate = useCallback(async () => {
    if (typeof window === 'undefined') return;

    setLocStatus('locating');
    setLocMessage(null);

    // Drop any watch from the previous attempt so a Retry cannot leave two
    // competing watchers fighting over the same state.
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (pluginWatchIdRef.current !== null) {
      const stale = pluginWatchIdRef.current;
      pluginWatchIdRef.current = null;
      void Geolocation.clearWatch({ id: stale }).catch(() => undefined);
    }

    const accept = (latitude: number, longitude: number, accuracy: number, at: number) => {
      setFix({
        lat: latitude,
        lon: longitude,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        at: at || Date.now(),
      });
      setLocStatus('ready');
      setLocMessage(null);
    };

    const fail = (message: string) => {
      setLocStatus('error');
      setLocMessage(message);
    };

    // On Android the WebView's geolocation is gated behind a runtime permission
    // that only the Capacitor plugin can request. Without it watchPosition is
    // refused immediately with PERMISSION_DENIED, and a member standing in the
    // lobby would never be able to unlock. The plugin also checks the
    // ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION entries in the manifest.
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await Geolocation.requestPermissions();
        if (status.location === 'denied' || status.coarseLocation === 'denied') {
          fail(geolocationErrorMessage(1));
          return;
        }

        pluginWatchIdRef.current = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
          (pos, err) => {
            if (err) {
              fail(
                typeof err.code === 'number'
                  ? geolocationErrorMessage(err.code)
                  : err.message || geolocationErrorMessage(2)
              );
              return;
            }
            if (!pos) return;
            accept(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.timestamp);
          }
        );
      } catch (error) {
        // Location services switched off, or the prompt was refused outright.
        // Fail closed: the pass stays locked and the reason is shown.
        fail(
          error instanceof Error && error.message
            ? error.message
            : geolocationErrorMessage(2)
        );
      }
      return;
    }

    // Browser / desktop path: plain geolocation, which the browser gates itself.
    if (!('geolocation' in navigator)) {
      fail('This browser has no location support. Use the front desk scanner.');
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => accept(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.timestamp),
      (err) => fail(geolocationErrorMessage(err.code)),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 }
    );
  }, []);

  // Start the moment a member signs in; release the watch when they leave.
  useEffect(() => {
    if (!member) return;
    // Subscribes to the geolocation API — its callbacks are the setState here, and
    // the cleanup below is what releases the watch when the member leaves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    locate();
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (pluginWatchIdRef.current !== null) {
        const id = pluginWatchIdRef.current;
        pluginWatchIdRef.current = null;
        void Geolocation.clearWatch({ id }).catch(() => undefined);
      }
    };
  }, [member, locate]);

  // --- Rotating pass: re-minted on every 30-second window.
  useEffect(() => {
    if (!member) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQrPayload('');
      return;
    }

    let lastWindow = -1;
    const tick = () => {
      const windowIndex = Math.floor(Date.now() / QR_WINDOW_MS);
      if (windowIndex !== lastWindow) {
        lastWindow = windowIndex;
        // The same verdict that hides the QR also stops the credential existing,
        // so a locked screen holds no scannable string in state at all — one
        // decision instead of two that could drift apart.
        const reading: GeoFix | null = fix
          ? { latitude: fix.lat, longitude: fix.lon, accuracy_meters: fix.accuracy, taken_at: fix.at }
          : null;
        const verdict = evaluateGeofence(geofence, reading);
        const armed = Boolean(
          geofence?.enforce_geofence &&
            geofence.latitude !== null &&
            geofence.longitude !== null
        );
        const mintable =
          verdict.unlocked &&
          !member.is_frozen &&
          !member.is_expired &&
          !(armed && locStatus === 'error');
        if (!mintable) {
          setQrPayload('');
        } else {
          void mintPass(member, verdict, fix).then((token) => {
            // The window may have rolled while the mint was in flight; a pass
            // for a previous window is already stale, so drop it.
            if (lastWindow !== windowIndex) return;
            setQrPayload(token ?? '');
          });
        }
      }
      const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
      setCountdown(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [member, geofence, fix, locStatus]);

  // --- The verdict. All the maths lives in lib/geofence.ts and is shared with the
  // console, so the pass screen and the gate can never disagree about the radius.
  const { geo, lock } = useMemo(() => {
    const fixReading: GeoFix | null = fix
      ? { latitude: fix.lat, longitude: fix.lon, accuracy_meters: fix.accuracy, taken_at: fix.at }
      : null;

    const verdict = evaluateGeofence(geofence, fixReading);

    // Only a fence that is actually armed needs a location to be believed. With
    // enforcement off (or never configured) a denied permission must not lock a
    // member out — there is nothing to enforce.
    const armed = Boolean(
      geofence?.enforce_geofence && geofence.latitude !== null && geofence.longitude !== null
    );

    // A denied or unavailable permission is not "still checking". The fence
    // cannot be proved, so the pass locks with the reason spelled out rather
    // than quietly staying open behind a stale fix.
    if (armed && locStatus === 'error') {
      return {
        geo: verdict,
        lock: {
          title: 'LOCATION REQUIRED TO UNLOCK PASS',
          message: locMessage ?? geolocationErrorMessage(2),
          warn: false,
        },
      };
    }

    if (!verdict.unlocked) {
      // Amber while the phone is still deciding, red when the gym is out of reach.
      const awaiting = verdict.state === 'awaiting_fix';
      const title =
        verdict.state === 'outside'
          ? 'OUT OF RANGE'
          : verdict.state === 'unavailable'
            ? 'GYM LOCATION UNKNOWN'
            : awaiting
              ? 'WAITING FOR GPS'
              : 'LOCATION REQUIRED TO UNLOCK PASS';
      return {
        geo: verdict,
        lock: {
          title,
          message: verdict.message,
          warn: awaiting,
        },
      };
    }

    // Membership state outranks geography: a frozen or expired pass locks the same
    // way, and the gate would refuse it anyway.
    if (member?.is_frozen) {
      return {
        geo: verdict,
        lock: {
          title: 'MEMBERSHIP FROZEN',
          message: member.freeze_end_date
            ? `Your membership is paused until ${member.freeze_end_date}. Ask the front desk to resume it.`
            : 'Your membership is paused. Contact the front desk to resume it.',
          warn: false,
        },
      };
    }
    if (member?.is_expired) {
      return {
        geo: verdict,
        lock: {
          title: 'MEMBERSHIP EXPIRED',
          message: 'This pass is locked because the membership has ended. Renew below to unlock the gate.',
          warn: false,
        },
      };
    }

    return { geo: verdict, lock: null as PassLock | null };
  }, [geofence, fix, member, locStatus, locMessage]);


  // One line of plain English about where the phone thinks the member is.
  const locLine =
    locStatus === 'locating'
      ? 'Getting your location…'
      : locStatus === 'error'
        ? 'Location unavailable'
        : locStatus === 'ready' && geo.distance_meters !== null
          ? `You are ${formatDistance(geo.distance_meters)} from ${geofence?.tenant_name ?? 'the gym'}`
          : locStatus === 'ready'
            ? 'Location locked'
            : 'Waiting for location';

  const lockWrap = lock?.warn ? 'bg-amber-500/10 border-amber-500/30' : 'bg-rose-500/10 border-rose-500/30';
  const lockTitle = lock?.warn ? 'text-amber-300' : 'text-rose-300';

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 sm:p-8 flex flex-col items-center justify-center">
      {!member ? (
        <div className="w-full max-w-sm bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center gap-2 mb-4 text-emerald-400">
            <Dumbbell className="w-6 h-6" />
            <h1 className="text-lg font-bold text-white">Member Smart Pass</h1>
          </div>
          <p className="text-xs text-neutral-400 mb-6">
            Enter your registered mobile number. Your pass only unlocks while you are standing at the gym.
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="member-phone" className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">
                Mobile Number
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3" />
                <input
                  id="member-phone"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="10-digit mobile number"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-10 pr-3 py-2.5 text-sm outline-none focus:border-emerald-500/50"
                />
              </div>
              <p className="text-[10px] text-neutral-600 mt-1.5">
                We ask your browser for location when the pass opens — that is what proves you are at the door.
              </p>
            </div>

            {loginError && (
              <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center gap-2 w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-black font-bold py-2.5 rounded-xl transition-all duration-150 active:scale-95 text-sm"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Open My Pass
            </button>
          </form>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-4 pb-24">
          <div className="bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-2xl p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-zinc-400 font-medium">
                  {geofence?.tenant_name ?? member.tenant_name} · Smart Pass
                </p>
                <h2 className="text-xl font-black leading-tight">{member.full_name}</h2>
                <p className="text-xs text-neutral-500 font-mono">{member.phone}</p>
              </div>
              {member.is_frozen ? (
                <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-sky-500/10 text-sky-300 border border-sky-500/20 rounded-full font-bold whitespace-nowrap">
                  <Timer className="w-3.5 h-3.5" /> Frozen
                </span>
              ) : member.is_expired ? (
                <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold whitespace-nowrap">
                  <ShieldAlert className="w-3.5 h-3.5" /> Expired
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold whitespace-nowrap">
                  <ShieldCheck className="w-3.5 h-3.5" /> Active
                </span>
              )}
            </div>

            {/* Live location strip */}
            <div className="flex items-center justify-between gap-2 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 mb-3">
              <span className="flex items-center gap-2 text-xs min-w-0">
                {locStatus === 'locating' ? (
                  <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                ) : locStatus === 'error' ? (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <Navigation className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span className="text-neutral-300 truncate">{locLine}</span>
                {fix?.accuracy != null && locStatus === 'ready' && (
                  <span className="text-[10px] text-neutral-600 font-mono shrink-0">
                    ±{Math.round(fix.accuracy)}m
                  </span>
                )}
              </span>
              <button
                onClick={locate}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition shrink-0"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
            {locMessage && <p className="text-[11px] text-amber-300/90 mb-3">{locMessage}</p>}
            {matchCount > 1 && (
              <p className="text-[11px] text-neutral-500 mb-3">
                This number appears on {matchCount} memberships — showing the one that runs the longest.
              </p>
            )}

            {/* The pass itself — or, when it is locked, the reason instead of a QR */}
            {lock === null ? (
              <>
                <div className="bg-white p-4 rounded-2xl w-fit mx-auto shadow-inner mb-3">
                  {qrPayload ? (
                    <QRCodeSVG value={qrPayload} size={180} level="M" />
                  ) : (
                    <div className="w-[180px] h-[180px] bg-neutral-200 animate-pulse rounded-lg" />
                  )}
                </div>

                <div className="flex items-center justify-center gap-1 text-xs text-neutral-400 font-mono mb-4">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" /> Refreshes in {countdown}s
                </div>

                {geofence && (
                  <p className="text-center text-[11px] text-emerald-400/80 mb-3">{geo.message}</p>
                )}
              </>
            ) : (
              <div className={`border rounded-2xl p-5 text-center ${lockWrap}`}>
                <Lock className={`w-11 h-11 mx-auto mb-2 ${lockTitle}`} />
                <h3 className={`text-base font-extrabold tracking-tight ${lockTitle}`}>{lock.title}</h3>
                <p className="text-xs text-neutral-300 mt-1.5 leading-relaxed">{lock.message}</p>

                {geo.distance_meters !== null && geofence && (
                  <div className="mt-3 inline-flex items-center gap-2 text-[11px] font-mono bg-black/40 border border-white/10 rounded-lg px-3 py-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {formatDistance(geo.distance_meters)} away · gate radius {geo.radius_meters} m
                  </div>
                )}


                <button
                  onClick={locate}
                  className="mt-4 flex items-center justify-center gap-2 w-full bg-neutral-100 hover:bg-white text-black font-bold py-2.5 rounded-xl transition-all duration-150 active:scale-95 text-sm"
                >
                  <Navigation className="w-4 h-4" /> Recalculate Location
                </button>
              </div>
            )}

            <div className="bg-neutral-950 border border-neutral-800/80 rounded-xl p-3 flex justify-between text-xs">
              <span className="text-neutral-400">Valid Until:</span>
              <span className="font-mono font-bold text-white">
                {member.membership_end
                  ? new Date(member.membership_end).toLocaleDateString()
                  : 'not set'}
                {!member.is_expired && (
                  <span className="ml-2 text-emerald-400">{member.days_left}d left</span>
                )}
              </span>
            </div>

            {member.is_expired &&
              (member.upi_id ? (
                <a
                  href={`upi://pay?pa=${encodeURIComponent(member.upi_id)}&pn=${encodeURIComponent(
                    geofence?.tenant_name ?? member.tenant_name
                  )}&am=${member.amount_paid || 1500}&cu=INR`}
                  className="mt-4 flex items-center justify-center gap-2 w-full bg-emerald-500 hover:bg-emerald-600 text-black font-bold py-2.5 rounded-xl transition text-sm"
                >
                  <CreditCard className="w-4 h-4" /> Renew Instantly via UPI (₹
                  {(member.amount_paid || 1500).toLocaleString()})
                </a>
              ) : (
                <p className="mt-3 text-[11px] text-neutral-500 text-center">
                  This gym has not saved a UPI id yet — renew at the front desk.
                </p>
              ))}
          </div>

          {/* Member Receipts List */}
          {invoices.length > 0 && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">
                <Receipt className="w-4 h-4 text-emerald-400" /> Payment History & Receipts
              </div>
              <div className="space-y-2">
                {invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-2.5 bg-neutral-950 rounded-xl text-xs border border-neutral-800"
                  >
                    <div>
                      <p className="font-bold text-white">₹{inv.amount.toLocaleString()}</p>
                      <p className="text-[10px] text-neutral-500">
                        {new Date(inv.issued_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Link
                      href={`/invoice/${inv.id}`}
                      target="_blank"
                      className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
                    >
                      Receipt <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setMember(null);
              setGeofence(null);
              setInvoices([]);
              setFix(null);
              setLocStatus('idle');
              setLocMessage(null);
              setPhoneInput('');
            }}
            className="w-full text-xs text-neutral-500 hover:text-white transition py-2"
          >
            Switch Account
          </button>
        </div>
      )}
    </div>
  );
}




