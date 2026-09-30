/**
 * The rotating gate-pass token, shared by the member portal (which mints it) and
 * the kiosk route (which validates it).
 *
 * Why the geofence proof rides inside the token: hiding the QR code is only a UI
 * affordance — a screenshot, a dev-tools console or a stale tab can still produce
 * the string. Binding the phone's fix to the credential means the gate re-runs the
 * fence decision on the server, so "this pass was unlocked while the phone stood
 * inside the gym" is a property of the token rather than of the screen that drew
 * it. The 30-second window index is what stops yesterday's screenshot working.
 */

/** One QR frame. Mirrors the countdown the member app draws under the code. */
export const PASS_WINDOW_MS = 30_000;

/**
 * How many windows either side of now are tolerated. The member's phone and the
 * kiosk keep their own clocks, so a strict equality check would lock members out
 * the moment a device drifts by a minute. Two frames keeps a screenshot usable
 * for at most ~90 seconds.
 */
export const PASS_WINDOW_SKEW = 2;

/** Where the phone stood at the moment the pass was minted. */
export interface PassGeoProof {
  lat: number;
  lon: number;
  accuracy_meters: number | null;
  /** Metres from the gym at mint time. */
  distance_meters: number;
  /** The radius the gym had configured at mint time. */
  radius_meters: number;
}

export interface PassTokenClaims {
  /** member id */
  id: string;
  /** phone */
  ph: string;
  /** floor(minted_at / PASS_WINDOW_MS) */
  t: number;
  /**
   * Absent when the gym does not enforce a fence (or has no coordinates), which
   * is exactly when the server has nothing to re-check.
   */
  geo?: PassGeoProof;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** base64 JSON. Every field is ASCII, so btoa is safe here. */
export function encodePassToken(claims: PassTokenClaims): string {
  return btoa(JSON.stringify(claims));
}

/**
 * Returns null for anything that is not one of our tokens. The caller decides
 * whether a null is fatal — legacy `GF:phone:t` and bare-digit codes still reach
 * the kiosk, and only an enforcing gym should refuse them.
 */
export function decodePassToken(raw: string): PassTokenClaims | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(text));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const body = parsed as Record<string, unknown>;

  const id = typeof body.id === 'string' ? body.id : '';
  const ph = typeof body.ph === 'string' ? body.ph : '';
  const t = typeof body.t === 'number' ? body.t : null;
  if (!id || t === null) return null;

  let geo: PassGeoProof | undefined;
  const rawGeo = body.geo;
  if (rawGeo && typeof rawGeo === 'object') {
    const g = rawGeo as Record<string, unknown>;
    // A proof we cannot re-measure is worse than no proof: it would let the
    // server "verify" a distance it never actually had.
    if (isFiniteNumber(g.lat) && isFiniteNumber(g.lon) && isFiniteNumber(g.distance_meters)) {
      geo = {
        lat: g.lat,
        lon: g.lon,
        accuracy_meters: isFiniteNumber(g.accuracy_meters) ? g.accuracy_meters : null,
        distance_meters: g.distance_meters,
        radius_meters: isFiniteNumber(g.radius_meters) ? g.radius_meters : 0,
      };
    }
  }

  return { id, ph, t, geo };
}

/** Fresh enough to act on right now. */
export function isPassWindowCurrent(t: number, nowMs: number = Date.now()): boolean {
  if (!Number.isFinite(t)) return false;
  const current = Math.floor(nowMs / PASS_WINDOW_MS);
  return Math.abs(current - t) <= PASS_WINDOW_SKEW;
}
