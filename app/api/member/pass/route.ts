import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { normalizePhone10 } from '@/lib/session';
import { badRequest, databaseError } from '@/lib/sqlstate';
import { parseCoordinate, parseRadius, type GymGeofence } from '@/lib/geofence';

/**
 * POST /api/member/pass — the member self-portal's lookup (Module 2.2).
 *
 * Body: { phone: string }
 *
 * Why this exists: the portal used to query `members` straight from the browser
 * with an `ilike '%1234%'` fragment. That meant a visitor with the public anon
 * key could walk through every gym in the database scraping names and payment
 * amounts off any phone fragment. Here the lookup needs a full 10-digit number,
 * runs on the server, and returns only the fields a member is allowed to see
 * about themselves.
 *
 * It also returns the gym's geofence configuration in the same round trip, so
 * the pass screen knows before it asks for GPS whether this gym enforces one.
 */

interface PassMember {
  id: string;
  full_name: string;
  phone: string;
  tenant_id: string | null;
  tenant_name: string;
  upi_id: string | null;
  membership_end: string | null;
  status: string;
  is_frozen: boolean;
  freeze_end_date: string | null;
  total_freeze_days: number;
  amount_paid: number;
  days_left: number;
  is_expired: boolean;
}

const MEMBER_FIELDS =
  'id, full_name, phone, tenant_id, membership_end, status, is_frozen, freeze_end_date, total_freeze_days, amount_paid';

function daysLeft(membershipEnd: string | null): number {
  if (!membershipEnd) return 0;
  const target = new Date(membershipEnd);
  if (Number.isNaN(target.getTime())) return 0;
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('Request body must be valid JSON.');
  }

  const rawPhone = body.phone ?? body.phone_number;
  if (typeof rawPhone !== 'string') return badRequest('phone is required.');

  const phone = normalizePhone10(rawPhone);
  if (phone.length !== 10) {
    return badRequest('Enter the full 10-digit mobile number on your membership.');
  }

  try {
    // Exact match first. The loose pass below only runs for legacy rows that were
    // saved with a +91 prefix or spaces, and it is still anchored to a full
    // 10-digit tail rather than an arbitrary fragment.
    const exact = await supabase
      .from('members')
      .select(MEMBER_FIELDS)
      .eq('phone', phone)
      .order('membership_end', { ascending: false })
      .limit(5);

    if (exact.error) return databaseError(exact.error, 'Membership lookup failed.');
    let rows = exact.data ?? [];

    if (rows.length === 0) {
      const loose = await supabase
        .from('members')
        .select(MEMBER_FIELDS)
        .like('phone', `%${phone}`)
        .order('membership_end', { ascending: false })
        .limit(5);

      if (loose.error) return databaseError(loose.error, 'Membership lookup failed.');
      rows = loose.data ?? [];
    }

    if (rows.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'No membership found for that number. Check the digits or see the front desk.',
      }, { status: 404 });
    }

    const row = rows[0] as unknown as Record<string, unknown>;
    const tenantId = typeof row.tenant_id === 'string' ? row.tenant_id : null;

    let geofence: GymGeofence | null = null;
    let tenantName = 'your gym';
    let tenantUpiId: string | null = null;

    if (tenantId) {
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('id, name, upi_id, latitude, longitude, geofence_radius_meters, enforce_geofence')
        .eq('id', tenantId)
        .maybeSingle();

      // A missing tenant row must not break the pass: it just means no geofence
      // is known, which the client treats as "not enforced".
      if (!tenantError && tenant) {
        const t = tenant as unknown as Record<string, unknown>;
        tenantName = (t.name as string) ?? tenantName;
        tenantUpiId = typeof t.upi_id === 'string' && t.upi_id.trim() ? t.upi_id.trim() : null;
        geofence = {
          tenant_id: tenantId,
          tenant_name: tenantName,
          latitude: parseCoordinate(t.latitude),
          longitude: parseCoordinate(t.longitude),
          geofence_radius_meters: parseRadius(t.geofence_radius_meters),
          enforce_geofence: Boolean(t.enforce_geofence),
        };
      }
    }

    const membershipEnd = (row.membership_end as string | null) ?? null;
    const remaining = daysLeft(membershipEnd);

    const member: PassMember = {
      id: String(row.id),
      full_name: (row.full_name as string) ?? 'Member',
      phone: (row.phone as string) ?? phone,
      tenant_id: tenantId,
      tenant_name: tenantName,
      upi_id: tenantUpiId,
      membership_end: membershipEnd,
      status: (row.status as string) ?? 'active',
      is_frozen: Boolean(row.is_frozen),
      freeze_end_date: (row.freeze_end_date as string | null) ?? null,
      total_freeze_days: Number(row.total_freeze_days) || 0,
      amount_paid: Number(row.amount_paid) || 0,
      days_left: remaining,
      is_expired: membershipEnd === null || remaining < 0,
    };

    return NextResponse.json({ ok: true, member, geofence, match_count: rows.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Member pass lookup failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
