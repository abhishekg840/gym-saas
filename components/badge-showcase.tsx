'use client';

import { Award, Lock } from 'lucide-react';
import { BADGE_CATALOG, badgeProgress, type MemberBadge } from '@/lib/gamification';

/**
 * The achievements shelf (Modules 11 & 28).
 *
 * Earned badges are colourful and stamped with the date; locked ones are the
 * SAME tiles, greyed out and carrying a progress ring plus the exact number
 * still needed. Showing a member the three trophies they could be chasing is a
 * stronger retention lever than hiding the ones they have not won yet.
 */

const CARD = 'bg-white rounded-2xl border border-slate-200 shadow-sm';

interface BadgeShowcaseProps {
  badges: MemberBadge[];
  bestStreak: number;
  heaviestBenchKg: number;
  loading?: boolean;
}

function earnedOn(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function BadgeShowcase({
  badges,
  bestStreak,
  heaviestBenchKg,
  loading,
}: BadgeShowcaseProps) {
  const earnedKeys = new Set(badges.map((badge) => badge.badge_key));
  const earnedAt = new Map(badges.map((badge) => [badge.badge_key, badge.awarded_at]));
  const won = badges.length;

  return (
    <section className={`${CARD} p-5`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Achievements
          </p>
          <h2 className="mt-0.5 text-sm font-extrabold tracking-tight">
            {loading ? 'Badges' : `${won} of ${Object.keys(BADGE_CATALOG).length} unlocked`}
          </h2>
        </div>
        <Award className="h-5 w-5 text-amber-500" />
      </div>

      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {Object.values(BADGE_CATALOG).map((badge) => {
          const progress = badgeProgress(badge.key, earnedKeys, {
            bestStreak,
            heaviestBenchKg,
          });
          const date = earnedOn(earnedAt.get(badge.key));

          return (
            <li
              key={badge.key}
              className={`relative overflow-hidden rounded-2xl border p-3 transition ${
                progress.earned
                  ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              {progress.earned ? (
                <>
                  <span
                    aria-hidden
                    className="absolute -right-3 -top-3 h-14 w-14 rounded-full bg-amber-200/40"
                  />
                  <span className="relative text-2xl" aria-hidden>
                    {badge.emoji}
                  </span>
                  <p className="relative mt-1 text-xs font-extrabold leading-tight text-slate-800">
                    {badge.name}
                  </p>
                  <p className="relative mt-1 text-[10px] font-semibold text-emerald-600">
                    {date ? `Unlocked ${date}` : 'Unlocked'}
                  </p>
                </>
              ) : (
                <>
                  {/* The ring is the progress bar, so a locked badge still tells
                      the member how far away the next one is. */}
                  <div
                    className="relative flex h-12 w-12 items-center justify-center rounded-full"
                    style={{
                      background: `conic-gradient(#94a3b8 ${progress.percent * 3.6}deg, #e2e8f0 0deg)`,
                    }}
                    role="img"
                    aria-label={`${progress.percent}% complete`}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-50">
                      <span className="text-lg grayscale" aria-hidden>
                        {badge.emoji}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-xs font-extrabold leading-tight text-slate-500">
                    <Lock className="h-3 w-3 shrink-0" />
                    {badge.name}
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
                    {progress.detail}
                  </p>
                </>
              )}

              <p className="mt-1.5 text-[10px] font-medium leading-relaxed text-slate-500">
                {badge.description}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] font-medium text-slate-500">
        Badges are awarded automatically at the gate and in the training log — there
        is nothing to claim.
      </p>
    </section>
  );
}
