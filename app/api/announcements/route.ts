import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * /api/announcements — the owner's notice board (Module 4.1.3).
 *
 *   GET    ?tenant_id=...              -> { ok, announcements[] }  (drafts included)
 *   POST   { tenant_id?, notice }      -> { ok, announcement }     (create/update)
 *   DELETE { tenant_id?, notice_id }   -> { ok, deleted }
 *
 * gym_announcements is revoked from PostgREST (Phase 5), so this route is the
 * ONLY way a notice can be written. It forwards to SECURITY DEFINER functions
 * that re-check tenant ownership, which is why a notice id belonging to another
 * gym comes back as a 404 rather than being edited.
 *
 * The member-facing read is deliberately NOT here: members go through
 * fn_announcements_feed via the companion bundle, so an unpublished or expired
 * notice can never leak through an owner endpoint.
 */

const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

const NOTICE_TYPES = ['general', 'alert', 'event', 'maintenance', 'offer'] as const;

/** ISO timestamp or null. An empty string from a date input means "no expiry". */
function parseExpiry(raw: unknown): { value: string | null } | null {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  return { value: date.toISOString() };
}

function asBool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  return String(raw) === 'true';
}

export async function GET(request: Request) {
  const tenantId = resolveTenant([new URL(request.url).searchParams.get('tenant_id')], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const { data, error } = await supabase.rpc('fn_announcements_admin_list', {
    p_tenant_id: tenantId,
  });
  if (error) return databaseError(error, 'Could not load announcements.');

  return NextResponse.json({ ok: true, announcements: Array.isArray(data) ? data : [] });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  // Either a whole notice, or the fields nested under `notice`. Accepting both
  // keeps the route usable from a plain form post and from the JSON client.
  const source = (body.notice && typeof body.notice === 'object'
    ? body.notice
    : body) as Record<string, unknown>;

  const noticeId = isUuid(source.id ?? source.notice_id) ? String(source.id ?? source.notice_id) : null;
  const title = String(source.title ?? '').trim();
  const noticeBody = String(source.body ?? source.message ?? '').trim();

  if (title.length < 3) return badRequest('Give the notice a title (at least 3 characters).');
  if (noticeBody.length === 0) return badRequest('Write the notice text before saving.');
  if (noticeBody.length > 2000) return badRequest('Keep the notice under 2000 characters.');

  const type = String(source.type ?? 'general').trim().toLowerCase();
  if (!(NOTICE_TYPES as readonly string[]).includes(type)) {
    return badRequest(`type must be one of: ${NOTICE_TYPES.join(', ')}.`);
  }

  const expires = parseExpiry(source.expires_at ?? source.expiresAt);
  if (!expires) return badRequest('That expiry date could not be read.');

  const { data, error } = await supabase.rpc('fn_announcements_upsert', {
    p_tenant_id: tenantId,
    p_id: noticeId,
    p_title: title,
    p_body: noticeBody,
    p_type: type,
    p_is_pinned: asBool(source.is_pinned ?? source.isPinned, false),
    p_is_published: asBool(source.is_published ?? source.isPublished, true),
    p_expires_at: expires.value,
  });

  if (error) return databaseError(error, 'Could not save that notice.');
  return NextResponse.json({ ok: true, announcement: data }, { status: noticeId ? 200 : 201 });
}

export async function DELETE(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const noticeId = body.notice_id ?? body.noticeId ?? body.id;
  if (!isUuid(noticeId)) return badRequest('notice_id must be a valid UUID.');

  const { error } = await supabase.rpc('fn_announcements_delete', {
    p_tenant_id: tenantId,
    p_id: noticeId,
  });
  if (error) return databaseError(error, 'Could not delete that notice.');

  return NextResponse.json({ ok: true, deleted: true, notice_id: noticeId });
}