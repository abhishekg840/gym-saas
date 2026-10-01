import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * /api/store/pickups — the desk fulfilment queue (Module 3.4 + Phase 5).
 *
 *   GET  ?tenant_id=...                                  -> { ok, count, pickups[] }
 *   POST { tenant_id, reservation_id, action, payment_method?, } -> { ok, ... }
 *
 * A member can reserve an item from the companion app, which only writes a
 * `pending` row. This is the other half: the counter sees the queue, hands the
 * item over and bills it in one transaction (fn_store_complete_pickup), or closes
 * a reservation nobody collected (fn_store_cancel_reservation).
 *
 * store_reservations is revoked from anon/authenticated, so every read and write
 * here goes through a SECURITY DEFINER function scoped by tenant_id: one gym can
 * never see or hand over another gym's reservations.
 *
 * A completed pickup returns the same shape as a counter sale receipt, so the POS
 * receipt panel renders a desk pickup and a walk-in sale identically.
 */

const MAX_METHOD = 30;

const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawTenant = url.searchParams.get('tenant_id');
  const tenantId = isUuid(rawTenant) ? rawTenant : readTenantCookie(request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const { data, error } = await supabase.rpc('fn_store_pending_reservations', {
    p_tenant_id: tenantId,
  });

  if (error) return databaseError(error, 'Could not load the pickup queue.');

  const pickups = Array.isArray(data?.reservations) ? data.reservations : [];
  return NextResponse.json({ ok: true, count: pickups.length, pickups });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const rawTenant = body.tenant_id ?? body.tenantId;
  const tenantId = isUuid(rawTenant) ? rawTenant : readTenantCookie(request);
  if (!tenantId || !isUuid(tenantId)) return badRequest(MISSING_TENANT, 403);

  const reservationId = body.reservation_id ?? body.reservationId ?? body.id;
  if (!isUuid(reservationId)) return badRequest('reservation_id must be a valid UUID.');

  const action = String(body.action ?? 'complete').trim().toLowerCase();

  if (action === 'cancel') {
    const { data, error } = await supabase.rpc('fn_store_cancel_reservation', {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
    });

    if (error) return databaseError(error, 'Could not close that reservation.');

    return NextResponse.json({ ok: true, action: 'cancel', reservation: data });
  }

  if (action !== 'complete') {
    return badRequest("action must be either 'complete' or 'cancel'.");
  }

  const paymentMethod = String(body.payment_method ?? body.paymentMethod ?? '')
    .trim()
    .slice(0, MAX_METHOD);

  const { data, error } = await supabase.rpc('fn_store_complete_pickup', {
    p_tenant_id: tenantId,
    p_reservation_id: reservationId,
    p_payment_method: paymentMethod || null,
  });

  if (error) return databaseError(error, 'Could not complete this pickup.');

  // 201 mirrors /api/store/checkout: a pickup writes a new order row.
  return NextResponse.json({ ok: true, action: 'complete', receipt: data }, { status: 201 });
}
