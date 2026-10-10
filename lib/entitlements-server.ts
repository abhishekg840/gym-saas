/**
 * Server-only entitlement rejection for the gated API routes.
 *
 * `deny()` needs NextResponse, so it lives here rather than in lib/entitlements
 * (which must stay import-safe for `'use client'` components that render the
 * suspension lock screen). Only route handlers import this module; the client
 * uses the sibling `isLocked`/`lockReasonLabel` helpers for its UX-only gate.
 *
 * The decision it encodes is IDENTICAL to the client mirror: a locked gym (or a
 * suspended/expired status) is refused with a 403 and a machine-readable code,
 * before any work is done. Everything downstream of the `next()` call can trust
 * that the gym is entitled to use the feature.
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
