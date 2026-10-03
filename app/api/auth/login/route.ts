import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, normalizePhone10, type GymSession } from '@/lib/session';

/**
 * POST /api/auth/login â€” MANDATORY credentials for owners AND members (Phase 13).
 *
 * Body: { identifier: string, password: string }
 *   identifier = a 10-digit mobile number, "@handle", an email address, or a user
 *   id. `password` is REQUIRED: there is no longer a blank-password path for
 *   anyone, which is what closes the phone-number-only bypass.
 *
 * HOW VERIFICATION WORKS NOW
 * --------------------------
 * Previously this route SELECTED gym_users.pin_code with the anon key and
 * compared the PIN in JavaScript. That was catastrophic twice over: the plaintext
 * PIN travelled to the server (and into any request log), and â€” because
 * gym_users had no RLS and no column restriction â€” anybody could read every
 * owner's PIN directly from PostgREST with the public key. That leak was
 * confirmed live before it was fixed.
 *
 * Now every credential check happens INSIDE Postgres via
 * fn_staff_verify_password / fn_member_verify_password, which compare with
 * pgcrypto's bcrypt. The hash never leaves the database, and this route never
 * sees a plaintext credential for anyone.
 *
 * DUAL ROLE
 * ---------
 * An owner who also holds a membership matches BOTH verifiers. When that happens
 * both are verified BEFORE any choice is offered, and the response carries
 * `portals`. Nothing is revealed until a correct password has been supplied, so
 * the selector is not an account-existence oracle.
 */

interface StaffRow {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  tenant_id: string | null;
  password_must_change: boolean;
}

interface MemberRow {
  member_id: string;
  full_name: string | null;
  phone: string | null;
  username: string | null;
  tenant_id: string | null;
  password_must_change: boolean;
  password_setup_completed: boolean;
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

/** True for anything a person would type as a phone number. */
function looksLikePhone(value: string): boolean {
  return /^[+0-9][0-9\s\-()]{5,}$/.test(value.trim());
}

/**
 * Runs one of the Phase 13 verifiers and normalises the answer.
 *
 * Returns null when the RPC is missing (migration 0013 not applied yet) so the
 * caller can answer with an actionable message instead of pretending the
 * credentials were simply wrong â€” otherwise every user would be told "invalid
 * password" and nobody would know the deployment was broken.
 */
async function verify(
  fn: 'fn_staff_verify_password' | 'fn_member_verify_password',
  identifier: string,
  password: string
): Promise<{ row: StaffRow | MemberRow | null; missing: boolean }> {
  const { data, error } = await supabase.rpc(fn, {
    p_identifier: identifier,
    p_password: password,
  });

  if (error) {
    const message = error.message ?? '';
    const missing =
      /could not find the function|does not exist/i.test(message) ||
      /schema cache/i.test(message);
    return { row: null, missing };
  }

  // NULL from Postgres == wrong credential (by design: the function cannot
  // distinguish "no such account" from "wrong password").
  return { row: (data as StaffRow | MemberRow | null) ?? null, missing: false };
}


const MISSING_MIGRATION =
  'Sign-in is not ready: migration 0013 has not been applied to this database. Run supabase/migrations/0013_phase13_real_credentials.sql in the Supabase SQL Editor.';

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

  // `pin` is accepted alongside `password` because a desk still calls a 4-digit
  // credential a PIN, and an older build in someone's pocket sends that name.
  const rawSecret = payload.password ?? payload.pin;
  const password = typeof rawSecret === 'string' ? rawSecret : '';

  if (identifier.length < 3) {
    return NextResponse.json(
      { ok: false, reason: 'Enter your mobile number, @handle or email address.' },
      { status: 400 }
    );
  }

  // MANDATORY PASSWORD — this is the bypass being closed.
  //
  // Rejected BEFORE any database call so a blank password can never reach the
  // verifier, and answered with a 401 rather than a 400: the request was
  // well-formed, the credential was simply absent.
  if (password.trim() === '') {
    return NextResponse.json(
      { ok: false, reason: 'Enter your password. Blank passwords are no longer accepted.' },
      { status: 401 }
    );
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(`${ip}:${identifier.toLowerCase()}`)) {
    return NextResponse.json(
      { ok: false, reason: 'Too many attempts. Wait a few minutes and try again.' },
      { status: 429 }
    );
  }

  try {
    // BOTH verifiers run before any decision is made. An owner who is also a
    // member must be checked against each of their credentials independently —
    // picking the owner account and only testing the owner password would lock
    // a member-owner out of their own pass entirely.
    const [staff, member] = await Promise.all([
      verify('fn_staff_verify_password', identifier, password),
      verify('fn_member_verify_password', identifier, password),
    ]);

    if (staff.missing || member.missing) {
      return NextResponse.json({ ok: false, reason: MISSING_MIGRATION }, { status: 503 });
    }

    const staffRow = staff.row as StaffRow | null;
    const memberRow = member.row as MemberRow | null;

    // Neither matched: ONE message for both cases. Distinguishing "no such
    // account" from "wrong password" would turn this endpoint into an account
    // enumeration oracle.
    if (!staffRow && !memberRow) {
      return NextResponse.json(
        { ok: false, reason: 'Invalid credentials. Please enter your password.' },
        { status: 401 }
      );
    }

    const staffSession: GymSession | null = staffRow
      ? {
          userId: staffRow.user_id,
          role: staffRow.role ?? 'receptionist',
          name: staffRow.full_name ?? 'Staff',
          phone: staffRow.phone ?? '',
          tenantId: isUuid(staffRow.tenant_id) ? staffRow.tenant_id : null,
          // Carried so the client can force the change-password screen.
          passwordMustChange: Boolean(staffRow.password_must_change),
          userIdForPassword: staffRow.user_id,
        }
      : null;

    const memberSession: GymSession | null = memberRow
      ? {
          userId: memberRow.member_id,
          role: 'member',
          name: memberRow.full_name ?? 'Member',
          phone: memberRow.phone ?? '',
          tenantId: isUuid(memberRow.tenant_id) ? memberRow.tenant_id : null,
          username: memberRow.username ?? null,
          passwordMustChange: Boolean(memberRow.password_must_change),
          userIdForPassword: memberRow.member_id,
        }
      : null;

    // Both accounts, one correct password: let the person choose. Safe to offer
    // because authentication has ALREADY succeeded for each side.
    if (staffSession && memberSession) {
      return NextResponse.json({
        ok: true,
        portals: { owner: staffSession, member: memberSession },
      });
    }

    const session = staffSession ?? memberSession;
    if (!session) {
      return NextResponse.json(
        { ok: false, reason: 'Invalid credentials. Please enter your password.' },
        { status: 401 }
      );
    }

    // A super admin owns the platform rather than a gym; skip the forced change
    // so the platform console is never gated on a per-gym credential.
    if (session.passwordMustChange && session.role !== 'super_admin') {
      return NextResponse.json({
        ok: true,
        session,
        requires_password_change: true,
      });
    }

    return NextResponse.json({ ok: true, session });
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'Sign-in is unavailable right now. Please retry.' },
      { status: 500 }
    );
  }
}
