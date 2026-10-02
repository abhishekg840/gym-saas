'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Flame, Loader2, Scale, Trophy, Users } from 'lucide-react';
import { isUuid, readSession } from '@/lib/session';
import {
  challengeUnit,
  joinChallenge,
  loadChallengeBoard,
  loadChallenges,
  progressPercent,
  type Challenge,
  type ChallengeBoardRow,
} from '@/lib/gamification';

/**
 * /member/challenges — the member side of the challenge engine (Module 29).
 *
 * Reads fn_challenge_list (already scoped to the signed-in member, so "joined",
 * "my progress" and "my rank" arrive with the list) and joins through
 * fn_challenge_join, which re-checks the window server-side. The board is only
 * fetched for a challenge the member has joined — an empty leaderboard is a
 * wasted round trip.
 */

const CARD = 'bg-white rounded-2xl border border-slate-200 shadow-sm';
const PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-4 py-2.5 text-xs font-semibold text-white transition disabled:opacity-60';
const TAP = 'transition-all duration-150 active:scale-[0.97]';

/**
 * The icon for a challenge kind, chosen by a branch rather than returned as a
 * component reference: React must be able to see a STATIC element here, or it
 * treats the freshly-created component type as a new type every render and
 * throws the subtree away.
 */
function KindIcon({ kind }: { kind: Challenge['kind'] }) {
  return kind === 'weight_loss' ? (
    <Scale className="h-5 w-5" />
  ) : (
    <Flame className="h-5 w-5" />
  );
}

/** The animated bar. Width is driven by the real percent, capped at 100. */
function ProgressBar({ percent, kind }: { percent: number; kind: Challenge['kind'] }) {
  const bar = kind === 'weight_loss' ? 'bg-orange-500' : 'bg-teal-500';
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${bar} transition-[width] duration-700 ease-out`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function dayCount(startDate: string, endDate: string): number {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000) + 1);
}

function ChallengeCard({
  challenge,
  onJoined,
  onOpenBoard,
  busyId,
}: {
  challenge: Challenge;
  onJoined: (challenge: Challenge) => Promise<void>;
  onOpenBoard: (challenge: Challenge) => void;
  busyId: string | null;
}) {
  const busy = busyId === challenge.id;
  const joined = challenge.joined;
  const progress = Number(challenge.my_progress ?? 0);
  const target = Number(challenge.target_value ?? 0);
  const percent = joined ? progressPercent(progress, target) : 0;
  const done = joined && progress >= target;

  return (
    <section className={`${CARD} p-5`}>
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
            challenge.kind === 'weight_loss' ? 'bg-orange-100 text-orange-600' : 'bg-teal-100 text-teal-700'
          }`}
        >
          <KindIcon kind={challenge.kind} />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-extrabold leading-tight tracking-tight text-slate-900">
            {challenge.title}
          </h2>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">
            {challenge.start_date} → {challenge.end_date} ·{' '}
            {dayCount(challenge.start_date, challenge.end_date)} days
          </p>
        </div>

        {joined && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
              done
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {done ? '🏆 Done' : 'Joined'}
          </span>
        )}
      </div>

      {challenge.description && (
        <p className="mt-2.5 text-xs leading-relaxed text-slate-600">{challenge.description}</p>
      )}

      <div className="mt-3 flex items-center gap-3 text-[11px] font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Trophy className="h-3.5 w-3.5 text-amber-500" />
          Target: {challenge.target_value} {challengeUnit(challenge.kind)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5 text-slate-400" />
          {challenge.participants} joined
        </span>
      </div>

      {joined ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold text-slate-600">
              {progress} / {challenge.target_value} {challengeUnit(challenge.kind)}
            </span>
            <span className="font-extrabold tabular-nums text-slate-800">{percent}%</span>
          </div>
          <ProgressBar percent={percent} kind={challenge.kind} />

          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-[11px] font-bold text-slate-700">
              {challenge.my_rank ? `Rank #${challenge.my_rank} of ${challenge.participants}` : 'Unranked so far'}
            </p>
            <button
              onClick={() => onOpenBoard(challenge)}
              className={`${PRIMARY} px-3 py-1.5 ${TAP}`}
            >
              View board
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => void onJoined(challenge)}
          disabled={busy}
          className={`${PRIMARY} mt-3.5 w-full ${TAP}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Join Challenge
        </button>
      )}
    </section>
  );
}

export default function MemberChallengesPage() {
  const router = useRouter();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * One state write for both ids: readSession() only answers after hydration,
   * and batching keeps the effect from cascading an extra render — the same
   * shape the member dashboard uses.
   */
  const [identity, setIdentity] = useState<{ memberId: string | null; tenantId: string | null }>({
    memberId: null,
    tenantId: null,
  });
  const { memberId, tenantId } = identity;

  /** The challenge whose full board is open. null = no board. */
  const [boardFor, setBoardFor] = useState<Challenge | null>(null);
  const [board, setBoard] = useState<ChallengeBoardRow[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);

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

  const reload = useCallback(async (tenant: string, viewer: string | null) => {
    const result = await loadChallenges({ tenantId: tenant, memberId: viewer });

    if (!result.ok) {
      setChallenges([]);
      setError(result.error ?? 'Could not load challenges.');
    } else {
      setError(null);
      setChallenges(result.challenges);
    }

    // Cleared last, so the spinner covers the whole round trip.
    setLoading(false);
  }, []);

  // No setLoading(true) here on purpose: `loading` starts true, and reloading
  // after a join already has the card's own busy spinner to show.
  //
  // reload() is async, so every setState it makes lands after the render has
  // committed; the rule cannot see that through the call boundary.
  useEffect(() => {
    if (!tenantId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload(tenantId, memberId);
  }, [reload, tenantId, memberId]);

  async function handleJoin(challenge: Challenge) {
    if (!memberId || !tenantId) return;

    setBusyId(challenge.id);
    const result = await joinChallenge({ challengeId: challenge.id, memberId });
    setBusyId(null);

    if (!result.ok) {
      setError(result.error ?? 'Could not join that challenge.');
      return;
    }
    // A duplicate join is not a failure — say so plainly and re-read the list so
    // the card flips to the joined state instead of looking broken.
    if (result.alreadyJoined) setError('You had already joined that challenge.');
    else setError(null);

    await reload(tenantId, memberId);
  }

  async function openBoard(challenge: Challenge) {
    setBoardFor(challenge);
    setBoardLoading(true);
    setBoard([]);
    const result = await loadChallengeBoard(challenge.id);
    setBoardLoading(false);
    if (!result.ok) setError(result.error ?? 'Could not load the leaderboard.');
  }

  const live = challenges.filter((challenge) => challenge.is_active);
  const finished = challenges.filter((challenge) => !challenge.is_active);

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
              Gym Challenges
            </p>
            <h1 className="text-base font-extrabold tracking-tight">Train together, win together</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {error && (
          <p
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800"
          >
            {error}
          </p>
        )}

        {loading ? (
          <div className={`${CARD} flex items-center justify-center gap-2 p-10 text-sm font-medium text-slate-500`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading challenges…
          </div>
        ) : challenges.length === 0 ? (
          <div className={`${CARD} p-8 text-center`}>
            <Trophy className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">No challenges running</p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              Your gym has not launched one yet. Check back soon.
            </p>
          </div>
        ) : (
          <>
            {live.map((challenge) => (
              <ChallengeCard
                key={challenge.id}
                challenge={challenge}
                onJoined={handleJoin}
                onOpenBoard={(target) => void openBoard(target)}
                busyId={busyId}
              />
            ))}

            {finished.length > 0 && (
              <div className="pt-2">
                <h2 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  Recently finished
                </h2>
                <div className="space-y-4">
                  {finished.map((challenge) => (
                    <ChallengeCard
                      key={challenge.id}
                      challenge={challenge}
                      onJoined={handleJoin}
                      onOpenBoard={(target) => void openBoard(target)}
                      busyId={busyId}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <Link
          href="/member/leaderboard"
          className={`block ${CARD} flex items-center justify-between px-4 py-3.5 ${TAP}`}
        >
          <span className="text-sm font-bold text-slate-800">Monthly Leaderboard</span>
          <span className="text-xs font-semibold text-teal-600">See the board →</span>
        </Link>
      </main>

      {/* The board. fn_challenge_board returns the ranked list plus the challenge
          itself, so the modal is fully self-describing. */}
      {boardFor && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${boardFor.title} leaderboard`}
          onClick={() => setBoardFor(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-slate-50 sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  Leaderboard
                </p>
                <h2 className="truncate text-sm font-extrabold tracking-tight">{boardFor.title}</h2>
              </div>
              <button
                onClick={() => setBoardFor(null)}
                aria-label="Close leaderboard"
                className={`rounded-xl border border-slate-200 bg-white p-2 text-slate-500 ${TAP}`}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              {boardLoading ? (
                <div className="flex items-center justify-center gap-2 p-10 text-sm font-medium text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading the board…
                </div>
              ) : board.length === 0 ? (
                <p className="py-8 text-center text-xs font-medium text-slate-500">
                  Nobody is on the board yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {board.map((row) => {
                    const you = row.member_id === memberId;
                    const percent = progressPercent(Number(row.progress), Number(row.target));
                    return (
                      <li
                        key={row.member_id}
                        className={`rounded-2xl border p-3 ${
                          you ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                              you ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {row.rank}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-800">
                              {row.name}
                              {you && <span className="text-teal-600"> (You)</span>}
                            </p>
                            <p className="text-[11px] font-medium text-slate-500">
                              {row.progress} / {row.target}{' '}
                              {challengeUnit(boardFor.kind)}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-extrabold tabular-nums text-slate-700">
                            {percent}%
                          </span>
                        </div>
                        <div className="mt-2">
                          <ProgressBar percent={percent} kind={boardFor.kind} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
