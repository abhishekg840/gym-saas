'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { readSession, writeSession } from '@/lib/session';

/**
 * /setup-password — Phase 13. The forced credential replacement.
 *
 * WHO LANDS HERE
 * --------------
 * Any account still holding a desk-issued or legacy PIN. /api/auth/login sets
 * requires_password_change, writes a VALID session, and routes here. The person is
 * never locked out — they are signed in, they just have one more step.
 *
 * WHY THIS EXISTS AT ALL
 * ---------------------
 * The previous flow (components/password-gate.tsx) called supabase.auth
 * .updateUser({ password }), which requires a Supabase Auth session. A
 * desk-enrolled member has no auth.users row, so it could never work, and the API
 * answered "there is no password to set here". The member was then stuck on a
 * blocking screen offering an action the system structurally could not perform.
 *
 * The credential now lives in Postgres as a bcrypt hash. This page calls
 * /api/auth/set-password, which forwards to fn_member_set_password /
 * fn_staff_set_password — no auth session required, no service_role key needed.
 *
 * SECURITY NOTE ON THE CURRENT-PASSWORD FIELD
 * -------------------------------------------
 * "Prove you know the current password" is enforced in SQL, not here. A caller
 * who knows only this person's identifier cannot silently change a credential
 * that already exists. That is why the field is genuinely required rather than an
 * optional convenience.
 */

const INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15';

const RULES = [
  { test: (v: string) => v.length >= 8, label: 'At least 8 characters' },
  {
    test: (v: string) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v),
    label: 'At least one letter and one number',
  },
  {
    test: (v: string) => !['1234', '12345678', 'password', 'password1'].includes(v),
    label: 'Not one of the most commonly guessed passwords',
  },
];
export default function SetupPasswordPage() {
  const router = useRouter();

  // The gym session, which login wrote before redirecting here.
  const session = readSession();
  const isMember = session?.role === 'member';

  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allRulesPass = RULES.every((rule) => rule.test(password));
  const matches = password === confirm && confirm !== '';
  const canSubmit = allRulesPass && matches && !busy;

  // No session: this page is only meaningful straight after a sign-in.
  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Sign in first</h1>
          <p className="mt-2 text-sm text-slate-500">
            This page replaces the password on the account you just signed in with.
          </p>
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700"
          >
            Go to sign in <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </main>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !session) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/set-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: isMember ? 'member' : session.role,
          member_id: isMember ? session.userId : undefined,
          user_id: isMember ? undefined : session.userId,
          current_password: current,
          new_password: password,
          confirm,
        }),
      });

      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !result.ok) {
        setError(result.error ?? 'Could not save that password.');
        return;
      }

      // Clear the forced-change flag IN the stored session before routing on.
      // Without this the next page load still reads passwordMustChange = true and
      // the user is sent straight back here forever.
      writeSession({ ...session, passwordMustChange: false });

      router.replace(isMember ? '/member/dashboard' : '/');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }
return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 ring-1 ring-teal-100">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
            {isMember ? 'Set your Vyroniq password' : 'Secure your gym account'}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Hi {session.name.split(' ')[0]} — you signed in with the temporary
            password your gym issued. Replace it with one only you know.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="space-y-3">
            <div>
              <label
                htmlFor="setup-current"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                Current temporary password / PIN
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                <input
                  id="setup-current"
                  type={show ? 'text' : 'password'}
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                  autoComplete="current-password"
                  placeholder="The PIN your gym gave you"
                  className={`${INPUT} pl-9`}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-new"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                New password
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                <input
                  id="setup-new"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className={`${INPUT} pl-9 pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShow((value) => !value)}
                  aria-label={show ? 'Hide passwords' : 'Show passwords'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:text-slate-700"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-confirm"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                Confirm new password
              </label>
              <input
                id="setup-confirm"
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
            {RULES.map((rule) => {
              const passed = rule.test(password);
              return (
                <li
                  key={rule.label}
                  className={`flex items-center gap-1.5 text-[11px] ${
                    passed ? 'text-teal-700' : 'text-slate-500'
                  }`}
                >
                  <Check
                    className={`h-3 w-3 shrink-0 ${passed ? 'text-teal-600' : 'text-slate-300'}`}
                  />
                  {rule.label}
                </li>
              );
            })}
            <li
              className={`flex items-center gap-1.5 text-[11px] ${
                matches ? 'text-teal-700' : 'text-slate-500'
              }`}
            >
              <Check
                className={`h-3 w-3 shrink-0 ${matches ? 'text-teal-600' : 'text-slate-300'}`}
              />
              The two passwords match
            </li>
          </ul>

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            Save and continue
          </button>
        </form>

        <p className="mt-4 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-slate-400">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" />
          This password is stored as a bcrypt hash — Vyroniq never keeps it in a
          readable form. If you forget it, the front desk can issue you a new
          temporary one.
        </p>
      </div>
    </main>
  );
}