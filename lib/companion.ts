import { supabase } from '@/lib/supabase';

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
  membership_end: string | null;
  is_frozen: boolean;
  freeze_end_date: string | null;
  status: string;
}

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

export interface AnnouncementEntry {
  id: string;
  title: string;
  message: string;
  created_at: string;
}

export interface CompanionData {
  member: CompanionMember | null;
  tenant_id: string | null;
  trainer: CompanionTrainer | null;
  weights: WeightEntry[];
  workouts: WorkoutEntry[];
  reservations: ReservationEntry[];
  announcements: AnnouncementEntry[];
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
    tenant_id: null,
    trainer: null,
    weights: [],
    workouts: [],
    reservations: [],
    announcements: [],
  };

  if (!memberId) return { ok: false, error: 'Sign in to see your dashboard.', data: empty };

  const { data, error } = await supabase.rpc('fn_member_companion_data', {
    p_member_id: memberId,
  });

  if (error) return { ok: false, error: errorText(error), data: empty };

  const payload = asRecord(data);
  const memberRow = asRecord(payload.member);
  const trainerRow = asRecord(payload.trainer);

  return {
    ok: true,
    data: {
      member: memberRow.id
        ? {
            id: str(memberRow.id),
            full_name: str(memberRow.full_name, 'Member'),
            phone: str(memberRow.phone),
            membership_end:
              typeof memberRow.membership_end === 'string' ? memberRow.membership_end : null,
            is_frozen: Boolean(memberRow.is_frozen),
            freeze_end_date:
              typeof memberRow.freeze_end_date === 'string' ? memberRow.freeze_end_date : null,
            status: str(memberRow.status, 'active'),
          }
        : null,
      tenant_id: typeof payload.tenant_id === 'string' ? payload.tenant_id : null,
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
        message: str(r.message),
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

/** Public gym hours used by the Home tab's Open/Closed pill. Deliberately a plain
 *  constant: this is a display rule, not a booking system. */
export const GYM_HOURS = { opens: 5, closes: 23 } as const;

function formatHour(hour24: number): string {
  const suffix = hour24 >= 12 ? 'pm' : 'am';
  const twelve = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${twelve}${suffix}`;
}

export function gymOpenState(now: Date = new Date()): { open: boolean; label: string } {
  const hour = now.getHours() + now.getMinutes() / 60;
  const open = hour >= GYM_HOURS.opens && hour < GYM_HOURS.closes;
  return open
    ? { open: true, label: 'Open now' }
    : { open: false, label: `Closed · opens ${formatHour(GYM_HOURS.opens)}` };
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