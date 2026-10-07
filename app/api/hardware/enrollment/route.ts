import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * /api/hardware/enrollment — the owner's "Tap on Terminal" flow (Phase 12).
 *
 *   GET  ?tenant_id=&device_id=   -> { ok, devices[] }   (enrollment state only)
 *   POST { tenant_id, device_id?, seconds?, purpose? } -> { ok, device }
 *
 * `purpose: "card"` is the RFID link modal's "Tap on Terminal": with no
 * device_id it arms a NON-biometric terminal (the card reader), never the
 * fingerprint unit — see the pick inside POST.
 *
 * WHY THIS IS AN API ROUTE AND NOT A DIRECT SUPABASE CALL
 * ------------------------------------------------------
 * hardware_devices is revoked from anon/authenticated on purpose (Phase 2): it
 * holds `api_key`, and the anon key ships inside every build. The browser
 * therefore CANNOT read this table. Everything goes through the SECURITY DEFINER
 * RPCs added in migration 0012, which return only non-secret enrollment fields.
 *
 * That is also why the UI polls this endpoint instead of subscribing to
 * `hardware_devices` over Realtime: the owner console authenticates against
 * gym_users, not Supabase Auth, so it holds the ANON role and RLS gives it
 * nothing. Realtime on that table is enabled for `authenticated` in the same
 * migration, so switching the console to Supabase Auth makes a socket viable
 * later without changing the contract.
 *
 * `device_id` is optional on POST: when omitted, the terminal most plausibly at
 * the front desk is armed so the owner does not have to know which reader is
 * at which door. For `purpose: "card"` the pick is restricted to readers whose
 * device_type is not biometric_fingerprint.
 */

/** Body/query tenant first, cookie second, hard 403 when neither is a UUID. */
function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = resolveTenant([url.searchParams.get('tenant_id')], request);
  if (!tenantId) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  const deviceId = url.searchParams.get('device_id');

  const { data, error } = await supabase.rpc('fn_hardware_enrollment_state', {
    p_tenant_id: tenantId,
    p_device_id: isUuid(deviceId) ? deviceId : null,
  });

  if (error) {
    return databaseError(
      error,
      'Could not read terminal enrollment state. Is migration 0012 applied?'
    );
  }

  return NextResponse.json({ ok: true, devices: (data ?? []) as unknown[] });
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

  const seconds = Number(body.seconds ?? 60);
  const window = Number.isFinite(seconds) ? Math.min(Math.max(seconds, 15), 300) : 60;

  // "card" = the RFID link modal's "Tap on Terminal". It must arm the card
  // reader, never the fingerprint unit — the pick below enforces it.
  const purpose = body.purpose === 'card' ? 'card' : null;

  let deviceId = isUuid(body.device_id) ? body.device_id : null;

  // No device chosen: arm the terminal that is most plausibly at the front desk.
  // "Online" is the 60-second heartbeat rule fn_hardware_list already uses, so
  // this picks the same device the owner's Hardware tab shows as live.
  if (!deviceId) {
    const { data: candidates, error: listError } = await supabase.rpc(
      'fn_hardware_enrollment_state',
      { p_tenant_id: tenantId, p_device_id: null }
    );

    if (listError) {
      return databaseError(
        listError,
        'Could not list terminals. Is migration 0012 applied?'
      );
    }

    const devices = (candidates ?? []) as Array<{
      id: string;
      status?: string;
      enrollment_mode?: boolean;
      device_type?: string;
    }>;

    // CARD PURPOSE: a tap arrives on whichever terminal holds the key the
    // ESP32 was flashed with, and fn_hardware_capture_enrollment only writes
    // last_scanned_uid when the TAPPED device's own row is armed. The old pick
    // was name order — "Finger Print" sorts before "RFID" — so it armed the
    // R307, the RC522's tap hit an unarmed row, captured=false, nothing was
    // stored, and the modal timed out every time. So: exclude the biometric
    // unit outright, and rank a dedicated rfid_scanner above any other reader
    // type. A gym with ONLY a fingerprint unit gets an honest 404 instead of
    // a silent 60-second wait.
    let pool = devices;
    if (purpose === 'card') {
      const readers = devices.filter((d) => d.device_type !== 'biometric_fingerprint');
      pool = [
        ...readers.filter((d) => d.device_type === 'rfid_scanner'),
        ...readers.filter((d) => d.device_type !== 'rfid_scanner'),
      ];
    }

    const online = pool.filter((d) => d.status === 'online' && !d.enrollment_mode);
    const fallback = pool.filter((d) => !d.enrollment_mode);
    // For a card tap an already-armed reader also counts (a second click
    // refreshes its window instead of failing); other purposes keep the
    // original armed-excluded behaviour.
    const armed = purpose === 'card' ? pool.filter((d) => d.enrollment_mode) : [];

    // An online terminal wins, so a second click is a no-op rather than
    // re-arming a different reader and splitting the owner's attention.
    const chosen = online[0] ?? fallback[0] ?? armed[0];
    if (!chosen) {
      return badRequest(
        purpose === 'card'
          ? 'No card reader terminal is available. Register a reader whose device type is not biometric_fingerprint on the Hardware tab first.'
          : 'No terminal is available to enroll. Register a reader on the Hardware tab first.',
        404
      );
    }
    deviceId = chosen.id;
  }

  const { data, error } = await supabase.rpc('fn_hardware_begin_enrollment', {
    p_tenant_id: tenantId,
    p_device_id: deviceId,
    p_seconds: window,
  });

  if (error) {
    return databaseError(error, 'Could not arm that terminal for enrollment.');
  }

  return NextResponse.json({ ok: true, device: data });
}