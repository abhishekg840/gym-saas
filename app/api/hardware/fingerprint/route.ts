import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import type { HardwareDevice } from '@/lib/hardware';

/**
 * /api/hardware/fingerprint — the desk half of R307 enrollment (Phase 17).
 *
 *   GET    ?tenant_id=&job_token=  -> { ok, job, terminals }
 *   POST   { tenant_id, member_id, device_id?, delete_old? } -> { ok, job }
 *   DELETE { tenant_id, job_token }                         -> { ok, cancelled }
 *
 * WHY THE JOB IS SERVER-OWNED
 * ---------------------------
 * The sensor cannot be told "enrol member X" directly: it only knows slots. So
 * the server reserves a slot up front (under an advisory lock), the device fills
 * exactly that slot, and only a SUCCESSFUL report binds it to the member. A
 * half-finished capture therefore never produces a "registered" member whose
 * finger would not actually open the gate.
 *
 * SCOPE
 * -----
 * The tenant comes from the session cookie server-side (with an explicit
 * tenant_id accepted for the browser, exactly like every other Phase 12 route).
 * The SQL re-resolves the gym from the MEMBER row, so even a tampered body
 * cannot aim an enrollment at another gym.
 */

/** Body/query tenant first, cookie second, hard 403 when neither is a UUID. */
function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

/** The columns the modal needs, already narrowed to fingerprint readers. */
interface FingerprintTerminalRow {
  id: string;
  device_name: string;
  status: string;
  last_heartbeat: string | null;
  /** Precomputed by fn_hardware_list on the same 60-second rule the Hardware tab uses. */
  is_online: boolean;
  seconds_since_seen: number | null;
}

type TerminalList =
  | { ok: true; terminals: FingerprintTerminalRow[] }
  | { ok: false; response: Response };

/**
 * This gym's fingerprint terminals, most recently seen first.
 *
 * WHY THIS IS NOT A TABLE SELECT
 * ------------------------------
 * hardware_devices is revoked from anon and authenticated (migration 0003, 5a),
 * and lib/supabase.ts is built on the ANON key — so a direct
 * `.from('hardware_devices').select(...)` answers "permission denied for table
 * hardware_devices". This route did exactly that, in two places, and the desk saw
 * the raw Postgres text in the enrollment dialog.
 *
 * fn_hardware_list is the supported door: SECURITY DEFINER, re-checks that the
 * tenant owns each row, and returns api_key already masked. It is granted to anon
 * and authenticated (0003, "Only these six doors are open").
 *
 * It does NOT filter by device type, and returns [] rather than null when the gym
 * has nothing registered, so both are narrowed here. `is_online` and
 * `seconds_since_seen` arrive PRECOMPUTED, which is the whole point: the
 * heartbeat rule is applied once, in the database, and the modal reads the same
 * number the Hardware tab is already showing the owner.
 */
async function listFingerprintTerminals(tenantId: string): Promise<TerminalList> {
  const { data, error } = await supabase.rpc('fn_hardware_list', { p_tenant_id: tenantId });

  if (error) {
    return {
      ok: false,
      response: databaseError(error, 'Could not list the fingerprint terminals.'),
    };
  }

  const terminals = ((data ?? []) as HardwareDevice[])
    .filter((d) => d.device_type === 'biometric_fingerprint')
    .map((d) => ({
      id: d.id,
      device_name: d.device_name,
      status: d.status,
      last_heartbeat: d.last_heartbeat,
      is_online: Boolean(d.is_online),
      seconds_since_seen: d.seconds_since_seen ?? null,
    }))
    // Freshest proof of life first, so the desk's default pick is the reader most
    // likely to be at the front desk. A live reader outranks a dead one outright,
    // which matters because picking a dead one costs the member ten minutes.
    .sort((a, b) => {
      if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
      return (
        (a.seconds_since_seen ?? Number.MAX_SAFE_INTEGER) -
        (b.seconds_since_seen ?? Number.MAX_SAFE_INTEGER)
      );
    });

  return { ok: true, terminals };
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

  const jobToken = url.searchParams.get('job_token');

  // The live job, if any. A null job is the normal "nothing running" answer.
  const { data: job, error: jobError } = await supabase.rpc(
    'fn_hardware_enrollment_job_state',
    { p_tenant_id: tenantId, p_job_token: jobToken }
  );

  if (jobError) {
    return databaseError(
      jobError,
      'Could not read the enrollment state. Is migration 0017 applied?'
    );
  }

  // The fingerprint terminals this gym can enrol on, so the UI never offers a
  // device that would immediately refuse the job.
  const list = await listFingerprintTerminals(tenantId);
  if (!list.ok) return list.response;

  return NextResponse.json({
    ok: true,
    job: (job ?? null) as Record<string, unknown> | null,
    terminals: list.terminals,
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

  let deviceId = isUuid(body.device_id ?? body.deviceId)
    ? (body.device_id ?? body.deviceId)
    : null;
  const deleteOld = body.delete_old === undefined ? true : body.delete_old !== false;

  // No terminal chosen: pick this gym's fingerprint reader that most recently
  // proved it was alive. listFingerprintTerminals already applies the 60-second
  // heartbeat rule in SQL and sorts live-first, so this picks the same device the
  // owner sees as live — the desk should not have to know which reader is at which
  // door.
  if (!deviceId) {
    const list = await listFingerprintTerminals(tenantId);
    if (!list.ok) return list.response;

    const chosen = list.terminals[0];
    if (!chosen) {
      return badRequest(
        'No fingerprint terminal is registered for this gym. Add one on the Hardware tab first.',
        404
      );
    }
    deviceId = chosen.id;
  }

  const { data, error } = await supabase.rpc('fn_hardware_create_enrollment_job', {
    p_member_id: memberId,
    p_device_id: deviceId,
    p_delete_old: deleteOld,
  });

  if (error) {
    // 45012 (already running), 45013 (slot race) and 45011 (wrong device type)
    // all map to 409, with a message the SQL already phrased for an operator.
    return databaseError(error, 'Could not start the fingerprint enrollment.');
  }

  return NextResponse.json({ ok: true, job: data });
}

export async function DELETE(request: Request) {
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

  const jobToken = body.job_token ?? body.jobToken;
  if (typeof jobToken !== 'string' || jobToken.trim() === '') {
    return badRequest('job_token is required.');
  }

  // Cancelling really does release the slot, so the next member is not pushed to
  // a higher slot for an enrollment nobody finished.
  const { data, error } = await supabase.rpc('fn_hardware_cancel_enrollment', {
    p_tenant_id: tenantId,
    p_job_token: jobToken.trim(),
  });

  if (error) return databaseError(error, 'Could not cancel the enrollment.');

  return NextResponse.json({ ok: true, ...(data as object) });
}

/**
 * DELETE { tenant_id, member_id, device_id? } -> { ok, job }
 *
 * Removes a fingerprint. Distinct from the DELETE above, which cancels a RUNNING
 * job — this one starts an unlink. Overloaded on member_id vs job_token rather
 * than given its own path, so the desk client keeps one endpoint for the feature.
 *
 * The template is erased ON THE SENSOR. Clearing the database alone would leave
 * the finger readable at the door, which is the wrong thing to leave behind when
 * someone leaves the gym.
 */
export async function PATCH(request: Request) {
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

  const deviceId = isUuid(body.device_id ?? body.deviceId)
    ? (body.device_id ?? body.deviceId)
    : null;

  // The gym is re-derived from the member row inside SQL, so this tenant only
  // narrows the lookup; it can never widen it to another gym's member.
  const { data, error } = await supabase.rpc('fn_hardware_unlink_fingerprint', {
    p_tenant_id: tenantId,
    p_member_id: memberId,
    p_device_id: deviceId,
  });

  if (error) {
    // 45010 (no terminal registered) and 45012 (job already running) map to a
    // message the SQL already phrased for an operator.
    return databaseError(error, 'Could not remove the fingerprint.');
  }

  return NextResponse.json({ ok: true, job: data });
}
