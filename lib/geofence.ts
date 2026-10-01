/**
 * Geofence geometry, kept for the owner's Hardware Console.
 *
 * Phase 5 removed geofencing from the member pass: a member's QR code no longer
 * depends on a GPS fix, and the kiosk no longer re-runs a distance check. What
 * remains is the arithmetic behind the console's "where am I relative to this
 * pin?" self-check, which is a setup aid for the owner rather than an access rule.
 */

/** The slice of the tenant row that a pass decision depends on. */
export interface GymGeofence {
  tenant_id: string;
  tenant_name: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number;
  enforce_geofence: boolean;
}

/** One reading straight out of navigator.geolocation. */
export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  /** epoch ms, so the UI can say how stale the reading is. */
  taken_at: number;
}

export type GeofenceState =
  | 'inside'
  | 'outside'
  | 'unconfigured'
  | 'unavailable'
  | 'not_enforced'
  | 'awaiting_fix';

export interface GeofenceVerdict {
  state: GeofenceState;
  distance_meters: number | null;
  accuracy_meters: number | null;
  radius_meters: number;
  /** True when the rotating QR pass may be shown and scanned. */
  unlocked: boolean;
  /** Member-facing sentence. Written for a phone screen, not a log line. */
  message: string;
}

export const DEFAULT_GEOFENCE_RADIUS = 100;

/** Mean Earth radius in metres (IUGG). Good to well under a metre at gym scale. */
const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in metres between two WGS84 points. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  // asin(min(1, sqrt(a))) guards the float edge where the two points are antipodal.
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * PostgREST returns numeric(10,7) as a JSON number, but a value that has been
 * through a form or a cache can arrive as a string, so accept both and reject
 * anything that is not a usable coordinate.
 */
export function parseCoordinate(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) === 0) return null; // 0,0 is the "nobody filled this in" default
  return value;
}

/** Radius is clamped to the same window the database CHECK allows. */
export function parseRadius(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_GEOFENCE_RADIUS;
  return Math.min(20_000, Math.max(10, Math.round(value)));
}

/** Human distance: metres under a kilometre, then kilometres with two decimals. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

/** navigator.geolocation error codes, translated for a kiosk crowd. */
export function geolocationErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return 'Location permission was blocked. Enable it for this site in your browser, then tap Refresh Location.';
    case 2:
      return 'No location available right now. Move near a window or turn on GPS, then tap Refresh Location.';
    case 3:
      return 'The GPS took too long to answer. Tap Refresh Location to try again.';
    default:
      return 'Your browser could not provide a location.';
  }
}

/**
 * The single place the pass rule lives:
 *   inside radius            -> unlocked
 *   outside radius + enforce -> locked, with the distance spelled out
 *   no coordinates saved     -> unlocked, geofencing is simply not configured
 *   no config object at all  -> locked (the phone never learned the rules)
 *   enforce on but no fix    -> locked (fail closed)
 */
export function evaluateGeofence(
  gym: GymGeofence | null,
  fix: GeoFix | null
): GeofenceVerdict {
  const radius = gym?.geofence_radius_meters ?? DEFAULT_GEOFENCE_RADIUS;

  const base = {
    distance_meters: null as number | null,
    accuracy_meters: fix?.accuracy_meters ?? null,
    radius_meters: radius,
  };

  // Two very different situations share the phrase "no coordinates". A gym that
  // was never marked is a choice: geofencing is simply off, so the pass works
  // anywhere. A null config object means the phone never learned this gym's
  // rules at all, and unlocking on that would turn a failed request into a hole
  // in the fence — so that one fails closed.
  if (!gym) {
    return {
      ...base,
      state: 'unavailable',
      unlocked: false,
      message:
        'This gym’s location rules could not be loaded, so the pass stays locked. Tap Retry, or ask the front desk to scan you in.',
    };
  }

  if (gym.latitude === null || gym.longitude === null) {
    return {
      ...base,
      state: 'unconfigured',
      unlocked: true,
      message:
        'This gym has no saved coordinates yet, so the pass works anywhere. Set the gym location in the Hardware Console to switch geofencing on.',
    };
  }

  const distance =
    fix === null
      ? null
      : haversineMeters(fix.latitude, fix.longitude, gym.latitude, gym.longitude);

  const withDistance = { ...base, distance_meters: distance };

  if (!gym.enforce_geofence) {
    return {
      ...withDistance,
      state: 'not_enforced',
      unlocked: true,
      message:
        distance === null
          ? `Geofencing is switched off for ${gym.tenant_name}, so your pass is live anywhere.`
          : `You are ${formatDistance(distance)} from ${gym.tenant_name}. Geofencing is off, so the pass stays live.`,
    };
  }

  if (fix === null || distance === null) {
    return {
      ...withDistance,
      state: 'awaiting_fix',
      unlocked: false,
      message:
        'Waiting for a GPS fix. Your gate pass unlocks as soon as your browser can prove you are inside the gym.',
    };
  }

  if (distance <= radius) {
    return {
      ...withDistance,
      state: 'inside',
      unlocked: true,
      message: `Inside ${gym.tenant_name} — ${formatDistance(distance)} from the door (±${formatDistance(fix.accuracy_meters)} GPS accuracy).`,
    };
  }

  return {
    ...withDistance,
    state: 'outside',
    unlocked: false,
    message: `Outside Gym Radius (${formatDistance(distance)} away).`,
  };
}

