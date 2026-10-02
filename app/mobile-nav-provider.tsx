'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Android back-button behaviour for the whole app.
 *
 * Press order (each level only reached when the one above has nothing to do):
 *   1. the active page handler  — e.g. the dashboard steps out of the current
 *      tab back through Home before leaving (lib/backnav.ts),
 *   2. history — router.back() on any app screen that is not a root,
 *   3. a two-press "Press again to exit" confirmation (only on root screens),
 *   4. App.exitApp().
 *
 * The exit toast is deliberately a hint, not a permission: a single back press on
 * /member/dashboard or /login never kills the app mid-typing.
 *
 * OAUTH RETURN (Module 7)
 * -----------------------
 * "Continue with Google" leaves the app for Chrome. The manifest's intent-filter
 * is what brings it back; THIS listener is what does something useful with it.
 * Without it the tokens arrive, sit in the URL, and the user is left on the
 * sign-in screen they already passed.
 *
 * The heavy lifting (parse the fragment, exchange a PKCE code, rebuild the gym
 * session through /api/auth/google) lives in lib/auth.ts, so this file stays
 * about Android wiring only. That import is dynamic because the same app runs in
 * a plain browser, where @capacitor/app has no native counterpart.
 */

const ROOT_PATHS = new Set(['/', '/login', '/member/dashboard']);
const EXIT_CONFIRM_MS = 2_000;

export default function MobileNavProvider() {
  const router = useRouter();
  const pathname = usePathname();

  /**
   * Keeps the latest route visible inside the plugin listener without re-binding
   * the listener on every navigation.
   *
   * Written as an effect rather than `ref.current = pathname` during render: a
   * ref is not render state, so assigning one mid-render is invisible to React
   * and is exactly what the react-hooks/refs rule rejects. An effect runs after
   * the commit, which is also the only point at which the listener could not
   * already have fired with a stale value.
   */
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const lastBackPressRef = useRef(0);
  const hintTimerRef = useRef<number | null>(null);
  const [showExitHint, setShowExitHint] = useState(false);
  /**
   * A failed OAuth return, surfaced globally rather than only on /login: the
   * user may have been deep in the app when Chrome handed the URL back, so a
   * message bound to the login screen would never be seen.
   */
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let subscription: { remove: () => Promise<void> } | null = null;

    function clearHint() {
      if (hintTimerRef.current !== null) {
        window.clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
      setShowExitHint(false);
    }

    async function handleBack(canGoBack: boolean) {
      // Level 1 — the page's own navigation (tabs, collapsed panels, ...).
      const { runActiveBackHandler } = await import('@/lib/backnav');
      if (runActiveBackHandler()) return;

      // Level 2 — anything but a root screen walks back through history.
      const atRoot = ROOT_PATHS.has(pathnameRef.current);
      const hasHistory = canGoBack || window.history.length > 1;
      if (!atRoot && hasHistory) {
        router.back();
        return;
      }

      // Levels 3 and 4 — two presses inside the confirmation window, or exit.
      const now = Date.now();
      if (now - lastBackPressRef.current <= EXIT_CONFIRM_MS) {
        lastBackPressRef.current = 0;
        clearHint();
        const { App } = await import('@capacitor/app');
        await App.exitApp();
        return;
      }

      lastBackPressRef.current = now;
      setShowExitHint(true);
      hintTimerRef.current = window.setTimeout(() => {
        hintTimerRef.current = null;
        lastBackPressRef.current = 0;
        setShowExitHint(false);
      }, EXIT_CONFIRM_MS);
    }

    void (async () => {
      const { App } = await import('@capacitor/app');
      subscription = await App.addListener('backButton', (event) => {
        void handleBack(event.canGoBack);
      });
      if (disposed) {
        await subscription.remove();
        subscription = null;
      }
    })();

    return () => {
      disposed = true;
      clearHint();
      if (subscription) void subscription.remove();
    };
  }, [router]);

  /**
   * OAuth return trip. Separate effect from the back button because it owns a
   * completely different concern: routing on success, reporting on failure, and
   * staying completely silent for a deep link that is not an OAuth return.
   */
  useEffect(() => {
    let disposed = false;
    let urlSubscription: { remove: () => Promise<void> } | null = null;

    void (async () => {
      const [{ App }, { handleOAuthReturn, routeForSession }] = await Promise.all([
        import('@capacitor/app'),
        import('@/lib/auth'),
      ]);

      urlSubscription = await App.addListener('appUrlOpen', async ({ url }) => {
        const result = await handleOAuthReturn(url);
        if (disposed) return;

        // Not an OAuth return (a plain vyroniq:// deep link): let normal routing
        // handle it, and say nothing to the user.
        if (result.ignored) return;

        if (!result.ok) {
          setAuthNotice(result.error ?? 'Could not complete Google sign-in.');
          return;
        }

        // The gym session was written by /api/auth/google; read it back so the
        // right destination is chosen instead of guessing from the current route
        // (which is still /login at this point).
        const { readSession } = await import('@/lib/session');
        const session = readSession();
        setAuthNotice(null);
        if (session) router.replace(routeForSession(session));
      });

      if (disposed) {
        await urlSubscription.remove();
        urlSubscription = null;
      }
    })();

    return () => {
      disposed = true;
      if (urlSubscription) void urlSubscription.remove();
    };
  }, [router]);

  return (
    <div>
      {authNotice && (
        <div
          role="alert"
          className="fixed inset-x-4 top-4 z-[80] mx-auto max-w-sm rounded-xl border border-rose-500/40 bg-neutral-900/95 px-4 py-3 text-xs font-medium text-rose-200 shadow-xl backdrop-blur"
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">{authNotice}</span>
            <button
              onClick={() => setAuthNotice(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded-md px-1 text-rose-300/70 hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center transition-all duration-200 ease-out ${
          showExitHint ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
        }`}
      >
        <span className="rounded-full border border-white/15 bg-neutral-900/95 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur">
          Press back again to exit
        </span>
      </div>
    </div>
  );
}
