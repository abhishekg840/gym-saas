'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ArrowRight, Clock, XCircle, AlertTriangle, Loader2 } from 'lucide-react';

type Phase = 'checking' | 'active' | 'failed' | 'error';

function OnboardSuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('order_id');
  const [phase, setPhase] = useState<Phase>('checking');
  const [detail, setDetail] = useState<string>('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    // No order id: there is nothing to poll. The render below shows the error
    // state directly, so this effect only ever runs for a real order.
    if (!orderId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch('/api/onboarding/status?order_id=' + orderId);
        const body = await res.json();
        if (cancelled) return;

        if (body.ok && body.paid) {
          setPhase('active');
          setDetail('Your Starter gym is live — the owner has been provisioned and is signed in.');
          setBusy(false);
          return;
        }
        if (body.failed) {
          setPhase('failed');
          setDetail(body.reason ?? 'We could not activate this order.');
          setBusy(false);
          return;
        }

        // Still in flight: keep the spinner honest and poll again.
        setDetail('Payment processing… we keep checking until it clears.');
        timer = setTimeout(poll, 2000);
      } catch {
        if (cancelled) return;
        setPhase('error');
        setDetail('Could not reach the provisioning service.');
        setBusy(false);
      }
    }

    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId]);

  // A manual re-check for the error / still-pending buttons: one fetch, no loop.
  async function fetchData() {
    if (!orderId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/onboarding/status?order_id=' + orderId);
      const body = await res.json();
      if (body.ok && body.paid) {
        setPhase('active');
        setDetail('Your Starter gym is live — the owner has been provisioned and is signed in.');
      } else if (body.failed) {
        setPhase('failed');
        setDetail(body.reason ?? 'We could not activate this order.');
      } else {
        setPhase('checking');
        setDetail('Still processing — we’ll keep checking.');
      }
    } catch {
      setPhase('error');
      setDetail('Could not reach the provisioning service.');
    } finally {
      setBusy(false);
    }
  }

  // A missing order id is a bad link, not a payment in flight — handled in the
  // render (not the effect) so we never call setState synchronously on mount.
  if (!orderId) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-10 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
          <AlertTriangle className="h-7 w-7 text-amber-600" />
        </span>
        <h1 className="vy-h1 mt-6">No order to confirm</h1>
        <p className="mt-2 max-w-md text-[15px] text-muted">
          This link is missing its order reference. Open the payment link from
          your confirmation, or start again.
        </p>
        <Link href="/onboard" className="vy-btn vy-btn-lg vy-btn-brand mt-6">
          Start again
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (phase === 'active') {
    return (
      <div className="mx-auto flex max-w-xl flex-col px-4 py-10 text-center">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-brand/10">
          <CheckCircle2 className="h-8 w-8 text-brand" />
        </span>
        <h1 className="vy-h1 mt-6">You are on board</h1>
        <p className="mt-2 text-[15px] text-muted">{detail}</p>
        <p className="mt-4 text-[13px] text-muted">
          The owner account has been provisioned and your gym is live. Keep this
          tab open — the plan is active for 30 days.
        </p>
        <Link
          href="/super-admin"
          className="vy-btn vy-btn-lg vy-btn-brand mt-6"
        >
          Go to the control center
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-10 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10">
          <XCircle className="h-7 w-7 text-rose-600" />
        </span>
        <h1 className="vy-h1 mt-6">Payment did not activate</h1>
        <p className="mt-2 max-w-md text-[15px] text-muted">{detail}</p>
        <Link
          href="/onboard"
          className="vy-btn vy-btn-lg vy-btn-brand mt-6"
        >
          Try again
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-10 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
          <AlertTriangle className="h-7 w-7 text-amber-600" />
        </span>
        <h1 className="vy-h1 mt-6">Could not confirm</h1>
        <p className="mt-2 max-w-md text-[15px] text-muted">{detail}</p>
        <button
          type="button"
          onClick={fetchData}
          className="vy-btn vy-btn-lg vy-btn-secondary mt-6"
        >
          Check again
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-10 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand/10">
        <Loader2 className="h-7 w-7 animate-spin text-brand" />
      </span>
      <h1 className="vy-h1 mt-6">Confirming payment</h1>
      <p className="mt-2 max-w-md text-[15px] text-muted">{detail}</p>
      <p className="mt-4 flex items-center gap-1.5 text-[13px] text-muted">
        <Clock className="h-3.5 w-3.5" />
        Keep this tab open — the plan turns on automatically once Cashfree
        confirms the payment.
      </p>
      {!busy && (
        <button
          type="button"
          onClick={fetchData}
          className="vy-btn vy-btn-lg vy-btn-secondary mt-6"
        >
          Check again
        </button>
      )}
    </div>
  );
}

export default function OnboardSuccessPage() {
  // useSearchParams() must sit inside a Suspense boundary so the page can be
  // statically prerendered; the page is a client island, so the fallback only
  // shows for the tick before search params are available.
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-10 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand/10">
            <Loader2 className="h-7 w-7 animate-spin text-brand" />
          </span>
          <h1 className="vy-h1 mt-6">Confirming payment</h1>
        </div>
      }
    >
      <OnboardSuccessContent />
    </Suspense>
  );
}
