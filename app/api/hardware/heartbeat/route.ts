import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import {
  isDeviceStatus,
  isDeviceType,
  type HardwareDeviceStatus,
  type HardwareDeviceType,
  type HeartbeatReport,
} from '@/lib/hardware';

/**
 * POST /api/hardware/heartbeat — Module 2.4.1.
 *
 * Body (all optional, at least one address required):
 *   { apiKey }                                    a real terminal, keyed
 *   { deviceId, tenant_id? }                       console "Ping Device"
 *   { tenant_id, device_type: 'camera_kiosk' }     the browser kiosk on /scan
 *   { status?, firmware_version? }                 defaults to "online"
 *
 * Who may say what:
 *   - A device holding a valid machine key may update its own row and report
 *     any status, including "error" / "maintenance".
 *   - The console pings by device id, scoped to the tenant in its session cookie.
 *   - The kiosk has no machine key, so it addresses its own gym by type and must
 *     present a matching forgeos_tenant cookie. A random caller cannot mark
 *     somebody else's gym green.
 *
 * The IP column is filled from x-forwarded-for, which is what a device behind a
 * NAT actually presents. It is informational, never an authorisation input.
 */

/** First hop of x-forwarded-for: the client, per the upstream proxy. */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first && first.length <= 45) return first;
  }
  return request.headers.get('x-real-ip')?.trim().slice(0, 45) ?? null;
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const apiKey =
    typeof body.apiKey === 'string'
      ? body.apiKey.trim()
      : typeof body.api_key === 'string'
        ? body.api_key.trim()
        : '';

  const deviceId = body.deviceId ?? body.device_id;
  const bodyTenant = body.tenant_id ?? body.tenantId;
  const cookieTenant = readTenantCookie(request);

  let status: HardwareDeviceStatus = 'online';
  const rawStatus = body.status;
  if (rawStatus !== null && rawStatus !== undefined && rawStatus !== '') {
    if (!isDeviceStatus(rawStatus)) {
      return badRequest('status must be online, offline, error or maintenance.');
    }
    status = rawStatus;
  }

  let deviceType: HardwareDeviceType | null = null;
  const rawType = body.device_type ?? body.deviceType;
  if (rawType !== null && rawType !== undefined && rawType !== '') {
    if (!isDeviceType(rawType)) {
      return badRequest(
        `device_type must be one of: biometric_fingerprint, rfid_scanner, camera_kiosk, turnstile_relay, raspberry_pi.`
      );
    }
    deviceType = rawType;
  }

  const firmware = body.firmware_version ?? body.firmwareVersion;
  const firmwareVersion =
    typeof firmware === 'string' && firmware.trim() ? firmware.trim().slice(0, 24) : null;

  const hasDeviceId = isUuid(deviceId);
  const hasBodyTenant = isUuid(bodyTenant);

  if (!apiKey && !hasDeviceId && !hasBodyTenant) {
    return badRequest('heartbeat needs an apiKey, a deviceId, or a tenant_id.');
  }

  // Tenant-addressed ping (the /scan kiosk): require the session cookie to agree
  // with the claimed tenant, and never let it reach past its own gym.
  if (!apiKey && !hasDeviceId && hasBodyTenant && cookieTenant !== bodyTenant) {
    return badRequest('That tenant does not match this browser session.', 403);
  }

  const { data, error } = await supabase.rpc('fn_hardware_heartbeat', {
    p_api_key: apiKey || null,
    p_device_id: hasDeviceId ? (deviceId as string) : null,
    p_tenant_id: hasBodyTenant ? (bodyTenant as string) : cookieTenant,
    p_device_type: deviceType,
    p_status: status,
    p_firmware_version: firmwareVersion,
    p_ip_address: clientIp(request),
  });
  if (error) return databaseError(error, 'Heartbeat could not be recorded.');

  // NULL from the function means nothing matched that address.
  if (!data) {
    if (apiKey) {
      return NextResponse.json(
        { ok: false, error: 'Unknown device api_key.', code: '45005' },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'No terminal in this gym matches that id or type.' },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, heartbeat: data as HeartbeatReport });
}
