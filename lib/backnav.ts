/**
 * Page-owned Android back-button handling.
 *
 * The root layout mounts a provider that listens to Capacitor's `backButton`
 * event. Before it decides anything (history walk or "exit the app"), it asks
 * the active handler below whether the page itself wants the press. Pages with
 * in-screen navigation — the member dashboard's Home / Health / Training / Store
 * tabs, which never create history entries — register a handler that steps back
 * through their own state and returns true while there is somewhere to go.
 *
 * Handler contract: return true when the press was consumed, false to let the
 * provider fall through to history / exit logic.
 */

export type BackHandler = () => boolean;

let activeHandler: BackHandler | null = null;

/**
 * Publishes the current page's back handler. Returns the unregister function —
 * always call it from the effect's cleanup so an unmounted page can never
 * swallow the next screen's back press.
 */
export function registerBackHandler(handler: BackHandler): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

/** Runs the active handler, if any. True = the press was consumed. */
export function runActiveBackHandler(): boolean {
  if (!activeHandler) return false;
  try {
    return activeHandler();
  } catch {
    // A throwing handler must never trap the user: treat it as "not handled".
    return false;
  }
}
