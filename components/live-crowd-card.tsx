'use client';

import { Users, AlertTriangle, RefreshCw } from 'lucide-react';
import { CROWD_TONE, useLiveCrowd, type CrowdMember } from '@/lib/live-crowd';

/**
 * "Currently Inside" (Phase 12).
 *
 * ONE component, two shapes, because the same number is wanted twice and the two
 * presentations have genuinely different jobs:
 *
 *   variant="card"    the owner's stat tile — big number, plus the "who's in"
 *                     roster underneath, because when the count looks wrong the
 *                     owner's first question is always "who exactly?".
 *
 *   variant="badge"   the member app's quiet header badge. Members care whether
 *                     the gym is pleasant to visit right now, so it shows a
 *                     sentiment label (Quiet / Moderate / Busy) rather than a
 *                     raw headcount.
 *
 * The occupancy rule itself lives in fn_gym_live_crowd: latest granted punch per
 * member is 'in' and within 3 hours. See lib/live-crowd.ts for why "latest row
 * per member" is required rather than a plain count of today's check-ins.
 */

interface LiveCrowdCardProps {
  tenantId: string | null;
  variant?: 'card' | 'badge';
  /** Hide the roster strip on the badge variant (there is no room for it). */
  showRoster?: boolean;
}

function relativeAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

export default function LiveCrowdCard({
  tenantId,
  variant = 'card',
  showRoster = variant === 'card',
}: LiveCrowdCardProps) {
  const { inside, members, label, loading, error, refresh } = useLiveCrowd(tenantId);

  // ---------------------------------------------------------------- badge ---
  if (variant === 'badge') {
    if (error) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          Gym crowd: unavailable
        </span>
      );
    }

    return (
      <button
        type="button"
        onClick={() => void refresh()}
        title="Tap to refresh live gym occupancy"
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95 ${CROWD_TONE[label]}`}
      >
        <Users className="h-3 w-3" />
        Gym Crowd: {inside} {label === 'Busy' ? 'Busy' : 'Inside'}
        <span className="opacity-70">· {label}</span>
        {loading && <RefreshCw className="h-2.5 w-2.5 animate-spin" />}
      </button>
    );
  }

  // ----------------------------------------------------------------- card ---
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <Users className="h-3.5 w-3.5" />
            Currently Inside
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold tabular-nums tracking-tight text-slate-900">
              {inside}
            </span>
            <span className="text-sm font-medium text-slate-500">
              {inside === 1 ? 'member' : 'members'}
            </span>
          </div>
          <span
            className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${CROWD_TONE[label]}`}
          >
            {label}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh live occupancy"
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
          {error}
        </p>
      )}

      {!error && (
        <p className="mt-3 text-[11px] text-slate-400">
          Anyone whose last entry is more than 3 hours old is counted out automatically.
        </p>
      )}

      {showRoster && members.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Inside now
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {members.map((member: CrowdMember, index: number) => (
              <li
                // A member can legitimately appear once, but two identical names
                // exist in any real roster, so the index keeps the key stable.
                key={`${member.phone}-${member.at}-${index}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700"
              >
                {member.full_name}
                <span className="text-slate-400">{relativeAge(member.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}