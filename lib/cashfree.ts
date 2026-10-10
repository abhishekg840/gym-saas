/**
 * Cashfree drop-checkout loader (client-only).
 *
 * The Cashfree JS SDK is loaded from their CDN as a global (`window.Cashfree`),
 * not as an npm package, so this helper injects the script tag once and resolves
 * with the factory. The order (and therefore the payment_session_id) is created
 * SERVER-SIDE in /api/super-admin/billing/create-order — the secret key never
 * touches the browser — and only the session id is handed to `openCheckout`.
 *
 * `mode` MUST match the environment the order was created in: a sandbox session
 * id opened against the production SDK (or vice-versa) is rejected by Cashfree,
 * so the create-order route echoes which mode it used and we pass it straight
 * through here.
 */

export type CashfreeMode = 'sandbox' | 'production';

const SDK_SRC = 'https://sdk.cashfree.com/js/v3/cashfree.js';

/** The subset of the v3 SDK the billing screen uses. */
interface CashfreeCheckoutOptions {
  paymentSessionId: string;
  redirectTarget: '_modal' | '_self';
}
interface CashfreeInstance {
  checkout(options: CashfreeCheckoutOptions): Promise<unknown>;
}
type CashfreeFactory = (config: { mode: CashfreeMode }) => CashfreeInstance;

declare global {
  interface Window {
    Cashfree?: CashfreeFactory;
  }
}

let sdkPromise: Promise<CashfreeFactory> | null = null;

/** Injects the Cashfree SDK script once; resolves with the global factory. */
export function loadCashfreeSdk(): Promise<CashfreeFactory> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Cashfree SDK can only load in the browser.'));
  }
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<CashfreeFactory>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.addEventListener('load', () => {
      if (window.Cashfree) resolve(window.Cashfree);
      else reject(new Error('Cashfree SDK loaded but window.Cashfree is missing.'));
    });
    script.addEventListener('error', () => {
      sdkPromise = null; // allow a retry on the next tap
      reject(new Error('Could not load the Cashfree checkout. Check your connection.'));
    });
    if (!existing) document.head.appendChild(script);
  });

  return sdkPromise;
}

/**
 * Opens the Cashfree drop checkout for a session id. Resolves when the customer
 * is redirected to (or closes) the hosted payment page; the authoritative
 * "did it succeed" answer always comes from the webhook, never from this call.
 */
export async function openCashfreeCheckout(
  paymentSessionId: string,
  mode: CashfreeMode
): Promise<void> {
  const factory = await loadCashfreeSdk();
  const cashfree = factory({ mode });
  // `_modal` keeps the owner on the billing screen behind an overlay, which is
  // the least jarring option inside the console.
  await cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' });
}
