import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/hardware/gate-checkin — Module 11.1, the integration webhook.
 *
 * A different contract from /api/hardware/punch (which speaks the firmware
 * dialect of this codebase): this one answers third-party controllers,
 * turnstile firmware and smart-gate vendors with the exact envelope they
 * were promised —
 *
 *   Request:  { device_key, action: "gate_checkin", slot? | rfid? | rfid_uid? }
 *             (api_key / apiKey, biometric_id / biometricId, rfid_card /
 *              rfidCard / card and rfidUid are all accepted as aliases, so the
 *              older integrations keep working untouched)
 *   Response: { access: "GRANTED" | "DENIED", reason, member?, ... }
 *   Status:   200 for a decision, 400 malformed, 401 unknown/revoked key,
 *             5xx the database itself failed.
 *
 * Three credentials can arrive and only one is needed:
 *   slot      the fingerprint template number the scanner stores
 *   rfid      the raw card serial straight off the RC522
 *   rfid_uid  the SYSTEM key printed on the card (members.rfid_uid), which
 *             migration 0010 resolves to the serial server-side — so a Pi
 *             that only knows the key still opens the door, and a stolen key
 *             is useless without the machine's device_key
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

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
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
  const apiKey = String(body.api_key ?? body.apiKey ?? body.device_key ?? body.deviceKey ?? '').trim();
  if (!apiKey) return badRequest('device_key (api_key) is required.');
  if (apiKey.length > 80) return badRequest('device_key is not valid.');

  const biometricId = normalizeBiometricId(
    body.slot ?? body.biometric_id ?? body.biometricId
  );
  const rfidCard = normalizeCard(
    body.rfid ?? body.rfid_card ?? body.rfidCard ?? body.card
  );
  // The system key printed on the card (members.rfid_uid). Resolved to the raw
  // serial inside fn_hardware_punch, which is the only place the door decision
  // is made — see migration 0010.
  const rfidUid = normalizeCard(body.rfid_uid ?? body.rfidUid);

  if (biometricId === null && rfidCard === null && rfidUid === null) {
    return badRequest('Send slot (biometric_id), rfid (card serial) or rfid_uid (card key).');
  }

  // The four-argument overload from migration 0010: no defaults on the trailing
  // parameters, so this call is unambiguous. Passing nulls for the credentials
  // the device did not send keeps a fingerprint punch winning over a card tap,
  // exactly as the three-argument version does.
  const { data, error } = await supabase.rpc('fn_hardware_punch', {
    p_api_key: apiKey,
    p_biometric_id: biometricId,
    p_rfid_card: rfidCard,
    p_rfid_uid: rfidUid,
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
      'POST { device_key, action: "gate_checkin", slot | rfid | rfid_uid } -> { access: GRANTED | DENIED, reason }',
  });
}
