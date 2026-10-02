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
 * WHY A ROUTE AND NOT A DIRECT SUPABASE CALL: the password half calls
 * supabase.auth.updateUser(), which needs the user's OWN access token. A member
 * who signed in with Google has one; a member who signed in with the gym PIN has
 * none, and updateUser() would fail. The route reports that case in plain words
 * instead of pretending the password was set.
 *
 * The profile fields live on `profiles` (which the client could write directly),
 * but they go through fn_member_profile_update so the validation rules live in
 * ONE place rather than being reimplemented in the UI.
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

    // No Supabase session => this member signed in with a gym PIN, not an auth
    // account, so there is no credential to set.
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'This account signs in with the number your gym gave you, so there is no password to set here. Your gym number and @handle are your sign-in.',
        },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      return NextResponse.json(
        { ok: false, error: 'Could not set that password. Please try again.' },
        { status: 400 }
      );
    }

    // Only now is the flag honest: Auth accepted the secret first.
    const { error: markError } = await supabase.rpc('fn_member_mark_password_setup', {
      p_member_id: memberId,
    });
    if (markError) return databaseError(markError, 'Password set, but the flag could not be saved.');

    return NextResponse.json({ ok: true, password_setup_completed: true });
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