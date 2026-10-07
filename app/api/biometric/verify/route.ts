import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendWhatsAppNotification } from '@/lib/whatsapp';
import { isUuid } from '@/lib/session';
import { databaseError, readJsonBody } from '@/lib/sqlstate';

// Health probe for the browser / device onboarding checklist.
export async function GET() {
  return NextResponse.json({
    status: 'online',
    message: 'Biometric Cloud Gateway Active. Ready for POST verification from Raspberry Pi.',
  });
}

/**
 * Fingerprint verification endpoint called by the Raspberry Pi gateway.
 *
 * DEVICE KEY REQUIRED (hardening pass, fix 2)
 * -------------------------------------------
 * Every POST must carry the machine key issued at registration — the
 * X-Device-Key header (X-Api-Key and body device_key/api_key accepted too) —
 * or it is refused with 401 before anything is read. The key resolves through
 * fn_hardware_authorize and the GYM comes from the device row, so a caller can
 * only ever punch into its own gym; a contradicting X-Tenant-Id is rejected
 * (403) rather than obeyed.
 *
 * The decision itself — lookup, freeze, expiry and the attendances row with
 * device_id — runs inside fn_hardware_punch, the same function
 * /api/hardware/punch uses. This route is therefore a thin translator, not a
 * second gate authority: it can no longer write device-less attendance or
 * re-implement membership rules.
 *
 * NOTE: biometric_id uniqueness is (tenant_id, biometric_id), so the same slot
 * number can legitimately exist in two gyms; the device row settles which gym
 * owns the finger, and an ambiguous in-tenant slot is refused, never guessed.
 */

/** Mirrors /api/hardware/punch: a template slot is a positive integer. */
function normalizeBiometricId(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  if (value > 2_147_483_647) return null;
  return value;
}

/** Header first (preferred), then the body aliases firmware in the field uses. */
function readDeviceKey(request: Request, body: Record<string, unknown>): string {
  const header = request.headers.get('x-device-key') ?? request.headers.get('x-api-key') ?? '';
  if (header.trim()) return header.trim();
  const fromBody = body.device_key ?? body.deviceKey ?? body.api_key ?? body.apiKey ?? '';
  return String(fromBody).trim();
}

export async function POST(req: Request) {
  try {
    const parsed = await readJsonBody(req);
    if ('response' in parsed) return parsed.response;
    const body = parsed.body;

    const deviceKey = readDeviceKey(req, body);
    // 401, not 400: without a credential this request is unauthenticated.
    if (!deviceKey || deviceKey.length > 80) {
      return NextResponse.json(
        { success: false, allowed: false, error: 'Unauthorized: device_key is required.' },
        { status: 401 }
      );
    }

    // 1. Turn the key into "which device, which gym" inside Postgres.
    const { data: authorize, error: authError } = await supabase.rpc('fn_hardware_authorize', {
      p_api_key: deviceKey,
    });
    if (authError) return databaseError(authError, 'The gate refused this request.');

    const device = authorize as { device_id?: string; tenant_id?: string | null } | null;
    if (!device || !device.tenant_id) {
      return NextResponse.json(
        { success: false, allowed: false, error: 'Unauthorized: unknown device key.' },
        { status: 401 }
      );
    }

    const headerTenant = req.headers.get('x-tenant-id');
    if (headerTenant && isUuid(headerTenant) && headerTenant !== device.tenant_id) {
      return NextResponse.json(
        { success: false, allowed: false, error: 'X-Tenant-Id does not match this device.' },
        { status: 403 }
      );
    }

    const biometricId = normalizeBiometricId(
      body.biometric_id ?? body.biometricId ?? body.slot ?? body.fingerprint_id ?? body.fingerprintId
    );
    if (biometricId === null) {
      return NextResponse.json({ success: false, error: 'Biometric ID missing' }, { status: 400 });
    }

    // 2. One transaction: member lookup scoped to the device's gym, freeze and
    //    expiry rules, and the attendances row — all carrying device context.
    const { data, error } = await supabase.rpc('fn_hardware_punch', {
      p_api_key: deviceKey,
      p_biometric_id: biometricId,
      p_rfid_card: null,
    });
    if (error) return databaseError(error, 'The gate refused this request.');

    const verdict = (data ?? {}) as Record<string, unknown>;
    const code = String(verdict.code ?? '');
    const name = (verdict.member_name as string) ?? 'Member';

    // Response contract kept byte-compatible with the pre-hardening endpoint so
    // the Pi gateway needs no firmware change.
    if (code === 'unknown_credential') {
      return NextResponse.json(
        { success: false, allowed: false, message: 'Member not registered' },
        { status: 404 }
      );
    }

    if (code === 'ambiguous_credential') {
      return NextResponse.json(
        {
          success: false,
          allowed: false,
          message: 'This fingerprint matches more than one member in this gym. See the front desk.',
        },
        { status: 409 }
      );
    }

    // Frozen beats expiry — a frozen pass is a temporary hold, not a dues problem.
    if (code === 'blocked_frozen') {
      return NextResponse.json({ success: true, allowed: false, name, message: 'Membership Frozen' });
    }

    if (code === 'blocked_expired') {
      return NextResponse.json({ success: true, allowed: false, name, message: 'Membership Expired' });
    }

    if (verdict.unlock !== true) {
      // Any future deny code stays a deny, with the database's own reason.
      return NextResponse.json({
        success: false,
        allowed: false,
        name,
        message: String(verdict.reason ?? 'Access Denied'),
      });
    }

    // Granted: WhatsApp greeting, exactly as before (fire and forget).
    const phone = typeof verdict.member_phone === 'string' ? verdict.member_phone : '';
    if (phone) {
      sendWhatsAppNotification({
        phone,
        message: `Welcome to the gym, ${name}! 💪 Your biometric attendance has been recorded.`,
      }).catch((err) => console.error('WhatsApp notify error:', err));
    }

    return NextResponse.json({ success: true, allowed: true, name, message: 'Attendance Successful' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
