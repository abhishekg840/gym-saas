import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/auth/set-password — the working replacement for the dead end.
 *
 * Body: { member_id?, user_id?, role, current_password?, new_password, confirm }
 *
 * WHY THIS EXISTS
 * ---------------
 * The old path (app/api/member/account, action: 'password_setup') called
 * `supabase.auth.updateUser({ password })`. That function REQUIRES a Supabase
 * Auth session, and a desk-enrolled member has no auth.users row at all — so it
 * always failed, and the route answered with a hardcoded 409:
 *
 *   "This account signs in with the number your gym gave you, so there is no
 *    password to set here."
 *
 * That was a dead end by design, and it is what trapped members on the blocking
 * screen. This endpoint writes the credential through the Phase 13 SQL functions
 * instead, which is where the hash actually lives.
 *
 * AUTHORISATION
 * -------------
 * There is no server-verifiable session in this architecture (the gym session is
 * localStorage), so this endpoint does NOT trust the ids in the body. It forwards
 * `current_password` to Postgres, and:
 *
 *   - a member who ALREADY has a password must present it (fn_member_set_password
 *     rejects an empty one), so a leaked member_id cannot take over an account;
 *   - a member with NO password may set their first one, because there is nothing
 *     to prove. That is safe only because such an account cannot sign in at all
 *     until a password exists (fn_member_verify_password returns NULL).
 *
 * So the worst case for a caller who knows only a member_id is: they set the
 * FIRST password of an account that was previously unusable. It cannot modify an
 * existing credential.
 */

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const role = String(body.role ?? '').trim().toLowerCase();
  if (role !== 'member' && role !== 'owner' && role !== 'receptionist' && role !== 'super_admin') {
    return badRequest("role must be 'member' or an owner/staff role.");
  }

  const memberId = body.member_id ?? body.memberId;
  const userId = body.user_id ?? body.userId;

  const targetId = role === 'member' ? memberId : userId;
  if (!isUuid(targetId)) return badRequest('A valid member_id or user_id is required.');

  const newPassword = String(body.new_password ?? body.password ?? '');
  const confirm = String(body.confirm ?? body.confirm_password ?? newPassword);
  const currentPassword =
    body.current_password ?? body.currentPassword ?? body.pin ?? body.current;

  // Client-side pre-checks exist only so a weak password never costs a round
  // trip. The authoritative policy is inside fn_*_set_password, which is the
  // only place that actually decides.
  if (newPassword.length < MIN_PASSWORD) {
    return badRequest(`Use at least ${MIN_PASSWORD} characters.`);
  }
  if (newPassword.length > MAX_PASSWORD) {
    return badRequest(`Keep it under ${MAX_PASSWORD} characters.`);
  }
  if (newPassword !== confirm) {
    return badRequest('The two passwords do not match.');
  }
  if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return badRequest('Include at least one letter and one number.');
  }

  if (role === 'member') {
    const { data, error } = await supabase.rpc('fn_member_set_password', {
      p_member_id: targetId,
      p_current_password: currentPassword === undefined ? null : String(currentPassword),
      p_new_password: newPassword,
      p_confirm: confirm,
    });

    if (error) {
      // 45009 = the CURRENT password was wrong. 409 keeps the UI pointing at the
      // right field rather than showing a generic failure.
      return databaseError(error, 'Could not save that password.', 409);
    }

    const result = (data ?? {}) as { password_setup_completed?: boolean };
    return NextResponse.json({
      ok: true,
      password_setup_completed: result.password_setup_completed !== false,
    });
  }

  const { data, error } = await supabase.rpc('fn_staff_set_password', {
    p_user_id: targetId,
    // Staff ALWAYS proves the current credential — fn_staff_set_password
    // refuses an empty one, which is what stops an owner_id from being enough.
    p_current_password: currentPassword === undefined ? null : String(currentPassword),
    p_new_password: newPassword,
    p_confirm: confirm,
  });

  if (error) return databaseError(error, 'Could not save that password.', 409);

  return NextResponse.json({ ok: true, ...(data as object) });
}