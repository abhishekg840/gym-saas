import { NextResponse } from 'next/server';

/**
 * Postgres SQLSTATE -> HTTP status.
 *
 * Phase 1 established this contract in /api/membership/actions; Phase 2 shares
 * one copy so every new route answers a database error the same way instead of
 * leaking a 500 for what is really a 400/401/404.
 *
 * Custom codes raised by Vyroniq functions (SQLSTATE 45xxx):
 *   45001 already frozen / not frozen / already transferred / package finished
 *   45002 nothing left to transfer
 *   45003 recipient phone is already a member of this gym
 *   45004 could not allocate a unique device key
 *   45005 machine authentication failed (unknown or revoked device key)
 *   45006 lead has already been converted to a member
 *   45007 not enough stock left for the requested quantity
 *   45008 a card is already linked to a different member (Phase 12)
 *   45009 the CURRENT password supplied for a credential change was wrong
 *     (Phase 13)
 */
const STATUS_BY_SQLSTATE: Record<string, number> = {
  '22023': 400, // invalid parameter (bad date, bad phone, bad enum value)
  '22P02': 400, // invalid text representation (malformed uuid)
  '22008': 400, // datetime field value out of range (e.g. 2026-13-45)
  P0002: 404, // no data found (row is not in this gym)
  '45001': 409,
  '45002': 422,
  '45003': 409,
  '45004': 503,
  '45005': 401,
  '45006': 409,
  '45007': 409,
  // A conflict, not a bad request: the request was well-formed, the card is just
  // already spoken for. 409 lets the UI say "unlink it there first" instead of
  // implying the owner typed something invalid.
  '45008': 409,
  // Same shape for a wrong CURRENT password: the new password may well be fine.
  '45009': 409,
  '23505': 409, // unique violation (composite tenant key)
  '23503': 400, // foreign key (unknown plan / tenant / member)
};

/** The subset of a PostgREST error this app needs. */
export interface PostgresFailure {
  message?: string;
  code?: string;
}

/**
 * PostgREST codes that mean "this object is not in the schema cache at all".
 * In practice that is one situation: a phase migration has not been run in the
 * Supabase project yet. A bare 500 is useless to firmware in the field and to an
 * owner staring at the console, so name the file to run.
 */
const SCHEMA_MISSING_HINT =
  'The database schema is missing part of this endpoint. Run the pending migration from supabase/migrations/ in the Supabase SQL Editor.';

/**
 * Which migration introduced a given database object.
 *
 * Kept as a lookup rather than a prose hint because the answer changes as the
 * schema grows: fn_hardware_punch arrived in Phase 2, its four-argument
 * RFID-key overload in Phase 10. Naming the wrong file costs the operator a
 * round trip, so the mapping is data rather than prose.
 */
const INTRODUCED_BY: Record<string, string> = {
  'fn_hardware_punch 4': '0010_phase10_vyroniq_identity_avatar.sql',
  'fn_hardware_punch 3': '0003_phase2_hardware_geofence.sql',
  'fn_member_hardware_identity 1': '0010_phase10_vyroniq_identity_avatar.sql',
  'fn_member_set_avatar 2': '0010_phase10_vyroniq_identity_avatar.sql',

  // Phase 12: enrollment capture, crowd tracker, biometric slots, branding.
  // Named by ARITY, for the same reason as Phase 11 above: PostgREST echoes
  // parameter names as spelled at the call site, not as declared.
  'fn_hardware_begin_enrollment 3': '0012_phase12_enrollment_crowd_branding.sql',
  'fn_hardware_enrollment_state 2': '0012_phase12_enrollment_crowd_branding.sql',
  'fn_hardware_capture_enrollment 2': '0012_phase12_enrollment_crowd_branding.sql',
  'fn_hardware_checkout 3': '0012_phase12_enrollment_crowd_branding.sql',
  fn_next_biometric_slot: '0012_phase12_enrollment_crowd_branding.sql',
  'fn_member_link_hardware 5': '0012_phase12_enrollment_crowd_branding.sql',
  fn_gym_live_crowd: '0012_phase12_enrollment_crowd_branding.sql',
  'fn_tenant_set_branding 4': '0012_phase12_enrollment_crowd_branding.sql',
  fn_tenant_public_profile: '0012_phase12_enrollment_crowd_branding.sql',

  // Phase 13: credentials. A missing one of these means the deployment has not
  // had 0013 applied, and telling the operator "invalid password" for that would
  // send every user chasing a credential problem they do not have.
  fn_staff_verify_password: '0013_phase13_real_credentials.sql',
  fn_member_verify_password: '0013_phase13_real_credentials.sql',
  'fn_member_set_password 4': '0013_phase13_real_credentials.sql',
  'fn_staff_set_password 4': '0013_phase13_real_credentials.sql',
  'fn_member_issue_temp_password 4': '0013_phase13_real_credentials.sql',

  // Phase 11. Note the keys are the FUNCTION NAME PLUS ARITY, never a literal
  // parameter list: PostgREST echoes the names as they were SPELLED AT THE CALL
  // SITE, so `fn_tenant_set_operating_hours(p_hours, p_tenant_id)` and
  // `(p_tenant_id, p_hours)` are the same function with the same missing-ness.
  // Matching on arity is what makes this lookup stable across callers.
  fn_announcements_admin_list: '0011_phase11_announcements_realtime_settings.sql',
  fn_announcements_feed: '0011_phase11_announcements_realtime_settings.sql',
  'fn_announcements_upsert 8': '0011_phase11_announcements_realtime_settings.sql',
  'fn_announcements_delete 2': '0011_phase11_announcements_realtime_settings.sql',
  fn_tenant_set_operating_hours: '0011_phase11_announcements_realtime_settings.sql',
  fn_member_mark_password_setup: '0011_phase11_announcements_realtime_settings.sql',
  fn_member_security_state: '0011_phase11_announcements_realtime_settings.sql',
  fn_member_profile_update: '0011_phase11_announcements_realtime_settings.sql',

  fn_monthly_leaderboard: '0009_phase9_gamification_retention.sql',
  fn_member_badges: '0009_phase9_gamification_retention.sql',
  fn_challenge_list: '0009_phase9_gamification_retention.sql',
  fn_challenge_join: '0009_phase9_gamification_retention.sql',
  fn_challenge_board: '0009_phase9_gamification_retention.sql',
  fn_member_streak: '0009_phase9_gamification_retention.sql',
  fn_member_stats: '0009_phase9_gamification_retention.sql',
};

/**
 * PostgREST says exactly which signature is missing ("Could not find the
 * function public.fn_hardware_punch(text, text, text, text) in the schema
 * cache"), so the migration name is recovered from the message rather than
 * guessed. Null when the message names nothing we recognise, and the caller
 * falls back to the generic hint.
 *
 * The lookup key is "<name>" for a function with no arguments and
 * "<name> <arity>" otherwise: PostgREST always prints the full argument list,
 * but the PARAMETER NAMES depend on how the RPC was called, so arity — not the
 * literal signature — is what reliably distinguishes an overload from its
 * sibling.
 */
function migrationForMissingObject(message: string | undefined): string | null {
  if (!message) return null;

  const match = message.match(/function\s+public\.(\w+)\s*\(([^)]*)\)/);
  if (!match) return null;

  const name = match[1];
  const arity = match[2].trim() === '' ? 0 : match[2].split(',').length;
  return INTRODUCED_BY[`${name} ${arity}`] ?? INTRODUCED_BY[name] ?? null;
}

function isSchemaMissing(code: string | undefined): boolean {
  return code === 'PGRST202' || code === 'PGRST205';
}

export function statusForSqlState(code: string | undefined, fallback = 500): number {
  if (isSchemaMissing(code)) return 503;
  return code && STATUS_BY_SQLSTATE[code] !== undefined ? STATUS_BY_SQLSTATE[code] : fallback;
}

/**
 * Turns a PostgREST error into the envelope every client helper in this app
 * already understands: { ok: false, error, code }.
 */
export function databaseError(
  error: PostgresFailure | null,
  fallbackMessage: string,
  fallbackStatus = 500
): Response {
  const code = error?.code;
  const message = error?.message || fallbackMessage;

  let text = message;
  if (isSchemaMissing(code)) {
    // Name the exact migration file when it can be identified, and keep the raw
    // PostgREST text either way: it is the only thing that tells an integrator
    // which signature the endpoint expected.
    const file = migrationForMissingObject(error?.message);
    const hint = file
      ? `The database schema is missing part of this endpoint. Run supabase/migrations/${file} in the Supabase SQL Editor.`
      : SCHEMA_MISSING_HINT;
    text = `${hint} (${message})`;
  }

  return NextResponse.json(
    {
      ok: false,
      error: text,
      code,
    },
    { status: statusForSqlState(code, fallbackStatus) }
  );
}

/** Uniform 4xx for a malformed request, before anything reaches Postgres. */
export function badRequest(message: string, status = 400): Response {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Reads a JSON body, or answers 400 with the shared envelope. */
export async function readJsonBody(
  request: Request
): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { response: badRequest('Request body must be a JSON object.') };
    }
    return { body: parsed as Record<string, unknown> } as { body: Record<string, unknown> };
  } catch {
    return { response: badRequest('Request body must be valid JSON.') };
  }
}

/**
 * Device-tolerant body reader, for hardware endpoints.
 *
 * WHY THIS EXISTS
 * ---------------
 * `readJsonBody` is right for the browser: it speaks JSON and nothing else. It is
 * wrong for an ESP32 or a Raspberry Pi, because embedded HTTP clients get this
 * wrong in three very common ways:
 *
 *   1. They POST a `Content-Type` of `text/plain` or nothing at all. The body is
 *      perfectly good JSON, but `request.json()` does not look at the content —
 *      it tries to parse and only fails if the bytes are not JSON, so this case
 *      is actually already fine.
 *   2. They post form-encoded (`device_key=x&rfid_card=y`) because that is the
 *      default their HTTP library uses. `request.json()` throws.
 *   3. They post JSON with a trailing newline, a BOM, or a stray leading/trailing
 *      byte. Strict JSON.parse throws on all three.
 *
 * (2) and (3) are what this function fixes. The strategy is to read the body as
 * TEXT once and try the parsers in order of strictness, rather than letting
 * `request.json()` throw and losing the payload — a body is a one-shot stream, so
 * once the parser has consumed it there is nothing left to retry with.
 *
 * Order matters: JSON is tried before form-encoding because a JSON body can
 * legitimately contain an `=` or `&` inside a string value.
 */
export async function readDeviceBody(
  request: Request
): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { response: badRequest('Could not read the request body.') };
  }

  const text = raw.trim();
  if (text === '') {
    return { response: badRequest('Request body is empty.') };
  }

  // --- 1. Strict-ish JSON (also covers the text/plain-but-really-JSON case).
  // Strip a UTF-8 BOM: some firmware toolchains emit one, and JSON.parse
  // rejects it outright even though the rest of the document is fine.
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (withoutBom.startsWith('{') || withoutBom.startsWith('[')) {
    try {
      const parsed = JSON.parse(withoutBom) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { body: parsed as Record<string, unknown> };
      }
      return { response: badRequest('Request body must be a JSON object.') };
    } catch (err) {
      // Not valid JSON after all. Fall through: some devices send
      // `device_key=x&rfid_card=y` with a JSON content type, and some send a
      // truncated JSON document with form fields appended. Try the form parser
      // before giving up, but keep the parse error in case that fails too.
      const recovered = parseFormEncoded(withoutBom);
      if (recovered) return { body: recovered };
      return {
        response: badRequest(
          `Request body could not be parsed as JSON or form data (${
            err instanceof Error ? err.message : 'unknown parse error'
          }).`
        ),
      };
    }
  }

  // --- 2. Form-encoded: `device_key=x&rfid_card=y`.
  const form = parseFormEncoded(withoutBom);
  if (form) return { body: form };

  return {
    response: badRequest(
      'Request body must be JSON ({"device_key":"…"}) or form-encoded (device_key=…).'
    ),
  };
}

/**
 * `a=1&b=2` -> { a: "1", b: "2" }.
 *
 * Returns null when the text is not form-encoded at all — no `=` present, or the
 * `=` is in the first character (which is how a bare JSON fragment or a plain
 * token would look). A single bare key with no value is accepted, because some
 * firmware sends just `action=gate_checkin`.
 *
 * Repeated keys collapse to the LAST value, matching how PHP and most embedded
 * HTTP servers parse them.
 */
function parseFormEncoded(text: string): Record<string, unknown> | null {
  if (!text.includes('=')) return null;

  const result: Record<string, unknown> = {};
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;

    const rawKey = pair.slice(0, separator);
    const rawValue = pair.slice(separator + 1);
    if (!rawKey) continue;

    // `+` means space in application/x-www-form-urlencoded. Decoding it without
    // that rule turns a space in a device name into a literal plus.
    const key = decodeFormComponent(rawKey);
    const value = decodeFormComponent(rawValue);
    if (key) result[key] = value;
  }

  // An object built from input that had no usable pairs is not a form body.
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Percent-decoding that never throws.
 *
 * `decodeURIComponent` throws on a lone `%` (or any incomplete escape), and a
 * truncated RFID serial containing one would take the whole request down. A
 * device sending garbage should get a DENIED, not a 500.
 */
function decodeFormComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}
