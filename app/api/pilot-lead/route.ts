import { NextResponse } from 'next/server';
import { readJsonBody, badRequest } from '@/lib/sqlstate';
import { normalizePhone10 } from '@/lib/session';

/**
 * /api/pilot-lead — public 14-day pilot booking intake from the landing page.
 *
 * WHY IT IS SEPARATE FROM /api/leads
 * ----------------------------------
 * /api/leads writes to public.leads, which is the owner's per-gym CRM pipeline
 * and requires a tenant_id. A visitor on the public marketing page has no gym
 * yet, so their booking is stored in the tenant-less public.pilot_leads table
 * (migration 0021) until an operator promotes it after onboarding.
 *
 * WHY IT ALWAYS ANSWERS ok
 * ------------------------
 * This endpoint is best-effort telemetry for the sales pipeline. The prospect's
 * real handoff is the prefilled WhatsApp chat the client opens BEFORE this call,
 * so a database hiccup, an un-run migration or missing env vars must never fail
 * the request in a way that looks like a broken signup. The route still
 * validates the payload and returns the true save status so the client can tell,
 * but a save failure is reported as { ok: true, saved: false } — never a 5xx.
 */

const MAX_GYM = 120;
const MAX_CITY = 80;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const gymName = String(body.gym_name ?? body.gymName ?? '').trim();
  if (!gymName) return badRequest('gym_name is required.');
  if (gymName.length > MAX_GYM) {
    return badRequest(`gym_name must be ${MAX_GYM} characters or fewer.`);
  }

  const city = String(body.city ?? '').trim().slice(0, MAX_CITY);

  const phone = normalizePhone10(String(body.phone ?? ''));
  if (!/^\d{10}$/.test(phone)) {
    return badRequest('phone must be a 10-digit mobile number.');
  }

  // Persist best-effort. Any failure (missing env, un-run migration, network)
  // is swallowed: the lead is already safe in the WhatsApp conversation.
  try {
    const { supabase } = await import('@/lib/supabase');
    const { error } = await supabase
      .from('pilot_leads')
      .insert({ gym_name: gymName, city, phone, source: 'landing_pilot' });

    if (error) {
      console.error('pilot_leads insert failed:', error.message);
      return NextResponse.json({ ok: true, saved: false });
    }
  } catch (err) {
    console.error(
      'pilot-lead persistence unavailable:',
      err instanceof Error ? err.message : 'unknown error'
    );
    return NextResponse.json({ ok: true, saved: false });
  }

  return NextResponse.json({ ok: true, saved: true }, { status: 201 });
}
