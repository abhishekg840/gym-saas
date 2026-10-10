import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/onboarding/create-order — the stranger's step 1.
 *
 * Opens a Cashfree order for a *prospective* gym so the contract follows the
 * same path a paying gym takes: the owner never self-activates. All money
 * movement happens in fn_onboarding_record_order -> the webhook, keyed on
 * order_id; this route only authorises the application.
 *
 * Body: { name, phone, email, location, website?, notes? }
 * Reply: { ok, order_id, amount, currency, cashfree_env, payment_session_id }
 *
 * The order is recorded as PENDING in public.onboarding_requests. Once the
 * payment clears, fn_cashfree_dispatch provisions: tenant, owner, 30-day
 * starter tier, 5 member rows, and the default gym plan — so a smooth
 * payment is the only thing separating a visitor from a signed-in gym.
 */

type CashfreeEnv = 'sandbox' | 'production';

const PLAN_PRICES: Record<string, { monthly: number; yearly: number; label: string }> = {
  starter: { monthly: 799, yearly: 7990, label: 'Starter' },
};

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

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
  const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const location = typeof body.location === 'string' ? body.location.trim().slice(0, 200) : '';
  const website = typeof body.website === 'string' ? body.website.trim().slice(0, 500) : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : '';

  if (!name) return badRequest('name is required.');
  if (!phoneRaw) return badRequest('phone is required.');
  // Cashfree expects 10 digits for India; the webhook captures any number and
  // writes the customer record as-is. Keep the raw value — a nonlocal owner is
  // still a paying owner.
  const phone = phoneRaw.replace(/\D/g, '').slice(-10);

  // Step 1. Sanitise the caller's shape so the ledger cannot be flooded.
  const orderId = `onb_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

  // Step 2. Cashfree order for the prospective gym.
  const creds = cashfreeCredentials();
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: 'Cashfree is not configured. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.' },
      { status: 503 }
    );
  }

  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/onboard/success?order_id=${orderId}`;

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
      order_amount: PLAN_PRICES.starter.monthly,
      order_currency: 'INR',
      customer_details: {
        customer_id: orderId,
        customer_name: name,
        customer_email: emailRaw || undefined,
        customer_phone: phone,
      },
      order_meta: { return_url: returnUrl },
      order_note: `Vyroniq Starter on-boarding (${name})`,
      order_tags: { kind: 'onboarding_request', name, phone },
    }),
  });

  const cfJson = (await cfResponse.json().catch(() => null)) as Record<string, unknown> | null;
  if (!cfResponse.ok || !cfJson?.payment_session_id) {
    const message = (cfJson?.message as string) || `Cashfree refused the order (HTTP ${cfResponse.status}).`;
    console.error('[onboarding/create-order] Cashfree error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // Step 3. Record the PENDING order so the webhook can reconcile by order_id.
  //        fn_onboarding_record_order keeps the amount server-derived, so a
  //        tampered body can never reprice the payment.
  const { error: ledgerError } = await supabase.rpc('fn_onboarding_record_order', {
    p_order_id: orderId,
    p_payment_session_id: String(cfJson.payment_session_id),
    p_name: name,
    p_phone: phone,
    p_email: emailRaw || null,
    p_location: location || null,
    p_website: website || null,
    p_notes: notes || null,
    p_customer_id: orderId,
    p_plan_id: 'starter',
    p_billing_cycle: 'monthly',
  });

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    payment_session_id: String(cfJson.payment_session_id),
    amount: PLAN_PRICES.starter.monthly,
    currency: 'INR',
    plan_id: 'starter',
    billing_cycle: 'monthly',
    cashfree_env: env,
    ledger_recorded: !ledgerError,
  });
}

