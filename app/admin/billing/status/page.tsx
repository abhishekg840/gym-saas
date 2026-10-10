'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, CreditCard, Loader2 } from 'lucide-react';
import PageHeader from '@/components/page-header';
import { supabase } from '@/lib/supabase';
import { isUuid, readSession } from '@/lib/session';

/**
 * /admin/billing/status — where Cashfree sends the owner back after checkout.
 *
 * The return_url is built in /api/super-admin/billing/create-order as
 * `${origin}/admin/billing/status?order_id={order_id}`; Cashfree substitutes the
 * real order id when it redirects (both the drop-checkout modal and a full-page
 * redirect end up here).
 *
 * This page ACTIVATES NOTHING. Activation already happened — or will happen —
 * in /api/webhooks/cashfree the instant Cashfree confirmed the payment and the
 * HMAC checked out. All this screen does is poll fn_platform_billing_status
 * until the ledger row for ?order_id flips to 'paid', then celebrate. Webhooks
 * are fast but not instant, so a handful of polls with a short gap is the
 * honest UX: "confirming…" rather than a premature success/failed claim.
 */

type Phase = 'checking' | 'active' | 'pending' | 'failed' | 'error';

interface InvoiceRow {
  id: string;
  order_id: string;
  plan_id: string;
  billing_cycle: string;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
}

interface BillingStatus {
  tenant: {
    name: string;
    subscription_tier: string;
    subscription_status: string;
    subscription_expires_at: string | null;
  };
  invoices: InvoiceRow[];
}

/** ~8 polls x 2.5 s ≈ 20 s of patience before we stop claiming "any second now". */
const MAX_POLLS = 8;
const POLL_MS = 2500;

export default function BillingReturnPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // Same guard as the billing screen: members never land here.
  useEffect(() => {
    const session = readSession();
    if (!session) {
      router.push('/login');
      return;
    }
    if (session.role === 'member') {
      router.replace('/member/dashboard');
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTenantId(isUuid(session.tenantId) ? session.tenantId : null);
  }, [router]);

  // Poll the owner read until this order's ledger row settles.
  useEffect(() => {
    if (!tenantId) return;
    const orderId = new URLSearchParams(window.location.search).get('order_id') ?? '';

    let cancelled = false;
    let polls = 0;

    const check = async () => {
      if (!orderId) {
        setPhase('error');
        setDetail('This return link has no order_id, so there is nothing to confirm.');
        return;
      }
      const { data, error } = await supabase.rpc('fn_platform_billing_status', {
        p_tenant_id: tenantId,
      });
      if (cancelled) return;
      if (error) {
        setPhase('error');
        setDetail('Could not read your subscription. Has migration 0022 been run?');
        return;
      }
      const payload = (data ?? {}) as BillingStatus;
      setStatus(payload);
      const row = payload.invoices.find((entry) => entry.order_id === orderId) ?? null;
      setInvoice(row);

      if (row?.status === 'paid') {
        setPhase('active');
        return;
      }
      if (row?.status === 'failed') {
        setPhase('failed');
        return;
      }
      polls += 1;
      if (polls >= MAX_POLLS) {
        // Out of patience: either the webhook is still in flight, or the
        // best-effort ledger write missed and an operator must reconcile.
        setPhase(row ? 'pending' : 'error');
        if (!row) {
          setDetail(
            'This order has not reached the ledger yet. It usually appears within seconds — check back shortly or contact support with your order id.'
          );
        }
        return;
      }
      timerRef.current = window.setTimeout(() => void check(), POLL_MS);
    };

    void check();
    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [tenantId]);

  const planLabel = invoice?.plan_id === 'pro' || status?.tenant.subscription_tier === 'pro'
    ? 'Pro'
    : 'Starter';
  const paidThrough = status?.tenant.subscription_expires_at
    ? new Date(status.tenant.subscription_expires_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <div className="vy-page vy-noscroll font-sans">
      <div className="vy-shell">
        <PageHeader
          backHref="/admin/billing"
          icon={<CreditCard className="h-5 w-5" />}
          title="Payment status"
          subtitle={`${status?.tenant.name ?? 'Your gym'} · order ${invoice?.order_id ?? '…'}`}
        />

        {phase === 'checking' && (
          <div className="vy-card flex flex-col items-center gap-3 p-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
            <p className="text-sm font-medium text-ink">Confirming your payment…</p>
            <p className="max-w-md text-[13px] text-muted">
              Cashfree is verifying the payment with your bank. This usually takes a few seconds —
              your plan activates automatically the moment it lands.
            </p>
          </div>
        )}

        {phase === 'active' && (
          <div className="vy-card flex flex-col items-center gap-3 p-10 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </span>
            <p className="text-[15px] font-semibold text-ink">
              Payment received — {planLabel} is active
            </p>
            {invoice && (
              <p className="text-[13px] text-muted">
                {invoice.billing_cycle === 'yearly' ? 'Annual' : 'Monthly'} plan ·{' '}
                ₹{Number(invoice.amount || 0).toLocaleString('en-IN')} paid
                {paidThrough ? ` · paid through ${paidThrough}` : ''}
              </p>
            )}
            <Link href="/admin/billing" className="vy-btn vy-btn-lg vy-btn-brand mt-2">
              Back to Billing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {phase === 'pending' && (
          <div className="vy-card flex flex-col items-center gap-3 p-10 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
              <Clock className="h-6 w-6 text-amber-600" />
            </span>
            <p className="text-[15px] font-semibold text-ink">Payment still processing</p>
            <p className="max-w-md text-[13px] text-muted">
              Your bank has not confirmed the debit yet. Keep this tab open — we keep checking for
              about 20 seconds, and the plan turns on by itself once the payment clears.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="vy-btn vy-btn-lg vy-btn-secondary mt-1"
            >
              Check again
            </button>
          </div>
        )}

        {phase === 'failed' && (
          <div className="vy-card flex flex-col items-center gap-3 p-10 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10">
              <AlertTriangle className="h-6 w-6 text-rose-600" />
            </span>
            <p className="text-[15px] font-semibold text-ink">Payment did not go through</p>
            <p className="max-w-md text-[13px] text-muted">
              Cashfree reported this order as failed — no money was captured. You can try again
              from the billing screen.
            </p>
            <Link href="/admin/billing" className="vy-btn vy-btn-lg vy-btn-brand mt-1">
              Back to Billing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {phase === 'error' && (
          <div className="vy-card flex flex-col items-center gap-3 p-10 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10">
              <AlertTriangle className="h-6 w-6 text-rose-600" />
            </span>
            <p className="text-[15px] font-semibold text-ink">Could not confirm this payment</p>
            <p className="max-w-md text-[13px] text-muted">{detail}</p>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="vy-btn vy-btn-lg vy-btn-secondary"
              >
                Try again
              </button>
              <Link href="/admin/billing" className="vy-btn vy-btn-lg vy-btn-brand">
                Back to Billing
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

