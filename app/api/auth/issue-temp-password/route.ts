import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/auth/issue-temp-password — desk recovery (Phase 13).
 *
 * Body: { owner_identifier, owner_password, member_id, temp_password }
 *
 * THE ONLY WAY TO GIVE A MEMBER A CREDENTIAL WITHOUT KNOWING THEIR OLD ONE.
 *
 * With mandatory passwords, a member who has never set one — or who has lost it —
 * would otherwise be permanently locked out of the gym they pay for. That is the
 * failure mode this endpoint exists to prevent, and it is deliberately the ONLY
 * such path.
 *
 * SECURITY
 * --------
 * The owner must prove THEIR OWN credential, verified inside Postgres by
 * fn_member_issue_temp_password before any write happens. That matters because
 * the gym session in this app is localStorage plus a tenant cookie: there is no
 * server-verifiable staff identity to check, so a client-supplied "I am the owner"
 * flag would be worthless. Requiring the owner's actual password is what makes
 * this endpoint safe to expose to the anon key.
 *
 * The temporary password may be short (a 4-digit PIN is the point of it — the
 * member is on the phone with the desk) but never blank. It is hashed the same
 * way every other credential is, and sets password_must_change so the member is
 * forced to replace it at their next sign-in.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const ownerIdentifier = String(body.owner_identifier ?? body.ownerIdentifier ?? '').trim();
  const ownerPassword = String(body.owner_password ?? body.ownerPassword ?? '');

  const memberId = body.member_id ?? body.memberId;
  if (!isUuid(memberId)) return badRequest('member_id must be a valid UUID.');

  const tempPassword = String(body.temp_password ?? body.tempPassword ?? '');

  if (ownerIdentifier.length < 3) {
    return badRequest('Enter your own sign-in number and password.');
  }
  if (ownerPassword === '') {
    return badRequest('Enter your own password to authorise this.');
  }
  if (tempPassword === '') {
    return badRequest('Enter a temporary password to issue.');
  }
  if (tempPassword.length > 72) {
    return badRequest('Keep the temporary password under 72 characters.');
  }

  const { data, error } = await supabase.rpc('fn_member_issue_temp_password', {
    p_owner_identifier: ownerIdentifier,
    p_owner_password: ownerPassword,
    p_member_id: memberId,
    p_temp_password: tempPassword,
  });

  if (error) {
    // 45005 (owner auth failed) and P0002 (member not in this gym) both surface
    // with the database's own wording, which is already phrased for a human.
    return databaseError(error, 'Could not issue that temporary password.');
  }

  return NextResponse.json({ ok: true, ...(data as object) });
}