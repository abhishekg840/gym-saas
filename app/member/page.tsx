'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  evaluateGeofence,
  formatDistance,
  type GeoFix,
  type GymGeofence,
} from '@/lib/geofence';
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

const QR_WINDOW_MS = 30_000;

/**
 * The token the kiosk at the gate already knows how to read: base64 JSON with the
 * member id, the 30-second window it was minted in, and the phone. The window is
 * what makes yesterday's screenshot useless at the turnstile.
 */
function mintPass(member: PassMember, windowIndex: number): string {
  return btoa(JSON.stringify({ id: member.id, t: windowIndex, ph: member.phone }));
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
  const locate = useCallback(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setLocStatus('error');
      setLocMessage('This browser has no location support. Use the front desk scanner.');
      return;
    }

    setLocStatus('locating');
    setLocMessage(null);

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setFix({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          at: pos.timestamp || Date.now(),
        });
        setLocStatus('ready');
        setLocMessage(null);
      },
      (err) => {
        setLocStatus('error');
        setLocMessage(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was blocked. Allow it for this site, then tap Retry.'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'No GPS fix right now — step outside or check your phone location settings.'
              : 'Taking too long to get a fix. Tap Retry.'
        );
      },
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
        setQrPayload(mintPass(member, windowIndex));
      }
      const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
      setCountdown(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [member]);

  // --- The verdict. All the maths lives in lib/geofence.ts and is shared with the
  // console, so the pass screen and the gate can never disagree about the radius.
  const { geo, lock } = useMemo(() => {
    const fixReading: GeoFix | null = fix
      ? { latitude: fix.lat, longitude: fix.lon, accuracy_meters: fix.accuracy, taken_at: fix.at }
      : null;

    const verdict = evaluateGeofence(geofence, fixReading);

    if (!verdict.unlocked) {
      // Amber while the phone is still deciding, red when the gym is out of reach.
      const awaiting = verdict.state === 'awaiting_fix';
      return {
        geo: verdict,
        lock: {
          title: awaiting ? 'WAITING FOR GPS' : 'OUTSIDE GYM RADIUS',
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
  }, [geofence, fix, member]);


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
    <div className="min-h-screen bg-neutral-950 text-white p-4 sm:p-8 flex flex-col items-center justify-center">
      {!member ? (
        <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl">
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
              className="flex items-center justify-center gap-2 w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-black font-bold py-2.5 rounded-xl transition text-sm"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Open My Pass
            </button>
          </form>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-neutral-500">
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
                <h3 className={`text-base font-black tracking-wide ${lockTitle}`}>{lock.title}</h3>
                <p className="text-xs text-neutral-300 mt-1.5 leading-relaxed">{lock.message}</p>

                {geo.distance_meters !== null && geofence && (
                  <div className="mt-3 inline-flex items-center gap-2 text-[11px] font-mono bg-black/40 border border-white/10 rounded-lg px-3 py-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {formatDistance(geo.distance_meters)} away · gate radius {geo.radius_meters} m
                  </div>
                )}


                <button
                  onClick={locate}
                  className="mt-4 flex items-center justify-center gap-2 w-full bg-neutral-100 hover:bg-white text-black font-bold py-2.5 rounded-xl transition text-sm"
                >
                  <Navigation className="w-4 h-4" /> I moved — check again
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




