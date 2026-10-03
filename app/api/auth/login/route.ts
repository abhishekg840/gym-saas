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
 * WHERE THE HASH LIVES (Phase 14)
 * ------------------------------
 * Not on the public tables. `public.members` and `public.gym_users` must be
 * readable in full so the browser's `select('*')` queries keep working, and a
 * table that answers `select('*')` cannot hide a column. The credentials
 * therefore live in a `private` schema that PostgREST does not serve, and only
 * the SECURITY DEFINER verifiers can reach them.
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
 * WHY THIS USES THE POSTGREST ERROR CODE, NOT THE MESSAGE TEXT
 * -----------------------------------------------------------
 * The previous version classified a failure as "migration 0013 has not been
 * applied" whenever the error message contained "does not exist". That regex
 * matched a completely different, and far more common, failure:
 *
 *     42883  function crypt(text, text) does not exist
 *
 * which is what every verifier returned on Supabase, because pgcrypto is
 * installed in the `extensions` schema while the functions pinned
 * `search_path = public, pg_temp`. Migration 0013 was applied and working as
 * written; the deployment was fine and the *error message* was misleading. The
 * route then told every user that a migration they had already run was missing,
 * sending the operator to re-apply a file that could not possibly help.
 *
 * Only PostgREST's own PGRST202 / PGRST205 actually mean "this RPC is not in the
 * schema cache". Everything else is a real fault and is surfaced as one.
 */
async function verify(
  fn: 'fn_staff_verify_password' | 'fn_member_verify_password',
  identifier: string,
  password: string
): Promise<{ row: StaffRow | MemberRow | null; missing: boolean; fault?: string }> {
  const { data, error } = await supabase.rpc(fn, {
    p_identifier: identifier,
    p_password: password,
  });

  if (error) {
    // PGRST202 / PGRST205 are the ONLY codes that mean the RPC itself is absent.
    // A 42883 (undefined_function) is a fault INSIDE the function - a broken
    // search_path, typically - and must never be reported as a missing migration.
    const missing = error.code === 'PGRST202' || error.code === 'PGRST205';
    return { row: null, missing, fault: error.message ?? 'Unknown database error.' };
  }

  // NULL from Postgres == wrong credential (by design: the function cannot
  // distinguish "no such account" from "wrong password").
  return { row: (data as StaffRow | MemberRow | null) ?? null, missing: false };
}

/**
 * Only reached when the RPC genuinely is not in the schema cache. Kept as a
 * last-resort operator hint, not a pre-flight check: nothing probes for it
 * before the real query runs.
 */
const MISSING_RPC =
  'Sign-in is not ready: the password verification functions are missing from this database. Run supabase/migrations/0013_phase13_real_credentials.sql followed by supabase/migrations/0014_phase14_privilege_rls_repair.sql in the Supabase SQL Editor.';

/**
 * What a database FAULT looks like to the person at the desk.
 *
 * Generic about cause, specific about action. A 42883 almost always means a
 * verifier's search_path lost the `extensions` schema that holds pgcrypto, so
 * naming the migration that fixes it saves the operator a round trip of guessing.
 */
function faultMessage(fault: string | undefined): string {
  if (!fault) return 'Sign-in is unavailable right now. Please retry.';

  if (fault.includes('crypt(') || fault.includes('gen_salt(')) {
    return 'Sign-in is temporarily misconfigured on the server. An administrator needs to run the latest database migration.';
  }

  return 'Sign-in is unavailable right now. Please retry.';
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

    // A missing RPC is the ONLY case that earns a 503. Anything else that went
    // wrong (a 42883 from a broken search_path, a dropped connection, a
    // permission fault) is a server-side problem, and reporting it as "run
    // migration 0013" sent operators to re-run a file that was already applied.
    if (staff.missing || member.missing) {
      return NextResponse.json({ ok: false, reason: MISSING_RPC }, { status: 503 });
    }

    // A fault on EITHER verifier means we cannot know whether the credentials
    // were valid, so this must NOT fall through to a 401: answering "invalid
    // password" here would blame the person typing for a database that is
    // broken. Checked before the row comparison for exactly that reason.
    const fault = staff.fault ?? member.fault;
    if (fault) {
      console.error('[auth/login] verifier fault:', fault);
      return NextResponse.json(
        { ok: false, reason: faultMessage(fault) },
        { status: 503 }
      );
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
  } catch (err) {
    // Logged rather than swallowed: an unexpected throw here is a deployment
    // fault, and without this line the only evidence is a generic 500.
    console.error('[auth/login] unexpected error:', err);
    return NextResponse.json(
      { ok: false, reason: 'Sign-in is unavailable right now. Please retry.' },
      { status: 500 }
    );
  }
}
