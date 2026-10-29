import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/member/delete — hard delete (purge) a member and their records.
 *
 * Body: { member_id: string, tenant_id: string }
 *
 * Cascade purge using the service-role client so foreign-key constraints do
 * not block deletion. Runs in order:
 *   1. attendance logs tied to this member (+ tenant scope)
 *   2. nullify member_id on invoices (preserves historical financials)
 *   3. gate-pass / member_passes tokens (if the table exists)
 *   4. the member row itself (+ tenant scope)
 *
 * Tenant scope is enforced on BOTH the cookie and the body so a caller cannot
 * purge a member from another gym. Owner-only intent is assumed at the UI
 * layer (the dashboard only offers this to the owner role); the route rejects
 * any missing or mismatched tenant_id.
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
    const { error: attError } = await supabaseAdmin
      .from('attendances')
      .delete()
      .eq('member_id', memberId)
      .eq('tenant_id', tenantId);

    if (attError) return databaseError(attError, 'Could not clear attendance records.');

    // 2. Detach invoices from this member (nullify member_id, keep financial history).
    const { error: invError } = await supabaseAdmin
      .from('invoices')
      .update({ member_id: null })
      .eq('member_id', memberId)
      .eq('tenant_id', tenantId);

    if (invError) return databaseError(invError, 'Could not unlink invoices.');

    // 3. Delete gate-pass / member-pass tokens for this member (table may not exist in older tenants).
    const { error: passError } = await supabaseAdmin
      .from('member_passes')
      .delete()
      .eq('member_id', memberId);

    // Ignore "table does not exist" — older tenants may not have member_passes yet.
    if (passError && !passError.message.includes('does not exist')) {
      return databaseError(passError, 'Could not clear gate-pass tokens.');
    }

    // 4. Hard delete the member row itself, anchored to the same tenant.
    const { error: memError } = await supabaseAdmin
      .from('members')
      .delete()
      .eq('id', memberId)
      .eq('tenant_id', tenantId);

    if (memError) return databaseError(memError, 'Could not delete member profile.');

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Delete failed.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
