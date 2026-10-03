'use client';

import { useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';

/**
 * First-login password onboarding (Module 6).
 *
 * Members enrolled at the desk share whatever PIN the gym typed for them. Until
 * they set their own, that credential is effectively public knowledge for anyone
 * who ever sat at that desk. This screen BLOCKS the app until they have chosen
 * one — not a dismissible nag.
 *
 * Two cases, handled honestly:
 *
 *   1. The member signed in with Google, so a Supabase auth session exists and
 *      supabase.auth.updateUser({ password }) genuinely changes their secret.
 *   2. The member signed in with their gym number / @handle. There is no auth
 *      account, so there is nothing to set. The API answers 409 and this screen
 *      explains it rather than spinning forever.
 *
 * The same rules are enforced server-side in /api/member/account and by
 * Supabase Auth; this copy exists so the member is never told "too weak" only
 * after submitting.
 */

const INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15';

export const PASSWORD_RULES = [
  'At least 8 characters',
  'At least one letter and one number',
  'The two passwords must match',
] as const;

interface PasswordGateProps {
  memberId: string | null;
  name: string;
  /** Called once the password is set, so the parent can drop the gate. */
  onDone: () => void;
  onFlash: (message: string, kind?: 'ok' | 'bad') => void;
  /**
   * Phase 12: lets the member dismiss the gate.
   *
   * This screen used to be genuinely blocking, and that trapped a real and common
   * case: a member enrolled at the desk has NO Supabase auth account, so
   * `updateUser({ password })` answers 409 and there is nothing they can do about
   * it. They were stuck on "Secure your Vyroniq account" with no way forward —
   * locked out of a gym they had just paid for.
   *
   * Skipping does NOT mark the password as set. password_setup_completed stays
   * false, so the app can keep reminding them later from a non-blocking place. It
   * simply lets them use the gym now, which is what they actually came to do.
   */
  onSkip?: () => void;
}

export default function PasswordGate({ memberId, name, onDone, onFlash, onSkip }: PasswordGateProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!memberId) return;

    // Cheap local checks first so the common mistakes never cost a round trip.
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/member/account', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: memberId,
          action: 'password_setup',
          password,
          confirm,
        }),
      });

      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!result.ok) {
        setError(result.error ?? 'Could not set that password.');
        return;
      }

      onFlash('Your account is now secured.', 'ok');
      onDone();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-lg shadow-teal-600/20">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-extrabold tracking-tight">
            Secure your Vyroniq account
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            {name ? `Hi ${name.split(' ')[0]} — ` : ''}set a password of your own so nobody
            else can use your membership at the gate.
          </p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                New password
              </label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className={`${INPUT} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShow((value) => !value)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:text-slate-700"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Confirm password
              </label>
              <input
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                placeholder="Type it again"
                className={INPUT}
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700"
            >
              {error}
            </p>
          )}

          <ul className="mt-3 space-y-1">
            {PASSWORD_RULES.map((rule) => (
              <li key={rule} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Check className="h-3 w-3 shrink-0 text-teal-600" />
                {rule}
              </li>
            ))}
          </ul>

          <button
            type="submit"
            disabled={busy || !memberId}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Save and continue
          </button>

          {/*
            PHASE 13 — the "Skip for now" escape hatch is GONE, and that is the
            point of this change.

            It existed to stop the blocking setup screen trapping desk-enrolled
            members. Now that the flow actually WORKS (the credential is written
            as a bcrypt hash by fn_member_set_password, so no auth.users row is
            needed), there is nothing left to skip past: a member who lands here
            has already authenticated with a temporary password and has one
            meaningful action left, which is to replace it.

            Leaving a Skip here would reintroduce exactly the bypass this work
            removes — an account whose owner walks away from the screen still
            holding a desk-issued PIN.

            A member who genuinely cannot proceed (no idea what their PIN is)
            is handled by the DESK, via fn_member_issue_temp_password, which
            requires the owner to prove their own credential first.
          */}
        </form>

        <p className="mt-4 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-slate-400">
          <KeyRound className="mt-0.5 h-3 w-3 shrink-0" />
          You can still sign in with your gym number or @handle. This password is an
          additional way in, never the only one — a forgotten password cannot lock you
          out of the gym.
        </p>
      </div>
    </div>
  );
}