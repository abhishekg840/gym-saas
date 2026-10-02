import { supabase } from '@/lib/supabase';
import {
  DEFAULT_OPERATING_HOURS,
  normalizeOperatingHours,
  operatingState,
  type OperatingHours,
} from '@/lib/settings';

/**
 * Client for the member companion app (`/member/dashboard`).
 *
 * Every call goes through a SECURITY DEFINER RPC from migration 0005 rather than
 * a table read: `member_weights`, `workout_logs`, `store_reservations` and
 * `gym_announcements` are revoked from anon/authenticated, so a direct
 * `.from('workout_logs').select()` would come back empty for everyone. Each
 * function therefore returns `{ ok, error }` instead of throwing, because the
 * database answers a validation failure with a raised exception whose message is
 * already written for the member ("Enter a weight between 25 and 400 kg").
 */

export type WorkoutSplit = 'Push' | 'Pull' | 'Legs' | 'Cardio' | 'Full Body';

export const WORKOUT_SPLITS: readonly WorkoutSplit[] = [
  'Push',
  'Pull',
  'Legs',
  'Cardio',
  'Full Body',
] as const;

/** The starter routine offered on each split card, so a new member can log a set
 *  without first having to remember what "Push" means. */
export const SPLIT_SUGGESTIONS: Record<WorkoutSplit, readonly string[]> = {
  Push: ['Bench Press', 'Overhead Press', 'Incline Dumbbell', 'Cable Fly', 'Triceps Pushdown'],
  Pull: ['Deadlift', 'Lat Pulldown', 'Barbell Row', 'Seated Cable Row', 'Face Pull'],
  Legs: ['Back Squat', 'Romanian Deadlift', 'Leg Press', 'Walking Lunge', 'Leg Curl'],
  Cardio: ['Treadmill Run', 'Rowing Machine', 'Stair Climber', 'Cycling', 'Battle Ropes'],
  'Full Body': ['Front Squat', 'Bench Press', 'Pull-Up', 'Kettlebell Swing', 'Plank'],
};

export interface CompanionMember {
  id: string;
  full_name: string;
  phone: string;
  username: string | null;
  membership_end: string | null;
  is_frozen: boolean;
  freeze_end_date: string | null;
  status: string;
  /** Phase 11: the gym's real weekly schedule, replacing a hardcoded constant. */
  operating_hours: OperatingHours;
  /**
   * Phase 11: FALSE until the member has set their own password. The app shows a
   * BLOCKING onboarding screen while this is false — see PasswordGate.
   */
  password_setup_completed: boolean;
}

/** The streak badge on the Home tab. Computed in SQL from the attendance log. */
export interface CompanionStreak {
  count: number;
  best: number;
  checkedInToday: boolean;
  lastVisit: string | null;
  visitDays: number;
}

export const EMPTY_STREAK: CompanionStreak = {
  count: 0,
  best: 0,
  checkedInToday: false,
  lastVisit: null,
  visitDays: 0,
};

export interface CompanionTrainer {
  id: string;
  name: string;
  phone: string;
  specialization: string | null;
}

export interface WeightEntry {
  id: string;
  weight_kg: number;
  logged_at: string;
}

export interface WorkoutEntry {
  id: string;
  workout_split: string;
  exercise_name: string;
  sets: number;
  reps: number;
  weight_used: number;
  logged_at: string;
}

export interface ReservationEntry {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  status: 'pending' | 'picked_up' | 'cancelled';
  created_at: string;
}

/**
 * A gym notice as the member app receives it.
 *
 * `body` and `message` are both present because migration 0011 emits both: the
 * stored column is `body`, and `message` is a generated alias kept for the
 * Phase 4 shape. Reading either works; new code should use `body`.
 */
export interface AnnouncementEntry {
  id: string;
  title: string;
  body: string;
  message: string;
  type: string;
  is_pinned: boolean;
  created_at: string;
}

/** The member's own editable profile fields, distinct from the gym's roster row. */
export interface CompanionProfile {
  display_name: string | null;
  emergency_phone: string | null;
  gender: string | null;
  date_of_birth: string | null;
  avatar_url: string | null;
  /** When the @handle last changed — drives the 30-day cooldown message. */
  username_changed_at: string | null;
}

/** Days before another @handle change is allowed. Mirrors fn_member_set_username. */
export const USERNAME_COOLDOWN_DAYS = 30;

/** The shape used before any profile row exists. */
export const EMPTY_PROFILE: CompanionProfile = {
  display_name: null,
  emergency_phone: null,
  gender: null,
  date_of_birth: null,
  avatar_url: null,
  username_changed_at: null,
};

export interface CompanionData {
  member: CompanionMember | null;
  /** Phase 11: the member's own editable fields, beside the gym's roster row. */
  profile: CompanionProfile;
  tenant_id: string | null;
  trainer: CompanionTrainer | null;
  weights: WeightEntry[];
  workouts: WorkoutEntry[];
  reservations: ReservationEntry[];
  announcements: AnnouncementEntry[];
  streak: CompanionStreak;
}

/** Supabase sends Postgres error text in `message`; prefer it because the RPCs
 *  raise with member-facing sentences rather than codes. */
function errorText(error: { message?: string } | null): string {
  return error?.message?.trim() || 'Something went wrong. Please try again.';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** numeric columns arrive from jsonb as numbers, but a JSON number can still be
 *  missing, so every field is coerced rather than cast. */
function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function list<T>(value: unknown, map: (row: Record<string, unknown>) => T): T[] {
  return Array.isArray(value) ? value.map((row) => map(asRecord(row))) : [];
}
/**
 * Everything the four tabs need, in one round trip. Four tabs that each fired
 * their own query would be four network round trips on a phone connection.
 */
export async function loadCompanionData(
  memberId: string | null
): Promise<{ ok: boolean; error?: string; data: CompanionData }> {
  const empty: CompanionData = {
    member: null,
    profile: EMPTY_PROFILE,
    tenant_id: null,
    trainer: null,
    weights: [],
    workouts: [],
    reservations: [],
    announcements: [],
    streak: EMPTY_STREAK,
  };

  if (!memberId) return { ok: false, error: 'Sign in to see your dashboard.', data: empty };

  const { data, error } = await supabase.rpc('fn_member_companion_data', {
    p_member_id: memberId,
  });

  if (error) return { ok: false, error: errorText(error), data: empty };

  const payload = asRecord(data);
  const memberRow = asRecord(payload.member);
  const trainerRow = asRecord(payload.trainer);
  const streakRow = asRecord(payload.streak);
  const profileRow = asRecord(payload.profile);

  return {
    ok: true,
    data: {
      member: memberRow.id
        ? {
            id: str(memberRow.id),
            full_name: str(memberRow.full_name, 'Member'),
            phone: str(memberRow.phone),
            username: typeof memberRow.username === 'string' ? memberRow.username : null,
            membership_end:
              typeof memberRow.membership_end === 'string' ? memberRow.membership_end : null,
            is_frozen: Boolean(memberRow.is_frozen),
            freeze_end_date:
              typeof memberRow.freeze_end_date === 'string' ? memberRow.freeze_end_date : null,
            status: str(memberRow.status, 'active'),
            // Phase 11: the gym's saved schedule. normalizeOperatingHours fills in
            // any day the owner never configured, so this is never partial.
            operating_hours: normalizeOperatingHours(memberRow.operating_hours),
            password_setup_completed: Boolean(memberRow.password_setup_completed),
          }
        : null,
      // The member's own fields, kept beside the roster row rather than merged
      // into it: full_name is what the gym calls them, display_name is what they
      // want to be called.
      profile: {
        display_name:
          typeof profileRow.display_name === 'string' ? profileRow.display_name : null,
        emergency_phone:
          typeof profileRow.emergency_phone === 'string' ? profileRow.emergency_phone : null,
        gender: typeof profileRow.gender === 'string' ? profileRow.gender : null,
        date_of_birth:
          typeof profileRow.date_of_birth === 'string' ? profileRow.date_of_birth : null,
        avatar_url: typeof profileRow.avatar_url === 'string' ? profileRow.avatar_url : null,
        username_changed_at:
          typeof profileRow.username_changed_at === 'string'
            ? profileRow.username_changed_at
            : null,
      },
      tenant_id: typeof payload.tenant_id === 'string' ? payload.tenant_id : null,
      streak: {
        count: num(streakRow.streak_count),
        best: num(streakRow.streak_best),
        checkedInToday: Boolean(streakRow.checked_in_today),
        lastVisit: typeof streakRow.last_visit === 'string' ? streakRow.last_visit : null,
        visitDays: num(streakRow.visit_days),
      },
      trainer: trainerRow.id
        ? {
            id: str(trainerRow.id),
            name: str(trainerRow.name, 'Your trainer'),
            phone: str(trainerRow.phone),
            specialization:
              typeof trainerRow.specialization === 'string' ? trainerRow.specialization : null,
          }
        : null,
      weights: list(payload.weights, (r) => ({
        id: str(r.id),
        weight_kg: num(r.weight_kg),
        logged_at: str(r.logged_at),
      })),
      workouts: list(payload.workouts, (r) => ({
        id: str(r.id),
        workout_split: str(r.workout_split, 'Full Body'),
        exercise_name: str(r.exercise_name, 'Exercise'),
        sets: num(r.sets, 1),
        reps: num(r.reps),
        weight_used: num(r.weight_used),
        logged_at: str(r.logged_at),
      })),
      reservations: list(payload.reservations, (r) => ({
        id: str(r.id),
        product_id: str(r.product_id),
        product_name: str(r.product_name, 'Item'),
        quantity: num(r.quantity, 1),
        status: str(r.status, 'pending') as ReservationEntry['status'],
        created_at: str(r.created_at),
      })),
      announcements: list(payload.announcements, (r) => ({
        id: str(r.id),
        title: str(r.title, 'Notice'),
        // `body` is the stored column (migration 0011); `message` is the
        // generated alias the Phase 4 shape still emits. Reading body first and
        // falling back keeps this working against either version of the RPC.
        body: str(r.body, str(r.message)),
        message: str(r.message, str(r.body)),
        type: str(r.type, 'general'),
        is_pinned: Boolean(r.is_pinned),
        created_at: str(r.created_at),
      })),
    },
  };
}

export async function logWeight(
  memberId: string,
  weightKg: number
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(weightKg)) return { ok: false, error: 'Enter your weight in kilograms.' };

  const { error } = await supabase.rpc('fn_member_log_weight', {
    p_member_id: memberId,
    p_weight_kg: weightKg,
  });

  return error ? { ok: false, error: errorText(error) } : { ok: true };
}

export async function logWorkout(input: {
  memberId: string;
  split: WorkoutSplit;
  exercise: string;
  sets: number;
  reps: number;
  weightUsed: number;
}): Promise<{ ok: boolean; error?: string }> {
  const exercise = input.exercise.trim();
  if (!exercise) return { ok: false, error: 'Name the exercise first.' };
  if (!Number.isFinite(input.reps) || input.reps < 1) {
    return { ok: false, error: 'Enter how many reps you did.' };
  }

  const { error } = await supabase.rpc('fn_member_log_workout', {
    p_member_id: input.memberId,
    p_split: input.split,
    p_exercise: exercise,
    p_sets: input.sets,
    p_reps: input.reps,
    p_weight_used: input.weightUsed,
  });

  return error ? { ok: false, error: errorText(error) } : { ok: true };
}

/**
 * Renames the member's own @handle. The handle the gym minted on enrolment is
 * derived from a name and a phone tail, which is fine for signing in and rarely
 * what someone wants printed on their own profile.
 */
export async function setUsername(
  memberId: string,
  username: string
): Promise<{ ok: boolean; error?: string; username?: string }> {
  const clean = username.trim().replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._]{2,23}$/.test(clean)) {
    return {
      ok: false,
      error: 'Pick a handle of 3 to 24 characters: letters, numbers, dot or underscore.',
    };
  }

  const { data, error } = await supabase.rpc('fn_member_set_username', {
    p_member_id: memberId,
    p_username: clean,
  });

  if (error) return { ok: false, error: errorText(error) };

  return { ok: true, username: str(asRecord(data).username, clean) };
}

export async function reserveProduct(
  memberId: string,
  productId: string,
  quantity = 1
): Promise<{ ok: boolean; error?: string; merged?: boolean }> {
  const { data, error } = await supabase.rpc('fn_member_reserve_product', {
    p_member_id: memberId,
    p_product_id: productId,
    p_quantity: quantity,
  });

  if (error) return { ok: false, error: errorText(error) };

  return { ok: true, merged: Boolean(asRecord(data).merged) };
}

export async function cancelReservation(
  memberId: string,
  reservationId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('fn_member_cancel_reservation', {
    p_member_id: memberId,
    p_reservation_id: reservationId,
  });

  return error ? { ok: false, error: errorText(error) } : { ok: true };
}
/** What the Health tab draws: the newest reading and the change against the
 *  one before it, which is the only number most members actually care about. */
export function weightTrend(
  weights: WeightEntry[]
): { latest: number | null; delta: number | null; direction: 'up' | 'down' | 'flat' } {
  if (weights.length === 0) return { latest: null, delta: null, direction: 'flat' };

  const latest = weights[0].weight_kg;
  if (weights.length < 2) return { latest, delta: null, direction: 'flat' };

  const delta = Math.round((latest - weights[1].weight_kg) * 10) / 10;
  const direction = delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
  return { latest, delta, direction };
}

/**
 * The sparkline for the weight trend, as an SVG path.
 *
 * Drawn in code rather than with a chart library because the shape is fixed: a
 * polyline through the readings, normalised into a 100x36 box. Handing back the
 * `d` string keeps the component free of chart setup, and the empty case returns
 * null so the caller can render "log your first weigh-in" instead of an axis
 * with nothing on it.
 */
export function weightSparkPath(weights: WeightEntry[]): string | null {
  // Newest first from the database, so reverse to read left-to-right in time.
  const points = [...weights].reverse();
  if (points.length === 0) return null;

  const values = points.map((p) => p.weight_kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; centre it instead of drawing a spike.
  const span = max - min || 1;

  return points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 32 - ((point.weight_kg - min) / span) * 28;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

// Phase 11 removed the hardcoded 05:00-23:00. The gym's schedule now lives on
// tenants.operating_hours and arrives inside the companion bundle, so the Home
// tab's Open/Closed pill reads the real roster instead of a constant that was
// wrong for every gym with different hours.
//
// lib/settings.ts owns the maths (IST, past-midnight closes, rest days); this
// function only adapts it to the shape the pass card already expected, and
// normalizes any missing schedule back to the old default so a pre-migration
// install degrades to the previous behaviour instead of rendering nothing.
export const GYM_HOURS = { opens: 5, closes: 23 } as const;

export function gymOpenState(
  now: Date = new Date(),
  hours?: OperatingHours
): {
  open: boolean;
  label: string;
  hours: string;
  tone: string;
} {
  const state = operatingState(normalizeOperatingHours(hours), now);
  return {
    open: state.open,
    label: state.label,
    hours: state.todayLabel,
    tone: state.tone,
  };
}
/** The lineup under the streak flame: "12 Day Streak" or a nudge to start one. */
export function streakHeadline(streak: { count: number; checkedInToday: boolean }): {
  headline: string;
  detail: string;
  tone: string;
} {
  if (streak.count <= 0) {
    return {
      headline: 'Start your streak',
      detail: 'Check in today to light this up.',
      tone: 'bg-orange-50 text-orange-700 border-orange-200',
    };
  }

  const word = streak.count === 1 ? 'Day' : 'Days';
  return {
    headline: `${streak.count} ${word} Streak`,
    detail: streak.checkedInToday
      ? "Today's check-in is in. Well done."
      : 'Check in today to keep it alive.',
    tone: 'bg-orange-50 text-orange-700 border-orange-200',
  };
}


/** How busy the floor is, from the count of members currently inside.
 *  Thresholds are deliberately coarse: nobody needs to know there are 41 people
 *  in, only whether the bench is free. */
export function rushLevel(insideNow: number): {
  level: 'Low' | 'Moderate' | 'Busy';
  tone: string;
} {
  if (insideNow <= 12) {
    return { level: 'Low', tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' };
  }
  if (insideNow <= 35) {
    return { level: 'Moderate', tone: 'bg-amber-500/10 text-amber-300 border-amber-500/25' };
  }
  return { level: 'Busy', tone: 'bg-rose-500/10 text-rose-300 border-rose-500/25' };
}

/** Days left on the membership, with the wording an owner would actually use. */
export function expiryCountdown(
  membershipEnd: string | null
): { days: number; label: string; tone: string } {
  const expired: { days: number; label: string; tone: string } = {
    days: 0,
    label: 'No active plan',
    tone: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  };

  if (!membershipEnd) return expired;

  const end = new Date(membershipEnd);
  if (Number.isNaN(end.getTime())) return expired;

  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000);

  if (days < 0) {
    return {
      days,
      label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`,
      tone: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
    };
  }
  if (days === 0) {
    return { days, label: 'Expires today', tone: 'bg-amber-500/10 text-amber-300 border-amber-500/25' };
  }
  if (days <= 7) {
    return {
      days,
      label: `${days} day${days === 1 ? '' : 's'} left`,
      tone: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
    };
  }
  return {
    days,
    label: `${days} days left`,
    tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  };
}

/** "12 min ago" style stamp for the history lists. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return new Date(then).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** The most recent time this member did an exercise, for the "last time" hint
 *  shown under the name field on the workout logger. */
export function lastPerformance(
  workouts: WorkoutEntry[],
  split: WorkoutSplit,
  exercise: string
): WorkoutEntry | null {
  const needle = exercise.trim().toLowerCase();
  if (!needle) return null;
  return (
    workouts.find(
      (w) => w.workout_split === split && w.exercise_name.trim().toLowerCase() === needle
    ) ?? null
  );
}

/** Total volume in the current session's split, shown as a headline on the
 *  workout tab: sets x reps x load is what lifters actually compare week to week. */
export function splitVolume(workouts: WorkoutEntry[], split: WorkoutSplit): number {
  return workouts
    .filter((w) => w.workout_split === split)
    .reduce((total, w) => total + w.sets * w.reps * w.weight_used, 0);
}
