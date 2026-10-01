'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import {
  Bell,
  Dumbbell,
  Home,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  ShoppingBag,
  Store,
  Timer,
  User,
} from 'lucide-react';
import { readSession, clearSession, type GymSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import {
  evaluateGeofence,
  geolocationErrorMessage,
  type GeofenceVerdict,
  type GymGeofence,
} from '@/lib/geofence';
import { encodePassToken, PASS_WINDOW_MS } from '@/lib/passtoken';
import {
  WORKOUT_SPLITS,
  SPLIT_SUGGESTIONS,
  cancelReservation,
  expiryCountdown,
  gymOpenState,
  lastPerformance,
  loadCompanionData,
  logWeight,
  logWorkout,
  reserveProduct,
  rushLevel,
  splitVolume,
  timeAgo,
  weightSparkPath,
  weightTrend,
  type CompanionData,
  type WorkoutSplit,
} from '@/lib/companion';

type TabId = 'home' | 'health' | 'training' | 'store';

const TABS: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'health', label: 'Health', icon: User },
  { id: 'training', label: 'Training', icon: Dumbbell },
  { id: 'store', label: 'Store', icon: Store },
];

/** Shared surface for every card on the app: the layered dark slate the whole
 *  product now uses, instead of the flat #000000 block it replaced. */
const CARD = 'rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-md';

/** Tactile feedback for every pressable, per the Phase 1 interaction spec. */
const TAP = 'transition-all duration-150 active:scale-95';

/** The member-facing name for a reservation's state. */
const RESERVATION_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Waiting at the desk', tone: 'bg-amber-500/10 text-amber-300 border-amber-500/25' },
  picked_up: { label: 'Collected', tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' },
  cancelled: { label: 'Cancelled', tone: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25' },
};

/** Store categories with the icon the catalogue groups them under. */
const CATEGORY_META: Record<string, { label: string; icon: typeof Package }> = {
  protein: { label: 'Protein', icon: Package },
  supplements: { label: 'Supplements', icon: Package },
  merchandise: { label: 'Gear', icon: ShoppingBag },
  beverages: { label: 'Drinks', icon: Package },
  gear: { label: 'Gear', icon: ShoppingBag },
};

interface StoreItem {
  id: string;
  name: string;
  category: string;
  selling_price: number;
  stock_quantity: number;
}

/** What /api/member/pass returns; the Home tab needs the gym's fence config to
 *  decide whether the QR may be shown at all. */
interface PassMember {
  id: string;
  full_name: string;
  phone: string;
  tenant_id: string | null;
  tenant_name: string;
  membership_end: string | null;
  is_frozen: boolean;
  freeze_end_date: string | null;
  is_expired: boolean;
}

interface Fix {
  lat: number;
  lon: number;
  accuracy: number | null;
  at: number;
}

type LocStatus = 'idle' | 'locating' | 'ready' | 'error';

interface TabProps {
  data: CompanionData;
  onFlash: (message: string, kind?: 'ok' | 'bad') => void;
  onSaved: () => Promise<void>;
}
/**
 * A clock that only runs while `active`.
 *
 * Reading the wall clock during render is an impure operation, and React has no
 * reason to re-render when a second passes — so time is modelled as state that an
 * interval advances. The first reading lands on a macrotask rather than
 * synchronously in the effect body, which keeps the component from cascading a
 * render before it has anything to show.
 *
 * @param active when false the interval is torn down and the value is frozen
 */
function useClock(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) return;

    const tick = () => setNow(Date.now());

    const prime = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, intervalMs);

    return () => {
      window.clearTimeout(prime);
      window.clearInterval(interval);
    };
  }, [active, intervalMs]);

  return now;
}

export default function MemberDashboard() {
  const router = useRouter();

  /**
   * The session, read once on mount.
   *
   * `null` covers both "still hydrating" and "not a member", which is why the
   * redirect lives in an effect below rather than as a render-time branch: the
   * gate cannot tell those two apart before localStorage is readable.
   */
  const [session, setSession] = useState<GymSession | null>(null);
  const [tab, setTab] = useState<TabId>('home');
  const [data, setData] = useState<CompanionData | null>(null);
  const [pass, setPass] = useState<PassMember | null>(null);
  const [geofence, setGeofence] = useState<GymGeofence | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locStatus, setLocStatus] = useState<LocStatus>('idle');
  const [locMessage, setLocMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'bad'>('ok');
  const [insideNow, setInsideNow] = useState(0);

  /**
   * The live GPS subscription, tracked by platform because the two hand back
   * different id types. A single `string | number | null` would need a type
   * check at every teardown site; two named slots keep each one obvious.
   */
  const watchRef = useRef<{ plugin: string | null; browser: number | null }>({
    plugin: null,
    browser: null,
  });

  const memberId = session?.role === 'member' ? session.userId : null;

  // Held as its own binding: the loaders below depend on the phone number, and
  // reading `session?.phone` inside their dependency lists defeats the compiler's
  // memoisation check.
  const memberPhone = session?.phone ?? '';

  function flash(message: string, kind: 'ok' | 'bad' = 'ok') {
    setNotice(message);
    setNoticeKind(kind);
  }

  /** Reloads the four tabs' bundle. */
  const refresh = useCallback(async () => {
    if (!memberId) return;
    const result = await loadCompanionData(memberId);
    if (!result.ok) {
      flash(result.error ?? 'Could not load your dashboard.', 'bad');
      return;
    }
    setData(result.data);
  }, [memberId]);

  /**
   * The pass lookup also returns the gym's fence config, which decides whether the
   * QR may be rendered — so it is fetched alongside the bundle rather than on its
   * own, keeping the Home tab's first paint to a single round trip.
   */
  const loadPass = useCallback(async () => {
    if (!memberPhone) return;
    const response = await fetch('/api/member/pass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: memberPhone }),
    });
    if (!response.ok) return;
    const body = (await response.json()) as {
      ok: boolean;
      member?: PassMember;
      geofence?: GymGeofence | null;
    };
    if (body.ok && body.member) {
      setPass(body.member);
      setGeofence(body.geofence ?? null);
    }
  }, [memberPhone]);

  // --- Session gate ---------------------------------------------------------
  useEffect(() => {
    const stored = readSession();
    if (!stored || stored.role !== 'member') {
      router.replace('/login');
      return;
    }
    // Reading localStorage is a side effect by definition: the server render
    // cannot know the session, so this lands one commit after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(stored);
  }, [router]);

  useEffect(() => {
    if (!memberId) return;
    // Load-on-mount, not render-derived: the setStates land after the awaits.
    (async () => {
      await Promise.all([refresh(), loadPass()]);
    })();
  }, [memberId, refresh, loadPass]);

  // --- Live floor count for the rush indicator -----------------------------
  // Deliberately a count, not the list: the Home tab needs "how busy", and
  // reading one row per member would ship every member's name to the phone.
  const loadRush = useCallback(async () => {
    const tenantId = pass?.tenant_id;
    if (!tenantId) return;

    const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('attendances')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'granted')
      .gte('punch_time', since);

    if (!error && typeof count === 'number') setInsideNow(count);
  }, [pass?.tenant_id]);

  useEffect(() => {
    if (!pass?.tenant_id) return;
    // Subscribing to an external source (the gym's check-in feed) is exactly what
    // an effect is for; the state it writes is the poll result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRush();
    const timer = window.setInterval(loadRush, 60_000);
    return () => window.clearInterval(timer);
  }, [pass?.tenant_id, loadRush]);

  // --- GPS ------------------------------------------------------------------
  const locate = useCallback(async () => {
    setLocStatus('locating');
    setLocMessage(null);

    // One teardown for both id shapes. The plugin hands back a string id, the
    // browser API a number; missing either one leaks a live GPS subscription.
    const stop = (pluginId: string | null, browserId: number | null) => {
      if (pluginId !== null) {
        void Geolocation.clearWatch({ id: pluginId }).catch(() => undefined);
      }
      if (browserId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(browserId);
      }
    };

    // Drops the previous watch and parks a new one in `watchRef`, so a second tap
    // of "Recalculate" replaces the first subscription rather than adding to it.
    let pluginId: string | null = null;
    let browserId: number | null = null;
    stop(watchRef.current.plugin, watchRef.current.browser);

    const accept = (
      latitude: number,
      longitude: number,
      accuracy: number,
      at: number
    ) => {
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
      // Deliberately leaves `fix` null: the pass stays locked rather than
      // falling back to an unverified position.
      stop(pluginId, browserId);
      setLocStatus('error');
      setLocMessage(message);
    };

    // On Android the WebView's geolocation is gated behind a runtime permission
    // that only the Capacitor plugin can request. Without it watchPosition is
    // refused with PERMISSION_DENIED and a member in the lobby could never
    // unlock. The plugin also checks the manifest's FINE/COARSE entries.
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await Geolocation.requestPermissions();
        if (status.location === 'denied' || status.coarseLocation === 'denied') {
          fail(geolocationErrorMessage(1));
          return;
        }

        pluginId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
          (position, err) => {
            if (err) {
              fail(
                typeof err.code === 'number'
                  ? geolocationErrorMessage(err.code)
                  : err.message || geolocationErrorMessage(2)
              );
              return;
            }
            if (!position) return;
            accept(
              position.coords.latitude,
              position.coords.longitude,
              position.coords.accuracy ?? 0,
              position.timestamp
            );
          }
        );

        watchRef.current = { plugin: pluginId, browser: null };
      } catch (error) {
        // Location services switched off, or the prompt was refused outright.
        fail(
          error instanceof Error && error.message ? error.message : geolocationErrorMessage(2)
        );
      }
      return;
    }

    // Browser / desktop path: plain geolocation, which the browser gates itself.
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      fail('This device cannot report a location, so the pass stays locked.');
      return;
    }

    browserId = navigator.geolocation.watchPosition(
      (position) =>
        accept(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy ?? 0,
          position.timestamp
        ),
      (err) => fail(geolocationErrorMessage(err.code)),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 }
    );
    watchRef.current = { plugin: null, browser: browserId };
  }, []);

  useEffect(() => {
    if (!memberId) return;
    // Requesting a GPS fix is an external subscription, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    locate();

    // Unmounting mid-request would otherwise leave a watch running and a GPS
    // prompt on screen after the member has navigated away.
    return () => {
      const current = watchRef.current;
      watchRef.current = { plugin: null, browser: null };
      if (current.plugin !== null) {
        void Geolocation.clearWatch({ id: current.plugin }).catch(() => undefined);
      }
      if (current.browser !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(current.browser);
      }
    };
  }, [memberId, locate]);
// --- The geofence decision ------------------------------------------------
  // Geography only. Membership state (frozen / expired) is layered on below,
  // because a frozen pass is locked for a different reason and needs its own
  // sentence — and because the gate would refuse it even with a perfect fix.
  const verdict: GeofenceVerdict = useMemo(
    () =>
      evaluateGeofence(
        geofence,
        fix
          ? {
              latitude: fix.lat,
              longitude: fix.lon,
              accuracy_meters: fix.accuracy,
              taken_at: fix.at,
            }
          : null
      ),
    [geofence, fix]
  );

  /** Why the pass is locked, in member-facing words. Null means it may be shown. */
  const passLock = useMemo((): { title: string; message: string; warn: boolean } | null => {
    if (pass?.is_frozen) {
      return {
        title: 'MEMBERSHIP PAUSED',
        message: pass.freeze_end_date
          ? `Your membership is paused until ${pass.freeze_end_date}. Ask the front desk to resume it.`
          : 'Your membership is paused. Ask the front desk to resume it.',
        warn: false,
      };
    }
    if (pass?.is_expired) {
      return {
        title: 'MEMBERSHIP EXPIRED',
        message: 'This pass is locked because the membership has ended. Renew at the front desk to unlock the gate.',
        warn: false,
      };
    }
    if (!verdict.unlocked) {
      // Amber while the phone is still deciding, red once it is out of reach.
      const awaiting = verdict.state === 'awaiting_fix';
      return {
        title: awaiting
          ? 'FINDING YOUR LOCATION'
          : verdict.state === 'outside'
            ? 'OUTSIDE GYM RANGE'
            : verdict.state === 'unavailable'
              ? 'GYM LOCATION UNKNOWN'
              : verdict.state === 'unconfigured'
                ? 'PASS READY'
                : 'LOCATION REQUIRED TO UNLOCK PASS',
        message: verdict.message,
        warn: awaiting,
      };
    }
    return null;
  }, [pass, verdict]);

  /**
   * The QR window. One clock drives both the token and the countdown, so they
   * cannot drift apart: the token re-mints exactly when the kiosk's window rolls
   * over, which is what makes a screenshot useless within about 90 seconds.
   */
  const passVisible = passLock === null && pass !== null;
  const now = useClock(passVisible, 1000);

  /** Seconds until the current frame expires; null while locked. */
  const qrSeconds = passVisible
    ? Math.ceil((PASS_WINDOW_MS - (now % PASS_WINDOW_MS)) / 1000)
    : null;

  /**
   * The QR token, or null when the pass must not be drawn. Returning null IS the
   * lock: there is no fallback branch that renders a code anyway.
   */
  const qrToken = useMemo(() => {
    if (!pass || passLock !== null || now === 0) return null;

    return encodePassToken({
      id: pass.id,
      ph: pass.phone,
      t: Math.floor(now / PASS_WINDOW_MS),
      geo:
        fix && geofence && geofence.latitude !== null && geofence.longitude !== null
          ? {
              lat: fix.lat,
              lon: fix.lon,
              accuracy_meters: fix.accuracy,
              distance_meters: verdict.distance_meters ?? 0,
              radius_meters: geofence.geofence_radius_meters,
            }
          : undefined,
    });
  }, [pass, passLock, now, verdict.distance_meters, fix, geofence]);

  function signOut() {
    clearSession();
    router.replace('/login');
  }

  // `session === null` covers both "still reading localStorage" and "not a member
  // being redirected", which are indistinguishable before the gate effect runs.
  if (!memberId) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className={`${CARD} max-w-sm w-full p-6 text-center`}>
          {session === null ? (
            <>
              <Loader2 className="w-7 h-7 mx-auto mb-3 animate-spin text-emerald-400" />
              <h1 className="text-base font-bold mb-1">Loading your dashboard</h1>
              <p className="text-xs text-zinc-400">One moment…</p>
            </>
          ) : (
            <>
              <Lock className="w-8 h-8 text-rose-400 mx-auto mb-3" />
              <h1 className="text-base font-bold mb-1">Member sign-in required</h1>
              <p className="text-xs text-zinc-400 mb-4">
                This app is for gym members. Staff should use the staff dashboard.
              </p>
              <Link
                href="/login"
                className={`inline-block bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm px-4 py-2 rounded-xl ${TAP}`}
              >
                Go to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }
return (
    <div className="min-h-screen bg-zinc-950 text-white pb-28">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <Dumbbell className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight truncate">
              {data?.member?.full_name ?? pass?.full_name ?? 'Member'}
            </p>
            <p className="text-[11px] text-zinc-400 font-medium truncate">
              {pass?.tenant_name ?? 'Your gym'}
            </p>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className={`p-2 rounded-xl bg-white/5 border border-white/10 text-zinc-400 ${TAP}`}
          >
            <User className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-4 space-y-4">
        {notice && (
          <div
            className={`rounded-xl border px-3 py-2.5 text-xs font-medium ${
              noticeKind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/25 text-rose-200'
            }`}
          >
            {notice}
          </div>
        )}

        {tab === 'home' && (
          <HomeTab
            pass={pass}
            verdict={verdict}
            passLock={passLock}
            locStatus={locStatus}
            locMessage={locMessage}
            qrToken={qrToken}
            qrSeconds={qrSeconds}
            insideNow={insideNow}
            data={data}
            onLocate={locate}
            onRefresh={refresh}
          />
        )}
        {tab === 'health' && data && (
          <HealthTab data={data} onFlash={flash} onSaved={refresh} />
        )}
        {tab === 'training' && data && (
          <TrainingTab data={data} onFlash={flash} onSaved={refresh} />
        )}
        {tab === 'store' && data && (
          <StoreTab
            data={data}
            tenantId={pass?.tenant_id ?? null}
            onFlash={flash}
            onSaved={refresh}
          />
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-zinc-950/90 backdrop-blur-md">
        <div className="max-w-md mx-auto grid grid-cols-4">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 ${TAP} ${
                  active ? 'text-emerald-400' : 'text-zinc-500'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
// =============================================================================
// Tab 1 — Home & Pass
// =============================================================================

interface PassLock {
  title: string;
  message: string;
  /** Amber (still trying) rather than red (refused). */
  warn: boolean;
}

interface HomeTabProps {
  pass: PassMember | null;
  verdict: GeofenceVerdict;
  /** Decided once in the parent so the QR and the overlay cannot disagree. */
  passLock: PassLock | null;
  locStatus: LocStatus;
  locMessage: string | null;
  qrToken: string | null;
  qrSeconds: number | null;
  insideNow: number;
  data: CompanionData | null;
  onLocate: () => void;
  onRefresh: () => Promise<void>;
}

function HomeTab({
  pass,
  verdict,
  passLock,
  locStatus,
  locMessage,
  qrToken,
  qrSeconds,
  insideNow,
  data,
  onLocate,
  onRefresh,
}: HomeTabProps) {
  const hours = gymOpenState();
  const rush = rushLevel(insideNow);
  const countdown = expiryCountdown(pass?.membership_end ?? data?.member?.membership_end ?? null);
  const announcements = data?.announcements.slice(0, 3) ?? [];

  const locked = qrToken === null;
  const lockTone = passLock?.warn
    ? 'bg-amber-500/10 border-amber-500/30'
    : 'bg-rose-500/10 border-rose-500/30';
  const lockIconTone = passLock?.warn ? 'text-amber-300' : 'text-rose-300';
  const lockTextTone = passLock?.warn ? 'text-amber-200' : 'text-rose-200';

  return (
    <div className="space-y-4">
      {/* Gym status strip */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`${CARD} p-3.5`}>
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Gym</p>
          <p
            className={`mt-1.5 text-sm font-bold tracking-tight ${
              hours.open ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {hours.label}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500 font-medium">5am – 11pm daily</p>
        </div>
        <div className={`${CARD} p-3.5`}>
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            How busy
          </p>
          <span
            className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold ${rush.tone}`}
          >
            {rush.level}
          </span>
          <p className="mt-1 text-[11px] text-zinc-500 font-medium">
            {insideNow} checked in recently
          </p>
        </div>
      </div>

      {/* The pass. The QR is rendered only when `qrToken` exists — there is no
          else-branch that draws a placeholder code. */}
      <div className={`${CARD} p-5`}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">
              Gate Pass
            </p>
            <h2 className="text-lg font-extrabold tracking-tight truncate">
              {pass?.full_name ?? 'Member'}
            </h2>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${countdown.tone}`}
          >
            {countdown.label}
          </span>
        </div>
<div className="flex flex-col items-center">
          {!locked ? (
            <>
              <div className="rounded-2xl bg-white p-3">
                <QRCodeSVG value={qrToken} size={180} level="M" />
              </div>
              <p className="mt-3 text-[11px] font-semibold text-zinc-400">
                Refreshes in{' '}
                <span className="text-emerald-400 tabular-nums">{qrSeconds ?? 0}s</span>
              </p>
            </>
          ) : (
            <div className={`w-full rounded-2xl border p-5 text-center ${lockTone}`}>
              <Lock className={`w-10 h-10 mx-auto mb-2 ${lockIconTone}`} />
              <h3 className={`text-sm font-extrabold tracking-tight ${lockTextTone}`}>
                {passLock?.title ?? 'PASS LOCKED'}
              </h3>
              <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                {passLock?.message ?? 'Your pass is locked right now.'}
              </p>

              {verdict.state === 'outside' && (
                <p className="mt-2 text-[11px] text-zinc-400 font-medium">
                  Walk within {verdict.radius_meters} m of the entrance and it unlocks on its own.
                </p>
              )}

              <button
                onClick={onLocate}
                className={`mt-4 inline-flex items-center justify-center gap-2 w-full rounded-xl bg-white hover:bg-zinc-100 text-black font-bold py-2.5 text-xs ${TAP}`}
              >
                {locStatus === 'locating' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Navigation className="w-3.5 h-3.5" />
                )}
                Recalculate Location
              </button>

              {locStatus === 'error' && locMessage && (
                <p className="mt-2.5 text-[11px] text-amber-200 leading-relaxed">{locMessage}</p>
              )}
            </div>
          )}
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-zinc-500 font-medium leading-relaxed">
          <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
          {verdict.message}
        </p>
      </div>

      {/* Announcements */}
      {announcements.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-zinc-300">
            <Bell className="w-3.5 h-3.5 text-violet-400" /> Pinned by your gym
          </h3>
          {announcements.map((item) => (
            <div key={item.id} className={`${CARD} p-3.5`}>
              <p className="text-xs font-bold text-white">{item.title}</p>
              <p className="mt-1 text-[11px] text-zinc-400 leading-relaxed">{item.message}</p>
              <p className="mt-1.5 text-[10px] text-zinc-600 font-medium">
                {timeAgo(item.created_at)}
              </p>
            </div>
          ))}
        </section>
      )}

      <button
        onClick={() => void onRefresh()}
        className={`w-full inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-zinc-300 ${TAP}`}
      >
        Refresh
      </button>
    </div>
  );
}
// =============================================================================
// Tab 2 — Health & Profile
// =============================================================================

function HealthTab({ data, onFlash, onSaved }: TabProps) {
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);

  const trend = weightTrend(data.weights);
  const spark = weightSparkPath(data.weights);
  const countdown = expiryCountdown(data.member?.membership_end ?? null);
  const trainer = data.trainer;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!data.member) return;

    const value = Number(weight);
    if (!Number.isFinite(value) || value <= 0) {
      onFlash('Enter your weight in kilograms.', 'bad');
      return;
    }

    setSaving(true);
    const result = await logWeight(data.member.id, value);
    setSaving(false);

    if (!result.ok) {
      onFlash(result.error ?? 'Could not save your weight.', 'bad');
      return;
    }

    setWeight('');
    onFlash('Weight saved.', 'ok');
    await onSaved();
  }

  return (
    <div className="space-y-4">
      {/* Plan */}
      <section className={`${CARD} p-5`}>
        <p className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">
          Your membership
        </p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <p className="text-3xl font-extrabold tracking-tight text-white">
            {data.member?.full_name ?? 'Member'}
          </p>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${countdown.tone}`}
          >
            {countdown.label}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-zinc-400 font-medium">
          {data.member?.membership_end
            ? `Renews ${new Date(data.member.membership_end).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}`
            : 'Ask the front desk to activate a plan.'}
        </p>
        {data.member?.is_frozen && data.member.freeze_end_date && (
          <p className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-200 font-medium">
            Paused until {data.member.freeze_end_date}.
          </p>
        )}
      </section>

      {/* Trainer */}
      {trainer ? (
        <section className={`${CARD} p-5`}>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">
            Your trainer
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/25 to-violet-500/20 text-sm font-bold text-white ring-1 ring-white/10">
              {trainer.name
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')
                .toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate">{trainer.name}</p>
              <p className="text-[11px] text-zinc-400 font-medium truncate">
                {trainer.specialization ?? 'Strength & conditioning'}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a
              href={`https://wa.me/91${trainer.phone.replace(/\D/g, '').slice(-10)}`}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-black ${TAP}`}
            >
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
            <a
              href={`tel:+91${trainer.phone.replace(/\D/g, '').slice(-10)}`}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-zinc-200 ${TAP}`}
            >
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
          </div>
        </section>
      ) : (
        <section className={`${CARD} p-5 text-center`}>
          <p className="text-xs font-semibold text-zinc-400">
            No trainer assigned yet. Ask the front desk to pair you with one.
          </p>
        </section>
      )}
{/* Weight tracker */}
      <section className={`${CARD} p-5`}>
        <p className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">
          Weight tracker
        </p>

        <div className="mt-3 flex items-end gap-3">
          <p className="text-3xl font-extrabold tracking-tight text-white tabular-nums">
            {trend.latest !== null ? trend.latest.toFixed(1) : '—'}
            <span className="ml-1 text-base font-bold text-zinc-500">kg</span>
          </p>
          {trend.delta !== null && trend.delta !== 0 && (
            <span
              className={`mb-1 inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${
                trend.direction === 'up'
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/25'
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
              }`}
            >
              {trend.direction === 'up' ? '+' : ''}
              {trend.delta.toFixed(1)} kg
              <span className="text-zinc-400 font-medium">since last</span>
            </span>
          )}
        </div>

        {/* Sparkline. Drawn from the readings rather than a chart library: a
            fixed polyline in a 100x36 box is all this needs. */}
        {spark ? (
          <svg
            viewBox="0 0 100 36"
            preserveAspectRatio="none"
            className="mt-3 h-16 w-full"
            role="img"
            aria-label="Weight trend"
          >
            <path d={spark} fill="none" stroke="#10B981" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <p className="mt-3 text-[11px] text-zinc-500 font-medium">
            Log your first weigh-in to start the trend.
          </p>
        )}

        <form onSubmit={submit} className="mt-4 flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="25"
            max="400"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            placeholder="Today's weight (kg)"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
          />
          <button
            type="submit"
            disabled={saving}
            className={`shrink-0 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-black disabled:opacity-60 ${TAP}`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
          </button>
        </form>

        {data.weights.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {data.weights.slice(0, 6).map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs"
              >
                <span className="font-bold text-white tabular-nums">
                  {entry.weight_kg.toFixed(1)} kg
                </span>
                <span className="text-zinc-500 font-medium">{timeAgo(entry.logged_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
// =============================================================================
// Tab 3 — Workout Logger
// =============================================================================

/** Rest timer lengths, in seconds. Two options only, because the point is to
 *  start one between sets without thinking about it. */
const REST_PRESETS = [60, 90] as const;

function TrainingTab({ data, onFlash, onSaved }: TabProps) {
  const [split, setSplit] = useState<WorkoutSplit>('Push');
  const [exercise, setExercise] = useState('');
  const [reps, setReps] = useState('');
  const [load, setLoad] = useState('');
  const [saving, setSaving] = useState(false);
  /**
 * Rest timer.
 *
 * Modelled as a deadline plus a clock rather than a stored countdown, so no
 * component has to write "seconds remaining" back into state on every tick. The
 * displayed value is derived, and it drops to null the moment the deadline has
 * passed.
 */
  const [restUntil, setRestUntil] = useState(0);
  const resting = restUntil > 0;
  const restNow = useClock(resting, 250);

  const restLeft = !resting
    ? null
    : restNow >= restUntil
      ? null
      : Math.max(1, Math.ceil((restUntil - restNow) / 1000));

  /** Arms the rest timer for `seconds` from now. Inlined at each call site rather
   *  than wrapped in a helper: a component-scope function that reads the clock is
   *  indistinguishable from one invoked during render, and the deadline has to be
   *  stamped at press time, not at definition time. */

  const previous = lastPerformance(data.workouts, split, exercise);
  const suggestions = SPLIT_SUGGESTIONS[split];
  const volume = splitVolume(data.workouts, split);
  const recent = data.workouts.slice(0, 8);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!data.member) return;

    const repsValue = Number(reps);
    const loadValue = load.trim() === '' ? 0 : Number(load);
    if (!Number.isFinite(repsValue) || repsValue < 1) {
      onFlash('Enter how many reps you did.', 'bad');
      return;
    }
    if (!Number.isFinite(loadValue) || loadValue < 0) {
      onFlash('Enter the load in kilograms, or 0 for bodyweight.', 'bad');
      return;
    }

    setSaving(true);
    const result = await logWorkout({
      memberId: data.member.id,
      split,
      exercise,
      sets: 1,
      reps: repsValue,
      weightUsed: loadValue,
    });
    setSaving(false);

    if (!result.ok) {
      onFlash(result.error ?? 'Could not save that set.', 'bad');
      return;
    }

    // Clear only the numbers: keeping the exercise name lets a member log three
    // back-to-back sets of the same lift without retyping it each time.
    setReps('');
    setRestUntil(Date.now() + REST_PRESETS[0] * 1000);
    onFlash('Set logged.', 'ok');
    await onSaved();
  }
return (
    <div className="space-y-4">
      {/* Split picker */}
      <section>
        <h3 className="mb-2 text-xs font-bold text-zinc-300">Today&apos;s routine</h3>
        <div className="flex flex-wrap gap-2">
          {WORKOUT_SPLITS.map((option) => {
            const active = split === option;
            return (
              <button
                key={option}
                onClick={() => setSplit(option)}
                className={`rounded-xl border px-3.5 py-2 text-xs font-bold ${
                  active
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-white/10 bg-white/5 text-zinc-400'
                } ${TAP}`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </section>

      {/* Volume headline + running rest clock */}
      <div className={`${CARD} p-4 flex items-center justify-between`}>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            {split} volume
          </p>
          <p className="mt-0.5 text-2xl font-extrabold tracking-tight text-white tabular-nums">
            {volume.toLocaleString('en-IN')}
            <span className="ml-1 text-xs font-bold text-zinc-500">kg</span>
          </p>
        </div>
        {restLeft !== null && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Rest</p>
            <p className="mt-0.5 text-2xl font-extrabold tracking-tight text-amber-300 tabular-nums">
              {restLeft}
            </p>
          </div>
        )}
      </div>

      {/* Logger */}
      <form onSubmit={submit} className={`${CARD} p-5 space-y-3`}>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
            Exercise
          </label>
          <input
            value={exercise}
            onChange={(event) => setExercise(event.target.value)}
            placeholder="Bench Press"
            maxLength={80}
            className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
          />
          {/* "Last time" is the single most useful thing on a logging screen:
              what the member lifted in the previous session. */}
          {previous && (
            <p className="mt-1.5 text-[11px] text-zinc-400 font-medium">
              Last time: {previous.weight_used > 0 ? `${previous.weight_used} kg · ` : ''}
              {previous.reps} reps · {timeAgo(previous.logged_at)}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
              Reps
            </label>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="500"
              value={reps}
              onChange={(event) => setReps(event.target.value)}
              placeholder="8"
              className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
              Load (kg)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              max="1000"
              value={load}
              onChange={(event) => setLoad(event.target.value)}
              placeholder="60"
              className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className={`w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-black disabled:opacity-60 ${TAP}`}
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
          ) : (
            'Log this set'
          )}
        </button>

        {/* The timer starts automatically after a set, and can be re-armed by
            hand when a member rests without logging. */}
        <div className="grid grid-cols-2 gap-2">
          {REST_PRESETS.map((seconds) => (
            <button
              key={seconds}
              type="button"
              onClick={() => setRestUntil(Date.now() + seconds * 1000)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2 text-[11px] font-semibold text-zinc-300 ${TAP}`}
            >
              <Timer className="w-3.5 h-3.5" /> Rest {seconds}s
            </button>
          ))}
        </div>
      </form>
{/* Routine shortcuts */}
      <section className={`${CARD} p-5`}>
        <h3 className="text-xs font-bold text-zinc-300">Common {split.toLowerCase()} moves</h3>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setExercise(name)}
              className={`rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 ${TAP}`}
            >
              {name}
            </button>
          ))}
        </div>
      </section>

      {/* Recent sets */}
      <section className={`${CARD} p-5`}>
        <h3 className="mb-3 text-xs font-bold text-zinc-300">Recent sets</h3>
        {recent.length === 0 ? (
          <p className="text-[11px] text-zinc-500 font-medium">
            Nothing logged yet. Pick a split above and add your first set.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white">{entry.exercise_name}</p>
                  <p className="text-[10px] text-zinc-500 font-medium">
                    {entry.workout_split} · {timeAgo(entry.logged_at)}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-bold text-emerald-300 tabular-nums">
                  {entry.weight_used > 0 ? `${entry.weight_used}kg ` : ''}
                  <span className="text-zinc-400 font-semibold">× {entry.reps}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
// =============================================================================
// Tab 4 — Gym Store (member view)
// =============================================================================

interface StoreTabProps extends TabProps {
  tenantId: string | null;
}

function StoreTab({ data, tenantId, onFlash, onSaved }: StoreTabProps) {
  const [catalogue, setCatalogue] = useState<StoreItem[]>([]);
  const [loadedTenant, setLoadedTenant] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Derived rather than stored: no tenant means nothing to load, so the spinner
   *  must not be waiting on a request that was never made. */
  const loading = Boolean(tenantId) && loadedTenant !== tenantId;

  // The catalogue is a plain read of `products`: unlike the four Phase 4 tables
  // this one is not revoked (the POS needs it), and a member only ever sees the
  // gym's own rows because the read is scoped to tenant_id.
  useEffect(() => {
    if (!tenantId) return;

    let cancelled = false;
    (async () => {
      const response = await fetch(`/api/store?tenant_id=${tenantId}`, { method: 'GET' });
      const body = (await response.json()) as { products?: StoreItem[] };

      if (cancelled) return;
      setCatalogue(
        (body.products ?? []).map((product) => ({
          ...product,
          selling_price: Number(product.selling_price) || 0,
          stock_quantity: Number(product.stock_quantity) || 0,
        }))
      );
      setLoadedTenant(tenantId);
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  /** Everything this member already has waiting at the desk, keyed by product, so
   *  a reserved card can say "2 waiting" instead of looking like a fresh item. */
  const pendingByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of data.reservations) {
      if (entry.status !== 'pending') continue;
      map.set(entry.product_id, (map.get(entry.product_id) ?? 0) + entry.quantity);
    }
    return map;
  }, [data.reservations]);

  async function reserve(product: StoreItem) {
    if (!data.member) return;
    setBusyId(product.id);

    const result = await reserveProduct(data.member.id, product.id, 1);
    setBusyId(null);

    if (!result.ok) {
      onFlash(result.error ?? 'Could not reserve that item.', 'bad');
      return;
    }

    onFlash(
      result.merged
        ? `${product.name} is waiting for you at the desk.`
        : `${product.name} reserved. Collect it from the desk.`,
      'ok'
    );
    await onSaved();
  }

  async function cancel(reservationId: string) {
    if (!data.member) return;
    const result = await cancelReservation(data.member.id, reservationId);
    if (!result.ok) {
      onFlash(result.error ?? 'Could not cancel that reservation.', 'bad');
      return;
    }
    onFlash('Reservation cancelled.', 'ok');
    await onSaved();
  }
return (
    <div className="space-y-4">
      {/* Reservation tracker */}
      <section className={`${CARD} p-5`}>
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-zinc-300">
          <ShoppingBag className="w-3.5 h-3.5 text-violet-400" /> Your desk pickups
        </h3>

        {data.reservations.length === 0 ? (
          <p className="mt-2.5 text-[11px] text-zinc-500 font-medium">
            Nothing reserved. Tap any item below to hold it at the desk.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.reservations.slice(0, 6).map((entry) => {
              const meta = RESERVATION_LABEL[entry.status] ?? RESERVATION_LABEL.pending;
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white">{entry.product_name}</p>
                    <span
                      className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] font-bold text-zinc-400 tabular-nums">
                      × {entry.quantity}
                    </span>
                    {entry.status === 'pending' && (
                      <button
                        onClick={() => void cancel(entry.id)}
                        className={`rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-zinc-400 ${TAP}`}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Catalogue */}
      <section>
        <h3 className="mb-2 text-xs font-bold text-zinc-300">Gym store</h3>

        {loading ? (
          <div className={`${CARD} flex items-center justify-center gap-2 py-10 text-xs text-zinc-500`}>
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> Loading the shelf…
          </div>
        ) : catalogue.length === 0 ? (
          <div className={`${CARD} py-10 text-center text-xs text-zinc-500`}>
            Nothing on the shelf right now.
          </div>
        ) : (
          <div className="space-y-2.5">
            {catalogue.map((item) => {
              const meta = CATEGORY_META[item.category];
              const Icon = meta?.icon ?? Package;
              const pending = pendingByProduct.get(item.id) ?? 0;
              const out = item.stock_quantity <= 0;
              const busy = busyId === item.id;

              return (
                <div key={item.id} className={`${CARD} p-4`}>
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 shrink-0">
                      <Icon className="w-4 h-4 text-violet-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate">{item.name}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-400 font-medium">
                        {meta?.label ?? item.category}
                        {out
                          ? ' · Out of stock'
                          : pending > 0
                            ? ` · ${pending} waiting for you`
                            : item.stock_quantity <= 5
                              ? ` · only ${item.stock_quantity} left`
                              : ''}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-extrabold tracking-tight text-emerald-300 tabular-nums">
                      ₹{item.selling_price.toLocaleString('en-IN')}
                    </p>
                  </div>

                  <button
                    onClick={() => void reserve(item)}
                    disabled={out || busy}
                    className={`mt-3 w-full rounded-xl py-2.5 text-xs font-bold ${
                      out
                        ? 'border border-white/10 bg-white/5 text-zinc-500'
                        : 'bg-violet-500 hover:bg-violet-400 text-white disabled:opacity-60'
                    } ${TAP}`}
                  >
                    {busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
                    ) : out ? (
                      'Out of stock'
                    ) : pending > 0 ? (
                      'Reserve one more'
                    ) : (
                      'Reserve for desk pickup'
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
