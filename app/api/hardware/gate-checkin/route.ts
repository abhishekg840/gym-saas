import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { badRequest, databaseError, readDeviceBody } from '@/lib/sqlstate';

/**
 * POST /api/hardware/gate-checkin — Module 11.1, the integration webhook.
 *
 * A different contract from /api/hardware/punch (which speaks the firmware
 * dialect of this codebase): this one answers third-party controllers,
 * turnstile firmware and smart-gate vendors with the exact envelope they
 * were promised —
 *
 *   Request:  { device_key, action: "gate_checkin", rfid_card? | rfid_uid? | slot? }
 *             Accepted aliases: api_key / apiKey, biometric_id / biometricId,
 *             rfid / rfidCard / card, rfidUid.
 *             ALSO accepted: application/x-www-form-urlencoded
 *             (device_key=…&rfid_card=…), and JSON sent with a text/plain or
 *             missing Content-Type. See readDeviceBody for why.
 *   Response: { access: "GRANTED" | "DENIED", reason, member?, ... }
 *   Status:   200 for a decision, 400 malformed, 401 unknown/revoked key,
 *             5xx the database itself failed.
 *
 * CREDENTIAL ALIASING — rfid_card is the fallback for rfid_uid
 * ------------------------------------------------------
 * The ESP32 firmware in the field sends BOTH fields, but which one actually
 * carries the tapped credential varies by board revision: some read the RC522
 * into rfid_card, others into rfid_uid. Rather than force a firmware reflash on
 * hardware already bolted to a turnstile, the two are treated as ONE credential:
 *
 *     rfid_card = body.rfid_card || body.rfid_uid
 *
 * The resolved value is passed as BOTH p_rfid_card and p_rfid_uid. That is
 * deliberate and is what makes it revision-proof:
 *
 *   - p_rfid_card resolves members.rfid_card — the raw serial.
 *   - p_rfid_uid resolves members.rfid_uid — the system key (migration 0010),
 *     which fn_hardware_punch translates back to the serial server-side.
 *
 * fn_hardware_punch tries the key mapping first and falls back to a literal
 * rfid_card comparison, so a card that was enrolled by serial opens the door
 * whichever field the board put it in. Neither field is trusted over the other.
 *
 * The decision — membership validity, freeze state, the attendance row — all
 * live inside fn_hardware_punch, so the gate and this webhook can never
 * disagree. Every accepted credential (granted or denied) is logged in
 * attendances in realtime; the streak trigger then moves today's counters.
 */

function normalizeBiometricId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  if (value > 2_147_483_647) return null;
  return value;
}

function normalizeCard(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).replace(/[^0-9A-Za-z:\- ]/g, '').trim();
  return text ? text.slice(0, 64) : null;
}

/**
 * First argument that is a NON-EMPTY string — JavaScript's `||` semantics.
 *
 * `a ?? b` is not the same thing, and the difference is exactly what firmware
 * triggers here: a board that includes the field but leaves it blank sends
 * `"rfid_card": ""`, which `??` happily returns because "" is not null. The
 * spec's `rfid_card = body.rfid_card || body.rfid_uid` has to skip it and fall
 * through to rfid_uid, which is the only credential that board ever populates.
 * Numbers are accepted too, since a fingerprint slot can arrive unquoted from
 * a form body.
 */
function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text.trim() !== '') return text;
  }
  return '';
}

export async function POST(request: Request) {
  // readDeviceBody, not readJsonBody: an ESP32 may post form-encoded, or JSON
  // with the wrong Content-Type, or a trailing newline/BOM. A body is a one-shot
  // stream, so the payload has to be read as text and re-parsed rather than
  // letting request.json() throw and losing it.
  const parsed = await readDeviceBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  // `action` is optional and only ever gate_checkin. Rejecting an unknown
  // action loudly is the difference between "the firmware is on the wrong
  // build" and "the member was silently denied" — a door that answers
  // DENIED for a logout request would open support tickets.
  const action = String(body.action ?? 'gate_checkin').trim();
  if (action !== 'gate_checkin') {
    return badRequest("action must be 'gate_checkin'.");
  }

  // `device_key` is the Raspberry Pi spelling; `api_key` is the original
  // contract. Both resolve to the same machine token.
  const apiKey = firstNonEmpty(
    body.device_key,
    body.deviceKey,
    body.api_key,
    body.apiKey
  ).trim();
  if (!apiKey) return badRequest('device_key (api_key) is required.');
  if (apiKey.length > 80) return badRequest('device_key is not valid.');

  const biometricId = normalizeBiometricId(
    firstNonEmpty(body.slot, body.biometric_id, body.biometricId)
  );

  // rfid_card = body.rfid_card || body.rfid_uid
  //
  // Both fields are read here, in this order, and the first NON-EMPTY one wins:
  //   1. rfid_card / rfidCard / rfid / card — the raw serial the RC522 reports
  //   2. rfid_uid / rfidUid                      — the system key
  //
  // Whichever one the board put the tap into becomes the card credential. The
  // resolved value is sent as BOTH parameters below, so the database can match it
  // against members.rfid_card OR members.rfid_uid — a card enrolled either way
  // opens the door, with no firmware reflash on hardware already installed.
  const rfidCredential = normalizeCard(
    firstNonEmpty(
      body.rfid_card,
      body.rfidCard,
      body.rfid,
      body.card,
      body.rfid_uid,
      body.rfidUid
    )
  );

  if (biometricId === null && rfidCredential === null) {
    return badRequest('Send rfid_card (card serial) or rfid_uid (card key), or slot for a fingerprint.');
  }

  // ------------------------------------------------------------------
  // ENROLLMENT MODE INTERCEPT
  // ------------------------------------------------------------------
  // If this terminal is armed for enrollment, the tap is NOT a gym entry. It is
  // captured and answered with ENROLL_CAPTURED, and crucially NO attendances row
  // is written -- otherwise enrolling a card would check its current holder into
  // the gym as a phantom guest.
  //
  // The capture is a compare-and-swap inside SQL, so two readers tapping at once
  // cannot both win, and a terminal whose 60s window expired simply reports
  // captured=false and falls through to a normal punch below.
  //
  // Only tried when a card was actually sent: a fingerprint has nothing to enroll.
  if (rfidCredential !== null) {
    const { data: captured, error: captureError } = await supabase.rpc(
      'fn_hardware_capture_enrollment',
      { p_api_key: apiKey, p_card: rfidCredential }
    );

    if (captureError) {
      // Never let the enrollment path break the gate. A failure here must fall
      // through to a normal punch rather than locking members out of the door.
      return databaseError(captureError, 'Could not check enrollment mode on this terminal.', 500);
    }

    const capture = (captured ?? {}) as { captured?: boolean };
    if (capture.captured === true) {
      return NextResponse.json({
        access: 'ENROLL_CAPTURED',
        rfid_uid: rfidCredential,
        message: 'Card captured for enrollment',
        device_id: (captured as { device_id?: string }).device_id ?? null,
        captured_at: new Date().toISOString(),
      });
    }
  }

  // The four-argument overload from migration 0010: no defaults on the trailing
  // parameters, so this call is unambiguous. p_rfid_card and p_rfid_uid are both
  // set to the resolved credential so either column can match it.
  const { data, error } = await supabase.rpc('fn_hardware_punch', {
    p_api_key: apiKey,
    p_biometric_id: biometricId,
    p_rfid_card: rfidCredential,
    p_rfid_uid: rfidCredential,
  });

  // SQLSTATE 45005 is fn_hardware_punch's "unknown or revoked device key" ->
  // databaseError maps it to 401 for the integrating device.
  if (error) {
    return databaseError(error, 'The gate refused this request.', 500);
  }

  const verdict = (data ?? {}) as Record<string, unknown>;
  const granted = Boolean(verdict.unlock);

  return NextResponse.json({
    access: granted ? 'GRANTED' : 'DENIED',
    reason: String(verdict.reason ?? (granted ? 'Access approved.' : 'Access denied.')),
    code: verdict.code ?? (granted ? 'granted' : 'denied'),
    member: verdict.member_id
      ? {
          id: verdict.member_id,
          name: verdict.member_name ?? null,
          phone: verdict.member_phone ?? null,
          membership_end: verdict.membership_end ?? null,
          days_left: verdict.days_left ?? null,
          is_frozen: verdict.is_frozen ?? null,
        }
      : null,
    attendance_id: verdict.attendance_id ?? null,
    device: {
      id: verdict.device_id ?? null,
      name: verdict.device_name ?? null,
    },
    tenant_id: verdict.tenant_id ?? null,
    checked_at: new Date().toISOString(),
  });
}

/** GET doubles as a liveness probe for the integrator's onboarding checklist. */
export async function GET() {
  return NextResponse.json({
    status: 'online',
    contract:
      'POST { device_key, action: "gate_checkin", rfid_card | rfid_uid | slot } -> { access: GRANTED | DENIED, reason }',
    accepts: [
      'application/json',
      'application/x-www-form-urlencoded',
      'text/plain (JSON body)',
    ],
    notes:
      'rfid_card falls back to rfid_uid, so a board that populates either field opens the door. Credentials are matched against both members.rfid_card and members.rfid_uid.',
  });
}
