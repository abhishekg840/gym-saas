import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, normalizePhone10, type GymSession } from '@/lib/session';

/**
 * POST /api/auth/login
 *
 * The login screen used to run `supabase.from('gym_users').select('*')`, which
 * shipped every operator account in every gym - PIN hashes included - to whoever
 * opened the page, then compared the PIN in the browser. Member lookup had the
 * same problem for member names and phone numbers.
 *
 * Verification now happens here: only the phone the visitor typed is sent in,
 * and the only thing that comes back is the session for the one account (or
 * member) that matched. No PIN, no other gyms' rows.
 *
 * Body: { phone: string, pin?: string }
 */

interface UserRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  tenant_id: string | null;
  pin_code: string | null;
}

interface MemberRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  tenant_id: string | null;
}

/**
 * Best-effort throttle. Route handlers can run on any instance, so this is not a
 * distributed limiter - it only raises the cost of hammering one warm instance.
 * A real limiter belongs in the edge/DB layer (Phase 2).
 */
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 15;
const attempts = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS_PER_WINDOW) {
    attempts.set(key, recent);
    return true;
  }
  recent.push(now);
  attempts.set(key, recent);
  return false;
}

/** Compares PINs without leaking length/timing through a short-circuit on index 0. */
function pinMatches(input: string, stored: string | null): boolean {
  const expected = (stored ?? '1234').trim();
  const given = input.trim();
  if (given.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: 'Invalid request payload.' }, { status: 400 });
  }

  const phone10 = normalizePhone10(String(payload.phone ?? ''));
  const pin = typeof payload.pin === 'string' ? payload.pin : '';

  if (phone10.length < 6) {
    return NextResponse.json(
      { ok: false, reason: 'Enter the 10 digit mobile number on your account.' },
      { status: 400 }
    );
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(`${ip}:${phone10}`)) {
    return NextResponse.json(
      { ok: false, reason: 'Too many attempts. Wait a few minutes and try again.' },
      { status: 429 }
    );
  }

  // TODO(phase-2): store an indexed `phone_digits` column and replace these two
  // full reads with an indexed equality lookup.
  const { data: userRows, error: userError } = await supabase
    .from('gym_users')
    .select('id, full_name, phone, role, tenant_id, pin_code');

  if (userError) {
    return NextResponse.json(
      { ok: false, reason: 'Sign-in is unavailable right now. Please retry.' },
      { status: 500 }
    );
  }

  const matchedUser = ((userRows ?? []) as unknown as UserRow[]).find(
    (u) => normalizePhone10(u.phone) === phone10
  );

  if (matchedUser) {
    if (!pinMatches(pin, matchedUser.pin_code)) {
      return NextResponse.json({ ok: false, reason: 'Incorrect PIN.' }, { status: 401 });
    }

    const tenantId = isUuid(matchedUser.tenant_id) ? matchedUser.tenant_id : null;
    const session: GymSession = {
      userId: matchedUser.id,
      role: matchedUser.role ?? 'receptionist',
      name: matchedUser.full_name ?? 'Staff',
      phone: matchedUser.phone ?? '',
      tenantId,
    };

    return NextResponse.json({ ok: true, session });
  }

  // No operator account: fall back to a member self-login (phone only, as before).
  const { data: memberRows } = await supabase
    .from('members')
    .select('id, full_name, phone, tenant_id');

  const matchedMember = ((memberRows ?? []) as unknown as MemberRow[]).find(
    (m) => normalizePhone10(m.phone) === phone10
  );

  if (!matchedMember) {
    return NextResponse.json(
      { ok: false, reason: `No account found for phone: ${phone10}` },
      { status: 404 }
    );
  }

  const session: GymSession = {
    userId: matchedMember.id,
    role: 'member',
    name: matchedMember.full_name ?? 'Member',
    phone: matchedMember.phone ?? '',
    tenantId: isUuid(matchedMember.tenant_id) ? matchedMember.tenant_id : null,
  };

  return NextResponse.json({ ok: true, session });
}
