/**
 * Announcements client (Module 4.1.3) — the owner console's side.
 *
 * gym_announcements is revoked from PostgREST, so every call here is an HTTP
 * round trip to /api/announcements rather than a `.from()` select. That is the
 * same arrangement lib/crm.ts uses for leads, for the same reason.
 *
 * The MEMBER read is NOT in this file: it arrives inside the companion bundle
 * (fn_member_companion_data) so the member app still makes one call on launch.
 */

import { isUuid } from '@/lib/session';

export const NOTICE_TYPES = [
  { id: 'general', label: 'General', tone: 'bg-slate-50 text-slate-600 border-slate-200' },
  { id: 'alert', label: 'Alert', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  { id: 'event', label: 'Event', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'maintenance', label: 'Maintenance', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'offer', label: 'Offer', tone: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
] as const;

export type NoticeType = (typeof NOTICE_TYPES)[number]['id'];

export function noticeTone(type: string | null | undefined): string {
  return (
    NOTICE_TYPES.find((entry) => entry.id === type)?.tone ??
    'bg-slate-50 text-slate-600 border-slate-200'
  );
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: string;
  is_pinned: boolean;
  is_published: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Envelope {
  ok?: boolean;
  error?: string;
  announcements?: Announcement[];
  announcement?: Announcement;
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
    return { ok: false, error: body.error ?? `Request failed (${response.status}).`, body };
  }
  return { ok: true, body };
}

const NO_GYM = 'No gym is linked to this session. Sign in again.';

export async function listAnnouncements(
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; announcements: Announcement[] }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM, announcements: [] };
  const result = await call(`/api/announcements?tenant_id=${tenantId}`, { method: 'GET' });
  return {
    ok: result.ok,
    error: result.error,
    announcements: Array.isArray(result.body.announcements) ? result.body.announcements : [],
  };
}

export interface AnnouncementInput {
  /** null creates, a UUID updates. */
  id?: string | null;
  title: string;
  body: string;
  type?: NoticeType;
  is_pinned?: boolean;
  is_published?: boolean;
  /** ISO timestamp, or null for "never expires". */
  expires_at?: string | null;
}

export async function saveAnnouncement(
  tenantId: string | null,
  input: AnnouncementInput
): Promise<{ ok: boolean; error?: string; announcement?: Announcement }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM };
  const result = await call('/api/announcements', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      id: input.id ?? null,
      title: input.title,
      body: input.body,
      type: input.type ?? 'general',
      is_pinned: input.is_pinned ?? false,
      is_published: input.is_published ?? true,
      expires_at: input.expires_at ?? null,
    }),
  });
  return { ok: result.ok, error: result.error, announcement: result.body.announcement };
}

export async function deleteAnnouncement(
  tenantId: string | null,
  noticeId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuid(tenantId)) return { ok: false, error: NO_GYM };
  if (!isUuid(noticeId)) return { ok: false, error: 'Unknown notice.' };
  const result = await call('/api/announcements', {
    method: 'DELETE',
    body: JSON.stringify({ tenant_id: tenantId, notice_id: noticeId }),
  });
  return { ok: result.ok, error: result.error };
}

/**
 * An expiry the owner picked in a date input has no time component, so it is
 * stored as the END of that day (23:59:59.999). Without this, a notice set to
 * expire "today" would vanish at midnight instead of lasting the day the owner
 * selected — the single most common way an expiry gets set wrong.
 */
export function endOfDayIso(dateInput: string): string | null {
  if (!dateInput) return null;
  const parsed = new Date(`${dateInput}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** YYYY-MM-DD for an <input type="date">, or '' when there is no expiry. */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}