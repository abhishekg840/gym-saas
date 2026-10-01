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
 * The exit toast is deliberately a hint, not a permission: a single back press
 * on /member/dashboard or /login never kills the app mid-typing.
 */

const ROOT_PATHS = new Set(['/', '/login', '/member/dashboard']);
const EXIT_CONFIRM_MS = 2_000;

export default function MobileNavProvider() {
  const router = useRouter();
  const pathname = usePathname();

  /** Keeps the latest route visible inside the plugin listener without re-binding. */
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const lastBackPressRef = useRef(0);
  const hintTimerRef = useRef<number | null>(null);
  const [showExitHint, setShowExitHint] = useState(false);

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

  return (
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
  );
}
