/**
 * Server-only entitlement rejection for the gated API routes.
 *
 * `deny()` maps a ResolvedGrants object onto a 403 harness when the gym is
 * locked or suspended/expired, before any work is done. It needs NextResponse,
 * so it lives here (imported only by route handlers) rather than in
 * lib/entitlements, which stays import-safe for `'use client'` components. The
 * client mirrors this decision with `isLocked`/`lockReasonLabel` for UX only.
 */

import { NextResponse } from 'next/server';
import type { ResolvedGrants } from '@/lib/entitlements';

/** A rejector that maps a Grants object onto a 403 harness the routes already use. */
export function deny(grants: ResolvedGrants, next: () => Response): Response {
  if (grants.locked) {
    return NextResponse.json(
      {
        ok: false,
        error: 'This gym is offline',
        reason: grants.reason ?? 'Subscription locked',
        code: 'gym_offline',
      },
      { status: 403 }
    );
  }

  if (grants.status === 'suspended') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Subscription suspended',
        reason: grants.reason ?? 'Subscription suspended',
        code: 'subscription_suspended',
      },
      { status: 403 }
    );
  }

  return next();
}
