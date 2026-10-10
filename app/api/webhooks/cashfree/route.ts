import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabase } from '@/lib/supabase';

/**
 * POST /api/webhooks/cashfree — Cashfree -> Vyroniq platform billing.
 *
 * THE ONE JOB
 * -----------
 * On PAYMENT_SUCCESS_WEBHOOK, activate the paying gym's platform subscription.
 * That write (tenants.subscription_tier / status / expires_at) runs inside
 * fn_platform_activate_subscription, which also marks the ledger row paid, in
 * ONE idempotent transaction keyed on order_id.
 *
 * WHY THE SIGNATURE IS CHECKED ON THE RAW BODY
 * --------------------------------------------
 * Cashfree signs the EXACT bytes it sent: signature = base64(HMAC-SHA256(
 * timestamp + rawBody, SECRET_KEY)). Parsing and re-serialising the JSON — even
 * a byte-identical-looking pretty-print — changes the bytes and breaks the HMAC.
 * So this handler reads request.text() ONCE, verifies against that string, and
 * only then parses. The comparison is constant-time (timingSafeEqual) so a
 * wrong signature cannot be discovered byte-by-byte.
 *
 * WHY 200 ON EVERYTHING (EXCEPT A BAD SIGNATURE)
 * ----------------------------------------------
 * A verified-but-unprocessable event (unknown order, an already-paid order) is
 * still a 200: the webhook was genuine, and a non-2xx only makes Cashfree retry
 * a payment that already succeeded. A FAILED signature is a 401 — that request
 * did not come from Cashfree and must not be retried into a success.
 *
 * This route is deliberately NOT gated by CRON_SECRET or any session: Cashfree
 * calls it with no credentials of ours. The HMAC IS the authentication.
 */

/** The event type that means "money arrived". */
const PAYMENT_SUCCESS = 'PAYMENT_SUCCESS_WEBHOOK';

function cashfreeSecret(): string | null {
  return process.env.CASHFREE_SECRET_KEY?.trim() || null;
}

/**
 * Verify the Cashfree signature over the raw payload.
 *   expected = base64( HMAC-SHA256( timestamp + rawBody, secretKey ) )
 * `timestamp` comes from the x-webhook-timestamp header, the signature from
 * x-webhook-signature. Returns true only on an exact, length-safe match.
 */
function verifySignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  if (!timestamp || !signature) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}${rawBody}`).digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  // Length check first so timingSafeEqual never throws on a mismatched buffer.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secret = cashfreeSecret();
  if (!secret) {
    // Fail closed: without the secret we cannot prove the request is Cashfree's,
    // and silently trusting it would let anyone activate any subscription.
    console.error('[webhooks/cashfree] CASHFREE_SECRET_KEY is not set; refusing webhook.');
    return NextResponse.json({ ok: false, error: 'Webhook not configured.' }, { status: 503 });
  }

  // Read the body ONCE, as text, for the signature. Never re-read request.json().
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-webhook-timestamp') ?? '';
  const signature = request.headers.get('x-webhook-signature') ?? '';

  if (!verifySignature(rawBody, timestamp, signature, secret)) {
    console.warn('[webhooks/cashfree] signature verification failed; refusing.');
    return NextResponse.json({ ok: false, error: 'Invalid signature.' }, { status: 401 });
  }

  // Verified — now it is safe to parse.
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed payload.' }, { status: 400 });
  }

  const type = typeof event.type === 'string' ? event.type : '';
  if (type !== PAYMENT_SUCCESS) {
    // A genuine, signed event we do not act on (refund, etc.). Acknowledge it.
    return NextResponse.json({ ok: true, ignored: true, type });
  }

  const data = (event.data ?? {}) as Record<string, unknown>;
  const order = (data.order ?? {}) as Record<string, unknown>;
  const payment = (data.payment ?? {}) as Record<string, unknown>;

  const orderId = typeof order.order_id === 'string' ? order.order_id : null;
  const paymentId =
    typeof payment.cf_payment_id === 'string'
      ? payment.cf_payment_id
      : typeof data.cf_payment_id === 'string'
        ? (data.cf_payment_id as string)
        : null;

  if (!orderId) {
    // Signed, but no order to reconcile against. Acknowledge so Cashfree stops
    // retrying; there is nothing to activate.
    return NextResponse.json({ ok: true, ignored: true, reason: 'no order_id' });
  }

  // The single money-moving write. fn_platform_activate_subscription reads the
  // pending ledger row (so it activates the plan that was actually ordered),
  // extends the expiry, marks the ledger paid, and is idempotent on order_id.
  const { data: result, error } = await supabase.rpc('fn_platform_activate_subscription', {
    p_order_id: orderId,
    p_payment_id: paymentId,
  });

  if (error) {
    // A genuine payment we could not record. 500 so Cashfree retries — the RPC
    // is idempotent, so a retry is safe and eventually succeeds once the cause
    // (e.g. an un-run migration) is fixed.
    console.error('[webhooks/cashfree] activation failed:', error.message);
    return NextResponse.json({ ok: false, error: 'Activation failed.' }, { status: 500 });
  }

  const payload = (result ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    order_id: orderId,
    already_paid: Boolean(payload.already_paid),
    subscription_tier: payload.subscription_tier ?? null,
    subscription_expires_at: payload.subscription_expires_at ?? null,
  });
}
