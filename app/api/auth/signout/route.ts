import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * POST /api/auth/signout
 *
 * The server half of the logout fix. The client purge in lib/logout.ts handles
 * localStorage and document-writable cookies, but a cookie set HttpOnly (which
 * the Google flow can produce) is invisible to `document.cookie` and can only be
 * expired by a response carrying its own Set-Cookie header.
 *
 * `scope: 'local'` deliberately: it ends THIS device's session without revoking
 * the account's refresh tokens globally. A global signOut would sign the owner
 * out of the Vyroniq app on their own phone because they tapped Logout on the
 * desk tablet — that is a bug, not a feature.
 *
 * Returns 200 even if the network call fails. A logout that reports an error
 * leaves the user staring at a button that appears not to work, while the
 * client-side sweep has already cleared everything locally.
 */
export async function POST() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Intentionally swallowed — see the doc comment. The browser-side purge in
    // lib/logout.ts is the guarantee that actually matters for this bug.
  }

  const response = NextResponse.json({ ok: true });

  // Expire the Supabase cookies this origin can see. Names follow the
  // `sb-<project-ref>-auth-token` shape, and both the plain and chunked (`.0`)
  // variants are expired, because deleting only the unsuffixed one leaves the
  // chunk that supabase-js reads back on the next mount.
  const secure = process.env.NODE_ENV === 'production';
  const attrs = `Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${
    secure ? '; Secure' : ''
  }`;

  for (const name of supabaseAuthCookieNames()) {
    response.headers.append('Set-Cookie', `${name}=; ${attrs}`);
  }

  // The app's own tenant cookie, written by lib/session.ts.
  response.headers.append('Set-Cookie', `forgeos_tenant=; ${attrs}`);

  return response;
}

/**
 * Derives the auth cookie names for this project from the Supabase URL, so no
 * hardcoded project ref can drift out of sync with the environment.
 */
function supabaseAuthCookieNames(): string[] {
  const base = 'sb';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const ref = extractProjectRef(url);

  const stem = ref ? `${base}-${ref}-auth-token` : `${base}-auth-token`;
  // The chunked variants supabase-js writes when a token exceeds the per-cookie
  // size limit. Expiring 0-9 costs nothing and covers every realistic split.
  return [stem, ...Array.from({ length: 10 }, (_, index) => `${stem}.${index}`)];
}

/** "https://abcdefgh.supabase.co" -> "abcdefgh". Empty string when unparseable. */
function extractProjectRef(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0] ?? '';
  } catch {
    return '';
  }
}