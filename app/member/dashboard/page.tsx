'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bell,
  ChevronRight,
  Dumbbell,
  Flame,
  Home,
  Loader2,
  LogOut,
  MessageCircle,
  Package,
  Pencil,
  Phone,
  Pin,
  Plus,
  Settings,
  ShieldCheck,
  RefreshCw,
  ShoppingBag,
  Store,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  User,
  Utensils,
  X,
} from 'lucide-react';
import { readSession, clearSession, type GymSession } from '@/lib/session';
import { hardSignOut } from '@/lib/logout';
import LiveCrowdCard from '@/components/live-crowd-card';
import { supabase } from '@/lib/supabase';
import { PASS_WINDOW_MS } from '@/lib/passtoken';
import { mintGatePass } from '@/lib/passmint';
import AvatarUploader from '@/components/avatar-uploader';
import AccountSettings from '@/components/account-settings';
import BadgeShowcase from '@/components/badge-showcase';
import HardwareIdentityCard from '@/components/hardware-identity-card';
import PasswordGate from '@/components/password-gate';
import { loadHardwareIdentity, rfidDisplay, slotDisplay, HARDWARE_IDENTITY_HINT, type HardwareIdentity } from '@/lib/identity';
import { loadBadges, loadMemberStats, type MemberBadge, type MemberStats } from '@/lib/gamification';
import {
  EMPTY_STREAK,
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
  setUsername,
  splitVolume,
  streakHeadline,
  timeAgo,
  weightSparkPath,
  weightTrend,
  type CompanionData,
  type WorkoutSplit,
} from '@/lib/companion';

// =============================================================================
// Shell constants — the whole member app is one light surface
// =============================================================================
type TabId = 'home' | 'health' | 'training' | 'store';

const TABS: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'health', label: 'Health', icon: User },
  { id: 'training', label: 'Training', icon: Dumbbell },
  { id: 'store', label: 'Store', icon: Store },
];

/** Every card in the app: white, soft border, barely-there shadow. */
const CARD = 'bg-white rounded-2xl border border-slate-200 shadow-sm';

/** The one button style members press: solid teal, white text. */
const PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-60';

/** Tactile feedback for every pressable. */
const TAP = 'transition-all duration-150 active:scale-[0.97]';

const INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15';

/** The member-facing name for a reservation's state. */
const RESERVATION_LABEL: Record<string, { label: string; tone: string; hint: string }> = {
  pending: {
    label: 'Waiting at Desk',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
    hint: 'Show this screen at the counter to collect it.',
  },
  picked_up: {
    label: 'Picked Up',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    hint: 'Handed over and billed at the desk.',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'bg-slate-100 text-slate-500 border-slate-200',
    hint: 'This reservation was closed.',
  },
};

/** Store categories, with the icon the catalogue groups them under. */
const CATEGORY_META: Record<string, { label: string; icon: typeof Package }> = {
  protein: { label: 'Protein', icon: Package },
  supplements: { label: 'Supplements', icon: Package },
  merchandise: { label: 'Gear', icon: ShoppingBag },
  beverages: { label: 'Drinks', icon: Utensils },
  gear: { label: 'Gear', icon: ShoppingBag },
};

interface StoreItem {
  id: string;
  name: string;
  category: string;
  selling_price: number;
  stock_quantity: number;
  /**
   * Public Storage URL of the product photo, or null for no photo. Added by
   * migration 0007; the member store could not show it until the query above
   * started asking for this column.
   */
  image_url?: string | null;
}

/** What /api/member/pass returns for the signed-in member. */
interface PassMember {
  id: string;
  full_name: string;
  phone: string;
  username: string | null;
  tenant_id: string | null;
  tenant_name: string;
  upi_id: string | null;
  membership_end: string | null;
  status: string;
  is_frozen: boolean;
  freeze_end_date: string | null;
  is_expired: boolean;
}

/** Member-facing labels for the notice `type` an owner picks in /admin/settings. */
const NOTICE_LABELS: Record<string, string> = {
  general: 'Notice',
  alert: 'Alert',
  event: 'Event',
  maintenance: 'Maintenance',
  offer: 'Offer',
};

/** Tailwind for each notice badge. Keyed the same way as NOTICE_LABELS. */
const NOTICE_TONES: Record<string, string> = {
  general: 'border-slate-200 bg-slate-100 text-slate-600',
  alert: 'border-rose-200 bg-rose-50 text-rose-700',
  event: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  maintenance: 'border-amber-200 bg-amber-50 text-amber-700',
  offer: 'border-cyan-200 bg-cyan-50 text-cyan-700',
};

interface TabProps {
  data: CompanionData;
  onFlash: (message: string, kind?: 'ok' | 'bad') => void;
  onSaved: () => Promise<void>;
}

/** Why the gate pass cannot be shown, in member-facing words. Null = show it. */
interface PassLock {
  title: string;
  message: string;
  /** The tailwind tone for the card that replaces the QR code. */
  tone: string;
}

/**
 * A clock that only runs while `active`.
 *
 * Reading the wall clock during render is impure and React has no reason to
 * re-render when a second passes, so time is modelled as state an interval
 * advances. The first reading lands on a macrotask rather than synchronously in
 * the effect body, which keeps the component from cascading a render before it
 * has anything to show.
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

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// =============================================================================
// The app shell
// =============================================================================

export default function MemberDashboard() {
  const router = useRouter();

  /**
   * The session, read once on mount. `null` covers both "still hydrating" and
   * "not signed in", which is why the redirect lives in an effect below: the gate
   * cannot tell those two apart before localStorage is readable.
   */
  const [session, setSession] = useState<GymSession | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<TabId>('home');
  const [data, setData] = useState<CompanionData | null>(null);
  const [pass, setPass] = useState<PassMember | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'bad'>('ok');
  const [insideNow, setInsideNow] = useState(0);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrSeconds, setQrSeconds] = useState<number | null>(null);

  /** The 30-second window the last minted token belongs to. */
  const lastWindow = useRef(-1);
  /** The greeting is decided once per mount, so it cannot flip mid-session. */
  const [greetingAt] = useState(() => new Date());

  // ---- Phase 10 identity (photo, hardware credentials, badges) ---------------
  // Held here, not inside HealthTab, because the header avatar and the profile
  // modal need the same photo without the tab being mounted.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [hardware, setHardware] = useState<HardwareIdentity | null>(null);
  const [badges, setBadges] = useState<MemberBadge[]>([]);
  const [stats, setStats] = useState<MemberStats | null>(null);
  /** The profile sheet: photo + hardware identity, reachable from the header. */
  const [profileOpen, setProfileOpen] = useState(false);
  /** Phase 11: the Settings view, which is where the @handle now lives. */
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * Phase 11: until this member has set their own password, the app is BLOCKED
   * behind PasswordGate. Defaults to true so the gate shows on the very first
   * paint rather than flashing the dashboard and then covering it — which would
   * leak the whole member's data for a frame on a shared device.
   */
  const [passwordDone, setPasswordDone] = useState(true);

  const memberId = session?.role === 'member' ? session.userId : null;
  const memberPhone = session?.phone ?? '';

  function flash(message: string, kind: 'ok' | 'bad' = 'ok') {
    setNotice(message);
    setNoticeKind(kind);
  }

  /**
   * The Phase 10 bundle. Badges and the photo are separate concerns from the
   * four tabs' data, so a failed badge read must not blank the dashboard — each
   * load is independent and simply leaves its own slice empty.
   */
  const loadIdentity = useCallback(async () => {
    if (!memberId) return;

    const [identity, earned, memberStats] = await Promise.all([
      loadHardwareIdentity(memberId),
      loadBadges(memberId),
      loadMemberStats(memberId),
    ]);

    setHardware(identity);
    setBadges(earned);
    setStats(memberStats);
  }, [memberId]);

  /** Reads the stored session once, then leaves routing to the effect below. */
  useEffect(() => {
    // localStorage is an external store, so reading it belongs in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(readSession());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!session || session.role !== 'member') router.replace('/login');
  }, [ready, session, router]);

  /**
   * DUAL ROLE (Phase 12): does this member ALSO run the gym?
   *
   * The owner-console badge only appears for someone who genuinely has a staff
   * account, so this asks gym_users for a matching phone — scoped to the SAME
   * tenant as the member's, so a member of Gym A never sees a link into an owner
   * console they do not belong to.
   *
   * Read directly rather than through a new endpoint: gym_users is a small
   * operator table the app already reads in /api/auth/login, and this is a
   * single-column existence check on the client for display purposes only. It
   * grants nothing — navigating to / is still checked server-side by the
   * tenant-scoped routes.
   */
  const [isStaffToo, setIsStaffToo] = useState(false);

  // Derived rather than stored: a guard effect that calls setState(false) before
  // returning is the synchronous-update-in-effect pattern. Computing the inputs
  // first and only setting state inside the async continuation keeps the one
  // legitimate state write where it belongs.
  const staffPhone = (session?.phone ?? '').replace(/\D/g, '').slice(-10);
  const staffTenant = session?.tenantId ?? null;
  const canCheckStaff = ready && staffPhone.length === 10 && staffTenant !== null;

  useEffect(() => {
    // No early setState: when the inputs are unusable the state is already the
    // correct value (false), or `arm` below resets it via the cleanup.
    if (!canCheckStaff) return;

    let cancelled = false;

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('gym_users')
          .select('id, phone')
          .eq('tenant_id', staffTenant);

        if (cancelled || error) return;

        const match = ((data ?? []) as Array<{ id: string; phone: string }>).some(
          (row) => (row.phone ?? '').replace(/\D/g, '').slice(-10) === staffPhone
        );
        if (!cancelled) setIsStaffToo(match);
      } catch {
        /* the badge is a convenience; stay hidden on failure */
      }
    })();

    return () => {
      cancelled = true;
      // Clearing on scope change stops one gym's answer leaking into another's
      // badge after a sign-out, without an extra render on the happy path.
      setIsStaffToo(false);
    };
  }, [canCheckStaff, staffPhone, staffTenant]);

  /** Reloads the four tabs' bundle. */
  const refresh = useCallback(async () => {
    if (!memberId) return;
    const result = await loadCompanionData(memberId);
    if (!result.ok) {
      flash(result.error ?? 'Could not load your dashboard.', 'bad');
      return;
    }
    setData(result.data);

    // Phase 11: the password gate reads the SAME bundle the tabs use, so there
    // is no extra round trip just to decide whether to block the app.
    setPasswordDone(result.data.member?.password_setup_completed !== false);
  }, [memberId]);

  /**
   * The membership lookup behind the Gate Pass. It carries the gym name for the
   * card header and the UPI id for the pay-at-the-desk shortcut.
   */
  const loadPass = useCallback(async () => {
    if (!memberId && !memberPhone) return;

    try {
      const response = await fetch('/api/member/pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(memberId ? { member_id: memberId } : { phone: memberPhone }),
      });

      const result = (await response.json()) as { ok?: boolean; member?: PassMember };
      if (result.ok && result.member) setPass(result.member);
    } catch {
      // The pass card falls back to the bundle's own member row; a failed lookup
      // is not worth an error banner across the whole screen.
    }
  }, [memberId, memberPhone]);

  useEffect(() => {
    if (!memberId) return;
    // Fetching on mount is an external subscription; the state it writes is the
    // result of that fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    void loadPass();
    void loadIdentity();
  }, [memberId, refresh, loadPass, loadIdentity]);

  /**
   * The photo itself. profiles.avatar_url is the column the uploader writes
   * (mirrored into members.avatar_url by the same RPC), so one read covers both
   * the roster view and this header.
   */
  useEffect(() => {
    if (!memberId) return;

    let cancelled = false;
    void (async () => {
      const { data: row } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('user_id', memberId)
        .maybeSingle();
      if (!cancelled) setAvatarUrl(row?.avatar_url ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [memberId]);

  // --- Live floor count for the rush indicator -------------------------------
  const loadRush = useCallback(async () => {
    const tenantId = data?.tenant_id ?? pass?.tenant_id;
    if (!tenantId) return;

    const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('attendances')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'granted')
      .gte('punch_time', since);

    if (!error && typeof count === 'number') setInsideNow(count);
  }, [data?.tenant_id, pass?.tenant_id]);

  useEffect(() => {
    if (!data?.tenant_id && !pass?.tenant_id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRush();
    const timer = window.setInterval(loadRush, 60_000);
    return () => window.clearInterval(timer);
  }, [data?.tenant_id, pass?.tenant_id, loadRush]);

  /**
   * Membership-only pass state. Phase 5 removed every location rule: a frozen or
   * expired membership is the only thing that can hide the QR code.
   */
  const passLock = useMemo((): PassLock | null => {
    const live = pass ?? data?.member ?? null;
    if (!live) return null;

    if (live.is_frozen) {
      return {
        title: 'Membership Paused',
        message: live.freeze_end_date
          ? `Your membership is paused until ${live.freeze_end_date}. Ask the desk to resume it and your pass returns instantly.`
          : 'Your membership is paused. Ask the desk to resume it and your pass returns instantly.',
        tone: 'bg-slate-50 border-slate-200 text-slate-700',
      };
    }

    if (pass?.is_expired) {
      return {
        title: 'Membership Expired',
        message:
          'Renew at the front desk to reopen your gate pass. Your training history is safe.',
        tone: 'bg-rose-50 border-rose-200 text-rose-700',
      };
    }

    const status = live.status ?? 'active';
    if (status !== 'active') {
      return {
        title: 'Membership Inactive',
        message: `Your membership is marked "${status}". See the front desk to reactivate it.`,
        tone: 'bg-amber-50 border-amber-200 text-amber-800',
      };
    }

    return null;
  }, [pass, data?.member]);

  /**
   * The rotating credential, re-minted on every 30-second window. The claims
   * (member id + phone) travel to /api/member/pass/mint, which signs them
   * server-side — there is no location proof to attach any more, and the kiosk
   * re-checks the membership itself when the code is scanned.
   */
  useEffect(() => {
    if (!memberId) return;

    const tick = () => {
      const windowIndex = Math.floor(Date.now() / PASS_WINDOW_MS);
      setQrSeconds(30 - (Math.floor(Date.now() / 1000) % 30));

      if (windowIndex === lastWindow.current) return;
      lastWindow.current = windowIndex;

      if (passLock) {
        setQrToken(null);
        return;
      }

      // The signature is applied where the key lives; the browser only asks for
      // THIS window's signed token, so a leaked bundle cannot forge one.
      void mintGatePass({ id: memberId, ph: memberPhone }).then((token) => {
        // A newer window may have started while the mint was in flight.
        if (lastWindow.current !== windowIndex) return;
        setQrToken(token);
      });
    };

    const prime = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(prime);
      window.clearInterval(interval);
    };
  }, [memberId, memberPhone, passLock]);

  function signOut() {
    // Was `clearSession(); router.replace('/login')` — which is exactly what
    // caused the logout loop: it removed the gym session but left Supabase's
    // tokens in localStorage, autoRefreshToken renewed them on the next mount,
    // and the user was bounced straight back into the app.
    void hardSignOut();
  }

  const displayName = pass?.full_name ?? data?.member?.full_name ?? session?.name ?? 'Member';
  const handle = pass?.username ?? data?.member?.username ?? session?.username ?? null;

  const locked = qrToken === null;

  /**
   * Heaviest bench the member has ever logged, for the locked-badges ring. The
   * PR list is already in memory, so this costs nothing extra; a name that does
   * not contain "bench" is ignored on purpose (the SQL rule is the same).
   */
  const heaviestBenchKg = useMemo(
    () =>
      (stats?.prs ?? [])
        .filter((pr) => /bench/i.test(pr.exercise))
        .reduce((max, pr) => Math.max(max, Number(pr.weight) || 0), 0),
    [stats]
  );

  /**
   * Phase 11 (Module 6): the blocking first-run screen.
   *
   * Rendered INSTEAD of the whole app rather than as a modal on top, so no
   * member data is ever painted behind it. On a shared phone at the desk that
   * matters: a dismissible modal would still expose the previous member's
   * streak, weight and gate pass behind it.
   */
  if (!passwordDone) {
    return (
      <PasswordGate
        memberId={memberId}
        name={displayName}
        onFlash={flash}
        onDone={async () => {
          setPasswordDone(true);
          await refresh();
        }}
        // Phase 12: the escape hatch. Deliberately does NOT call
        // fn_member_mark_password_setup — the member still has no password, so
        // password_setup_completed stays false and the reminder can return later
        // from Settings. It only stops this screen from being a dead end.
        onSkip={() => {
          setPasswordDone(true);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* Tapping the header avatar opens the profile sheet — the same
                Instagram-style uploader the Health tab carries, so there is one
                implementation of the photo rules. */}
            <button
              onClick={() => setProfileOpen(true)}
              title="Edit profile photo"
              aria-label="Open your profile"
              className={`shrink-0 rounded-full ring-2 ring-white shadow-sm ${TAP}`}
            >
              <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-xs font-extrabold text-white">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  displayName
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((word) => word.charAt(0))
                    .join('')
                    .toUpperCase() || 'M'
                )}
              </span>
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">{displayName}</p>
              <p className="truncate text-[11px] font-medium text-slate-500">
                {handle ? `@${handle}` : pass?.tenant_name ?? 'Member app'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* ---- Live gym crowd (Phase 12) -------------------------------
                A member deciding whether to drive over wants to know if the floor
                is packed, not a raw integer, so the badge leads with the
                Quiet/Moderate/Busy sentiment. */}
            <LiveCrowdCard tenantId={session?.tenantId ?? null} variant="badge" />

            {/* ---- Back to Owner Console (Phase 12) ----------------------
                Only rendered when this member ALSO holds a staff account, which
                is the dual-role case. Hidden for everyone else: a badge that
                leads nowhere is worse than no badge. */}
            {isStaffToo && (
              <Link
                href="/admin"
                title="You also manage this gym — open the owner console"
                className={`inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-[11px] font-bold text-indigo-700 transition hover:bg-indigo-100 ${TAP}`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Owner
              </Link>
            )}

            <button
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              className={`rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:text-slate-900 ${TAP}`}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 py-4">
        {notice && (
          <div
            role="status"
            className={`rounded-xl border px-3 py-2.5 text-xs font-medium ${
              noticeKind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {notice}
          </div>
        )}

        {tab === 'home' && (
          <HomeTab
            pass={pass}
            data={data}
            lock={passLock}
            locked={locked}
            qrToken={qrToken}
            qrSeconds={qrSeconds}
            insideNow={insideNow}
            displayName={displayName}
            handle={handle}
            hardware={hardware}
            now={greetingAt}
            onRefresh={refresh}
          />
        )}
        {tab === 'health' && data && (
          <HealthTab
            data={data}
            onFlash={flash}
            onSaved={refresh}
            avatarUrl={avatarUrl}
            onAvatarChange={setAvatarUrl}
            tenantId={session?.tenantId ?? null}
            hardware={hardware}
            badges={badges}
            bestStreak={data.streak.best}
            heaviestBenchKg={heaviestBenchKg}
            onOpenProfile={() => setProfileOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
        {tab === 'training' && data && (
          <TrainingTab data={data} onFlash={flash} onSaved={refresh} />
        )}
        {tab === 'store' && data && <StoreTab data={data} onFlash={flash} onSaved={refresh} />}
      </main>

      {/* Settings — where the @handle, personal details and security live
          (Phase 11). Separate from the profile sheet on purpose: changing a
          handle is a deliberate, rate-limited act, not a photo edit. */}
      {settingsOpen && data && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Account settings"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-slate-50 p-4 sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                Settings
              </p>
              <button
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
                className={`rounded-xl border border-slate-200 bg-white p-2 text-slate-500 ${TAP}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <AccountSettings
              memberId={data.member?.id ?? null}
              currentUsername={data.member?.username ?? null}
              passwordDone={data.member?.password_setup_completed !== false}
              profile={{
                display_name: data.profile.display_name,
                emergency_phone: data.profile.emergency_phone,
                gender: data.profile.gender,
                date_of_birth: data.profile.date_of_birth,
                username_changed_at: data.profile.username_changed_at,
              }}
              onSaved={refresh}
              onFlash={flash}
              onLogout={signOut}
            />
          </div>
        </div>
      )}

      {/* The header profile sheet. Same uploader, same hardware card, no
          duplication: the Health tab is the deep version of this sheet. */}
      {profileOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Your profile"
          onClick={() => setProfileOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-slate-50 p-4 sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                Your Profile
              </p>
              <button
                onClick={() => setProfileOpen(false)}
                aria-label="Close profile"
                className={`rounded-xl border border-slate-200 bg-white p-2 text-slate-500 ${TAP}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className={`${CARD} flex items-center gap-4 p-4`}>
              <AvatarUploader
                memberId={memberId}
                tenantId={session?.tenantId ?? null}
                name={displayName}
                avatarUrl={avatarUrl}
                onFlash={flash}
                onChanged={setAvatarUrl}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold tracking-tight">{displayName}</p>
                <p className="truncate text-[11px] font-medium text-slate-500">
                  {handle ? `@${handle}` : 'Vyroniq member'}
                </p>
                <p className="mt-1.5 text-[11px] font-medium text-slate-500">
                  Tap the camera to add a photo, or the bin to remove it.
                </p>
              </div>
            </div>

            <div className="mt-3">
              <HardwareIdentityCard identity={hardware} />
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 ${TAP} ${
                  active ? 'text-teal-600' : 'text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5" />
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
// Tab 1 — Home & Gate Pass
// =============================================================================

interface HomeTabProps {
  pass: PassMember | null;
  data: CompanionData | null;
  /** Decided once in the parent so the QR and the notice cannot disagree. */
  lock: PassLock | null;
  locked: boolean;
  qrToken: string | null;
  qrSeconds: number | null;
  insideNow: number;
  displayName: string;
  handle: string | null;
  /** Read-only gate credentials, shown under the QR (Modules 10 & 33). */
  hardware: HardwareIdentity | null;
  now: Date;
  onRefresh: () => Promise<void>;
}

function HomeTab({
  pass,
  data,
  lock,
  locked,
  qrToken,
  qrSeconds,
  insideNow,
  displayName,
  handle,
  hardware,
  now,
  onRefresh,
}: HomeTabProps) {
  // Phase 11: the gym's real weekly schedule (IST) instead of a hardcoded
  // 05:00-23:00 that was wrong for most gyms.
  const hours = gymOpenState(new Date(), data?.member?.operating_hours);
  const rush = rushLevel(insideNow);
  const countdown = expiryCountdown(pass?.membership_end ?? data?.member?.membership_end ?? null);
  const streak = data?.streak ?? EMPTY_STREAK;
  const flame = streakHeadline(streak);
  const announcements = data?.announcements.slice(0, 3) ?? [];

  return (
    <div className="space-y-4">
      {/* Greeting + streak */}
      <section className={`${CARD} p-5`}>
        <p className="text-xs font-medium text-slate-500">
          {greeting(now)}, {displayName.split(' ')[0]}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {handle && (
            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              @{handle}
            </span>
          )}
          <span className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${countdown.tone}`}>
            {countdown.label}
          </span>
        </div>

        <div className={`mt-4 flex items-center gap-3 rounded-2xl border px-4 py-3 ${flame.tone}`}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/70">
            <Flame className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-extrabold tracking-tight">
              {flame.headline} <span aria-hidden>🔥</span>
            </p>
            <p className="text-[11px] font-medium opacity-80">{flame.detail}</p>
          </div>
          {streak.best > 0 && (
            <div className="ml-auto text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Best</p>
              <p className="text-sm font-bold tabular-nums">{streak.best}</p>
            </div>
          )}
        </div>
      </section>

      {/* Gate pass */}
      <section className={`${CARD} p-5`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Gate Pass
            </p>
            <h2 className="truncate text-lg font-extrabold tracking-tight">{displayName}</h2>
            <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
              {pass?.tenant_name ?? 'Your gym'}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
              locked
                ? 'border-slate-200 bg-slate-100 text-slate-500'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {locked ? 'Pass Unavailable' : 'Active Member'}
          </span>
        </div>

        <div className="flex flex-col items-center">
          {locked ? (
            <div className={`w-full rounded-2xl border p-5 text-center ${lock?.tone ?? ''}`}>
              <Bell className="mx-auto mb-2 h-9 w-9 opacity-60" />
              <h3 className="text-sm font-extrabold tracking-tight">
                {lock?.title ?? 'Pass Unavailable'}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed opacity-90">
                {lock?.message ?? 'Ask the front desk to check your membership.'}
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <QRCodeSVG value={qrToken ?? ''} size={188} level="M" />
              </div>
              <p className="mt-3 text-[11px] font-semibold text-slate-500">
                Refreshes in{' '}
                <span className="tabular-nums text-teal-600">{qrSeconds ?? 0}s</span>
              </p>
            </>
          )}
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500">Gym timing</span>
            <span className="font-semibold tabular-nums text-slate-800">
            {hours.open ? 'Open now' : hours.hours}
          </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500">Right now</span>
            <span className={`font-semibold ${hours.open ? 'text-emerald-600' : 'text-amber-600'}`}>
              {hours.label}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500">Floor</span>
            <span className={`rounded-full border px-2 py-0.5 font-semibold ${rush.tone}`}>
              {rush.level} · {insideNow} in
            </span>
          </div>
        </div>

        {pass?.upi_id && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-600">
            Pay at the desk over UPI: <span className="font-semibold">{pass.upi_id}</span>
          </p>
        )}

        {/* The alternate way through the same door: the card key and the finger
            the gate knows. Read-only, and the same component the Health tab and
            the profile sheet use. */}
        {hardware && (hardware.rfid_linked || hardware.biometric_linked) && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-500">RFID Key</span>
              <span className="font-mono text-xs font-bold tracking-wider text-slate-800">
                {rfidDisplay(hardware)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-500">Biometric Slot</span>
              <span className="font-mono text-xs font-bold tracking-wider text-slate-800">
                {slotDisplay(hardware)}
              </span>
            </div>
            <p className="mt-2 text-[10px] font-medium leading-relaxed text-slate-400">
              {HARDWARE_IDENTITY_HINT}
            </p>
          </div>
        )}
      </section>

      {/* Gym notices */}
      <section className={`${CARD} p-5`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold tracking-tight">Gym Notices</h3>
          <button
            onClick={() => void onRefresh()}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600 ${TAP}`}
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {announcements.length === 0 ? (
          <p className="mt-2 text-xs font-medium text-slate-500">
            No notices from the gym today. Everything is running as usual.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {announcements.map((notice) => (
              <li
                key={notice.id}
                className={`rounded-xl border p-3 ${
                  notice.is_pinned
                    ? 'border-amber-200 bg-amber-50/70'
                    : 'border-slate-100 bg-slate-50/70'
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {notice.is_pinned && (
                    <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800">
                      <Pin className="h-2.5 w-2.5" /> Pinned
                    </span>
                  )}
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      NOTICE_TONES[notice.type] ?? NOTICE_TONES.general
                    }`}
                  >
                    {NOTICE_LABELS[notice.type] ?? 'Notice'}
                  </span>
                </div>

                <p className="mt-1.5 text-xs font-bold text-slate-800">{notice.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 whitespace-pre-wrap">
                  {notice.body || notice.message}
                </p>
                <p className="mt-1 text-[10px] font-medium text-slate-400">
                  {timeAgo(notice.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Community: the two screens that turn solo training into a gym-wide
          habit. Both are full pages, so this is the only entry point. */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/member/leaderboard" className={`${CARD} flex flex-col gap-2 p-4 ${TAP}`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <Trophy className="w-4 h-4" />
          </span>
          <span className="text-xs font-extrabold text-slate-800">Leaderboard</span>
          <span className="text-[10px] font-medium text-slate-500">
            Where you rank this month
          </span>
        </Link>

        <Link href="/member/challenges" className={`${CARD} flex flex-col gap-2 p-4 ${TAP}`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
            <Target className="w-4 h-4" />
          </span>
          <span className="text-xs font-extrabold text-slate-800">Challenges</span>
          <span className="text-[10px] font-medium text-slate-500">
            30-day goals with the gym
          </span>
        </Link>
      </div>
    </div>
  );
}

// =============================================================================
// Tab 2 — Health & Profile
// =============================================================================

/**
 * Extra slices the shell owns and hands down, so the header and this tab can
 * never show two different photos or two different badge counts.
 */
interface HealthExtras {
  avatarUrl: string | null;
  onAvatarChange: (url: string | null) => void;
  /** The member's gym, which is the first path segment of the photo. */
  tenantId: string | null;
  hardware: HardwareIdentity | null;
  badges: MemberBadge[];
  bestStreak: number;
  heaviestBenchKg: number;
  /** Opens the photo sheet (Edit Profile). */
  onOpenProfile: () => void;
  /** Opens Settings, where the @handle and security live. */
  onOpenSettings: () => void;
}

function HealthTab({
  data,
  onFlash,
  onSaved,
  avatarUrl,
  onAvatarChange,
  tenantId,
  hardware,
  badges,
  bestStreak,
  heaviestBenchKg,
  onOpenProfile,
  onOpenSettings,
}: TabProps & HealthExtras) {
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);

  const trend = weightTrend(data.weights);
  const spark = weightSparkPath(data.weights);
  const trainer = data.trainer;

  async function submitWeight(event: React.FormEvent) {
    event.preventDefault();
    if (!data.member) return;

    const value = Number(weight);
    if (!Number.isFinite(value) || value < 25 || value > 400) {
      onFlash('Enter a weight between 25 and 400 kg.', 'bad');
      return;
    }

    setSaving(true);
    const result = await logWeight(data.member.id, value);
    setSaving(false);

    if (!result.ok) {
      onFlash(result.error ?? 'Could not save that weigh-in.', 'bad');
      return;
    }

    setWeight('');
    onFlash('Weigh-in saved.', 'ok');
    await onSaved();
  }
  return (
    <div className="space-y-4">
      {/* Profile — identity only. The @handle EDITOR moved to Settings (Phase 11):
          a handle is an identifier with a 30-day cooldown, not something you
          retype on the front card every time you want a different one. */}
      <section className={`${CARD} p-5`}>
        <div className="flex items-start gap-4">
          <AvatarUploader
            memberId={data.member?.id ?? null}
            tenantId={tenantId}
            name={data.member?.full_name ?? 'Member'}
            avatarUrl={avatarUrl}
            onFlash={onFlash}
            onChanged={onAvatarChange}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              My Profile
            </p>
            {/* The display name the member chose wins; the gym's roster name is
                the fallback so the card can never render blank. */}
            <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight">
              {data.profile.display_name ?? data.member?.full_name ?? 'Member'}
            </h2>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                @{data.member?.username ?? 'handle'}
              </span>
              {/* Active Member pill — the spec's status signal, derived from the
                  same fields the pass card already uses. */}
              {!data.member?.is_frozen &&
              (data.member?.membership_end ?? '') >= new Date().toISOString().slice(0, 10) ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  Active Member
                </span>
              ) : (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  {data.member?.is_frozen ? 'Frozen' : 'Expired'}
                </span>
              )}
            </div>

            <p className="mt-1.5 text-[11px] font-medium text-slate-500">
              {data.member?.phone ?? 'No number on file'}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={onOpenProfile}
                className={`inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 ${TAP}`}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit Profile
              </button>
              <button
                onClick={onOpenSettings}
                className={`inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 ${TAP}`}
              >
                <Settings className="h-3.5 w-3.5" /> Settings
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Hardware credentials — read only, assigned by the gate (Modules 10 & 33) */}
      <HardwareIdentityCard identity={hardware} />

      {/* Badges: earned ones in colour, locked ones greyed with a progress ring */}
      <BadgeShowcase
        badges={badges}
        bestStreak={bestStreak}
        heaviestBenchKg={heaviestBenchKg}
      />

      {/* Assigned trainer */}
      {trainer ? (
        <section className={`${CARD} p-5`}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            My Trainer
          </p>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-50 text-teal-700">
              <Dumbbell className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{trainer.name}</p>
              <p className="truncate text-[11px] font-medium text-slate-500">
                {trainer.specialization ?? 'Strength & conditioning'}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <a
              href={`https://wa.me/91${trainer.phone.replace(/[^0-9]/g, '').slice(-10)}`}
              target="_blank"
              rel="noreferrer"
              className={`py-2.5 text-xs ${PRIMARY} ${TAP}`}
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
            <a
              href={`tel:${trainer.phone}`}
              className={`border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-700 ${TAP} inline-flex items-center justify-center gap-2 rounded-xl`}
            >
              <Phone className="h-3.5 w-3.5" /> Call
            </a>
          </div>
        </section>
      ) : (
        <section className={`${CARD} p-5 text-center`}>
          <p className="text-xs font-semibold text-slate-500">
            No trainer assigned yet. Ask the front desk to pair you with one.
          </p>
        </section>
      )}

      {/* Weight tracker */}
      <section className={`${CARD} p-5`}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          Weight Tracker
        </p>

        <div className="mt-3 flex items-end gap-3">
          <p className="text-3xl font-extrabold tabular-nums tracking-tight text-slate-900">
            {trend.latest !== null ? trend.latest.toFixed(1) : '—'}
            <span className="ml-1 text-base font-bold text-slate-400">kg</span>
          </p>
          {trend.delta !== null && trend.delta !== 0 && (
            <span
              className={`mb-1 inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${
                trend.direction === 'up'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {trend.direction === 'up' ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {trend.delta > 0 ? '+' : ''}
              {trend.delta.toFixed(1)} kg
              <span className="font-medium text-slate-500">since last</span>
            </span>
          )}
        </div>

        {/* Sparkline: a fixed polyline in a 100x36 box, drawn from the readings. */}
        {spark ? (
          <svg
            viewBox="0 0 100 36"
            preserveAspectRatio="none"
            className="mt-3 h-16 w-full"
            role="img"
            aria-label="Weight trend"
          >
            <path
              d={spark}
              fill="none"
              stroke="#0D9488"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <p className="mt-3 text-[11px] font-medium text-slate-500">
            Log your first weigh-in to start the trend.
          </p>
        )}

        <form onSubmit={submitWeight} className="mt-4 flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="25"
            max="400"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            placeholder="Today's weight (kg)"
            className={INPUT}
          />
          <button
            type="submit"
            disabled={saving}
            className={`shrink-0 px-4 py-2.5 text-xs ${PRIMARY} ${TAP}`}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </button>
        </form>

        {data.weights.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {data.weights.slice(0, 6).map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
              >
                <span className="font-bold tabular-nums text-slate-800">
                  {entry.weight_kg.toFixed(1)} kg
                </span>
                <span className="font-medium text-slate-500">{timeAgo(entry.logged_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// =============================================================================
// Tab 3 — Training & Workout
// =============================================================================

/** Rest timer lengths, in seconds. Two options only: the point is to start one
 *  between sets without thinking about it. */
const REST_PRESETS = [60, 90] as const;

function TrainingTab({ data, onFlash, onSaved }: TabProps) {
  const [split, setSplit] = useState<WorkoutSplit>('Push');
  const [exercise, setExercise] = useState('');
  const [reps, setReps] = useState('');
  const [load, setLoad] = useState('');
  const [sets, setSets] = useState('1');
  const [saving, setSaving] = useState(false);

  /**
   * Rest timer, modelled as a deadline plus a clock rather than a stored
   * countdown, so no component writes "seconds remaining" back into state on
   * every tick. The displayed value is derived and drops to null once the
   * deadline passes.
   */
  const [restUntil, setRestUntil] = useState(0);
  const resting = restUntil > 0;
  const restNow = useClock(resting, 250);

  const restLeft = !resting
    ? null
    : restNow >= restUntil
      ? null
      : Math.max(1, Math.ceil((restUntil - restNow) / 1000));

  const previous = lastPerformance(data.workouts, split, exercise);
  const suggestions = SPLIT_SUGGESTIONS[split];
  const volume = splitVolume(data.workouts, split);
  const recent = data.workouts.slice(0, 8);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!data.member) return;

    const repsValue = Number(reps);
    const loadValue = load.trim() === '' ? 0 : Number(load);
    const setsValue = Number(sets) || 1;

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
      sets: setsValue,
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
        <h3 className="mb-2 text-xs font-bold text-slate-600">Today&apos;s routine</h3>
        <div className="flex flex-wrap gap-2">
          {WORKOUT_SPLITS.map((option) => {
            const active = split === option;
            return (
              <button
                key={option}
                onClick={() => setSplit(option)}
                className={`rounded-xl border px-3.5 py-2 text-xs font-bold ${TAP} ${
                  active
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </section>

      {/* Volume headline + running rest clock */}
      <div className={`${CARD} flex items-center justify-between p-4`}>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {split} volume
          </p>
          <p className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight text-slate-900">
            {volume.toLocaleString('en-IN')}
            <span className="ml-1 text-xs font-bold text-slate-400">kg</span>
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">
            Sets logged in the last two weeks
          </p>
        </div>
        {restLeft !== null ? (
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rest</p>
            <p className="mt-0.5 text-2xl font-extrabold tabular-nums text-amber-600">{restLeft}</p>
            <p className="text-[10px] font-medium text-slate-400">seconds</p>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Rest timer
            </p>
            <div className="mt-1 flex gap-1.5">
              {REST_PRESETS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => setRestUntil(Date.now() + seconds * 1000)}
                  className={`rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ${TAP}`}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Set logger */}
      <form onSubmit={submit} className={`${CARD} space-y-3 p-5`}>
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Exercise
          </label>
          <input
            value={exercise}
            onChange={(event) => setExercise(event.target.value)}
            placeholder="Bench Press"
            maxLength={80}
            className={INPUT}
          />
          {/* "Last time" is the single most useful thing on a logging screen. */}
          {previous && (
            <p className="mt-1.5 text-[11px] font-medium text-slate-500">
              Last time: {previous.weight_used > 0 ? `${previous.weight_used} kg · ` : ''}
              {previous.reps} reps · {timeAgo(previous.logged_at)}
            </p>
          )}
          {!previous && suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.slice(0, 4).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setExercise(name)}
                  className={`rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 ${TAP}`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Sets
            </label>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="20"
              value={sets}
              onChange={(event) => setSets(event.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
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
              className={INPUT}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
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
              className={INPUT}
            />
          </div>
        </div>

        <button type="submit" disabled={saving} className={`w-full py-3 text-sm ${PRIMARY} ${TAP}`}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Log Set
        </button>
      </form>

      {/* Recent sets */}
      <section className={`${CARD} p-5`}>
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-teal-600" />
          <h3 className="text-sm font-bold tracking-tight">Recent Sets</h3>
        </div>
        {recent.length === 0 ? (
          <p className="mt-2 text-xs font-medium text-slate-500">
            Nothing logged yet. Your first set starts the history.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"
              >
                <span className="min-w-0 truncate font-semibold text-slate-800">
                  {entry.exercise_name}
                </span>
                <span className="shrink-0 font-medium tabular-nums text-slate-500">
                  {entry.sets}×{entry.reps}
                  {entry.weight_used > 0 ? ` · ${entry.weight_used} kg` : ' · bodyweight'}
                </span>
                <span className="shrink-0 text-[10px] text-slate-400">
                  {timeAgo(entry.logged_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * A product thumbnail: the uploaded photo, or the category icon.
 *
 * The fallback is not only for products with no photo. A public bucket URL can
 * still 404 — the gym deleted the file, renamed it, or the till uploaded to a
 * path that was later overwritten — and a broken image icon in a store list
 * reads as "the gym's photos are broken". Swapping to the icon on `onError`
 * degrades quietly instead.
 *
 * `key` is derived from the URL so React remounts the <img> when the photo
 * changes; without it a re-render reuses the previous (already errored) node and
 * the fallback never comes back.
 */
function ProductThumb({ item, Icon }: { item: StoreItem; Icon: typeof Package }) {
  const [failed, setFailed] = useState(false);
  const url = item.image_url ?? null;

  /**
   * Clear the error when the URL changes — via the render-time adjustment
   * pattern rather than an effect. An effect would run AFTER the render that
   * still had the stale `failed=true`, so React would paint the fallback for a
   * frame and then correct itself.
   */
  const [syncedFrom, setSyncedFrom] = useState<string | null>(url);
  if (url !== syncedFrom) {
    setSyncedFrom(url);
    setFailed(false);
  }

  if (!url || failed) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Icon className="h-6 w-6" />
      </div>
    );
  }

  return (
    <img
      key={url}
      src={url}
      alt={item.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-14 w-14 shrink-0 rounded-2xl object-cover ring-1 ring-slate-200"
    />
  );
}

// =============================================================================
// Tab 4 — Store & Supplements
// =============================================================================

function StoreTab({ data, onFlash, onSaved }: TabProps) {
  const tenantId = data.tenant_id;
  const [items, setItems] = useState<StoreItem[]>([]);
  const [category, setCategory] = useState<string>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadItems = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    // image_url MUST be in the column list. PostgREST does not return columns
    // that were not asked for, so omitting it here is why every product rendered
    // as the generic cube icon even after the till uploaded a photo.
    const { data: rows } = await supabase
      .from('products')
      .select('id, name, category, selling_price, stock_quantity, image_url')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .limit(200);

    setItems((rows ?? []) as unknown as StoreItem[]);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadItems();
  }, [loadItems]);

  const categories = useMemo(() => {
    const seen = new Set(items.map((item) => item.category));
    return ['all', ...Array.from(seen)];
  }, [items]);

  const visible = category === 'all' ? items : items.filter((item) => item.category === category);

  async function reserve(item: StoreItem) {
    if (!data.member) return;

    setBusyId(item.id);
    const result = await reserveProduct(data.member.id, item.id, 1);
    setBusyId(null);

    if (!result.ok) {
      onFlash(result.error ?? 'Could not reserve that item.', 'bad');
      return;
    }

    onFlash(
      result.merged
        ? `${item.name}: quantity added to your existing pickup.`
        : `${item.name} reserved. Collect it at the front desk.`,
      'ok'
    );
    await onSaved();
  }

  async function cancel(id: string, name: string) {
    if (!data.member) return;

    setBusyId(id);
    const result = await cancelReservation(data.member.id, id);
    setBusyId(null);

    if (!result.ok) {
      onFlash(result.error ?? 'Could not cancel that reservation.', 'bad');
      return;
    }

    onFlash(`Reservation for ${name} cancelled.`, 'ok');
    await onSaved();
  }

  const pending = data.reservations.filter((entry) => entry.status === 'pending');
  const history = data.reservations.filter((entry) => entry.status !== 'pending');

  return (
    <div className="space-y-4">
      {/* Active pickups */}
      <section className={`${CARD} p-5`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold tracking-tight">My Desk Pickups</h3>
          {pending.length > 0 && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              {pending.length} waiting
            </span>
          )}
        </div>

        {data.reservations.length === 0 ? (
          <p className="mt-2 text-xs font-medium text-slate-500">
            Nothing reserved yet. Reserve a supplement below and collect it at the counter.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {[...pending, ...history].slice(0, 6).map((entry) => {
              const meta = RESERVATION_LABEL[entry.status] ?? RESERVATION_LABEL.pending;
              return (
                <li key={entry.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-800">
                        {entry.product_name}
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                        Qty {entry.quantity} · reserved {timeAgo(entry.created_at)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.tone}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] font-medium text-slate-500">{meta.hint}</p>
                  {entry.status === 'pending' && (
                    <button
                      onClick={() => void cancel(entry.id, entry.product_name)}
                      disabled={busyId === entry.id}
                      className={`mt-2 text-[11px] font-semibold text-rose-600 ${TAP}`}
                    >
                      {busyId === entry.id ? 'Cancelling…' : 'Cancel reservation'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Category filter */}
      <section>
        <h3 className="mb-2 text-xs font-bold text-slate-600">Shop</h3>
        <div className="flex flex-wrap gap-2">
          {categories.map((option) => {
            const active = category === option;
            const meta = CATEGORY_META[option];
            return (
              <button
                key={option}
                onClick={() => setCategory(option)}
                className={`rounded-xl border px-3 py-1.5 text-[11px] font-bold ${TAP} ${
                  active
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {option === 'all' ? 'All' : meta?.label ?? option}
              </button>
            );
          })}
        </div>
      </section>

      {/* Catalogue */}
      {loading ? (
        <p className={`${CARD} p-5 text-center text-xs font-medium text-slate-500`}>
          Loading the store…
        </p>
      ) : visible.length === 0 ? (
        <p className={`${CARD} p-5 text-center text-xs font-medium text-slate-500`}>
          No products in this category yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((item) => {
            const meta = CATEGORY_META[item.category];
            const Icon = meta?.icon ?? Package;
            const soldOut = item.stock_quantity <= 0;
            const low = !soldOut && item.stock_quantity <= 5;

            return (
              <li key={item.id} className={`${CARD} flex items-center gap-3 p-4`}>
                <ProductThumb item={item} Icon={Icon} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900">{item.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-700">
                      ₹{Number(item.selling_price).toLocaleString('en-IN')}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        soldOut
                          ? 'border-slate-200 bg-slate-100 text-slate-500'
                          : low
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {soldOut
                        ? 'Out of Stock'
                        : low
                          ? `Only ${item.stock_quantity} left`
                          : 'In Stock'}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => void reserve(item)}
                  disabled={soldOut || busyId === item.id}
                  className={`shrink-0 px-3 py-2 text-[11px] ${PRIMARY} ${TAP}`}
                >
                  {busyId === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  Reserve
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="px-1 text-center text-[11px] font-medium text-slate-400">
        Reservations are held at the front desk. Payment happens when you collect.
      </p>
    </div>
  );
}












