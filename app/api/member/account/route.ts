import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * /api/member/account — the member's own identity and security settings.
 *
 *   GET  { member_id }                              -> security state + profile
 *   POST { member_id, action: 'password_setup' }    -> set password, mark it done
 *   POST { member_id, action: 'update_profile', … } -> edit profile fields
 *
 * WHY A ROUTE AND NOT A DIRECT SUPABASE CALL: the profile fields live on
 * `profiles`, but they go through fn_member_profile_update so the validation
 * rules live in ONE place rather than being reimplemented in the UI.
 *
 * PHASE 13 — the password half no longer touches Supabase Auth at all.
 * It used to call supabase.auth.updateUser(), which requires the user's OWN
 * access token. A desk-enrolled member has no auth.users row and therefore no
 * token, so that call could never succeed and the route answered with a
 * hardcoded 409 ("there is no password to set here") — a dead end that blocked
 * members on the setup screen. The credential is now a bcrypt hash written by
 * fn_member_set_password, so no auth session is needed at all.
 */

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // bcrypt's hard limit: longer input is silently truncated.

interface PasswordCheck {
  ok: boolean;
  error?: string;
}

/**
 * Password policy, enforced here as well as in Supabase Auth. The client shows
 * the same rules, so a member is never told "too weak" only after submitting.
 */
export function checkPassword(password: string, confirm: string): PasswordCheck {
  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: `Use at least ${MIN_PASSWORD} characters.` };
  }
  if (password.length > MAX_PASSWORD) {
    return { ok: false, error: `Keep it under ${MAX_PASSWORD} characters.` };
  }
  if (password !== confirm) {
    return { ok: false, error: 'The two passwords do not match.' };
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, error: 'Include at least one letter and one number.' };
  }
  return { ok: true };
}

/** YYYY-MM-DD or null; '' and null both mean "not set". */
function parseDate(raw: unknown): { value: string | null } | null {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const text = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return { value: text };
}

export async function GET(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('Request body must be valid JSON.');
  }

  const memberId = body.member_id ?? body.memberId;
  if (!isUuid(memberId)) return badRequest('member_id must be a valid UUID.');

  const { data, error } = await supabase.rpc('fn_member_security_state', {
    p_member_id: memberId,
  });
  if (error) return databaseError(error, 'Could not load your account state.');

  const state = (data ?? {}) as { password_setup_completed?: boolean; has_email?: boolean };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name, emergency_phone, gender, date_of_birth, username_changed_at')
    .eq('user_id', memberId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    password_setup_completed: Boolean(state.password_setup_completed),
    has_email: Boolean(state.has_email),
    // A missing profile row is normal (nobody has edited it yet), so it is an
    // empty object rather than an error.
    profile: profileError ? null : profile ?? null,
  });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const memberId = body.member_id ?? body.memberId;
  if (!isUuid(memberId)) return badRequest('member_id must be a valid UUID.');

  const action = String(body.action ?? 'update_profile');

  if (action === 'password_setup') {
    const password = String(body.password ?? '');
    const confirm = String(body.confirm ?? body.confirm_password ?? '');

    const check = checkPassword(password, confirm);
    if (!check.ok) return badRequest(check.error ?? 'That password will not work.');

    // PHASE 13 — this branch used to call supabase.auth.updateUser(), which
    // REQUIRES a Supabase Auth session. A desk-enrolled member has no auth.users
    // row, so it could never succeed, and the route answered with a hardcoded
    // 409 telling the member there was "no password to set here". That dead end
    // is what blocked them on the setup screen.
    //
    // The credential now lives in Postgres as a bcrypt hash, written by
    // fn_member_set_password. No auth session is needed, and no service_role key
    // is introduced.
    //
    // `current_password` is forwarded when supplied. fn_member_set_password
    // requires it for anyone who already has a password and allows it to be
    // absent only for a first-time set — so this cannot silently overwrite a
    // credential that already exists.
    const currentPassword = body.current_password ?? body.currentPassword;

    const { data, error } = await supabase.rpc('fn_member_set_password', {
      p_member_id: memberId,
      p_current_password: currentPassword == null ? null : String(currentPassword),
      p_new_password: password,
      p_confirm: confirm,
    });

    if (error) {
      return databaseError(error, 'Could not save that password.', 409);
    }

    const result = (data ?? {}) as { password_setup_completed?: boolean };

    return NextResponse.json({
      ok: true,
      password_setup_completed: result.password_setup_completed !== false,
    });
  }

  if (action === 'change_username') {
    // The 30-day cooldown and the ^[a-z0-9._]{3,20}$ rule both live in
    // fn_member_set_username. Only a cheap emptiness check happens here, so the
    // server stays the single authority on what a handle may be.
    if (!String(body.username ?? body.handle ?? '').trim()) {
      return badRequest('Type the handle you want first.');
    }

    const { data, error } = await supabase.rpc('fn_member_set_username', {
      p_member_id: memberId,
      p_username: String(body.username ?? body.handle ?? ''),
    });
    if (error) return databaseError(error, 'Could not change your @handle.');

    const result = (data ?? {}) as {
      username?: string;
      changed?: boolean;
      next_change_available?: string;
    };

    return NextResponse.json({
      ok: true,
      username: result.username ?? null,
      // A no-op re-submit is a success with changed=false: it does NOT burn the
      // cooldown clock, and reporting it as an error would be a lie.
      changed: result.changed ?? false,
      next_change_available: result.next_change_available ?? null,
    });
  }

  if (action === 'update_profile') {
    const dob = parseDate(body.date_of_birth ?? body.dateOfBirth);
    if (!dob) return badRequest('Date of birth must be a real date (YYYY-MM-DD).');

    const { data, error } = await supabase.rpc('fn_member_profile_update', {
      p_member_id: memberId,
      p_display_name: body.display_name ?? body.displayName ?? null,
      p_emergency_phone: body.emergency_phone ?? body.emergencyPhone ?? null,
      p_gender: body.gender ?? null,
      p_date_of_birth: dob.value,
    });
    if (error) return databaseError(error, 'Could not save your profile.');

    return NextResponse.json({ ok: true, profile: data });
  }

  return badRequest(
    "action must be 'change_username', 'password_setup' or 'update_profile'."
  );
}