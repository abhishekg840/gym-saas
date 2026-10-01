'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { writeSession, type GymSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Dumbbell, Lock, ArrowRight, Phone, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

/** The one Google mark the brand already lives with — no icon library needed. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * True when the address still carries OAuth leftovers — a `#access_token`
 * fragment or an authorization code supabase-js may already have consumed before
 * React mounted. Only then do we auto-complete a Google session: a stale session
 * from an earlier visit must not hijack the form on a shared desk computer.
 */
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

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  /** Stops the auth listener and getSession() from finishing the same login twice. */
  const completingRef = useRef(false);

  /** One landing strip shared by the password and Google paths. */
  function finish(session: GymSession) {
    // writeSession also mirrors the tenant id into a cookie so server-side gate
    // routes (/api/scan/verify, /api/biometric/verify) can scope their lookups.
    writeSession(session);

    if (session.role === 'super_admin') {
      router.push('/super-admin');
    } else if (session.role === 'owner') {
      router.push('/');
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
      // Credentials go to the server, which verifies the PIN and answers with just
      // this account's session. The client never sees other gyms' users or PINs.
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
      };

      if (!result.ok || !result.session) {
        setErrorMsg(result.reason || 'Sign-in failed. Please check your details.');
        setLoading(false);
        return;
      }

      finish(result.session);
    } catch {
      setErrorMsg('Sign-in failed: could not reach the server.');
      setLoading(false);
    }
  }

  /**
   * Hands the Google-verified access token to /api/auth/google, which resolves
   * the email to the gym account (staff first, then member) and answers with the
   * same GymSession a password sign-in returns.
   */
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
        // Leave no half-authenticated Google session behind to loop on.
        await supabase.auth.signOut();
        return;
      }

      finish(result.session);
    } catch {
      setErrorMsg('Google sign-in failed: could not reach the server.');
      await supabase.auth.signOut();
    } finally {
      setGoogleBusy(false);
      completingRef.current = false;
    }
  }

  async function signInWithGoogle() {
    setErrorMsg('');
    setGoogleBusy(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Lands back on this page; supabase-js picks the token/code out of the URL.
        redirectTo: `${window.location.origin}/login`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });

    if (error) {
      setErrorMsg(`Google sign-in unavailable: ${error.message}`);
      setGoogleBusy(false);
    }
    // On success the browser navigates to Google and this page unloads.
  }

  useEffect(() => {
    let cancelled = false;

    // The redirect back from Google may have been processed before React mounted,
    // so also check for OAuth leftovers in the URL — never a bare stale session.
    if (hasOAuthArtifacts()) {
      void supabase.auth.getSession().then(({ data }) => {
        if (!cancelled && data.session) void completeGoogleLogin(data.session.access_token);
      });
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) void completeGoogleLogin(session.access_token);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 text-white flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm bg-[#16181D] border border-neutral-800 rounded-3xl p-8 shadow-2xl relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <Dumbbell className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight">GlitchFiesta Gym OS</h1>
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">Access Portal</span>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="login-identifier" className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 block mb-1">
              Username / Email / Mobile Number
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3" />
              <input
                id="login-identifier"
                required
                autoFocus
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="9569272339 · @rahul · rahul@email.com"
                className="w-full bg-zinc-950 border border-neutral-800 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-sm font-mono text-white focus:outline-none"
              />
            </div>
            <p className="mt-1 text-[10px] text-neutral-500 font-mono">
              Members sign in with no PIN — staff and reception add theirs below.
            </p>
          </div>

          <div>
            <label htmlFor="login-secret" className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 block mb-1">
              Password / PIN
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3" />
              <input
                id="login-secret"
                type={showSecret ? 'text' : 'password'}
                maxLength={64}
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Leave blank if you are a member"
                className="w-full bg-zinc-950 border border-neutral-800 focus:border-emerald-500 rounded-xl pl-10 pr-11 py-2.5 text-sm font-mono text-white focus:outline-none tracking-widest"
              />
              <button
                type="button"
                onClick={() => setShowSecret((shown) => !shown)}
                aria-label={showSecret ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-lg text-neutral-500 hover:text-neutral-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || googleBusy}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In'} <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-neutral-500">
          <span className="h-px flex-1 bg-neutral-800" />
          or continue with
          <span className="h-px flex-1 bg-neutral-800" />
        </div>

        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          disabled={loading || googleBusy}
          className="w-full py-3 bg-white hover:bg-neutral-200 text-neutral-900 font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
        >
          <GoogleIcon />
          {googleBusy ? 'Opening Google…' : 'Continue with Google'}
        </button>

        <div className="mt-6 pt-5 border-t border-neutral-800/80 text-center">
          <Link href="/member" className="text-xs text-neutral-400 hover:text-emerald-400 font-mono transition">
            Member without PIN? Open Direct Pass →
          </Link>
        </div>
      </div>
    </main>
  );
}