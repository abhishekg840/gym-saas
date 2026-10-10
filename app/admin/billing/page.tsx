'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  IndianRupee,
  CalendarClock,
  Sparkles,
} from 'lucide-react';
import PageHeader from '@/components/page-header';
import { supabase } from '@/lib/supabase';
import { isUuid, readSession, daysUntil } from '@/lib/session';
import { openCashfreeCheckout, type CashfreeMode } from '@/lib/cashfree';

/**
 * /admin/billing — the owner's Vyroniq subscription screen (B2B SaaS billing).
 *
 * WHAT IT SHOWS
 * -------------
 *   * The gym's current plan, status and days remaining until it lapses.
 *   * Upgrade / Renew CTAs for Starter and Pro that open Cashfree checkout.
 *   * A recent platform-invoice ledger so an owner can see what they paid.
 *
 * THE MONEY FLOW (and why this screen never "activates" anything itself)
 * ---------------------------------------------------------------------
 *   1. Tapping a plan calls /api/super-admin/billing/create-order, which talks
 *      to Cashfree with the SERVER's secret key and returns a payment_session_id.
 *   2. That session id opens the Cashfree drop checkout (lib/cashfree.ts).
 *   3. Cashfree posts PAYMENT_SUCCESS_WEBHOOK to /api/webhooks/cashfree, which
 *      verifies the signature and — only then — activates the subscription.
 *
 * So a paid plan appears here after a short delay (the webhook round-trip), and
 * the status auto-refreshes while a payment is in flight. If Cashfree is not
 * configured the create-order route answers 503 and we say so plainly.
 */

interface BillingTenant {
  tenant_id: string;
  name: string;
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  trial_ends_at: string | null;
}

interface PlatformInvoice {
  id: string;
  order_id: string;
  plan_id: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
}

interface BillingStatus {
  tenant: BillingTenant;
  invoices: PlatformInvoice[];
}

const PLANS: {
  id: 'starter' | 'pro';
  name: string;
  monthly: number;
  blurb: string;
  features: string[];
}[] = [
  {
    id: 'starter',
    name: 'Starter',
    monthly: 799,
    blurb: 'For a single gym finding its feet.',
    features: ['Up to 300 members', 'QR gate + attendance', 'Member app & wallet', 'Email support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 1499,
    blurb: 'For a busy gym that wants the lot.',
    features: ['Unlimited members', 'Biometric + RFID hardware', 'Challenges, leads & store POS', 'Analytics & priority support'],
  },
];


export default function OwnerBillingPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ message: string; kind: 'ok' | 'bad' } | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

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

  const load = useCallback(async (tenant: string) => {
    const { data, error } = await supabase.rpc('fn_platform_billing_status', {
      p_tenant_id: tenant,
    });
    if (error) {
      setNotice({ message: 'Could not load your subscription. Has migration 0022 been run?', kind: 'bad' });
      setLoading(false);
      return;
    }
    const payload = (data ?? {}) as BillingStatus;
    setStatus(payload);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tenantId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load(tenantId);
    }
  }, [tenantId, load]);

  /**
   * Open Cashfree checkout for a plan. The subscription is NOT activated here —
   * the webhook does that once Cashfree confirms the payment — so after the
   * checkout resolves we refresh, and the caller (return_url landing) also
   * refreshes. A short delay gives the webhook time to land first.
   */
  const subscribe = useCallback(
    async (planId: 'starter' | 'pro') => {
      if (!tenantId) return;
      setBusyPlan(planId);
      setNotice(null);
      try {
        const res = await fetch('/api/super-admin/billing/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ tenant_id: tenantId, plan_id: planId, billing_cycle: 'monthly' }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          payment_session_id?: string;
          cashfree_env?: CashfreeMode;
          error?: string;
        };
        if (!res.ok || !json.ok || !json.payment_session_id) {
          setNotice({
            message: json.error ?? 'Could not start the payment. Please try again.',
            kind: 'bad',
          });
          return;
        }
        await openCashfreeCheckout(json.payment_session_id, json.cashfree_env ?? 'sandbox');
        // Give the webhook a moment, then reflect whatever landed.
        setNotice({ message: 'Payment window closed. Refreshing your subscription…', kind: 'ok' });
        window.setTimeout(() => void load(tenantId), 2500);
      } catch (err) {
        setNotice({
          message: err instanceof Error ? err.message : 'Could not open the payment window.',
          kind: 'bad',
        });
      } finally {
        setBusyPlan(null);
      }
    },
    [tenantId, load]
  );

  const tenant = status?.tenant ?? null;
  const tier = tenant?.subscription_tier ?? 'starter';
  const subStatus = tenant?.subscription_status ?? 'active';
  // Days remaining prefers the paid-through date; falls back to the trial end.
  const daysLeft = daysUntil(tenant?.subscription_expires_at ?? tenant?.trial_ends_at ?? null);

const STATUS_TONE: Record<string, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  trialing: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  suspended: 'border-rose-500/30 bg-rose-500/10 text-rose-700',
  expired: 'border-rose-500/30 bg-rose-500/10 text-rose-700',
  // Ledger rows reuse this map for their own status column.
  paid: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-700',
};

const fmtINR = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  const expiresOn = tenant?.subscription_expires_at ?? tenant?.trial_ends_at ?? null;
  const formattedExpiry = expiresOn
    ? new Date(expiresOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  const statusLabel =
    subStatus === 'trialing' ? 'Trial' : subStatus.charAt(0).toUpperCase() + subStatus.slice(1);
  const lapsed = subStatus === 'suspended' || subStatus === 'expired' || daysLeft < 0;
  const invoices = status?.invoices ?? [];

  if (loading) {
    return (
      <div className="vy-page vy-noscroll font-sans">
        <div className="vy-shell">
          <PageHeader
            icon={<CreditCard className="h-5 w-5" />}
            title="Billing & Subscription"
            subtitle="Loading your Vyroniq plan…"
          />
          <div className="vy-card flex items-center gap-3 p-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your subscription…
          </div>
        </div>
      </div>
    );
  }

  // Loaded but nothing to show: the RPC failed (or migration 0022 has not run).
  if (!tenant) {
    return (
      <div className="vy-page vy-noscroll font-sans">
        <div className="vy-shell">
          <PageHeader
            icon={<CreditCard className="h-5 w-5" />}
            title="Billing & Subscription"
            subtitle="Vyroniq platform plan"
          />
          <div className="vy-notice vy-notice-bad mb-5">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {notice?.message ??
                  'Could not load your subscription. Has migration 0022_phase22_dual_gate_billing.sql been run?'}
              </span>
            </span>
            {tenantId && (
              <button
                type="button"
                onClick={() => void load(tenantId)}
                className="vy-btn vy-btn-secondary shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vy-page vy-noscroll font-sans">
      <div className="vy-shell">
        <PageHeader
          icon={<CreditCard className="h-5 w-5" />}
          title="Billing & Subscription"
          subtitle={`${tenant.name} · Vyroniq platform plan`}
          actions={
            tenantId ? (
              <button
                type="button"
                onClick={() => void load(tenantId)}
                className="vy-btn vy-btn-secondary"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            ) : undefined
          }
        />

        {notice && (
          <div
            role="status"
            className={`vy-notice mb-5 ${notice.kind === 'ok' ? 'vy-notice-ok' : 'vy-notice-bad'}`}
          >
            <span className="flex items-start gap-2">
              {notice.kind === 'ok' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{notice.message}</span>
            </span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="vy-btn vy-btn-ghost shrink-0 text-xs"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ---- Where the gym stands right now ------------------------------ */}
        <section className="vy-card mb-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="vy-eyebrow">Current plan</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                <span className="text-lg font-semibold tracking-tight text-ink">
                  {tier === 'pro' ? 'Pro' : 'Starter'}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                    STATUS_TONE[subStatus] ?? STATUS_TONE.active
                  }`}
                >
                  {statusLabel}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                {lapsed
                  ? 'Your subscription has lapsed — renew to keep your gym on Vyroniq.'
                  : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining${
                      formattedExpiry ? ` · paid through ${formattedExpiry}` : ''
                    }`}
              </p>
            </div>
            <div className="text-right">
              <p className="vy-eyebrow">Paid through</p>
              <p className="mt-1.5 flex items-center justify-end gap-1.5 text-sm font-medium text-ink">
                <CalendarClock className="h-4 w-4 text-muted" />
                {formattedExpiry ?? 'Not yet subscribed'}
              </p>
            </div>
          </div>
        </section>

        {/* ---- Plans ------------------------------------------------------- */}
        <p className="vy-eyebrow mb-3">Plans · billed monthly via Cashfree</p>
        <section className="mb-6 grid gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === tier;
            const cta = isCurrent
              ? `Renew ${fmtINR(plan.monthly)}/mo`
              : plan.id === 'pro'
                ? 'Upgrade to Pro'
                : 'Switch to Starter';
            return (
              <article
                key={plan.id}
                className={`vy-card relative flex flex-col p-5 ${
                  isCurrent ? 'ring-2 ring-brand/40' : ''
                }`}
              >
                {isCurrent && (
                  <span className="absolute right-4 top-4 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Current plan
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand" />
                  <h2 className="text-[15px] font-semibold text-ink">{plan.name}</h2>
                </div>
                <p className="mt-1 text-[13px] text-muted">{plan.blurb}</p>
                <p className="mt-3 flex items-center gap-1 text-ink">
                  <IndianRupee className="h-4 w-4 text-muted" />
                  <span className="text-2xl font-semibold tracking-tight">
                    {plan.monthly.toLocaleString('en-IN')}
                  </span>
                  <span className="text-[13px] text-muted">/month</span>
                </p>
                <ul className="mt-3 space-y-1.5 text-[13px] text-ink-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busyPlan !== null || !tenantId}
                  onClick={() => void subscribe(plan.id)}
                  className={`vy-btn vy-btn-lg mt-4 w-full ${
                    isCurrent ? 'vy-btn-secondary' : 'vy-btn-brand'
                  }`}
                >
                  {busyPlan === plan.id ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening checkout…
                    </>
                  ) : (
                    cta
                  )}
                </button>
              </article>
            );
          })}
        </section>

        {/* ---- What the owner has paid Vyroniq ----------------------------- */}
        <section className="vy-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="vy-eyebrow">Platform invoices</h2>
            <span className="text-xs text-muted">{invoices.length} shown</span>
          </div>
          {invoices.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              No payments yet — your first invoice appears here right after checkout.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Plan
                  </th>
                  <th scope="col" className="hidden px-3 py-3 font-semibold sm:table-cell">
                    Order
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3 text-ink-2">
                      {new Date(invoice.paid_at ?? invoice.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-3 py-3 text-ink-2">
                      {invoice.plan_id === 'pro' ? 'Pro' : 'Starter'}
                      <span className="text-muted"> · {invoice.billing_cycle}</span>
                    </td>
                    <td className="hidden max-w-[10rem] truncate px-3 py-3 font-mono text-[11px] text-muted sm:table-cell">
                      {invoice.order_id}
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-ink">
                      {fmtINR(invoice.amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          STATUS_TONE[invoice.status] ?? 'border-line bg-wash text-muted'
                        }`}
                      >
                        {invoice.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="mt-4 text-xs text-muted">
          Payments are processed securely by Cashfree. Your plan activates automatically the moment
          the payment webhook confirms — no further action is needed after checkout.
        </p>
      </div>
    </div>
  );
}
