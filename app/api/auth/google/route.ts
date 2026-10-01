import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isUuid, type GymSession } from '@/lib/session';
import { badRequest, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/auth/google
 *
 * Body: { access_token: string }  — the Supabase session the browser got back
 * from the Google OAuth redirect.
 *
 * /api/auth/login resolves phone / @handle / email to a gym account and answers
 * with a GymSession cookie. Google cannot use that route (there is no PIN to
 * verify), so the identity lands here instead:
 *
 *   1. verify the access token with Supabase Auth — the client's claim is never
 *      taken at face value,
 *   2. take the verified email address,
 *   3. resolve it to staff (gym_users.email) or to a member (members.email),
 *   4. answer with the same GymSession shape /api/auth/login returns, which the
 *      client stores through writeSession exactly like a password sign-in.
 *
 * An email that matches nobody is refused with a reason: a Google account is an
 * alternate key to an existing gym membership, not a way to create one.
 */

const MAX_TOKEN = 4_096;
const INVALID_TOKEN = 'Your Google session could not be verified. Please sign in again.';

interface StaffRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  tenant_id: string | null;
}

interface MemberRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  username: string | null;
  tenant_id: string | null;
}

/**
 * Remembers the Google profile picture the first time an identity signs in
 * (ON CONFLICT DO NOTHING — a photo the person uploaded later always wins).
 * Failure here is not fatal: sign-in must not hinge on an avatar.
 */
async function seedAvatar(user: User, userId: string, tenantId: string | null): Promise<void> {
  const picture = user.user_metadata?.picture;
  if (typeof picture !== 'string' || !picture.startsWith('https://')) return;

  await supabase.from('profiles').upsert(
    {
      user_id: userId,
      tenant_id: tenantId,
      avatar_url: picture.slice(0, 1000),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id', ignoreDuplicates: true }
  );
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;

  const token = String(parsed.body.access_token ?? parsed.body.accessToken ?? '').trim();
  if (!token) return badRequest('Missing Google session token.');
  if (token.length > MAX_TOKEN) return badRequest(INVALID_TOKEN, 401);

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return badRequest(INVALID_TOKEN, 401);

  const email = String(authData.user.email ?? '').trim().toLowerCase();
  if (!email) return badRequest('That Google account has no email address.', 403);

  // 1. Staff first: reception and owners want their console, not the member app.
  //    gym_users may predate the email column — PostgREST then answers with an
  //    error, which we read as "no staff match" rather than a failure.
  const staffResult = await supabase
    .from('gym_users')
    .select('id, full_name, phone, role, tenant_id')
    .ilike('email', email)
    .limit(1);

  const staffRow = staffResult.error
    ? undefined
    : ((staffResult.data ?? []) as unknown as StaffRow[])[0];

  if (staffRow) {
    const tenantId = isUuid(staffRow.tenant_id) ? staffRow.tenant_id : null;
    await seedAvatar(authData.user, staffRow.id, tenantId);

    const session: GymSession = {
      userId: staffRow.id,
      role: staffRow.role ?? 'receptionist',
      name: staffRow.full_name ?? 'Staff',
      phone: staffRow.phone ?? '',
      tenantId,
    };
    return NextResponse.json({ ok: true, session });
  }

  // 2. Members: the enrolled email is the match key.
  const memberResult = await supabase
    .from('members')
    .select('id, full_name, phone, username, tenant_id')
    .ilike('email', email)
    .limit(1);

  if (memberResult.error) {
    return NextResponse.json(
      { ok: false, reason: 'Sign-in is unavailable right now. Please retry.' },
      { status: 500 }
    );
  }

  const memberRow = ((memberResult.data ?? []) as unknown as MemberRow[])[0];
  if (!memberRow) {
    return NextResponse.json(
      {
        ok: false,
        reason: `${email} is not enrolled at this gym yet. Ask the front desk to add your email, or sign in with your number.`,
      },
      { status: 403 }
    );
  }

  const tenantId = isUuid(memberRow.tenant_id) ? memberRow.tenant_id : null;
  await seedAvatar(authData.user, memberRow.id, tenantId);

  const session: GymSession = {
    userId: memberRow.id,
    role: 'member',
    name: memberRow.full_name ?? 'Member',
    phone: memberRow.phone ?? '',
    tenantId,
    username: memberRow.username ?? null,
  };
  return NextResponse.json({ ok: true, session });
}
