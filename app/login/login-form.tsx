'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { writeSession, type GymSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { hardSignOut, isLoggedOutLanding } from '@/lib/logout';
import { Dumbbell, Lock, ArrowRight, Phone, Eye, EyeOff, Building2, UserRound, LogOut } from 'lucide-react';
import Link from 'next/link';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function hasOAuthArtifacts(): boolean {
  const url = new URL(window.location.href);
  return (
    url.searchParams.has('code') ||
    url.searchParams.has('error') ||
    url.searchParams.get('error_description') !== null ||
    url.hash.includes('access_token') ||
    url.hash.includes('error')
  );
}

interface PortalPair {
  owner: GymSession;
  member: GymSession;
}

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loggedOut = isLoggedOutLanding();

  const [portalChoice, setPortalChoice] = useState<PortalPair | null>(null);

  const isDualRole = portalChoice !== null;

  const completingRef = useRef(false);

  function finish(session: GymSession) {
    writeSession(session);

    if (session.role === 'super_admin') {
      router.push('/super-admin');
    } else if (session.role === 'owner') {
      router.push('/admin');
    } else if (session.role === 'member') {
      router.push('/member/dashboard');
    } else {
      router.push('/scan');
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ identifier, password: pin }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        reason?: string;
        session?: GymSession;
        portals?: PortalPair;
        requires_password_change?: boolean;
      };

      if (!result.ok) {
        setErrorMsg(result.reason || 'Sign-in failed. Please check your details.');
        setLoading(false);
        return;
      }

      if (result.portals) {
        setPortalChoice(result.portals);
        setLoading(false);
        return;
      }

      if (!result.session) {
        setErrorMsg('Sign-in failed: the server returned no account.');
        setLoading(false);
        return;
      }

      if (result.requires_password_change) {
        writeSession(result.session);
        router.push('/setup-password');
        return;
      }

      finish(result.session);
    } catch {
      setErrorMsg('Sign-in failed: could not reach the server.');
      setLoading(false);
    }
  }

  function choosePortal(session: GymSession) {
    setPortalChoice(null);
    finish(session);
  }

  async function completeGoogleLogin(accessToken: string) {
    if (completingRef.current) return;
    completingRef.current = true;
    setGoogleBusy(true);
    setErrorMsg('');

    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ access_token: accessToken }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        session?: GymSession;
        reason?: string;
        error?: string;
      };

      if (!result.ok || !result.session) {
        setErrorMsg(result.reason || result.error || 'Google sign-in could not be completed.');
        try {
          await supabase.auth.signOut();
        } catch {
          /* best effort cleanup */
        }
        return;
      }

      finish(result.session);
    } catch {
      setErrorMsg('Google sign-in failed: could not reach the server.');
      try {
        await supabase.auth.signOut();
      } catch {
        /* best effort cleanup */
      }
    } finally {
      setGoogleBusy(false);
      completingRef.current = false;
    }
  }

  async function signInWithGoogle() {
    setErrorMsg('');
    setGoogleBusy(true);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/login`,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });

      if (error) {
        setErrorMsg(`Google sign-in unavailable: ${error.message}`);
        setGoogleBusy(false);
      }
    } catch {
      setErrorMsg('Google sign-in unavailable: could not initialize OAuth.');
      setGoogleBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (isLoggedOutLanding()) {
      void supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      return;
    }

    if (hasOAuthArtifacts()) {
      try {
        void supabase.auth.getSession().then(({ data }: { data: { session: { access_token: string } | null } }) => {
          if (!cancelled && data.session) void completeGoogleLogin(data.session.access_token);
        });
      } catch {
        /* getSession failed — safe to ignore, the form is still usable */
      }
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((event: any, session: any) => {
      if (cancelled) return;

      if (event === 'TOKEN_REFRESHED') return;

      if (session) void completeGoogleLogin(session.access_token);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-8 shadow-sm relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center">
            <Dumbbell className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight text-slate-900">Vyroniq Gym OS</h1>
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">Access Portal</span>
          </div>
        </div>

        {isDualRole && portalChoice && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">You have both accounts</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700">
                This number is registered as a gym owner and as a member. Pick where
                you want to go.
              </p>
            </div>

            <button
              type="button"
              onClick={() => choosePortal(portalChoice.owner)}
              className="w-full flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50/50 active:scale-[0.99]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Building2 className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900">Continue to Owner Console</span>
                <span className="block text-[11px] text-slate-500">
                  Roster, hardware gate, store &amp; billing
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
            </button>

            <button
              type="button"
              onClick={() => choosePortal(portalChoice.member)}
              className="w-full flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 active:scale-[0.99]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <UserRound className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900">Continue to Member App</span>
                <span className="block text-[11px] text-slate-500">
                  Your pass, workouts, streak &amp; store
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
            </button>

            <button
              type="button"
              onClick={() => setPortalChoice(null)}
              className="w-full py-2 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition"
            >
              Use a different account
            </button>
          </div>
        )}

        {!isDualRole && loggedOut && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <LogOut className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="text-xs font-semibold text-emerald-900">You have been signed out</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-700">
                Your session and saved tokens were cleared from this device.
              </p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className={isDualRole ? 'hidden' : 'space-y-4'}>
          <div>
            <label htmlFor="login-identifier" className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block mb-1">
              Username / Email / Mobile Number
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                id="login-identifier"
                required
                autoFocus
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="9569272339 · @rahul · rahul@email.com"
                className="w-full bg-white border border-slate-200 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-sm font-mono text-slate-900 focus:outline-none"
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-400 font-mono">
              Required for both members and gym staff.
            </p>
          </div>

          <div>
            <label htmlFor="login-secret" className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block mb-1">
              Password <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                id="login-secret"
                type={showSecret ? 'text' : 'password'}
                maxLength={72}
                required
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Your password"
                className="w-full bg-white border border-slate-200 focus:border-emerald-500 rounded-xl pl-10 pr-11 py-2.5 text-sm font-mono text-slate-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowSecret((shown) => !shown)}
                aria-label={showSecret ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-lg text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || googleBusy}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In'} <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="mt-3 text-right">
          <Link
            href="/forgot-password"
            className="text-xs text-slate-500 hover:text-emerald-600 font-mono transition"
          >
            Forgot password?
          </Link>
        </p>

        <div className="my-5 flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          or continue with
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          disabled={loading || googleBusy}
          className="w-full py-3 bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-50"
        >
          <GoogleIcon />
          {googleBusy ? 'Opening Google…' : 'Continue with Google'}
        </button>

        <div className="mt-6 pt-5 border-t border-slate-100 text-center">
          <Link href="/member" className="text-xs text-slate-500 hover:text-emerald-600 font-mono transition">
            Member without PIN? Open Direct Pass →
          </Link>
        </div>
      </div>
    </main>
  );
}



