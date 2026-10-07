import type { PassGeoProof } from '@/lib/passtoken';

/**
 * Client half of the signed gate pass (P0-2).
 *
 * The member app no longer composes the QR string itself. It sends the claims
 * to /api/member/pass/mint, which re-checks them against the members table,
 * stamps the 30-second window server-side (so a client cannot mint a
 * far-future pass) and applies the HMAC signature where AUTH_SECRET exists.
 * If signing is unavailable or the network fails, this returns null and the
 * UI shows the locked state — never an unsigned token.
 */
export async function mintGatePass(input: {
  id: string;
  ph: string;
  geo?: PassGeoProof;
}): Promise<string | null> {
  try {
    const response = await fetch('/api/member/pass/mint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) return null;

    const json = (await response.json()) as { ok?: boolean; token?: unknown };
    return json.ok && typeof json.token === 'string' && json.token
      ? json.token
      : null;
  } catch {
    return null;
  }
}
