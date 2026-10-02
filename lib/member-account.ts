/**
 * Member account client (Module 8.3) — profile fields and the @handle.
 *
 * Both go through /api/member/account rather than a direct Supabase call, so the
 * validation lives in ONE place. The @handle especially: the 30-day cooldown is
 * enforced by fn_member_set_username in Postgres, and a client-side check would be
 * a second, inevitably-divergent copy of the same rule.
 *
 * Failure modes are translated into sentences here because the alternative is a
 * raw Postgres message ("You can change your @handle again from 12 Apr 2026")
 * shown as a toast, which reads like a bug even though it is the correct answer.
 */

import { isUuid } from '@/lib/session';

export interface UsernameResult {
  ok: boolean;
  error?: string;
  /** null when the handle was rejected or unchanged. */
  username?: string | null;
  /** true when the handle was actually different and the clock restarted. */
  changed?: boolean;
  /** ISO timestamp of the next permitted change, when one applies. */
  nextChangeAvailable?: string | null;
}

export interface ProfileResult {
  ok: boolean;
  error?: string;
}

interface Envelope {
  ok?: boolean;
  error?: string;
  username?: string;
  changed?: boolean;
  next_change_available?: string;
}

async function call(
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; error?: string; body: Envelope }> {
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

  let body: Envelope;
  try {
    body = (await response.json()) as Envelope;
  } catch {
    return { ok: false, error: `Server returned an invalid response (${response.status}).`, body: {} };
  }

  if (!response.ok || body.ok === false) {
    return { ok: false, error: body.error ?? 'Something went wrong. Please try again.', body };
  }
  return { ok: true, body };
}

const NO_MEMBER = 'Sign in again to change your account.';

/**
 * Sets a new @handle.
 *
 * `changed: false` is a SUCCESS, not an error: re-submitting the handle you
 * already have is a no-op server-side (so it does not burn the cooldown clock),
 * and telling the member "that is not allowed" for a no-op would be a lie.
 */
export async function changeUsername(
  memberId: string | null,
  next: string
): Promise<UsernameResult> {
  if (!isUuid(memberId)) return { ok: false, error: NO_MEMBER };

  const result = await call('/api/member/account', {
    method: 'POST',
    body: JSON.stringify({ member_id: memberId, action: 'change_username', username: next }),
  });

  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    username: result.body.username ?? next,
    changed: result.body.changed ?? false,
    nextChangeAvailable: result.body.next_change_available ?? null,
  };
}

export interface ProfileInput {
  displayName?: string | null;
  emergencyPhone?: string | null;
  gender?: string | null;
  /** YYYY-MM-DD, or null to clear. */
  dateOfBirth?: string | null;
}

/**
 * Saves the Edit Profile fields.
 *
 * Only the fields the modal actually changed are sent as non-null; a null means
 * "leave the stored value alone", which is how fn_member_profile_update keeps a
 * partial save from blanking a field the member did not touch.
 */
export async function saveProfile(
  memberId: string | null,
  input: ProfileInput
): Promise<ProfileResult> {
  if (!isUuid(memberId)) return { ok: false, error: NO_MEMBER };

  const result = await call('/api/member/account', {
    method: 'POST',
    body: JSON.stringify({
      member_id: memberId,
      action: 'update_profile',
      display_name: input.displayName ?? null,
      emergency_phone: input.emergencyPhone ?? null,
      gender: input.gender ?? null,
      date_of_birth: input.dateOfBirth ?? null,
    }),
  });

  return { ok: result.ok, error: result.error };
}

/** Local pre-check so obvious typos never cost a round trip. */
export function validateHandle(next: string): string | null {
  const clean = next.trim().replace(/^@+/, '').toLowerCase();
  if (clean.length < 3) return 'Use at least 3 characters.';
  if (clean.length > 20) return 'Keep it to 20 characters or fewer.';
  if (!/^[a-z0-9._]+$/.test(clean)) {
    return 'Use letters, numbers, dots and underscores only.';
  }
  return null;
}

/** The normalised handle, for showing the member what will be stored. */
export function normalizeHandle(next: string): string {
  return next.trim().replace(/^@+/, '').toLowerCase();
}