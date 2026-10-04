import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { badRequest, databaseError, readDeviceBody } from '@/lib/sqlstate';

/**
 * POST /api/hardware/poll — the ESP32's command loop.
 *
 * The R307S is a template-storage unit: it owns finger templates and reports a
 * slot number, but it has no idea who a member is. So enrollment cannot be a
 * request/response call from the browser — the desk's web tab and the sensor are
 * two different machines that have to meet. This endpoint is the meeting point:
 *
 *   1. The desk queues a job (POST /api/hardware/fingerprint).
 *   2. The ESP32 calls HERE every couple of seconds and is handed the oldest
 *      live job for its own terminal, already claimed atomically.
 *   3. The board runs the 2-pass capture and reports the outcome back.
 *
 * WHY THE DEVICE GETS ITS OWN ROUTE RATHER THAN A SUPABASE CALL
 * ------------------------------------------------------------
 * Exactly the reason /api/hardware/punch exists: the board holds a machine key,
 * not a Supabase session, and hardware_devices is revoked from anon so a leaked
 * anon key cannot hand out machine tokens. One more round trip through a route
 * handler is the cheapest way to keep that boundary.
 *
 * IDLE IS NOT AN ERROR
 * --------------------
 * A gate reader polls forever, so "nothing to do" is the overwhelmingly common
 * response. It answers 200 with { ok: true, job: null } rather than an error, or
 * the firmware would fill its log with failures while behaving perfectly.
 *
 * `readDeviceBody` (not readJsonBody) because field firmware posts form-encoded,
 * or JSON with a missing Content-Type, or a body with a trailing newline. A body
 * is a one-shot stream, so it has to be read as text and re-parsed rather than
 * letting request.json() throw and losing it.
 */

/** The ESP32 may spell the key three ways, and sends it as a string. */
function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text.trim() !== '') return text.trim();
  }
  return '';
}

export async function POST(request: Request) {
  const parsed = await readDeviceBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const apiKey = firstNonEmpty(body.api_key, body.apiKey, body.device_key, body.deviceKey);
  if (!apiKey) return badRequest('api_key is required.');
  if (apiKey.length > 80) return badRequest('api_key is not valid.');

  const { data, error } = await supabase.rpc('fn_hardware_claim_enrollment_job', {
    p_api_key: apiKey,
    p_device_id: firstNonEmpty(body.device_id, body.deviceId) || null,
  });

  if (error) {
    // 45005 (unknown device key) maps to 401, which is what the punch endpoint
    // already teaches this firmware to expect.
    return databaseError(error, 'The terminal could not claim an enrollment job.');
  }

  // A null data means "idle". That is the normal case, not a failure.
  const job = (data ?? null) as Record<string, unknown> | null;

  return NextResponse.json({
    ok: true,
    job: job
      ? {
          job_token: job.job_token,
          slot: job.slot,
          stage: job.stage,
          device_name: job.device_name,
          expires_at: job.expires_at,
          // Two passes is the R307S standard enrollment ceremony. Sent as data
          // rather than hard-coded in firmware so the server owns the flow.
          passes: 2,
        }
      : null,
  });
}