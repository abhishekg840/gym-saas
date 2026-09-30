import { NextResponse } from 'next/server';

/**
 * Postgres SQLSTATE -> HTTP status.
 *
 * Phase 1 established this contract in /api/membership/actions; Phase 2 shares
 * one copy so every new route answers a database error the same way instead of
 * leaking a 500 for what is really a 400/401/404.
 *
 * Custom codes raised by ForgeOS functions (SQLSTATE 45xxx):
 *   45001 already frozen / not frozen / already transferred
 *   45002 nothing left to transfer
 *   45003 recipient phone is already a member of this gym
 *   45004 could not allocate a unique device key
 *   45005 machine authentication failed (unknown or revoked device key)
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
 * In practice that is one situation: the Phase 2 migration has not been run in
 * the Supabase project yet. A bare 500 is useless to firmware in the field and to
 * an owner staring at the console, so name the file to run.
 */
const SCHEMA_MISSING_HINT =
  'The database schema is missing part of this endpoint. If Phase 2 was just added, run supabase/migrations/0003_phase2_hardware_geofence.sql in the Supabase SQL Editor.';

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
  return NextResponse.json(
    {
      ok: false,
      error: isSchemaMissing(code) ? `${SCHEMA_MISSING_HINT} (${message})` : message,
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
    return { body: parsed as Record<string, unknown> };
  } catch {
    return { response: badRequest('Request body must be valid JSON.') };
  }
}
