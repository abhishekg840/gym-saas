import { supabase } from '@/lib/supabase';
import { clearSession } from '@/lib/session';

/**
 * Hard logout (Phase 12, Module: "the logout loop").
 *
 * THE BUG THIS FIXES
 * ------------------
 * Clicking Logout navigated to /login, and one or two seconds later the user was
 * back in the app. Three separate things were keeping the session alive, and
 * clearing only one of them is what made it look intermittent:
 *
 *   1. `supabase.auth.signOut()` was never called on the member side. The member
 *      dashboard's signOut only did `clearSession()`, which deletes the GYM
 *      session key and nothing else. Supabase's own tokens stayed in
 *      localStorage under `sb-*-auth-token`.
 *   2. lib/supabase.ts sets `autoRefreshToken: true` and `persistSession: true`.
 *      On the very next mount, supabase-js found a still-valid refresh token and
 *      exchanged it for a fresh access token, re-establishing the session.
 *   3. Nothing cleared cookies, so a `sb-*-auth-token` cookie set by a Google
 *      sign-in survived and was re-read by the server.
 *
 * The result is that "logged out" was never actually logged out. On a shared
 * desk tablet that is a genuine access problem: the next person at the counter
 * inherits the previous owner's session.
 *
 * THE ORDER MATTERS
 * -----------------
 * `supabase.auth.signOut()` is scoped to 'local' so the SERVER session is left
 * alone. A global signOut would also revoke refresh tokens, which on a shared
 * device means signing the owner out of their phone too — a logout on the desk
 * tablet must not sign the owner out of the app in their pocket.
 *
 * Then storage, then cookies, then a hard navigation. `router.replace` is not
 * enough on its own: a bfcache restore can replay the previous page and re-run
 * its mount effects, which is exactly how the user got bounced back. A full
 * `location.assign` guarantees a fresh document with nothing cached.
 */

/** Cookie names Supabase writes. Matched as prefixes because the project ref varies. */
const AUTH_COOKIE_PREFIXES = ['sb-', 'supabase-auth-token'];

/** Keys written by this app that must never survive a logout. */
const APP_STORAGE_KEYS = ['gym_session', 'forgeos_tenant'];

/**
 * Deletes every Supabase auth cookie visible to the document.
 *
 * Cookie deletion only works on the exact (name, domain, path) tuple that was
 * written, so each candidate path is expired explicitly. Without this, a cookie
 * set on `path=/` survives a `path=/login` delete and the loop persists.
 */
function purgeAuthCookies(): void {
  if (typeof document === 'undefined') return;

  const names = AUTH_COOKIE_PREFIXES.flatMap((prefix) => {
    // `sb-<ref>-auth-token` and the chunked `.0` / `.1` variants supabase-js
    // writes for large tokens.
    const found: string[] = [];
    for (const part of document.cookie.split(';')) {
      const key = part.split('=')[0]?.trim();
      if (!key) continue;
      if (key.startsWith(prefix) && !found.includes(key)) found.push(key);
    }
    return found;
  });

  const paths = ['/', '/login', '/api', window.location.pathname];
  const expires = 'Thu, 01 Jan 1970 00:00:00 GMT';

  for (const name of names) {
    for (const path of paths) {
      document.cookie = `${name}=; path=${path}; max-age=0; expires=${expires}; samesite=lax`;
    }
  }

  // The tenant cookie this app writes by hand in lib/session.ts.
  for (const path of paths) {
    document.cookie = `forgeos_tenant=; path=${path}; max-age=0; expires=${expires}; samesite=lax`;
  }
}

/** Empties localStorage and sessionStorage. */
function purgeWebStorage(): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.clear();
  } catch {
    // Safari private mode throws on clear(); fall through to the targeted sweep.
  }
  try {
    window.sessionStorage.clear();
  } catch {
    /* same */
  }

  // Targeted sweep in case a whole-store clear was blocked.
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (const key of APP_STORAGE_KEYS) {
      try {
        store.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Full sign-out. Safe to call from a click handler; performs a hard navigation
 * to /login?logged_out=true when it finishes.
 */
export async function hardSignOut(): Promise<void> {
  // 1. Auth first, and scoped locally. Never throws the caller out of the flow:
  //    a network failure here must not strand the user on a protected screen.
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    /* the storage sweep below is what actually guarantees the logout */
  }

  // 2. App session + tenant cookie.
  clearSession();

  // 3. Everything else the browser kept.
  purgeWebStorage();
  purgeAuthCookies();

  // 4. Hard navigation. The flag tells /login to suppress its own
  //    "you're already signed in" redirect, closing the loop.
  window.location.assign('/login?logged_out=true');
}

/**
 * True when the page was reached by an explicit logout.
 *
 * /login uses this to skip session recovery entirely. Without it the page mounts,
 * supabase-js auto-refreshes a still-valid refresh token, and the router pushes
 * the user back into the app — the exact loop being fixed here.
 */
export function isLoggedOutLanding(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('logged_out') === 'true';
  } catch {
    return false;
  }
}