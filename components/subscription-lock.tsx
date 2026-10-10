'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Lock,
  Loader2,
  RefreshCw,
  MessageCircle,
  LogOut,
  Snowflake,
  AlertTriangle,
} from 'lucide-react';
import { resolveGrants, isLocked } from '@/lib/entitlements';
import { isUuid, readSession } from '@/lib/session';
import { hardSignOut } from '@/lib/logout';

/**
 * SubscriptionLock — the full-screen wall a suspended / expired gym sees in
 * place of the owner console (Phase 23, the "owner console's lock screen" named
 * in migration 0023).
 *
 * WHY A WHOLE SCREEN, NOT A BANNER: the server already refuses every gated
 * action with a 403. Rendering the console underneath would be a lie — buttons
 * that look live but do nothing. This replaces the surface entirely with the
 * one thing the owner can actually act on: renew, or contact support.
 *
 * It re-checks fn_resolve_entitlements on its own (not the page's hook) so a
 * "check again" that lands after an admin re-activates the gym can walk the
 * owner straight back in. The check FAILS OPEN on a network error: a flaky
 * connection shows a retry, never a false lock.
 *
 * This is UX, not the security boundary. The authoritative refusal is the
 * server's deny() on every route; this only decides what to paint.
 */

const SUPPORT_WHATSAPP = '9569272339';

function supportLink(gymName: string | null): string {
  const who = gymName ? `My gym "${gymName}"` : 'My gym';
  const text = `Hi, ${who} is showing as offline on Vyroniq and I'd like to sort it out.`;
  return `https://wa.me/91${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

type Check = 'idle' | 'checking' | 'live' | 'still';

export default function SubscriptionLock({ reason }: { reason?: string }) {
  const router = useRouter();
  const [gymName, setGymName] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>('idle');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const session = readSession();
    setGymName(session?.tenantName ?? null);
  }, []);

  async function recheck() {
    setCheck('checking');
    const session = readSession();
    const tenantId = session?.tenantId ?? null;
    if (!tenantId || !isUuid(tenantId)) {
      setCheck('still');
      return;
    }
    try {
      const grants = await resolveGrants(tenantId);
      if (!isLocked(grants)) {
        setCheck('live');
        // Back to a fresh document so the console re-mounts against the new truth.
        window.location.assign('/admin');
        return;
      }
      setCheck('still');
    } catch {
      // Network blip — do not claim the gym is fine, just offer the retry again.
      setCheck('still');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12 text-ink">
      <div className="vy-card w-full max-w-lg p-8 text-center sm:p-10">
        <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full border border-line bg-wash">
          <Lock className="h-7 w-7 text-muted" />
        </span>

        <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink">
          {gymName ? `${gymName} is offline` : 'This gym is offline'}
        </h1>

        <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-muted">
          {reason && reason.length > 0
            ? reason
            : 'The console is paused because this gym’s subscription is not active. Your members, attendance and billing data are all safe — nothing has been deleted.'}
        </p>

        <div className="vy-panel mx-auto mt-6 max-w-md text-left">
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
            <Snowflake className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
            <span>
              While a gym is offline, gate scans, check-ins and new enrolments are
              paused, and the console stays read-only. Reactivating the plan
              restores everything immediately.
            </span>
          </p>
        </div>

        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <a
            href={supportLink(gymName)}
            target="_blank"
            rel="noreferrer"
            className="vy-btn vy-btn-lg vy-btn-brand"
          >
            <MessageCircle className="h-4 w-4" />
            Reactivate on WhatsApp
          </a>
          <button
            type="button"
            onClick={recheck}
            disabled={check === 'checking'}
            className="vy-btn vy-btn-lg vy-btn-secondary"
          >
            {check === 'checking' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                I’ve renewed — check again
              </>
            )}
          </button>
        </div>

        {check === 'live' && (
          <p className="mt-4 text-[12px] font-medium text-emerald-700">
            This gym is active again — taking you back in…
          </p>
        )}
        {check === 'still' && (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            Still showing as offline. If you’ve just paid, give it a moment and try
            again, or message us and we’ll look.
          </p>
        )}

        <div className="mt-8 border-t border-line pt-5">
          <button
            type="button"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await hardSignOut();
              router.replace('/login');
            }}
            className="vy-btn vy-btn-ghost text-muted"
          >
            {signingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
