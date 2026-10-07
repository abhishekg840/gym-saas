/**
 * Operating hours (Module 4.1.2).
 *
 * Replaces the hardcoded 05:00-23:00 the member app used to render. The gym's
 * schedule lives on `tenants.operating_hours` (jsonb, written by
 * fn_tenant_set_operating_hours) and travels to the phone inside the companion
 * bundle, so "Open now" costs no extra round trip.
 *
 * Everything here is computed against the GYM's timezone (Asia/Kolkata), not the
 * device's: a member who flies abroad must still see their gym's hours, and a
 * phone set to UTC must not show the gym opening six hours early.
 */

import { isUuid } from '@/lib/session';

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

export type OperatingHours = Record<DayKey, DayHours>;

/** The schedule a gym starts with, matching the migration's backfill. */
export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  mon: { open: '05:00', close: '23:00', closed: false },
  tue: { open: '05:00', close: '23:00', closed: false },
  wed: { open: '05:00', close: '23:00', closed: false },
  thu: { open: '05:00', close: '23:00', closed: false },
  fri: { open: '05:00', close: '23:00', closed: false },
  sat: { open: '06:00', close: '22:00', closed: false },
  sun: { open: '07:00', close: '20:00', closed: false },
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isDayHours(value: unknown): value is DayHours {
  if (!value || typeof value !== 'object') return false;
  const day = value as Record<string, unknown>;
  return (
    typeof day.open === 'string' &&
    typeof day.close === 'string' &&
    TIME_PATTERN.test(day.open) &&
    TIME_PATTERN.test(day.close) &&
    typeof day.closed === 'boolean'
  );
}

/**
 * Coerces whatever the database sent into a complete seven-day schedule.
 *
 * Anything missing, malformed or of the wrong type falls back to the default for
 * THAT DAY, so one bad entry cannot blank the whole card. This is the boundary
 * where untrusted JSON becomes typed state.
 */
export function normalizeOperatingHours(raw: unknown): OperatingHours {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const result = {} as OperatingHours;

  for (const key of DAY_KEYS) {
    const candidate = source[key];
    result[key] = isDayHours(candidate)
      ? { open: candidate.open, close: candidate.close, closed: candidate.closed }
      : { ...DEFAULT_OPERATING_HOURS[key] };
  }
  return result;
}

function minutesOf(time: string): number | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `05:00` -> `5:00 AM`, for display. */
export function formatClock(time: string): string {
  const minutes = minutesOf(time);
  if (minutes === null) return time;
  const hour24 = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, '0');
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${mins} ${suffix}`;
}

/**
 * "Right now, what time is it at the gym?"
 *
 * Uses Intl rather than Date#getHours so the answer is the GYM's local time even
 * when the phone is in another timezone. The explicit timeZone is the whole
 * point: a member travelling abroad must not see their gym open at 03:00.
 */
function gymNow(now: Date): { day: DayKey; minutes: number } {
  // en-GB gives the 3-letter day code as mon/tue/... and a 24-hour clock, which
  // is exactly the pair the schedule is keyed by.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const dayCode = read('weekday').slice(0, 3).toLowerCase();
  const day = (DAY_KEYS as readonly string[]).includes(dayCode)
    ? (dayCode as DayKey)
    : 'mon';

  // midnight can come back as "24" from some ICU builds; fold it to 0.
  const hour = Number(read('hour')) % 24;
  return { day, minutes: hour * 60 + Number(read('minute')) };
}

export interface OpenState {
  open: boolean;
  /** "Open now" / "Closed · opens 5:00 AM" — one line for the pass card. */
  label: string;
  /** "5:00 AM – 11:00 PM" for today. */
  todayLabel: string;
  /** Today, in IST. */
  todayLabelKey: DayKey;
  tone: string;
  openTone: string;
  closedTone: string;
}

/**
 * Is the gym open right now, and what are today's hours?
 *
 * Handles the two cases a naive comparison gets wrong:
 *   - a day that closes AFTER midnight (22:00–02:00), where close < open
 *     numerically but the gym is still open past midnight, and
 *   - a "closed" day, which is not the same as "open 00:00-00:00".
 */
export function operatingState(
  hours: OperatingHours,
  now: Date = new Date()
): OpenState {
  const { day, minutes } = gymNow(now);
  const today = hours[day] ?? DEFAULT_OPERATING_HOURS[day];
  const open = minutesOf(today.open);
  const close = minutesOf(today.close);

  const openTone = 'text-emerald-600';
  const closedTone = 'text-amber-600';

  if (today.closed || open === null || close === null) {
    // Find the next day that IS open, so the member is told when to come back
    // rather than just "closed".
    const next = nextOpenDay(hours, day);
    return {
      open: false,
      label: next ? `Closed · opens ${next}` : 'Closed today',
      todayLabel: today.closed ? 'Closed all day' : 'Hours not set',
      todayLabelKey: day,
      tone: closedTone,
      openTone,
      closedTone,
    };
  }

  // Past-midnight close: the window that started yesterday is still running.
  const overnight = close <= open;
  const inside = overnight
    ? minutes >= open || minutes < close
    : minutes >= open && minutes < close;

  const todayLabel = `${formatClock(today.open)} – ${formatClock(today.close)}`;

  if (inside) {
    return {
      open: true,
      label: overnight ? 'Open now · closes after midnight' : 'Open now',
      todayLabel,
      todayLabelKey: day,
      tone: openTone,
      openTone,
      closedTone,
    };
  }

  // Before opening: say when it opens. After closing: point at the next day.
  if (!overnight && minutes < open) {
    return {
      open: false,
      label: `Closed · opens ${formatClock(today.open)}`,
      todayLabel,
      todayLabelKey: day,
      tone: closedTone,
      openTone,
      closedTone,
    };
  }

  const next = nextOpenDay(hours, day);
  return {
    open: false,
    label: next ? `Closed · opens ${next}` : 'Closed today',
    todayLabel,
    todayLabelKey: day,
    tone: closedTone,
    openTone,
    closedTone,
  };
}

/** "opens tomorrow 6:00 AM" / "opens Saturday 6:00 AM". */
function nextOpenDay(hours: OperatingHours, from: DayKey): string | null {
  const start = DAY_KEYS.indexOf(from);
  for (let step = 1; step <= 7; step += 1) {
    const key = DAY_KEYS[(start + step) % 7];
    if (hours[key]?.closed) continue;
    const at = formatClock(hours[key].open);
    if (step === 1) return `tomorrow ${at}`;
    if (step === 7) return `next ${DAY_LABELS[key]} ${at}`;
    return `${DAY_LABELS[key]} ${at}`;
  }
  return null;
}

/** The whole week, for the owner settings screen and the member "full hours" row. */
export function weeklySummary(hours: OperatingHours): {
  day: DayKey;
  label: string;
  text: string;
  open: boolean;
}[] {
  const { day: todayKey } = gymNow(new Date());
  return DAY_KEYS.map((key) => {
    const day = hours[key];
    return {
      day: key,
      label: DAY_LABELS[key],
      text: day.closed ? 'Closed' : `${formatClock(day.open)} – ${formatClock(day.close)}`,
      open: key === todayKey,
    };
  });
}

// -----------------------------------------------------------------------------
// Owner write path (/api/settings)
// -----------------------------------------------------------------------------

const NO_GYM = 'No gym is linked to this session. Sign in again.';

async function callSettings(
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
    return { ok: false, error: 'Network error — check your connection.', body: {} };
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `Server returned an invalid response (${response.status}).`, body: {} };
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

/** The gym's saved schedule, normalised. Falls back to the default on any failure. */
export async function loadOperatingHours(
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; hours: OperatingHours }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM, hours: DEFAULT_OPERATING_HOURS };
  const result = await callSettings(`/api/settings?tenant_id=${tenantId}`, { method: 'GET' });
  return {
    ok: result.ok,
    error: result.error,
    hours: normalizeOperatingHours(result.body.operating_hours),
  };
}

/**
 * Saves the whole week in one call.
 *
 * The server always writes all seven days, so the UI's optimistic copy can be
 * replaced wholesale with the response — there is no partial-save state to
 * reconcile, which is why the settings screen can enable Save once and forget.
 */
export async function saveOperatingHours(
  tenantId: string | null,
  hours: OperatingHours
): Promise<{ ok: boolean; error?: string; hours: OperatingHours }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM, hours };
  const result = await callSettings('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, hours }),
  });
  return {
    ok: result.ok,
    error: result.error,
    hours: result.ok ? normalizeOperatingHours(result.body.operating_hours) : hours,
  };
}

// -----------------------------------------------------------------------------
// Payment identity (UPI VPA)
// -----------------------------------------------------------------------------

/** The gym's saved UPI ID, or null when never configured. */
export async function loadUpiId(
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; upiId: string | null }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM, upiId: null };
  const result = await callSettings(`/api/settings?tenant_id=${tenantId}`, { method: 'GET' });
  const raw = result.body.upi_id;
  return {
    ok: result.ok,
    error: result.error,
    upiId: typeof raw === 'string' && raw.trim() ? raw.trim() : null,
  };
}

/**
 * Saves (or clears, with an empty string) the gym's UPI ID. Renewal reminders
 * build their payment link from it; clearing switches those messages to the
 * neutral front-desk copy instead of ever falling back to someone's personal
 * payment QR.
 */
export async function saveUpiId(
  tenantId: string | null,
  upiId: string
): Promise<{ ok: boolean; error?: string; upiId: string | null }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM, upiId: null };
  const result = await callSettings('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, upi_id: upiId }),
  });
  const raw = result.body.upi_id;
  return {
    ok: result.ok,
    error: result.error,
    upiId: result.ok ? (typeof raw === 'string' && raw.trim() ? raw.trim() : null) : null,
  };
}