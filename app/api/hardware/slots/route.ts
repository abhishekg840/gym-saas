import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError } from '@/lib/sqlstate';

/**
 * GET /api/hardware/slots?tenant_id=…  ->  { ok, slot }
 *
 * The next free fingerprint slot for a gym, used to pre-fill the enrollment
 * form. The allocation runs in fn_next_biometric_slot (migration 0012) under a
 * transaction-scoped advisory lock, so a client-side MAX(biometric_id) + 1 —
 * wrong under concurrency — is never used. The browser never touches a table
 * directly; it asks for one gym's data through this server route, which
 * resolves the tenant from the request or the cookie.
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