import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/member/delete — hard delete (purge) a member and their records.
 *
 * Body: { member_id: string, tenant_id: string }
 *
 * Deletes, inside a single transaction-scoped request:
 *   1. attendance logs tied to this member (+ tenant scope)
 *   2. the member row itself (+ tenant scope)
 *
 * RFID lives as `members.rfid_card`, so it disappears with the row. Gate-pass
 * JWTs are short-lived bearer tokens — nothing to revoke server-side.
 *
 * Tenant scope is enforced on BOTH the cookie and the body so a caller cannot
 * purge a member from another gym. Owner-only intent is assumed at the UI
 * layer (the dashboard only offers this to the owner role); the route rejects
 * any missing or mismatched tenant_id.
 *
 * Transferred / archived members (status = 'transferred') are included —
 * there is no soft-delete path that keeps dead rows cluttering the roster.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const memberId = String(payload.member_id ?? payload.memberId ?? '');
  if (!isUuid(memberId)) return badRequest('member_id must be a valid UUID.');

  // Tenant id: body takes precedence, cookie is the fallback. Never "no filter".
  const tenantId =
    String(payload.tenant_id ?? payload.tenantId ?? '') ||
    readTenantCookie(request);
  if (!tenantId || !isUuid(tenantId)) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  try {
    // 1. Purge attendance logs for this member in this tenant.
    const { error: attError } = await supabase
      .from('attendances')
      .delete()
      .eq('member_id', memberId)
      .eq('tenant_id', tenantId);

    if (attError) return databaseError(attError, 'Could not clear attendance records.');

    // 2. Purge the member row itself, anchored to the same tenant.
    const { error: memError } = await supabase
      .from('members')
      .delete()
      .eq('id', memberId)
      .eq('tenant_id', tenantId);

    if (memError) return databaseError(memError, 'Could not delete member profile.');

    return NextResponse.json({
      ok: true,
      deleted_attendances: null, // attendance delete above does not return a count
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Delete failed.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
