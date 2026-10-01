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
 *   Request:  { api_key, slot? | biometric_id?, rfid? }
 *             (camelCase aliases accepted: apiKey, biometricId, rfidCard)
 *   Response: { access: "GRANTED" | "DENIED", reason, member?, ... }
 *   Status:   200 for a decision, 400 malformed, 401 unknown/revoked key,
 *             5xx the database itself failed.
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

  const apiKey = String(body.api_key ?? body.apiKey ?? '').trim();
  if (!apiKey) return badRequest('api_key is required.');
  if (apiKey.length > 80) return badRequest('api_key is not valid.');

  const biometricId = normalizeBiometricId(
    body.slot ?? body.biometric_id ?? body.biometricId
  );
  const rfidCard = normalizeCard(
    body.rfid ?? body.rfid_card ?? body.rfidCard ?? body.card
  );

  if (biometricId === null && rfidCard === null) {
    return badRequest('Send slot/biometric_id (number) or rfid (string).');
  }

  const { data, error } = await supabase.rpc('fn_hardware_punch', {
    p_api_key: apiKey,
    p_biometric_id: biometricId,
    p_rfid_card: rfidCard,
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
    contract: 'POST { api_key, slot | biometric_id | rfid } -> { access: GRANTED | DENIED, reason }',
  });
}
