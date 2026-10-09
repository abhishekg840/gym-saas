-- =============================================================================
-- 0021_phase21_pilot_leads.sql   (run after 0020_phase20_security_hardening.sql)
--
-- Public B2B pilot-booking leads from the marketing landing page (app/page.tsx).
--
-- WHY THIS IS NOT public.leads
-- ----------------------------
-- public.leads is the owner's per-gym CRM pipeline: tenant_id is NOT NULL and
-- every row belongs to a signed-up gym that is working the enquiry. A visitor
-- on the public landing page is the opposite — a prospective gym that has no
-- tenant yet, so there is nothing to scope the row to and no owner console that
-- should show it. Forcing a NULL/fake tenant_id would either violate the NOT
-- NULL constraint or pollute some unrelated gym's pipeline.
--
-- So pilot bookings get their own tenant-less table. An operator promotes a row
-- into public.leads by hand once the gym onboards.
--
-- Access model: this app talks to Postgres with the anon key, so the table is
-- opened for anon INSERT only (the landing page writes it server-side) and is
-- NOT readable through PostgREST — the leads are read through the service role
-- / dashboard, never exposed to the public.
--
-- Every statement is idempotent: safe to re-run in the SQL Editor.
-- =============================================================================

begin;

create table if not exists public.pilot_leads (
  id         uuid primary key default gen_random_uuid(),
  gym_name   text not null,
  city       text not null default '',
  phone      text not null,
  source     text not null default 'landing_pilot',
  created_at timestamptz not null default now()
);

comment on table public.pilot_leads is
  'Tenant-less B2B leads from the public landing-page 14-day pilot booking form.';

-- Idempotent grants: anon may insert (the /api/pilot-lead route runs server-side
-- with the anon key) but never select/update/delete, so the list cannot be
-- scraped through PostgREST.
revoke all on table public.pilot_leads from anon;
grant insert on table public.pilot_leads to anon;

commit;
