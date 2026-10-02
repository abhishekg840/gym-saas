'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Dumbbell, Flame, Loader2, Medal, Trophy, TrendingUp } from 'lucide-react';
import { isUuid, readSession } from '@/lib/session';
import {
  LEADERBOARD_MODES,
  loadLeaderboard,
  type LeaderboardMode,
  type LeaderboardRow,
} from '@/lib/gamification';

/**
 * /member/leaderboard — the gym's monthly board (Modules 11 & 28).
 *
 * Everything here comes from fn_monthly_leaderboard, which ranks the CURRENT
 * calendar month (IST) in one of three ways. The member's own row is appended by
 * that function even when they are outside the top ten, so "where am I?" never
 * needs a second query — the same principle the rest of Phase 9 used.
 */

const CARD = 'bg-white rounded-2xl border border-slate-200 shadow-sm';
const TAP = 'transition-all duration-150 active:scale-[0.97]';

/** Silver / gold / bronze — the order the podium renders them in. */
const PODIUM = [
  { rank: 2, ring: 'border-amber-300 bg-amber-50', text: 'text-amber-700', height: 'h-16' },
  { rank: 1, ring: 'border-amber-400 bg-amber-100', text: 'text-amber-800', height: 'h-24' },
  { rank: 3, ring: 'border-orange-300 bg-orange-50', text: 'text-orange-700', height: 'h-12' },
] as const;

function modeIcon(mode: LeaderboardMode) {
  if (mode === 'volume') return TrendingUp;
  if (mode === 'streak') return Flame;
  return Dumbbell;
}

function formatValue(mode: LeaderboardMode, value: number): string {
  const rounded = Math.round(value);
  if (mode === 'volume') {
    return rounded >= 1000 ? `${(value / 1000).toFixed(1)}k kg` : `${rounded} kg`;
  }
  if (mode === 'streak') return `${rounded} ${rounded === 1 ? 'day' : 'days'}`;
  return `${rounded} check-ins`;
}

function Avatar({ name, you }: { name: string; you: boolean }) {
  const letter = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
        you ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {letter}
    </span>
  );
}

export default function LeaderboardPage() {
  const router = useRouter();
  /**
   * One state write, not two: readSession() reads localStorage, so it can only
   * answer after hydration, and batching the ids into a single object keeps the
   * effect from cascading an extra render. This is the same shape the member
   * dashboard and /leads use for the same reason.
   */
  const [identity, setIdentity] = useState<{ memberId: string | null; tenantId: string | null }>({
    memberId: null,
    tenantId: null,
  });
  const { memberId, tenantId } = identity;

  const [mode, setMode] = useState<LeaderboardMode>('checkins');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = readSession();
    if (!session || session.role !== 'member') {
      router.replace('/login');
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdentity({
      memberId: isUuid(session.userId) ? session.userId : null,
      tenantId: isUuid(session.tenantId) ? session.tenantId : null,
    });
  }, [router]);

  const load = useCallback(
    async (nextMode: LeaderboardMode, tenant: string, viewer: string | null) => {
      const result = await loadLeaderboard({
        tenantId: tenant,
        mode: nextMode,
        viewerId: viewer,
        limit: 10,
      });

      if (!result.ok) {
        setRows([]);
        setError(result.error ?? 'Could not load the leaderboard.');
      } else {
        setError(null);
        setRows(result.rows);
      }

      // Cleared last so the spinner stays up for the whole round trip.
      setLoading(false);
    },
    []
  );

  // No setLoading(true) here on purpose: `loading` starts true, and switching
  // mode sets it in the click handler below. Calling it from the effect body
  // would be a synchronous setState in a render pass, which cascades a render
  // before there is anything new to show.
  //
  // The disable is the same one the member dashboard uses for its mount fetch:
  // load() is async, so its setState calls all land after the render commits.
  // The rule cannot see that through the call boundary.
  useEffect(() => {
    if (!tenantId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(mode, tenantId, memberId);
  }, [load, mode, tenantId, memberId]);

  const active = LEADERBOARD_MODES.find((entry) => entry.id === mode) ?? LEADERBOARD_MODES[0];
  const top = rows.filter((row) => !row.is_you && row.rank <= 3);
  const rest = rows.filter((row) => !row.is_you && row.rank > 3);
  const you = rows.find((row) => row.is_you) ?? null;

  // Silver / gold / bronze, so the winner sits in the middle of the podium.
  const podium = [
    top.find((row) => row.rank === 2),
    top.find((row) => row.rank === 1),
    top.find((row) => row.rank === 3),
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-10 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link
            href="/member/dashboard"
            className={`rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:text-slate-900 ${TAP}`}
            aria-label="Back to the member app"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              This Month
            </p>
            <h1 className="text-base font-extrabold tracking-tight">Gym Leaderboard</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          {LEADERBOARD_MODES.map((entry) => {
            const Icon = modeIcon(entry.id);
            const selected = entry.id === mode;
            return (
              <button
                key={entry.id}
                onClick={() => {
                  // The spinner is raised here rather than inside the effect
                  // that fetches, so the render pass never calls setState
                  // synchronously while it is already committing.
                  setLoading(true);
                  setMode(entry.id);
                }}
                aria-pressed={selected}
                className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-[10px] font-bold transition ${TAP} ${
                  selected
                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="text-center leading-tight">{entry.label}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-800">
            {error}
          </p>
        )}

        {loading ? (
          <div className={`${CARD} flex items-center justify-center gap-2 p-10 text-sm font-medium text-slate-500`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the board…
          </div>
        ) : rows.length === 0 ? (
          <div className={`${CARD} p-8 text-center`}>
            <Trophy className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">Nobody has scored yet</p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              Check in at the gate this month to be the first on the board.
            </p>
          </div>
        ) : (
          <>
            {top.length > 0 && (
              <section className={`${CARD} p-5`}>
                <h2 className="mb-4 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  Top of the gym
                </h2>
                <div className="flex items-end justify-center gap-2">
                  {podium.map((row, index) => {
                    const style = PODIUM[index];
                    if (!row) return <div key={style.rank} className="w-1/3" />;
                    return (
                      <div key={row.member_id} className="flex w-1/3 flex-col items-center">
                        <Avatar name={row.name} you={row.is_you} />
                        <p className="mt-1.5 w-full truncate text-center text-[11px] font-bold text-slate-800">
                          {row.name.split(' ')[0]}
                        </p>
                        <p className={`text-[10px] font-bold ${style.text}`}>
                          {formatValue(mode, row.value)}
                        </p>
                        <div
                          className={`mt-1.5 flex w-full items-start justify-center rounded-t-xl border-2 border-b-0 ${style.ring} ${style.height}`}
                        >
                          <Medal className={`mt-2 h-4 w-4 ${style.text}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {rest.length > 0 && (
              <section className={`${CARD} overflow-hidden`}>
                <ul className="divide-y divide-slate-100">
                  {rest.map((row) => (
                    <li key={row.member_id} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-6 shrink-0 text-center text-sm font-extrabold tabular-nums text-slate-400">
                        {row.rank}
                      </span>
                      <Avatar name={row.name} you={row.is_you} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-800">{row.name}</p>
                        {row.username && (
                          <p className="truncate text-[11px] font-medium text-slate-500">
                            @{row.username}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs font-bold tabular-nums text-slate-700">
                        {formatValue(mode, row.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* The viewer's own row, present even when they are outside the top 10. */}
            {you && (
              <section className="rounded-2xl border border-teal-500 bg-teal-50 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-teal-600">
                  Your position
                </p>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-extrabold text-white">
                    {you.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-900">
                      {you.name} <span className="text-teal-600">(It&apos;s You)</span>
                    </p>
                    <p className="text-[11px] font-medium text-teal-700">
                      Ranked by {active.label.toLowerCase()} this month
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-extrabold tabular-nums text-teal-800">
                    {formatValue(mode, you.value)}
                  </span>
                </div>
              </section>
            )}
          </>
        )}

        <Link
          href="/member/challenges"
          className={`block ${CARD} flex items-center justify-between px-4 py-3.5 ${TAP}`}
        >
          <span className="text-sm font-bold text-slate-800">Gym Challenges</span>
          <span className="text-xs font-semibold text-teal-600">Join one →</span>
        </Link>
      </main>
    </div>
  );
}
