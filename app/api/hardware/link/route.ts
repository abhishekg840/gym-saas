import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * /api/hardware/link — bind a tapped or typed credential to a member (Phase 12).
 *
 *   GET  ?tenant_id=&member_id=  -> { ok, rfid_uid, biometric_id }
 *   POST { tenant_id, member_id,
 *          rfid_uid?, biometric_id?, clear_bio?, clear_rfid? }  -> { ok, ... }
 *
 * NULL MEANS "NO CHANGE", NOT "CLEAR". fn_member_link_hardware has no
 * "keep existing" sentinel — it writes members.rfid_card = p_rfid_uid and
 * members.biometric_id = p_biometric_id unconditionally — so this route
 * merges: a field the caller omits is replaced by the member's current value.
 * Only an explicit clear_rfid/clear_bio produces a null in the payload. That
 * is what makes "save a fingerprint without touching the card" safe even if
 * the browser sends rfid_uid: null, and vice versa.
 *
 * Everything is written by fn_member_link_hardware, which is the ONLY writer for
 * both members.rfid_card and members.rfid_uid. Letting the browser update those
 * columns directly is how they drift apart, and a drifted pair is exactly what
 * made the Phase 10 gate overload fail to resolve a card that was plainly
 * enrolled.
 *
 * The RPC also refuses to move a card that already belongs to a different member
 * in the same gym (SQLSTATE 45008 -> 409), so tapping someone else's card at the
 * desk cannot silently steal their identity.
 */

/** Body/query tenant first, cookie second, hard 403 when neither is a UUID. */
function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = resolveTenant([url.searchParams.get('tenant_id')], request);
  if (!tenantId) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  const memberId = url.searchParams.get('member_id');
  if (!isUuid(memberId)) return badRequest('member_id must be a valid UUID.');

  // Read the raw columns rather than fn_member_hardware_identity, which returns
  // the card MASKED. The desk needs the full serial to edit or clear it.
  const { data, error } = await supabase
    .from('members')
    .select('rfid_card, biometric_id')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) return databaseError(error, 'Could not read that member’s credentials.');
  if (!data) return badRequest('That member is not in this gym.', 404);

  const row = data as { rfid_card: string | null; biometric_id: number | null };
  return NextResponse.json({
    ok: true,
    rfid_uid: row.rfid_card ?? null,
    biometric_id: row.biometric_id ?? null,
  });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  const memberId = body.member_id ?? body.memberId;
  if (!isUuid(memberId)) return badRequest('member_id must be a valid UUID.');

  const rawUid = body.rfid_uid ?? body.rfidUid ?? body.rfid_card ?? body.rfidCard;
  const rawBio = body.biometric_id ?? body.biometricId;
  const clearBio = body.clear_bio === true || body.clearBio === true;

  // A biometric_id of 0 is what a `<input type="number">` sends for an empty
  // field, so it must never reach SQL as a real slot.
  const biometricId =
    rawBio === undefined || rawBio === null || rawBio === '' || Number(rawBio) === 0
      ? null
      : Number(rawBio);

  if (biometricId !== null && (!Number.isInteger(biometricId) || biometricId < 1)) {
    return badRequest('Fingerprint slot must be a positive whole number.');
  }

  const rfidUid = typeof rawUid === 'string' ? rawUid.trim() : rawUid == null ? null : String(rawUid);
  // TRUE only when the caller explicitly asks to unlink the card — never a
  // stand-in for "field was left empty".
  const clearRfid = body.clear_rfid === true || body.clearRfid === true;

  // Refuse a no-op rather than silently clearing somebody's credential: an empty
  // POST is far more likely to be a UI bug than a deliberate unlink.
  if (!rfidUid && biometricId === null && !clearBio && !clearRfid) {
    return badRequest('Send a card UID or a fingerprint slot to save.');
  }

  // Merge with what the member has NOW, so a credential the caller did not
  // send is preserved rather than overwritten with null. (See the header
  // comment: the RPC writes whatever it is handed, unconditionally.)
  const { data: currentRow, error: readError } = await supabase
    .from('members')
    .select('rfid_card, biometric_id')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (readError) return databaseError(readError, 'Could not read that member’s credentials.');
  if (!currentRow) return badRequest('That member is not in this gym.', 404);

  const current = currentRow as { rfid_card: string | null; biometric_id: number | null };

  const mergedRfid = clearRfid ? null : rfidUid || current.rfid_card || null;
  const mergedBio = clearBio ? null : (biometricId ?? current.biometric_id);

  const { data, error } = await supabase.rpc('fn_member_link_hardware', {
    p_member_id: memberId,
    p_tenant_id: tenantId,
    p_rfid_uid: mergedRfid,
    p_biometric_id: mergedBio,
    p_clear_bio: clearBio,
  });

  if (error) {
    // 45008 (card already owned) and 23505 (unique index) both mean the same thing
    // to the owner, and databaseError maps them to a 409 with the SQL message,
    // which fn_member_link_hardware already phrases for a human.
    return databaseError(error, 'Could not save that credential.');
  }

  return NextResponse.json({ ok: true, ...(data as object) });
}