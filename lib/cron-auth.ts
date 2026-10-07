import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * Shared gate for the scheduled endpoints (/api/cron and /api/cron/whatsapp).
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically whenever
 * the CRON_SECRET environment variable is set on the project, so matching that
 * header is the only wiring a deployment needs. Anything else that reaches these
 * routes — a stray curl, a port scan, a misconfigured proxy — gets 401.
 *
 * Fail-closed rule: with no CRON_SECRET configured, the gate only opens in
 * `development`. Production must not inherit "no secret means open", which is
 * exactly the hole this file closes.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const header = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${secret}`;
    // Length check first so timingSafeEqual never throws on mismatched buffers.
    const actual = Buffer.from(header, 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
  }

  return process.env.NODE_ENV === 'development';
}

/** The one answer every unauthenticated cron call gets. */
export function cronUnauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Unauthorized' },
    { status: 401 }
  );
}
