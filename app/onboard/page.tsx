'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Building2,
  Phone,
  Mail,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

type Step = 'info' | 'confirm' | 'success';

interface FormState {
  name: string;
  phone: string;
  email: string;
  location: string;
  website: string;
  notes: string;
}

export default function OnboardPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('info');
  const [form, setForm] = useState<FormState>({
    name: '',
    phone: '',
    email: '',
    location: '',
    website: '',
    notes: '',
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (next: Step) => {
    if (next === 'success') {
      setStep('success');
      return;
    }
    setStep(next);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDirty(true);
    setBusy(true);

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      location: form.location.trim(),
      website: form.website.trim(),
      notes: form.notes.trim(),
    };

    try {
      const res = await fetch('/api/onboarding/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      if (!body.ok) {
        setError(body.error || 'Could not open the payment page.');
        return;
      }

      router.push(`/onboard/success?order_id=${body.order_id}`);
    } catch {
      setError('Could not reach the payment service. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'vy-input vy-input-sm flex w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10';

  return (
    <div className="mx-auto flex max-w-2xl flex-col px-4 py-10 sm:px-6 lg:px-8">
      {step !== 'success' && (
        <header className="mb-8">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <h1 className="vy-h1 mt-2">On-board a new gym</h1>
          <p className="mt-1 max-w-md text-[15px] text-muted">
            Fill in the basics. A Cashfree order opens the moment you press
            continue; the plan turns on automatically once the payment clears.
          </p>
        </header>
      )}

      {step === 'info' && (
        <div>
          <form className="vy-card space-y-5 p-6" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="vy-label" htmlFor="name">Gym name</label>
                <input
                  id="name"
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Sunrise Athletics"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="vy-label" htmlFor="phone">
                  Owner phone <span className="text-ink/50">(10 digits)</span>
                </label>
                <input
                  id="phone"
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="9569272339"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="vy-label" htmlFor="email">Owner email</label>
                <input
                  id="email"
                  type="email"
                  className={inputClass}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="owner@mygyms.com"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="vy-label" htmlFor="location">Location</label>
                <input
                  id="location"
                  className={inputClass}
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Mumbai, MH 400097"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="vy-label" htmlFor="website">Website <span className="text-ink/50">(optional)</span></label>
              <input
                id="website"
                className={inputClass}
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="https://mygyms.com"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="vy-label" htmlFor="notes">Notes <span className="text-ink/50">(optional)</span></label>
              <textarea
                id="notes"
                className={`${inputClass} min-h-[80px]`}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Anything the onboarding team should know..."
              />
            </div>

            {error && (
              <p className="vy-message vy-message-error flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => go('info')}
                className="flex-1 vy-btn vy-btn-secondary"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="submit"
                disabled={busy || !dirty}
                className="flex-1 vy-btn vy-btn-brand flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Continue to payment
              </button>
            </div>
          </form>
        </div>
      )}

      {step === 'confirm' && (
        <div className="vy-card flex flex-col items-center gap-6 p-8 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand/10">
            <CheckCircle2 className="h-7 w-7 text-brand" />
          </span>
          <h2 className="vy-h2">Almost there</h2>
          <p className="max-w-md text-[15px] text-muted">
            A Cashfree order has been opened for{' '}
            <span className="font-semibold text-ink">{form.name}</span> at{' '}
            <span className="font-semibold text-ink">
              {form.location || 'your location'}
            </span>
            . The payment opens in a few seconds � once the card clears, the gym
            is provisioned and you will be signed in automatically.
          </p>
          <div className="max-w-sm space-y-2 text-left text-sm text-muted">
            <p className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0" />
              {form.name} � Starter tier
            </p>
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0" />
              Owner: {form.name} � {form.phone}
            </p>
            {form.email && (
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0" />
                {form.email}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Link href="/onboard" className="vy-btn vy-btn-secondary">
              <ArrowLeft className="h-4 w-4" />
              Edit details
            </Link>
            <Link
              href="/onboard/success"
              className="vy-btn vy-btn-brand"
            >
              Open payment page
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
