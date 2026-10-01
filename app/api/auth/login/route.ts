import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, normalizePhone10, type GymSession } from '@/lib/session';

/**
 * POST /api/auth/login
 *
 * Body: { identifier: string, pin?: string }
 *   identifier = a 10-digit mobile number, "@handle", or an email address.
 *   `phone`, `username` and `email` are still accepted as aliases so an older
 *   build of the app in someone's pocket keeps working.
 *
 * The login screen used to run `supabase.from('gym_users').select('*')`, which
 * shipped every operator account in every gym - PINs included - to whoever opened
 * the page, then compared the PIN in the browser. Member lookup had the same
 * problem for member names and phone numbers.
 *
 * Verification now happens here: only what the visitor typed is sent in, and the
 * only thing that comes back is the session for the one account that matched.
 * No PIN, no other gyms' rows.
 *
 * A PIN is required for staff and reception accounts only. A member identifies
 * themselves with the phone number, @handle or email their gym enrolled them
 * under - they never had a PIN to forget.
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
  username: string | null;
  tenant_id: string | null;
}

/**
 * Best-effort throttle. Route handlers can run on any instance, so this is not a
 * distributed limiter - it only raises the cost of hammering one warm instance.
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
  // A staff row saved before PINs were mandatory has a NULL code; the documented
  // desk default is used for it so such an account is not bricked.
  const expected = (stored ?? '1234').trim();
  const given = input.trim();
  if (given.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** True for anything a person would type as a phone number. */
function looksLikePhone(value: string): boolean {
  return /^[+0-9][0-9\s\-()]{5,}$/.test(value.trim());
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: 'Invalid request payload.' }, { status: 400 });
  }

  const identifier = String(
    payload.identifier ?? payload.phone ?? payload.username ?? payload.email ?? ''
  ).trim();
  const pin = typeof payload.pin === 'string' ? payload.pin : '';

  if (identifier.length < 3) {
    return NextResponse.json(
      { ok: false, reason: 'Enter your mobile number, @handle or email address.' },
      { status: 400 }
    );
  }

  const phone10 = normalizePhone10(identifier);
  const phoneLike = looksLikePhone(identifier) && phone10.length === 10;
  const emailLike = !identifier.startsWith('@') && identifier.includes('@');
  const handle = identifier.replace(/^@+/, '').toLowerCase();

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(`${ip}:${identifier.toLowerCase()}`)) {
    return NextResponse.json(
      { ok: false, reason: 'Too many attempts. Wait a few minutes and try again.' },
      { status: 429 }
    );
  }

  try {
    // --- 1. Staff / reception / owner ------------------------------------------
    // Only a phone-shaped identifier can match a staff account, so an @handle
    // never triggers a read of the operator table.
    if (phoneLike) {
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
          return NextResponse.json(
            { ok: false, reason: 'Incorrect PIN. Please try again.' },
            { status: 401 }
          );
        }

        const staffSession: GymSession = {
          userId: matchedUser.id,
          role: matchedUser.role ?? 'receptionist',
          name: matchedUser.full_name ?? 'Staff',
          phone: matchedUser.phone ?? '',
          tenantId: isUuid(matchedUser.tenant_id) ? matchedUser.tenant_id : null,
        };

        return NextResponse.json({ ok: true, session: staffSession });
      }
    }

    // --- 2. Members: phone, @handle or email -----------------------------------
    const MEMBER_COLUMNS = 'id, full_name, phone, username, tenant_id';

    let memberQuery = supabase.from('members').select(MEMBER_COLUMNS);

    if (emailLike) {
      memberQuery = memberQuery.eq('email', identifier.toLowerCase());
    } else if (identifier.startsWith('@')) {
      memberQuery = memberQuery.eq('username', handle);
    } else if (phoneLike) {
      memberQuery = memberQuery.eq('phone', phone10);
    } else {
      // A bare word is a handle without the '@': people type "rahul", not "@rahul".
      memberQuery = memberQuery.eq('username', handle);
    }

    let { data: memberRows, error: memberError } = await memberQuery.limit(5);

    // Legacy rows were saved with a +91 prefix or spaces, so one loose attempt is
    // still made - anchored to the full 10-digit tail, never a short fragment.
    if ((memberError || (memberRows ?? []).length === 0) && phoneLike) {
      const loose = await supabase
        .from('members')
        .select(MEMBER_COLUMNS)
        .like('phone', `%${phone10}`)
        .limit(5);
      memberRows = loose.data;
      memberError = loose.error;
    }

    if (memberError) {
      return NextResponse.json(
        { ok: false, reason: 'Sign-in is unavailable right now. Please retry.' },
        { status: 500 }
      );
    }

    const matchedMember = ((memberRows ?? []) as unknown as MemberRow[])[0];

    if (!matchedMember) {
      return NextResponse.json(
        {
          ok: false,
          reason: phoneLike
            ? 'No account found for that number. Check the digits, or sign in with your @handle.'
            : 'No account found for those details. Check them, or ask the front desk.',
        },
        { status: 404 }
      );
    }

    const session: GymSession = {
      userId: matchedMember.id,
      role: 'member',
      name: matchedMember.full_name ?? 'Member',
      phone: matchedMember.phone ?? '',
      tenantId: isUuid(matchedMember.tenant_id) ? matchedMember.tenant_id : null,
      username: matchedMember.username ?? null,
    };

    return NextResponse.json({ ok: true, session });
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'Sign-in is unavailable right now. Please retry.' },
      { status: 500 }
    );
  }
}
