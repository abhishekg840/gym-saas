import { isUuid } from '@/lib/session';

/**
 * Typed client for the hardware console endpoints.
 *
 * The console never reads hardware_devices directly: the table is revoked from
 * the anon role (see 0003_phase2_hardware_geofence.sql) precisely so a leaked
 * anon key cannot hand out machine tokens. Everything goes through
 * /api/hardware/*, which talks to the SECURITY DEFINER functions.
 */

export type HardwareDeviceType =
  | 'biometric_fingerprint'
  | 'rfid_scanner'
  | 'camera_kiosk'
  | 'turnstile_relay'
  | 'raspberry_pi';

export type HardwareDeviceStatus = 'online' | 'offline' | 'error' | 'maintenance';

export const DEVICE_TYPES: readonly HardwareDeviceType[] = [
  'biometric_fingerprint',
  'rfid_scanner',
  'camera_kiosk',
  'turnstile_relay',
  'raspberry_pi',
] as const;

export const DEVICE_STATUSES: readonly HardwareDeviceStatus[] = [
  'online',
  'offline',
  'error',
  'maintenance',
] as const;

/** A device is "live" if it checked in within this window. Mirrors fn_hardware_list. */
export const ONLINE_WINDOW_SECONDS = 60;

export function isDeviceType(value: unknown): value is HardwareDeviceType {
  return typeof value === 'string' && (DEVICE_TYPES as readonly string[]).includes(value);
}

export function isDeviceStatus(value: unknown): value is HardwareDeviceStatus {
  return typeof value === 'string' && (DEVICE_STATUSES as readonly string[]).includes(value);
}

interface DeviceTypeMeta {
  label: string;
  /** Tailwind classes for the badge on the device card. */
  badge: string;
  /** One line of plain language for the registration modal. */
  hint: string;
}

export const DEVICE_TYPE_META: Record<HardwareDeviceType, DeviceTypeMeta> = {
  biometric_fingerprint: {
    label: 'Fingerprint',
    badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
    hint: 'Sends a template slot number (biometric_id) with every punch.',
  },
  rfid_scanner: {
    label: 'RFID',
    badge: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    hint: 'Sends a card serial (rfidCard) with every punch.',
  },
  camera_kiosk: {
    label: 'QR Kiosk',
    badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    hint: 'A browser on /scan reading the rotating member pass.',
  },
  turnstile_relay: {
    label: 'Turnstile',
    badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    hint: 'Barrier relay that opens on unlock: true.',
  },
  raspberry_pi: {
    label: 'Pi Gateway',
    badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    hint: 'General gateway that fronts other readers on the gym LAN.',
  },
};

export function deviceTypeLabel(value: string): string {
  return isDeviceType(value) ? DEVICE_TYPE_META[value].label : value;
}

export interface HardwareDevice {
  id: string;
  device_name: string;
  device_type: HardwareDeviceType;
  status: HardwareDeviceStatus;
  ip_address: string | null;
  firmware_version: string;
  last_heartbeat: string | null;
  created_at: string;
  /** fn_hardware_list masks the token: only the ends are ever shown. */
  api_key_masked: string;
  api_key_length: number;
  is_online: boolean;
  seconds_since_seen: number | null;
}

/** Returned once, by the register call. It is never recoverable afterwards. */
export interface RegisteredDevice {
  id: string;
  tenant_id: string;
  device_name: string;
  device_type: HardwareDeviceType;
  api_key: string;
  status: HardwareDeviceStatus;
  firmware_version: string;
  ip_address: string | null;
  created_at: string;
  secret_shown_once: boolean;
}

interface ApiEnvelope {
  ok?: boolean;
  error?: string;
  code?: string;
  devices?: HardwareDevice[];
  device?: RegisteredDevice;
  heartbeat?: HeartbeatReport;
  [key: string]: unknown;
}

/** Every call shares one shape so failures always come back as a sentence. */
async function callHardware(
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; error?: string; code?: string; body: ApiEnvelope }> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    return { ok: false, error: 'Network error — the console could not reach the server.', body: {} };
  }

  let body: ApiEnvelope;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    return { ok: false, error: `Server returned an invalid response (${response.status}).`, body: {} };
  }

  if (!response.ok || body.ok === false) {
    return {
      ok: false,
      error: body.error ?? `Request failed with status ${response.status}.`,
      code: body.code,
      body,
    };
  }
  return { ok: true, body };
}

/** Guard here so a corrupt session value cannot fire an unscoped console query. */
function requireTenant(tenantId: string | null | undefined): string | null {
  return isUuid(tenantId) ? (tenantId as string) : null;
}

export async function listDevices(
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; devices: HardwareDevice[] }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: 'Sign in to a gym to see its terminals.', devices: [] };

  const result = await callHardware(`/api/hardware/devices?tenant_id=${tenant}`, { method: 'GET' });
  return { ok: result.ok, error: result.error, devices: result.body.devices ?? [] };
}

export async function registerDevice(input: {
  tenantId: string | null;
  deviceName: string;
  deviceType: HardwareDeviceType;
  firmwareVersion?: string;
}): Promise<{ ok: boolean; error?: string; device?: RegisteredDevice }> {
  const tenant = requireTenant(input.tenantId);
  if (!tenant) return { ok: false, error: 'Sign in to a gym before registering hardware.' };

  const result = await callHardware('/api/hardware/devices', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenant,
      device_name: input.deviceName.trim(),
      device_type: input.deviceType,
      firmware_version: input.firmwareVersion?.trim() || null,
    }),
  });
  return { ok: result.ok, error: result.error, device: result.body.device };
}

export async function deleteDevice(
  deviceId: string,
  tenantId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: 'Sign in to a gym before removing hardware.' };
  if (!isUuid(deviceId)) return { ok: false, error: 'Unknown terminal.' };

  const result = await callHardware('/api/hardware/devices', {
    method: 'DELETE',
    body: JSON.stringify({ tenant_id: tenant, device_id: deviceId }),
  });
  return { ok: result.ok, error: result.error };
}

/** What fn_hardware_heartbeat reports back. */
export interface HeartbeatReport {
  device_id: string;
  tenant_id: string;
  device_name: string;
  device_type: HardwareDeviceType;
  status: HardwareDeviceStatus;
  last_heartbeat: string | null;
  devices_updated: number;
}

export interface HeartbeatPayload {
  /** Machine token, when the caller has one (a real terminal). */
  apiKey?: string;
  deviceId?: string;
  /** Session tenant: lets the browser kiosk on /scan report in without a key. */
  tenantId?: string | null;
  deviceType?: HardwareDeviceType;
  status?: HardwareDeviceStatus;
  firmwareVersion?: string;
}

export async function sendHeartbeat(
  payload: HeartbeatPayload
): Promise<{ ok: boolean; error?: string; heartbeat?: HeartbeatReport }> {
  const result = await callHardware('/api/hardware/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      apiKey: payload.apiKey ?? null,
      deviceId: payload.deviceId ?? null,
      tenant_id: payload.tenantId ?? null,
      device_type: payload.deviceType ?? null,
      status: payload.status ?? 'online',
      firmware_version: payload.firmwareVersion ?? null,
    }),
  });
  return { ok: result.ok, error: result.error, heartbeat: result.body.heartbeat };
}

/**
 * "Ping Device": writes one heartbeat from the console so the operator can watch
 * the dot go green and confirm the heartbeat path works end to end. A real
 * device overwrites it on its next check-in (at most 30s later for /scan).
 */
export async function pingDevice(
  deviceId: string,
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; heartbeat?: HeartbeatReport }> {
  if (!isUuid(deviceId)) return { ok: false, error: 'Unknown terminal.' };
  const result = await sendHeartbeat({ deviceId, tenantId });
  return { ok: result.ok, error: result.error, heartbeat: result.heartbeat };
}

/** Body shape /api/hardware/punch accepts (camelCase, IoT friendly). */
export interface PunchPayload {
  apiKey: string;
  biometricId?: number;
  rfidCard?: string;
}

export type PunchCode =
  | 'granted'
  | 'blocked_frozen'
  | 'blocked_expired'
  | 'unknown_credential'
  | 'ambiguous_credential';

export interface PunchResponse {
  unlock: boolean;
  code: PunchCode | string;
  reason: string;
  memberName?: string;
  member_id?: string;
  member_phone?: string;
  membership_end?: string | null;
  days_left?: number;
  method?: 'biometric' | 'rfid';
  device_name?: string;
}

/**
 * Punches the gate from anywhere holding a machine key, so the console's test
 * panel and any browser-based terminal share one type with the ESP32 firmware.
 */
export async function sendPunch(payload: PunchPayload): Promise<PunchResponse> {
  try {
    const response = await fetch('/api/hardware/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return (await response.json()) as PunchResponse;
  } catch {
    return { unlock: false, code: 'network_error', reason: 'Gate service unreachable.' };
  }
}

/** "just now / 12s ago / 4m ago" — the console refreshes on a timer, not a wall clock. */
export function formatSince(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'never';
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}


