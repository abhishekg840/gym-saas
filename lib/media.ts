import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';

/**
 * Media helpers for Supabase Storage (Phase 7).
 *
 * Both buckets are created by 0007_phase7_media_identity.sql and are public-read:
 * a photo URL is pasted straight into an <img> by the till, the member app and
 * printed receipts, so signing every read is not worth the plumbing. Writes are
 * admitted to any signed-in visitor of the app, exactly like the rest of the
 * schema that talks to Postgres with the anon key.
 */

export const PRODUCT_IMAGE_BUCKET = 'product-images';
export const AVATAR_BUCKET = 'avatars';

/** Keep in sync with `allowed_mime_types` on the buckets in the migration. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
const TYPE_LIST = 'JPEG, PNG, WebP, AVIF or GIF';

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** null = fine to upload, otherwise the message to show the person. */
export function validateImageFile(file: File, maxBytes: number): string | null {
  if (!IMAGE_TYPES.includes(file.type)) {
    return `Pick a ${TYPE_LIST} photo.`;
  }
  if (file.size > maxBytes) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    const cap = Math.round(maxBytes / (1024 * 1024));
    return `That photo is ${mb} MB — keep it under ${cap} MB.`;
  }
  return null;
}

/** A stable, URL-safe tail for a storage path. Never returns an empty string. */
export function imageFileName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'photo';
}

/** Turns raw storage errors into something a gym manager can act on. */
function friendlyUploadError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('bucket not found')) {
    return 'Image storage is not set up yet — run the 0007 migration in Supabase.';
  }
  if (lower.includes('exceeded') || lower.includes('size')) {
    return 'That photo is too large. Try a smaller image.';
  }
  if (lower.includes('mime') || lower.includes('format')) {
    return `That file type is not allowed — use ${TYPE_LIST}.`;
  }
  return 'Could not upload that photo. Please try again.';
}

/**
 * Uploads `file` to `bucket` at `path` and answers with the public URL that the
 * catalogue/profile UIs store. `upsert` is on so retrying the same path replaces
 * the file instead of failing on a duplicate.
 */
export async function uploadImage(
  bucket: string,
  path: string,
  file: File
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    cacheControl: '31536000',
    contentType: file.type,
  });

  if (error) return { ok: false, error: friendlyUploadError(error.message) };

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data?.publicUrl) {
    return { ok: false, error: 'Uploaded, but the shareable link could not be built.' };
  }
  return { ok: true, url: data.publicUrl };
}

/** Reads the avatar for one identity. Missing row or failed read = null. */
export async function loadAvatar(userId: string | null | undefined): Promise<string | null> {
  if (!isUuid(userId)) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return null;
  const url = data?.avatar_url;
  return typeof url === 'string' && url ? url : null;
}

/**
 * Writes the avatar URL for one identity (members.id for members, gym_users.id
 * for staff). Only https links are accepted so a stray value can never smuggle
 * a javascript: URI into an <img src> later.
 */
export async function saveAvatar(
  userId: string,
  tenantId: string | null,
  avatarUrl: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuid(userId)) {
    return { ok: false, error: 'Your session is stale — sign in again to update your photo.' };
  }

  const value = avatarUrl.trim();
  if (!/^https:\/\/\S+$/i.test(value) || value.length > 1000) {
    return { ok: false, error: 'That image link does not look right.' };
  }

  const { error } = await supabase.from('profiles').upsert(
    {
      user_id: userId,
      tenant_id: isUuid(tenantId) ? tenantId : null,
      avatar_url: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) return { ok: false, error: 'Could not save your photo. Please try again.' };
  return { ok: true };
}
