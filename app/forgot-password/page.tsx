'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ArrowRight, Lock, Mail, Phone, UserRound } from 'lucide-react';
import Link from 'next/link';

const INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const value = identifier.trim();
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

    if (looksLikeEmail) {
      // Supabase Auth email-based reset — works for owners/staff who signed up
      // via Google (Supabase Auth) or any email-linked auth identity.
      const { error } = await supabase.auth.resetPasswordForEmail(value, {
        redirectTo: `${window.location.origin}/setup-password`,
      });

      if (error) {
        setError(error.message ?? 'Could not send the reset email.');
        setBusy(false);
        return;
      }

      setSent(true);
      setSentTo(value);
      setBusy(false);
      return;
    }

    // Gym number / @handle — these live in Postgres, not Supabase Auth, so the
    // desk must issue a temporary password. Point them at the right flow.
    setError(
      'Use the email address on your gym account. If you signed in with your gym number instead, ask the front desk to issue a temporary password.'
    );
    setBusy(false);
  }

  if (sent) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 mx-auto mb-4">
            <Mail className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Reset link sent</h1>
          <p className="mt-2 text-sm text-slate-500">
            We sent a password-reset link to <strong>{sentTo}</strong>. Open it from the same device/browser you signed in with, then choose a new password.
          </p>
          <p className="mt-4 text-[11px] text-slate-400">
            Didn't receive it? Check your spam folder, or ask the front desk to issue a temporary password.
          </p>
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Back to sign in <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 mx-auto mb-4">
          <Lock className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Forgot your password?</h1>
        <p className="mt-2 text-sm text-slate-500">
          Enter the email address on your gym account. We'll send a reset link.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15">
            <UserRound className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              id="forgot-email"
              type="email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="name@email.com"
              autoComplete="email"
              className="w-full bg-transparent border-none outline-none text-sm text-slate-900 placeholder:text-slate-400"
            />
          </div>

          {error && (
            <p role="alert" className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="mt-6 flex items-center gap-2 text-[11px] text-slate-400">
          <Phone className="h-3 w-3 shrink-0" />
          Signed in with your gym number instead? Ask the front desk to issue a
          temporary password — you'll set your own at first sign-in.
        </p>
        <p className="mt-2 text-[11px] text-slate-400">
          Already remember it?{' '}
          <Link href="/login" className="text-emerald-600 hover:text-emerald-700 font-medium transition">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
