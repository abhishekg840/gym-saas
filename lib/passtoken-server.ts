import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PASS_TOKEN_SEPARATOR,
  decodePassClaims,
  encodePassToken,
  type PassTokenClaims,
} from '@/lib/passtoken';

// Re-export the claims type so a route handler can import the token helper and
// its payload type from the one server-only module (it never touches node:crypto
// types it shouldn't, and keeps the client-safe passtoken import out of handlers).
export type { PassTokenClaims };

/**
 * Server-only half of the gate-pass token (P0-2): the HMAC-SHA256 signature.
 *
 * The claims are minted here, never in the browser. A signing key shipped in a
 * JS bundle is not a key — anyone can read it from dev-tools and forge a pass
 * for any member id. So the member app POSTs its claims to
 * /api/member/pass/mint, which signs them with a secret the client never sees,
 * and /api/scan/verify checks that signature BEFORE a single claim inside the
 * token is believed.
 *
 * Key resolution (first hit wins):
 *   1. AUTH_SECRET           — the production secret; set it on the project.
 *   2. SUPABASE_JWT_SECRET   — a server-held fallback so a deployment that
 *                              already keeps Supabase's secret env var signed
 *                              without extra wiring.
 *   3. a fixed constant      — DEVELOPMENT ONLY, so `next dev` works with zero
 *                              configuration.
 *   4. null                  — production with no secret: minting returns 503
 *                              and verification refuses everything. Failing
 *                              closed beats minting forgeable passes.
 *
 * This module imports node:crypto, so it must never be pulled into a client
 * component — keep signing/verification inside route handlers.
 */

const DEV_ONLY_KEY = 'vyroniq-dev-pass-key-do-not-use-in-production';

export type PassSigningKey = string | null;

export function passSigningKey(): PassSigningKey {
  const authSecret = process.env.AUTH_SECRET?.trim();
  if (authSecret) return authSecret;

  const jwtSecret = process.env.SUPABASE_JWT_SECRET?.trim();
  if (jwtSecret) return jwtSecret;

  if (process.env.NODE_ENV === 'development') return DEV_ONLY_KEY;

  return null;
}

function hmacBase64Url(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/**
 * Serialises the claims and appends the signature:
 * `<base64 claims>`.`<base64url HMAC-SHA256>`.
 *
 * Returns null only when no signing key is available (production without
 * AUTH_SECRET) — callers must treat that as a configuration error, never as
 * "fall back to an unsigned token".
 */
export function signPassToken(claims: PassTokenClaims): string | null {
  const key = passSigningKey();
  if (!key) return null;

  const payload = encodePassToken(claims);
  return `${payload}${PASS_TOKEN_SEPARATOR}${hmacBase64Url(key, payload)}`;
}

export type PassVerification =
  | { ok: true; claims: PassTokenClaims }
  /** No separator at all: a legacy bare-phone / GF: / unsigned-claims string. */
  | { ok: false; reason: 'unsigned' }
  /** A signed-format token whose signature does not check out. */
  | { ok: false; reason: 'forged' }
  /** Signed format, but the payload is not readable claims. */
  | { ok: false; reason: 'malformed' }
  /** Signed format, but this deployment has no key to check it against. */
  | { ok: false; reason: 'unconfigured' };

/**
 * Verifies the signature first, decodes second. An unsigned payload is never
 * parsed into claims: processing an unverified claim (member id, phone,
 * window) is precisely the forgery this signature exists to stop.
 */
export function verifyPassToken(raw: string): PassVerification {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, reason: 'malformed' };

  if (!text.includes(PASS_TOKEN_SEPARATOR)) {
    // Every pre-P0 format: raw digits, `GF:phone:t`, unsigned base64 JSON.
    return { ok: false, reason: 'unsigned' };
  }

  const parts = text.split(PASS_TOKEN_SEPARATOR);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'malformed' };
  }

  const key = passSigningKey();
  if (!key) return { ok: false, reason: 'unconfigured' };

  const expected = Buffer.from(hmacBase64Url(key, parts[0]), 'utf8');
  const provided = Buffer.from(parts[1], 'utf8');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'forged' };
  }

  const claims = decodePassClaims(parts[0]);
  if (!claims) return { ok: false, reason: 'malformed' };

  return { ok: true, claims };
}
