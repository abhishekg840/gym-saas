import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import { DEVICE_TYPES, type HardwareDevice, type HardwareDeviceType } from '@/lib/hardware';

/**
 * /api/hardware/devices — the owner's terminal registry (Module 2.3.2).
 *
 *   GET    ?tenant_id=...                 -> { ok, devices[] }      (masked keys)
 *   POST   { tenant_id, device_name,
 *            device_type, firmware_version? }  -> { ok, device }     (key shown ONCE)
 *   DELETE { tenant_id, device_id }       -> { ok, deleted }
 *
 * hardware_devices is revoked from the API roles, so nothing here touches the
 * table directly: every statement runs inside a SECURITY DEFINER function that
 * re-checks tenant ownership. The tenant id is taken from the request body/query
 * when it is a well-formed UUID and otherwise from the forgeos_tenant cookie —
 * never from "no filter", which would list every gym's terminals.
 */

/** Body/query tenant first, cookie second, hard 403 when neither is a UUID. */
function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

export async function GET(request: Request) {
  const tenantId = resolveTenant([new URL(request.url).searchParams.get('tenant_id')], request);
  if (!tenantId) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  const { data, error } = await supabase.rpc('fn_hardware_list', { p_tenant_id: tenantId });
  if (error) return databaseError(error, 'Could not load the terminal list.');

  return NextResponse.json({ ok: true, devices: (data ?? []) as HardwareDevice[] });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  const deviceName = String(body.device_name ?? body.deviceName ?? '').trim();
  if (!deviceName) return badRequest('device_name is required.');
  if (deviceName.length > 80) return badRequest('device_name must be 80 characters or fewer.');

  const rawType = String(body.device_type ?? body.deviceType ?? '').trim();
  if (!DEVICE_TYPES.includes(rawType as HardwareDeviceType)) {
    return badRequest(
      `device_type must be one of: ${DEVICE_TYPES.join(', ')}.`
    );
  }

  const firmware = body.firmware_version ?? body.firmwareVersion;
  const firmwareVersion =
    typeof firmware === 'string' && firmware.trim() ? firmware.trim().slice(0, 24) : null;

  const { data, error } = await supabase.rpc('fn_hardware_register', {
    p_tenant_id: tenantId,
    p_device_name: deviceName,
    p_device_type: rawType as HardwareDeviceType,
    p_firmware_version: firmwareVersion,
  });
  if (error) return databaseError(error, 'Could not register that terminal.');

  // fn_hardware_register returns the plaintext key. It is the only response that
  // ever will: the list endpoint masks it, so store it in the device now.
  return NextResponse.json({ ok: true, device: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  const deviceId = body.device_id ?? body.deviceId;
  if (!isUuid(deviceId)) return badRequest('device_id must be a valid UUID.');

  const { data, error } = await supabase.rpc('fn_hardware_delete', {
    p_device_id: deviceId,
    p_tenant_id: tenantId,
  });
  if (error) return databaseError(error, 'Could not remove that terminal.');

  return NextResponse.json({ ok: true, ...(data as object) });
}
