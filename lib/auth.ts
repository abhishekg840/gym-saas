/**
 * Google OAuth on the native app (Module 7).
 *
 * THE LOOP THIS FIXES
 * -------------------
 * "Continue with Google" called supabase.auth.signInWithOAuth, which sent the
 * user out to Chrome. When the provider redirected back, Android had no intent
 * filter matching the URL, so Chrome kept the result and the app never learned
 * about it. The user was left staring at a sign-in screen they had already
 * passed — the classic "opens Chrome but doesn't resume" loop.
 *
 * Three things have to be true for the return trip to work, and this module owns
 * all three:
 *
 *   1. Android must hand the URL back. That is the manifest's intent-filter
 *      (autoVerify App Link + the vyroniq://auth custom scheme) — outside this
 *      file, but the reason the event arrives at all.
 *   2. The tokens in the URL must become a Supabase session. Supabase's
 *      `detectSessionInUrl` only scans the INITIAL page load; a URL that arrives
 *      later, through appUrlOpen, is invisible to it. So we parse and call
 *      setSession ourselves.
 *   3. The app must then route as if signed in. The gym session is separate
 *      from the Supabase one, so it is rebuilt by POSTing the (now verified)
 *      access token to /api/auth/google, exactly as the web flow does.
 *
 * The browser cannot be "closed" from here — Android owns the activity stack.
 * What we CAN do is stop showing the login screen, which is what the user
 * actually perceives as the fix.
 */

import { supabase } from '@/lib/supabase';
import { clearSession, writeSession, type GymSession } from '@/lib/session';

/** Only our own scheme/host is an OAuth return trip; anything else is noise. */
function isOAuthReturn(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'vyroniq:' ||
      (parsed.protocol === 'https:' && parsed.pathname.startsWith('/auth'))
    );
  } catch {
    return false;
  }
}

export interface OAuthResult {
  ok: boolean;
  /** A sentence to show, only when ok is false. */
  error?: string;
  /** True when the URL carried no session at all (a plain deep link). */
  ignored?: boolean;
}

/**
 * Handles one appUrlOpen event.
 *
 * Returns `ignored` for a deep link that is not an OAuth return, so the caller
 * can fall through to normal routing instead of treating it as an error.
 */
export async function handleOAuthReturn(url: string): Promise<OAuthResult> {
  if (!isOAuthReturn(url)) return { ok: true, ignored: true };

  // Supabase returns either an implicit-grant hash (#access_token=...) or a
  // PKCE query (?code=...). detectSessionInUrl handles both, so the safest thing
  // is to hand it the fragment/query verbatim rather than reimplementing the
  // parsing — and it also stores the session in localStorage for us.
  let sessionError: unknown = null;
  try {
    const result = await supabase.auth.getSession();
    sessionError = result.error;
  } catch (err) {
    sessionError = err;
  }

  let accessToken: string | null = null;
  try {
    const fragment = new URLSearchParams(url.split('#')[1] ?? '');
    accessToken = fragment.get('access_token');
    if (!accessToken) {
      // PKCE: exchange the code for a session.
      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      if (code && typeof window !== 'undefined') {
        const exchanged = await supabase.auth.exchangeCodeForSession(code);
        if (exchanged.error) return { ok: false, error: exchanged.error.message };
      }
    }
  } catch {
    // A malformed URL is handled by the getSession() fallback above.
  }

  if (!accessToken) {
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
  }

  if (!accessToken) {
    return {
      ok: false,
      error:
        sessionError
          ? 'Could not complete Google sign-in. Please try again.'
          : 'Google sign-in did not return a session. Please try again.',
    };
  }

  // The Supabase session exists now; turn it into a gym session exactly as the
  // web flow does, so /login and the deep link converge on one code path.
  try {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken }),
    });

    const result = (await response.json()) as {
      ok?: boolean;
      reason?: string;
      session?: GymSession;
    };

    if (!result.ok || !result.session) {
      return {
        ok: false,
        error: result.reason ?? 'Could not match that Google account to a gym membership.',
      };
    }

    writeSession(result.session);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the server after Google sign-in.' };
  }
}

/** Where a completed gym session should land. Mirrors /login's finish(). */
export function routeForSession(session: GymSession): string {
  if (session.role === 'super_admin') return '/super-admin';
  if (session.role === 'owner') return '/';
  if (session.role === 'member') return '/member/dashboard';
  return '/scan';
}

/** Used when the member signs out from the deep-link path. */
export function signOutOfApp(): void {
  clearSession();
}