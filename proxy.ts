import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge guard for the logout loop (Phase 12).
 *
 * NAMING — this file is `proxy.ts`, not `middleware.ts`.
 * ----------------------------------------------------
 * Next.js 16 renamed the `middleware` convention to `proxy`; `middleware` is
 * deprecated and emits a build warning. See
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md — "Starting
 * with Next.js 16, Middleware is now called Proxy." Only one proxy file is
 * supported per project, so proxy logic lives here and is imported from modules
 * if it ever needs splitting.
 *
 * WHAT IT ACTUALLY DOES
 * ---------------------
 * It is deliberately NOT an auth system. The app authenticates staff against
 * gym_users via /api/auth/login and keeps the session in localStorage, so the
 * server has no token to validate on a page request — a proxy that tried to
 * authorise here would either be a no-op or a false sense of security. The Next
 * docs say the same: proxy is for optimistic checks, not full session management.
 *
 * So it does the one thing that genuinely must happen server-side:
 *
 *   /login?logged_out=true  ->  a session-recovery SUPPRESSOR.
 *
 * While that flag is present the login page must not attempt to restore a
 * session. Previously the client cleared storage but supabase-js re-read the
 * token it had already written, auto-refreshed it, and pushed the user back into
 * /admin one or two seconds after they logged out.
 *
 * The flag is added as a cookie rather than read from the query string, because
 * the browser then sends it on the subsequent navigations of the same tab. That
 * is what makes the suppression survive the /login render -> redirect sequence
 * instead of only applying to the very first request.
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const loggedOut = searchParams.get('logged_out') === 'true';

  const isLogin = pathname === '/login';
  const isAuthRoute =
    pathname.startsWith('/api/auth/') || pathname.startsWith('/api/hardware/');

  // Strip the flag from anything that is not the login screen, so a stale
  // `?logged_out=true` cannot sit in the address bar and quietly suppress a
  // future, legitimate sign-in.
  if (!isLogin && loggedOut) {
    const cleaned = request.nextUrl.clone();
    cleaned.searchParams.delete('logged_out');
    return NextResponse.redirect(cleaned);
  }

  if (!isLogin && !isAuthRoute) {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  if (isLogin && loggedOut) {
    // Short-lived on purpose: this suppresses the recovery attempt for the
    // redirect that follows, and nothing beyond it. A permanent cookie would
    // break signing back in on the same device.
    response.cookies.set('vyroniq_logged_out', '1', {
      path: '/',
      maxAge: 30,
      sameSite: 'lax',
    });
  }

  return response;
}

export const config = {
  // Only the auth surface. A matcher this broad would run on every static asset
  // and slow the app for no benefit.
  matcher: ['/login', '/((?!_next/static|_next/image|favicon.ico).*)'],
};