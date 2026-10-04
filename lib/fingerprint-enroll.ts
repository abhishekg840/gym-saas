/**
 * Client for the R307 / R307S enrollment flow (Phase 17).
 *
 * Mirrors lib/tap-to-enroll.ts, but for the ceremony that actually has a device
 * on the other end. tap-to-enroll arms a reader for a CARD tap, which completes
 * in one event. A fingerprint has a multi-stage handshake, so this is a job:
 * create it, watch it, and let the terminal report the outcome.
 *
 * WHY THIS POLLS
 * --------------
 * fingerprint_enrollments is revoked from anon/authenticated (migration 0017),
 * for the same reason hardware_devices is: it is written only through SECURITY
 * DEFINER functions, and the anon key ships inside every browser bundle. So the
 * desk cannot subscribe to it, and polls a route handler instead.
 *
 * Realtime would work if the console moved to Supabase Auth; the contract below
 * would not change.
 */

/** Stages the sensor reports, in the order they occur. */
export type FingerprintStage =
  | 'queued'
  | 'connecting'
  | 'waiting_finger'
  | 'pass1_captured'
  | 'remove_finger'
  | 'pass2_captured'
  | 'saving'
  | 'done';

export type FingerprintJobStatus =
  | 'pending'
  | 'claimed'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface FingerprintTerminal {
  id: string;
  device_name: string;
  status: string;
  last_heartbeat: string | null;
}

export interface FingerprintJob {
  job_id: string;
  job_token: string;
  status: FingerprintJobStatus;
  stage: FingerprintStage;
  message: string | null;
  error_code: string | null;
  /** The slot RESERVED on the terminal, and the slot actually bound on success. */
  slot: number;
  member_id: string;
  member_name: string;
  device_id: string;
  device_name: string;
  created_at: string;
  completed_at: string | null;
  expires_at: string;
}

/** What the create call returns, before the terminal has seen the job. */
export interface CreatedFingerprintJob {
  job_id: string;
  job_token: string;
  member_id: string;
  member_name: string;
  device_id: string;
  device_name: string;
  slot: number;
  previous_slot: number | null;
  /** Set on re-enrollment: the slot the sensor should delete first. */
  delete_slot: number | null;
  expires_at: string;
}

export type EnrollState =
  | 'idle'
  | 'starting'
  | 'waiting_terminal'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/**
 * The seven steps the modal shows, in order.
 *
 * Copy is written for the PERSON STANDING AT THE SENSOR, not for the desk: it is
 * the only text a member reads while a finger is on a reader. "Place the SAME
 * finger again" is spelled that way because using a different finger on pass two
 * is the single most common reason a capture fails.
 */
export const ENROLLMENT_STEPS: readonly {
  stage: FingerprintStage;
  title: string;
  detail: string;
}[] = [
  {
    stage: 'connecting',
    title: 'Connecting to terminal…',
    detail: 'Waking up the fingerprint reader.',
  },
  {
    stage: 'waiting_finger',
    title: 'Waiting for finger…',
    detail: 'Place the index finger flat on the sensor.',
  },
  {
    stage: 'pass1_captured',
    title: 'Finger detected',
    detail: 'First scan captured. Hold still.',
  },
  {
    stage: 'remove_finger',
    title: 'Remove finger…',
    detail: 'Lift the finger fully off the sensor.',
  },
  {
    stage: 'pass2_captured',
    title: 'First scan saved',
    detail: 'Now place the SAME finger again, the same way.',
  },
  {
    stage: 'saving',
    title: 'Creating template…',
    detail: 'Combining both scans and writing to the sensor.',
  },
  {
    stage: 'done',
    title: 'Fingerprint registered',
    detail: 'Saved to the terminal.',
  },
] as const;

export interface StartFingerprintResult {
  ok: boolean;
  job?: CreatedFingerprintJob;
  error?: string;
  terminals?: FingerprintTerminal[];
}

/** Creates an enrollment job and reserves its slot. */
export async function startFingerprintEnrollment(
  tenantId: string,
  memberId: string,
  deviceId?: string | null
): Promise<StartFingerprintResult> {
  try {
    const response = await fetch('/api/hardware/fingerprint', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenantId,
        member_id: memberId,
        device_id: deviceId ?? null,
      }),
    });

    const result = (await response.json()) as {
      ok?: boolean;
      job?: CreatedFingerprintJob;
      error?: string;
    };

    if (!response.ok || !result.ok || !result.job) {
      return { ok: false, error: result.error ?? 'Could not start the enrollment.' };
    }
    return { ok: true, job: result.job };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}

/** Reads the newest job for this gym, plus the terminals available to enrol on. */
export async function fetchFingerprintState(
  tenantId: string,
  jobToken?: string | null
): Promise<{
  ok: boolean;
  job: FingerprintJob | null;
  terminals: FingerprintTerminal[];
  error?: string;
}> {
  try {
    const query = new URLSearchParams({ tenant_id: tenantId });
    if (jobToken) query.set('job_token', jobToken);

    const response = await fetch(`/api/hardware/fingerprint?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const result = (await response.json()) as {
      ok?: boolean;
      job?: FingerprintJob | null;
      terminals?: FingerprintTerminal[];
      error?: string;
    };

    if (!response.ok || !result.ok) {
      return { ok: false, job: null, terminals: [], error: result.error };
    }
    return { ok: true, job: result.job ?? null, terminals: result.terminals ?? [] };
  } catch {
    return { ok: false, job: null, terminals: [], error: 'Could not reach the server.' };
  }
}

/**
 * Cancels a live job and releases its slot.
 *
 * Called when the owner closes the modal. Without this the reservation would sit
 * until its ten-minute expiry and push the next member onto a higher slot for an
 * enrollment nobody finished.
 */
export async function cancelFingerprintEnrollment(
  tenantId: string,
  jobToken: string
): Promise<void> {
  try {
    await fetch('/api/hardware/fingerprint', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, job_token: jobToken }),
    });
  } catch {
    /* best effort: the SQL-side expiry releases the slot regardless */
  }
}
/**
 * Removes a member's fingerprint, on the terminal as well as in the database.
 *
 * PATCH rather than DELETE: DELETE on this endpoint cancels a RUNNING job, and
 * overloading one verb on two different meanings is how a client ends up
 * cancelling the job it just started. Unlinking starts a new job instead.
 *
 * The template is erased by the sensor. Clearing the row alone would leave the
 * finger readable at the door, which is the wrong thing to leave behind.
 */
export async function unlinkFingerprint(
  tenantId: string,
  memberId: string,
  deviceId?: string | null
): Promise<{ ok: boolean; job?: CreatedFingerprintJob; error?: string }> {
  try {
    const response = await fetch('/api/hardware/fingerprint', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenantId,
        member_id: memberId,
        device_id: deviceId ?? null,
      }),
    });

    const result = (await response.json()) as {
      ok?: boolean;
      job?: CreatedFingerprintJob;
      error?: string;
    };

    if (!response.ok || !result.ok || !result.job) {
      return { ok: false, error: result.error ?? 'Could not remove the fingerprint.' };
    }
    return { ok: true, job: result.job };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}