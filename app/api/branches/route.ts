import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * /api/branches — multi-branch foundation (Module 11.2).
 *
 *   GET  ?tenant_id=...                                  -> { ok, branches[] }
 *   POST { tenant_id?, name, address?, phone? }          -> { ok, branch }
 *   PATCH { tenant_id?, branch_id, name?, ... }          -> { ok, branch }
 *
 * Owner-only in spirit (the console gates the UI), tenant-scoped like every
 * other route: the gym always comes from the body when it is a UUID, else the
 * forgeos_tenant cookie, and never falls back to "no filter".
 */

const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

const COLUMNS = 'id, tenant_id, name, address, phone, is_active, created_at';

function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

function parseName(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, 80);
}

function parseOptionalText(raw: unknown, max: number): string | null {
  return String(raw ?? '').trim().slice(0, max) || null;
}

export async function GET(request: Request) {
  const tenantId = resolveTenant([new URL(request.url).searchParams.get('tenant_id')], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const { data, error } = await supabase
    .from('branches')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) return databaseError(error, 'Could not load branches.');
  return NextResponse.json({ ok: true, branches: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const name = parseName(body.name);
  if (name.length < 2) return badRequest('Branch name must be at least 2 characters.');

  const { data, error } = await supabase
    .from('branches')
    .insert({
      tenant_id: tenantId,
      name,
      address: parseOptionalText(body.address, 300),
      phone: parseOptionalText(body.phone, 20),
      is_active: true,
    })
    .select(COLUMNS)
    .maybeSingle();

  if (error) return databaseError(error, 'Could not create this branch.');
  return NextResponse.json({ ok: true, branch: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const branchId = body.branch_id ?? body.branchId;
  if (!isUuid(branchId)) return badRequest('branch_id must be a valid UUID.');

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = parseName(body.name);
    if (name.length < 2) return badRequest('Branch name must be at least 2 characters.');
    patch.name = name;
  }
  if (body.address !== undefined) patch.address = parseOptionalText(body.address, 300);
  if (body.phone !== undefined) patch.phone = parseOptionalText(body.phone, 20);
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return badRequest('is_active must be true or false.');
    patch.is_active = body.is_active;
  }

  if (Object.keys(patch).length === 0) {
    return badRequest('Nothing to update. Send name, address, phone or is_active.');
  }

  const { data, error } = await supabase
    .from('branches')
    .update(patch)
    .eq('id', branchId)
    .eq('tenant_id', tenantId)
    .select(COLUMNS)
    .maybeSingle();

  if (error) return databaseError(error, 'Could not update this branch.');
  if (!data) return badRequest('Branch not found in this gym.', 404);

  return NextResponse.json({ ok: true, branch: data });
}
