import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';
import { AVATAR_BUCKET, MAX_AVATAR_BYTES, uploadImage, validateImageFile } from '@/lib/media';

/**
 * Vyroniq member identity (Phase 10): the profile photo and the hardware
 * credentials that are assigned BY the system and never typed.
 *
 * Both features share one rule — the member app is the only place they appear,
 * and neither value originates there. The RFID key and the terminal slot are
 * minted by a database trigger (migration 0010) from the card serial and the
 * fingerprint template the desk enrolled; the photo is the member's own upload.
 */

/** Matches the 5 MB bucket limit set by migration 0010. */
export const MAX_AVATAR_FILE_BYTES = MAX_AVATAR_BYTES;

/**
 * Where a member's photo lives: one stable path per tenant+member, so a new
 * photo REPLACES the old one (uploadImage passes upsert) instead of littering
 * the bucket with a timestamped copy nobody can prune.
 */
export function avatarPath(tenantId: string | null, memberId: string): string {
  const tenant = isUuid(tenantId) ? tenantId : 'unscoped';
  return `${tenant}/${memberId}/avatar.jpg`;
}

// -----------------------------------------------------------------------------
// Hardware identity — read only, always
// -----------------------------------------------------------------------------

export interface HardwareIdentity {
  /** `•••• 9A4F`. The full key never crosses the wire. */
  rfid_masked: string | null;
  /** Last four characters, for matching a card at the desk. */
  rfid_tail: string | null;
  rfid_linked: boolean;
  /** Raw slot id (`SLOT-042`) — kept for support/diagnostics. */
  slot_id: string | null;
  /** Cosmetic `#042`, exactly what the card reader was configured with. */
  slot_label: string | null;
  biometric_linked: boolean;
}

/** The one tooltip copy for both read-only fields. */
export const HARDWARE_IDENTITY_HINT =
  'Auto-synced with Vyroniq Gate Terminal on physical card tap / biometric registration';

/** No credential issued yet. Distinct from "the read failed", which is null. */
export const EMPTY_HARDWARE_IDENTITY: HardwareIdentity = {
  rfid_masked: null,
  rfid_tail: null,
  rfid_linked: false,
  slot_id: null,
  slot_label: null,
  biometric_linked: false,
};

/**
 * The member's hardware identity, or null when nothing is linked (the front
 * desk has not enrolled a card or finger yet).
 */
export async function loadHardwareIdentity(
  memberId: string | null | undefined
): Promise<HardwareIdentity | null> {
  if (!isUuid(memberId)) return null;

  const { data, error } = await supabase.rpc('fn_member_hardware_identity', {
    p_member_id: memberId,
  });
  if (error) return null;

  const row = (data ?? {}) as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === 'string' && value ? value : null);

  return {
    rfid_masked: str(row.rfid_masked),
    rfid_tail: str(row.rfid_tail),
    rfid_linked: Boolean(row.rfid_linked),
    slot_id: str(row.slot_id),
    slot_label: str(row.slot_label),
    biometric_linked: Boolean(row.biometric_linked),
  };
}

/** `•••• 9A4F` when linked, `Not Linked` when not. */
export function rfidDisplay(identity: HardwareIdentity | null): string {
  return identity?.rfid_masked ?? 'Not Linked';
}

/** `#042` when linked, `Not Registered` when not. */
export function slotDisplay(identity: HardwareIdentity | null): string {
  return identity?.slot_label ?? 'Not Registered';
}

// -----------------------------------------------------------------------------
// Profile photo
// -----------------------------------------------------------------------------

/**
 * A versioned URL for `<img src>`.
 *
 * The bucket is public with a one-year cache header, so re-uploading to the
 * same path leaves the browser showing the OLD photo until that cache expires.
 * Appending the upload time is what makes the change visible on the same tap.
 */
export function cacheBust(url: string | null | undefined, stamp: number): string | null {
  if (!url) return null;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${stamp}`;
}

/** `AB` from "Aarav Bedi". Used by the fallback tile when there is no photo. */
export function initialsFor(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export interface AvatarResult {
  ok: boolean;
  /** Versioned URL ready for an <img src>; null once the photo is removed. */
  url?: string | null;
  error?: string;
}

function avatarError(message: string): string {
  return message || 'Could not update your photo. Please try again.';
}

/**
 * Uploads the picked file and writes it to `members.avatar_url` and
 * `profiles.avatar_url` in one database call, so the two can never disagree.
 */
export async function uploadAvatar(input: {
  memberId: string;
  tenantId: string | null;
  file: File;
}): Promise<AvatarResult> {
  if (!isUuid(input.memberId)) {
    return { ok: false, error: 'Your session is stale — sign in again to update your photo.' };
  }

  const invalid = validateImageFile(input.file, MAX_AVATAR_FILE_BYTES);
  if (invalid) return { ok: false, error: invalid };

  const path = avatarPath(input.tenantId, input.memberId);
  const uploaded = await uploadImage(AVATAR_BUCKET, path, input.file);
  if (!uploaded.ok || !uploaded.url) {
    return { ok: false, error: avatarError(uploaded.error ?? '') };
  }

  const { error } = await supabase.rpc('fn_member_set_avatar', {
    p_member_id: input.memberId,
    p_avatar_url: uploaded.url,
  });
  if (error) return { ok: false, error: avatarError(error.message) };

  return { ok: true, url: cacheBust(uploaded.url, Date.now()) };
}

/**
 * Detaches the photo. The object stays in the bucket on purpose: deleting it is
 * not worth a second round trip for a member who may change their mind, and the
 * path is overwritten by the next upload anyway.
 */
export async function removeAvatar(memberId: string): Promise<AvatarResult> {
  if (!isUuid(memberId)) {
    return { ok: false, error: 'Your session is stale — sign in again to change your photo.' };
  }

  const { error } = await supabase.rpc('fn_member_set_avatar', {
    p_member_id: memberId,
    p_avatar_url: null,
  });
  if (error) return { ok: false, error: avatarError(error.message) };

  return { ok: true, url: null };
}
