import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/hardware/punch — Module 2.3.3.
 *
 * The door endpoint for ESP32 / Raspberry Pi / fingerprint & RFID readers. There
 * is no session and no cookie here: the machine authenticates with the api key
 * printed once at registration, and the gym is derived from the device row, so a
 * reader can only ever punch into its own gym.
 *
 * Request:  { apiKey: string, biometricId?: number, rfidCard?: string }
 *           (snake_case api_key / biometric_id / rfid_card are accepted too,
 *            because firmware in the field is rarely consistent)
 *
 * Granted:  { unlock: true,  code: "granted", memberName, reason, ... }
 * Blocked:  { unlock: false, code: "blocked_frozen" | "blocked_expired", reason }
 *
 * Every accepted credential leaves an attendances row — granted and blocked
 * punches alike — so the log shows who was turned away and at which terminal.
 * The whole decision runs inside fn_hardware_punch in one transaction.
 */

/** Cards arrive from many readers: keep printable ASCII, cap the length. */
function normalizeCard(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^0-9A-Za-z:\-\s]/g, '').trim();
  return cleaned ? cleaned.slice(0, 64) : null;
}

function normalizeBiometricId(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  // Postgres integer ceiling; a template slot is never this big anyway.
  if (value > 2_147_483_647) return null;
  return value;
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const rawKey = body.apiKey ?? body.api_key;
  const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!apiKey) return badRequest('apiKey is required.');
  if (apiKey.length > 80) return badRequest('apiKey is not valid.');

  const biometricId = normalizeBiometricId(body.biometricId ?? body.biometric_id);
  const rfidCard = normalizeCard(body.rfidCard ?? body.rfid_card);

  if (biometricId === null && rfidCard === null) {
    return badRequest('Send biometricId (number) or rfidCard (string).');
  }

  const { data, error } = await supabase.rpc('fn_hardware_punch', {
    p_api_key: apiKey,
    p_biometric_id: biometricId,
    p_rfid_card: rfidCard,
  });

  if (error) {
    // 45005 is the function's own "unknown device api_key" -> 401 for the reader.
    return databaseError(error, 'The gate controller refused this request.', 500);
  }

  const verdict = (data ?? {}) as Record<string, unknown>;

  // memberName is the field name the spec gives firmware; member_name is kept
  // alongside it so a dashboard can read either without a translation layer.
  return NextResponse.json({
    unlock: Boolean(verdict.unlock),
    code: verdict.code ?? 'granted',
    reason: verdict.reason ?? 'Decision recorded.',
    memberName: verdict.member_name ?? null,
    member_id: verdict.member_id ?? null,
    member_phone: verdict.member_phone ?? null,
    membership_end: verdict.membership_end ?? null,
    days_left: verdict.days_left ?? null,
    is_frozen: verdict.is_frozen ?? null,
    method: verdict.method ?? null,
    device_name: verdict.device_name ?? null,
    device_id: verdict.device_id ?? null,
    attendance_id: verdict.attendance_id ?? null,
    tenant_id: verdict.tenant_id ?? null,
  });
}
