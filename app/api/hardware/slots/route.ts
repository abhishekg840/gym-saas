import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError } from '@/lib/sqlstate';

/**
 * GET /api/hardware/slots?tenant_id=…  ->  { ok, slot }
 *
 * The next free fingerprint slot for a gym, used to pre-fill the enrollment form.
 *
 * WHY THIS EXISTS INSTEAD OF A client-side MAX(biometric_id) + 1
 * ----------------------------------------------------------------
 * That query is wrong under concurrency. Two receptionists enrolling at the same
 * moment both read the same MAX and both write it, and the unique index on
 * (tenant_id, biometric_id) then turns one of them into an opaque 23505. The
 * allocation is done in fn_next_biometric_slot (migration 0012) under a
 * transaction-scoped advisory lock, so the read and the write cannot interleave.
 *
 * This route is a thin wrapper for the same reason every other data call in this
 * app is: the browser never touches a table directly, it asks for one gym's data
 * through a server route that resolves the tenant from the request or the cookie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('tenant_id');
  const tenantId = isUuid(fromQuery) ? fromQuery : readTenantCookie(request);

  if (!tenantId) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  const { data, error } = await supabase.rpc('fn_next_biometric_slot', {
    p_tenant_id: tenantId,
  });

  if (error) {
    return databaseError(
      error,
      'Could not work out the next fingerprint slot. Is migration 0012 applied?'
    );
  }

  return NextResponse.json({ ok: true, slot: typeof data === 'number' ? data : null });
}