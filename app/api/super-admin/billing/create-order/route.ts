import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/super-admin/billing/create-order — open a Cashfree order for a gym
 * owner paying Vyroniq for their platform subscription (B2B SaaS billing).
 *
 * Body: { tenant_id, plan_id: 'starter' | 'pro', billing_cycle?: 'monthly' | 'yearly' }
 * Reply: { ok, order_id, payment_session_id, amount, currency, cashfree_env }
 *
 * FLOW
 * ----
 *   1. Resolve the owner's name / email / phone from the tenant + its gym_users
 *      so Cashfree's customer_details are real (a payment that bounces for a bad
 *      customer record is a support ticket, not revenue).
 *   2. Build a Cashfree order via POST {base}/pg/orders with the server's own
 *      APP_ID / SECRET_KEY and a return_url back into the owner billing screen.
 *   3. Record the PENDING order in public.platform_billing (fn_platform_record_order
 *      re-derives the amount from the plan id server-side, so a tampered body can
 *      never set the price). The webhook later reconciles by order_id.
 *
 * The payment_session_id is handed back to the client, which opens the Cashfree
 * drop checkout. The actual "subscription is now active" write happens ONLY in
 * the webhook (/api/webhooks/cashfree) after the signature is verified — never
 * here — so a client cannot self-activate a plan.
 *
 * This route has no server-verifiable session (the app runs on the anon key), so
 * it is the weakest link by design: the real gate is the webhook. The order is
 * still created against the correct tenant, and no money moves until Cashfree
 * confirms it and the signature checks out.
 */

type CashfreeEnv = 'sandbox' | 'production';

const PLAN_PRICES: Record<string, { monthly: number; yearly: number; label: string }> = {
  starter: { monthly: 799, yearly: 7990, label: 'Starter' },
  pro: { monthly: 1499, yearly: 14990, label: 'Pro' },
};

/** Cashfree's two API hosts. SANDBOX is the default so a fresh deploy is safe. */
function cashfreeBase(): { base: string; env: CashfreeEnv } {
  const raw = (process.env.CASHFREE_ENV ?? 'SANDBOX').trim().toUpperCase();
  if (raw === 'PRODUCTION') return { base: 'https://api.cashfree.com', env: 'production' };
  return { base: 'https://sandbox.cashfree.com', env: 'sandbox' };
}

function cashfreeCredentials(): { appId: string; secret: string } | null {
  const appId = process.env.CASHFREE_APP_ID?.trim();
  const secret = process.env.CASHFREE_SECRET_KEY?.trim();
  return appId && secret ? { appId, secret } : null;
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  // 1. Inputs.
  const tenantId = body.tenant_id ?? body.tenantId;
  if (!isUuid(tenantId)) return badRequest('tenant_id must be a valid UUID.', 403);

  const planId = String(body.plan_id ?? body.planId ?? '').trim().toLowerCase();
  if (!(planId in PLAN_PRICES)) {
    return badRequest("plan_id must be 'starter' or 'pro'.");
  }

  const billingCycleRaw = String(body.billing_cycle ?? body.billingCycle ?? 'monthly').trim().toLowerCase();
  const billingCycle = billingCycleRaw === 'yearly' ? 'yearly' : 'monthly';
  const amount = PLAN_PRICES[planId][billingCycle];

  // 2. Owner identity for Cashfree customer_details.
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name, owner_name, phone')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantError) return databaseError(tenantError, 'Could not load this gym for billing.');
  if (!tenant) return badRequest('Gym not found.', 404);

  // The owner's email is not on tenants; it lives on the owner's gym_users row.
  const { data: ownerRow } = await supabase
    .from('gym_users')
    .select('full_name, phone, email')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const customerName =
    (ownerRow?.full_name as string) || (tenant.owner_name as string) || (tenant.name as string) || 'Gym Owner';
  const customerPhone = phone10((ownerRow?.phone as string) || (tenant.phone as string));
  // Cashfree needs a syntactically valid email even when we have none on file;
  // a deterministic placeholder on our own domain keeps the order creatable and
  // is never used to contact anyone (the dashboard shows the real phone).
  const customerEmail =
    (ownerRow?.email as string)?.trim() || `billing+${String(tenantId).slice(0, 8)}@vyroniq.app`;

  if (!/^\d{10}$/.test(customerPhone)) {
    return badRequest('This gym has no valid owner phone number on file. Add one before subscribing.');
  }

  // 3. Credentials + Cashfree order.
  const creds = cashfreeCredentials();
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: 'Cashfree is not configured. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.' },
      { status: 503 }
    );
  }

  // A unique, human-traceable order id. Cashfree allows alphanumerics, '_' and '-'.
  const orderId = `vyr_${String(tenantId).replace(/-/g, '').slice(0, 12)}_${Date.now().toString(36)}`;

  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/admin/billing/status?order_id={order_id}`;

  const { base, env } = cashfreeBase();
  const cfResponse = await fetch(`${base}/pg/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': '2023-08-01',
      'x-client-id': creds.appId,
      'x-client-secret': creds.secret,
    },
    body: JSON.stringify({
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: String(tenantId),
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      },
      order_meta: {
        return_url: returnUrl,
      },
      order_note: `Vyroniq ${PLAN_PRICES[planId].label} plan (${billingCycle})`,
      order_tags: {
        tenant_id: String(tenantId),
        plan_id: planId,
        billing_cycle: billingCycle,
      },
    }),
  });

  const cfJson = (await cfResponse.json().catch(() => null)) as Record<string, unknown> | null;
  if (!cfResponse.ok || !cfJson?.payment_session_id) {
    const message =
      (cfJson?.message as string) || `Cashfree refused the order (HTTP ${cfResponse.status}).`;
    console.error('[billing/create-order] Cashfree error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // 4. Record the pending order so the webhook can reconcile by order_id.
  //    Best-effort: if the ledger write fails the payment can still proceed and
  //    the operator can reconcile by order_id, but we surface it so it is not
  //    silent. The amount here is advisory — fn_platform_record_order re-derives
  //    it from the plan id.
  const { error: ledgerError } = await supabase.rpc('fn_platform_record_order', {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_payment_session_id: String(cfJson.payment_session_id),
    p_plan_id: planId,
    p_billing_cycle: billingCycle,
    p_amount: amount,
  });
  if (ledgerError) {
    console.error('[billing/create-order] ledger write failed:', ledgerError.message);
  }

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    payment_session_id: String(cfJson.payment_session_id),
    amount,
    currency: 'INR',
    plan_id: planId,
    billing_cycle: billingCycle,
    // The client needs to know which SDK mode to boot (sandbox vs production).
    cashfree_env: env,
    ledger_recorded: !ledgerError,
  });
}


/** Keep only the digits a real owner phone would have; Cashfree wants 10 for IN. */
function phone10(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}
