import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { badRequest, databaseError, readDeviceBody } from '@/lib/sqlstate';

/**
 * POST /api/hardware/fingerprint/report — how the terminal answers.
 *
 * The board posts after each stage of the 2-pass capture and once more at the
 * end. Three statuses, and the distinction between them is the whole point of
 * the flow:
 *
 *   progress   — a stage changed; updates the desk's live view only
 *   succeeded  — the template is in the sensor; THIS is the call that binds the
 *                slot to the member (fn_hardware_report_enrollment is the only
 *                writer of members.biometric_id in the entire flow)
 *   failed     — no template exists; the slot reservation is released and
 *                nothing is written, so the member is never left looking
 *                enrolled when their finger would not open the gate
 *
 * MACHINE-KEY AUTH ONLY, no SESSION
 * ---------------------------------
 * Same trust model as /api/hardware/punch and /api/hardware/poll: the ESP32
 * proves itself with the api key printed at registration, and the SQL re-derives
 * the gym from that key, so a board can only ever report on its own terminal's
 * jobs. There is no cookie path here at all, by design.
 */

/** The ESP32 may spell the key three ways; job tokens arrive verbatim. */
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

  const jobToken = firstNonEmpty(body.job_token, body.jobToken, body.job_id, body.jobId);
  if (!jobToken) return badRequest('job_token is required.');

  // The board echoes the stage verbatim; anything the firmware invents is
  // normalised here so an unexpected value cannot reach the CHECK constraint.
  const rawStage = firstNonEmpty(body.stage, body.step).toLowerCase();
  const stage = ['connecting', 'waiting_finger', 'pass1_captured', 'remove_finger',
                 'pass2_captured', 'saving', 'done'].includes(rawStage)
    ? rawStage
    : null;

  const status = firstNonEmpty(body.status, body.result).toLowerCase();

  const { data, error } = await supabase.rpc('fn_hardware_report_enrollment', {
    p_api_key: apiKey,
    p_job_token: jobToken,
    p_status: status,
    p_stage: stage,
    p_message: firstNonEmpty(body.message, body.error) || null,
    p_error_code: firstNonEmpty(body.error_code, body.errorCode) || null,
  });

  if (error) {
    // 45005 (unknown key) -> 401 and 45008 (slot conflict) -> 409, both of which
    // this firmware family already knows how to handle from the punch endpoint.
    return databaseError(error, 'The terminal could not report this enrollment.');
  }

  // `already_final` is returned when a retry replays a finished job. It is a
  // success, not a failure: the firmware must not retry a report it already sent.
  return NextResponse.json({ ok: true, ...(data as object) });
}