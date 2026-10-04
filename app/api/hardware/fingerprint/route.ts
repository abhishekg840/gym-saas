import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

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
  const { data: devices, error: deviceError } = await supabase
    .from('hardware_devices')
    .select('id, device_name, status, last_heartbeat')
    .eq('tenant_id', tenantId)
    .eq('device_type', 'biometric_fingerprint');

  if (deviceError) {
    return databaseError(
      deviceError,
      'Could not list fingerprint terminals. Is migration 0003 applied?'
    );
  }

  return NextResponse.json({
    ok: true,
    job: (job ?? null) as Record<string, unknown> | null,
    terminals: (devices ?? []) as unknown[],
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
  // proved it was alive. "Online" is the 60-second heartbeat rule the Hardware
  // tab already uses, so this picks the same device the owner sees as live —
  // the desk should not have to know which reader is at which door.
  if (!deviceId) {
    const { data: candidates, error: listError } = await supabase
      .from('hardware_devices')
      .select('id, status, last_heartbeat')
      .eq('tenant_id', tenantId)
      .eq('device_type', 'biometric_fingerprint')
      .order('last_heartbeat', { ascending: false, nullsFirst: false })
      .limit(1);

    if (listError) {
      return databaseError(listError, 'Could not find a fingerprint terminal.');
    }

    const chosen = (candidates ?? [])[0];
    if (!chosen) {
      return badRequest(
        'No fingerprint terminal is registered for this gym. Add one on the Hardware tab first.',
        404
      );
    }
    deviceId = chosen.id as string;
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
