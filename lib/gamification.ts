import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';

/**
 * Gamification client (Module 7): streaks, badges, the monthly leaderboard and
 * 30-day challenges.
 *
 * Every read goes through a SECURITY DEFINER RPC from migration 0009 —
 * `member_streaks`, `member_badges` and `challenge_participants` are revoked
 * from PostgREST, so a direct `.from()` would come back empty for everyone.
 * The RPCs never throw: a validation failure arrives as `{ ok: false, error }`
 * already written for a phone screen.
 */

// -----------------------------------------------------------------------------
// Badges
// -----------------------------------------------------------------------------

export interface BadgeMeta {
  key: string;
  emoji: string;
  name: string;
  description: string;
}

/** The display catalogue. Adding a badge is a frontend change, not a migration. */
export const BADGE_CATALOG: Record<string, BadgeMeta> = {
  iron_streak_7: {
    key: 'iron_streak_7',
    emoji: '🔥',
    name: '7-Day Iron Streak',
    description: 'Seven straight days of gate check-ins.',
  },
  bench_100kg: {
    key: 'bench_100kg',
    emoji: '🏋️',
    name: '100kg Bench Club',
    description: 'Benched 100 kg or more in a logged set.',
  },
  beast_mode_30: {
    key: 'beast_mode_30',
    emoji: '⚡',
    name: '30-Day Beast Mode',
    description: 'Thirty straight days of gate check-ins.',
  },
};

export interface MemberBadge {
  badge_key: string;
  awarded_at: string;
}

function errorText(error: { message?: string } | null): string {
  return error?.message ?? 'The gym server did not answer.';
}

/** Every badge the member holds, newest first. */
export async function loadBadges(memberId: string): Promise<MemberBadge[]> {
  if (!isUuid(memberId)) return [];
  const { data, error } = await supabase.rpc('fn_member_badges', {
    p_member_id: memberId,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as MemberBadge[]).filter((row) => row && typeof row.badge_key === 'string');
}

/**
 * How a member is doing against a badge they have not won yet.
 *
 * The award itself is decided in SQL (fn_badges_evaluate) so it can never be
 * faked from the client; this is presentation only, and it deliberately reads
 * from data the screen already holds (the streak and the PR list) rather than
 * adding a round trip per tile.
 */
export interface BadgeProgress {
  earned: boolean;
  /** 0-100, for the locked tile's ring. */
  percent: number;
  /** `4 / 7 days` — the honest "how close am I" line. */
  detail: string;
}

export function badgeProgress(
  key: string,
  earnedKeys: Set<string>,
  context: { bestStreak: number; heaviestBenchKg: number }
): BadgeProgress {
  if (earnedKeys.has(key)) {
    return { earned: true, percent: 100, detail: 'Unlocked' };
  }

  if (key === 'iron_streak_7' || key === 'beast_mode_30') {
    const target = key === 'iron_streak_7' ? 7 : 30;
    const best = Math.max(0, Math.floor(context.bestStreak));
    const percent = Math.min(100, Math.round((best / target) * 100));
    return {
      earned: false,
      percent,
      detail: best === 0 ? `0 / ${target} days` : `${best} / ${target} days`,
    };
  }

  if (key === 'bench_100kg') {
    const best = context.heaviestBenchKg;
    const percent = Math.min(100, Math.round((best / 100) * 100));
    return {
      earned: false,
      percent,
      detail: best <= 0 ? 'Log a bench set' : `${best.toFixed(0)} / 100 kg`,
    };
  }

  return { earned: false, percent: 0, detail: '' };
}

// -----------------------------------------------------------------------------
// Streak (read side; the write side is the attendance trigger)
// -----------------------------------------------------------------------------

export interface StoredStreak {
  count: number;
  best: number;
  checkedInToday: boolean;
  lastVisit: string | null;
  lastCheckinDate: string | null;
  visitDays: number;
}

export async function loadStreak(memberId: string): Promise<StoredStreak | null> {
  if (!isUuid(memberId)) return null;
  const { data, error } = await supabase.rpc('fn_member_streak', {
    p_member_id: memberId,
  });
  if (error) return null;
  const row = (data ?? {}) as Record<string, unknown>;
  const num = (value: unknown, fallback = 0) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    count: num(row.streak_count),
    best: num(row.streak_best),
    checkedInToday: Boolean(row.checked_in_today),
    lastVisit: typeof row.last_visit === 'string' ? row.last_visit : null,
    lastCheckinDate: typeof row.last_checkin_date === 'string' ? row.last_checkin_date : null,
    visitDays: num(row.visit_days),
  };
}

// -----------------------------------------------------------------------------
// Volume & PRs (Module 10.1)
// -----------------------------------------------------------------------------

export interface ExercisePr {
  exercise: string;
  weight: number;
  reps: number;
  sets: number;
  split: string;
  logged_at: string;
}

export interface MemberStats {
  volume_7d: number;
  volume_30d: number;
  month_volume: number;
  sessions_this_month: number;
  prs: ExercisePr[];
}

export async function loadMemberStats(memberId: string): Promise<MemberStats | null> {
  if (!isUuid(memberId)) return null;
  const { data, error } = await supabase.rpc('fn_member_stats', {
    p_member_id: memberId,
  });
  if (error) return null;
  const row = (data ?? {}) as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    volume_7d: num(row.volume_7d),
    volume_30d: num(row.volume_30d),
    month_volume: num(row.month_volume),
    sessions_this_month: num(row.sessions_this_month),
    prs: Array.isArray(row.prs) ? (row.prs as ExercisePr[]) : [],
  };
}

// -----------------------------------------------------------------------------
// Monthly leaderboard (Module 7.2)
// -----------------------------------------------------------------------------

export type LeaderboardMode = 'checkins' | 'volume' | 'streak';

export const LEADERBOARD_MODES: { id: LeaderboardMode; label: string; unit: string }[] = [
  { id: 'checkins', label: 'Monthly Consistency', unit: 'check-ins' },
  { id: 'volume', label: 'Volume Lifted', unit: 'kg lifted' },
  { id: 'streak', label: 'Streak', unit: 'day streak' },
];

export interface LeaderboardRow {
  member_id: string;
  name: string;
  username: string | null;
  value: number;
  rank: number;
  is_you: boolean;
}

export async function loadLeaderboard(input: {
  tenantId: string;
  mode: LeaderboardMode;
  viewerId?: string | null;
  limit?: number;
}): Promise<{ ok: boolean; rows: LeaderboardRow[]; error?: string }> {
  if (!isUuid(input.tenantId)) {
    return { ok: false, rows: [], error: 'No gym is linked to this session.' };
  }
  const { data, error } = await supabase.rpc('fn_monthly_leaderboard', {
    p_tenant_id: input.tenantId,
    p_mode: input.mode,
    p_limit: input.limit ?? 10,
    p_viewer_id: isUuid(input.viewerId) ? input.viewerId : null,
  });
  if (error) return { ok: false, rows: [], error: errorText(error) };
  return { ok: true, rows: Array.isArray(data) ? (data as LeaderboardRow[]) : [] };
}

// -----------------------------------------------------------------------------
// Challenges (Module 7.4)
// -----------------------------------------------------------------------------

export type ChallengeKind = 'attendance' | 'weight_loss';

export interface Challenge {
  id: string;
  title: string;
  kind: ChallengeKind;
  description: string | null;
  start_date: string;
  end_date: string;
  target_value: number;
  is_active: boolean;
  participants: number;
  joined: boolean;
  my_progress: number | null;
  my_rank: number | null;
  baseline_weight: number | null;
}

export interface ChallengeBoardRow {
  member_id: string;
  name: string;
  username: string | null;
  progress: number;
  target: number;
  baseline_weight: number | null;
  joined_at: string;
  rank: number;
}

export async function loadChallenges(input: {
  tenantId: string;
  memberId?: string | null;
}): Promise<{ ok: boolean; challenges: Challenge[]; error?: string }> {
  if (!isUuid(input.tenantId)) {
    return { ok: false, challenges: [], error: 'No gym is linked to this session.' };
  }
  const { data, error } = await supabase.rpc('fn_challenge_list', {
    p_tenant_id: input.tenantId,
    p_member_id: isUuid(input.memberId) ? input.memberId : null,
  });
  if (error) return { ok: false, challenges: [], error: errorText(error) };
  return { ok: true, challenges: Array.isArray(data) ? (data as Challenge[]) : [] };
}

export async function joinChallenge(input: {
  challengeId: string;
  memberId: string;
}): Promise<{ ok: boolean; alreadyJoined?: boolean; error?: string }> {
  if (!isUuid(input.challengeId) || !isUuid(input.memberId)) {
    return { ok: false, error: 'That challenge could not be opened.' };
  }
  const { data, error } = await supabase.rpc('fn_challenge_join', {
    p_challenge_id: input.challengeId,
    p_member_id: input.memberId,
  });
  if (error) return { ok: false, error: errorText(error) };
  const row = (data ?? {}) as Record<string, unknown>;
  return { ok: true, alreadyJoined: Boolean(row.already_joined) };
}

export async function loadChallengeBoard(
  challengeId: string
): Promise<{ ok: boolean; board: ChallengeBoardRow[]; error?: string }> {
  if (!isUuid(challengeId)) return { ok: false, board: [], error: 'Unknown challenge.' };
  const { data, error } = await supabase.rpc('fn_challenge_board', {
    p_challenge_id: challengeId,
  });
  if (error) return { ok: false, board: [], error: errorText(error) };
  const row = (data ?? {}) as Record<string, unknown>;
  return { ok: true, board: Array.isArray(row.board) ? (row.board as ChallengeBoardRow[]) : [] };
}

// -----------------------------------------------------------------------------
// Owner-side challenge management (/admin/challenges)
// -----------------------------------------------------------------------------
// The member side above goes straight to the RPCs; the owner console has to
// CREATE and DELETE challenge rows, which /api/challenges does with the same
// tenant scoping as /api/leads. Both go through one envelope helper so a failed
// request always reaches the form as a sentence.

async function callAdmin(
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; error?: string; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    return { ok: false, error: 'Network error — the request could not reach the server.', body: {} };
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: `Server returned an invalid response (${response.status}).`,
      body: {},
    };
  }

  if (!response.ok || body.ok === false) {
    return {
      ok: false,
      error: typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`,
      body,
    };
  }
  return { ok: true, body };
}

const NO_GYM = 'No gym is linked to this session. Sign in again.';

export interface ChallengeInput {
  title: string;
  kind: ChallengeKind;
  description?: string | null;
  /** YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  targetValue: number;
}

/** Every challenge in the gym, for the owner table. */
export async function listChallengesForOwner(
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; challenges: Challenge[] }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM, challenges: [] };
  const result = await callAdmin(`/api/challenges?tenant_id=${tenantId}`, { method: 'GET' });
  if (!result.ok) {
    return { ok: false, error: result.error, challenges: [] };
  }
  return {
    ok: true,
    challenges: Array.isArray(result.body.challenges)
      ? (result.body.challenges as Challenge[])
      : [],
  };
}

export async function createChallenge(
  tenantId: string | null,
  input: ChallengeInput
): Promise<{ ok: boolean; error?: string; challenge?: Challenge }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM };
  const result = await callAdmin('/api/challenges', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      title: input.title,
      kind: input.kind,
      description: input.description ?? null,
      start_date: input.startDate,
      end_date: input.endDate,
      target_value: input.targetValue,
    }),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, challenge: result.body.challenge as Challenge };
}

export async function deleteChallenge(
  tenantId: string | null,
  challengeId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM };
  if (!isUuid(challengeId)) return { ok: false, error: 'Unknown challenge.' };
  const result = await callAdmin('/api/challenges', {
    method: 'DELETE',
    body: JSON.stringify({ tenant_id: tenantId, challenge_id: challengeId }),
  });
  return { ok: true, ...(result.ok ? {} : { error: result.error }) };
}

// -----------------------------------------------------------------------------
// Shared display helpers
// -----------------------------------------------------------------------------

/** A challenge's progress expressed in its own unit: check-ins or kilograms. */
export function challengeUnit(kind: ChallengeKind): string {
  return kind === 'attendance' ? 'check-ins' : 'kg lost';
}

export function progressPercent(progress: number, target: number): number {
  if (!Number.isFinite(progress) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progress / target) * 100)));
}

