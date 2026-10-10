import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/onboarding/status — the success page's poller.
 *
 * Reads the platform_billing ledger row by order_id (the single source of truth
 * for whether a payment cleared) and the onboarding_requests row for the
 * lifecycle status. Returns ok=true, paid=true the moment the ledger flips to
 * paid — the single moment the gym is live. Returns ok=false, failed=true when
 * the order is terminal (the webhook already ran and the order is rejected,
 * cancelled, or beyond its retry window).
 *
 * This is a read-only mirror of the ledger state; activation happened in the
 * webhook, which is the single source of truth.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get('order_id');
  if (!orderId) {
    return NextResponse.json({ ok: false, error: 'missing order_id' }, { status: 400 });
  }

  // Ledger row is the source of truth for the payment outcome.
  const { data: ledger, error: ledgerErr } = await supabase
    .from('platform_billing')
    .select('order_id, status, plan_id, billing_cycle, amount, paid_at')
    .eq('order_id', orderId)
    .single();

  if (ledgerErr) {
    // Row not present: either the order was never placed, or it cleared the wire
    // and the webhook never saw it. In the latter case the playground never got
    // an order_id; treat missing ledger as an empty poll until it appears.
    console.error('[onboarding/status] ledger read error:', ledgerErr.message);
    return NextResponse.json({
      ok: true,
      paid: false,
      failed: false,
      status: null,
      order_id: null,
      plan_id: null,
      billing_cycle: null,
      amount: 0,
      paid_at: null,
    });
  }

  // onboarding_requests carries the lifecycle decision (provisioned/failed).
  const { data: req, error: reqErr } = await supabase
    .from('onboarding_requests')
    .select('order_id, status, tenant_id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (reqErr) {
    console.error('[onboarding/status] request read error:', reqErr.message);
    return NextResponse.json({
      ok: true,
      paid: false,
      failed: false,
      status: null,
      order_id: ledger.order_id,
      plan_id: ledger.plan_id,
      billing_cycle: ledger.billing_cycle,
      amount: Number(ledger.amount ?? 0),
      paid_at: ledger.paid_at,
    });
  }

  // maybeSingle() returns null (no row) with no error when the order has not
  // produced an onboarding request yet — an order that cleared the wire but
  // whose webhook has not run, or a brand-new order. Report an empty poll.
  if (!req) {
    return NextResponse.json({
      ok: true,
      paid: false,
      failed: false,
      status: 'pending',
      order_id: ledger.order_id,
      tenant_id: null,
      plan_id: ledger.plan_id,
      billing_cycle: ledger.billing_cycle,
      amount: Number(ledger.amount ?? 0),
      paid_at: ledger.paid_at,
    });
  }

  const status = String(req.status ?? 'pending');
  const paid = status === 'provisioned';
  const failed = status === 'failed';

  return NextResponse.json({
    ok: true,
    paid,
    failed,
    status,
    order_id: req.order_id ?? null,
    tenant_id: req.tenant_id ?? null,
    plan_id: ledger.plan_id ?? null,
    billing_cycle: ledger.billing_cycle ?? null,
    amount: Number(ledger.amount ?? 0),
    paid_at: ledger.paid_at,
  });
}
