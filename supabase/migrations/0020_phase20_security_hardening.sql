-- =============================================================================
-- 0020 — P0 security hardening: super-admin directory gate + tenant UPI identity
--
-- Phase 1 of the launch roadmap (critical security & endpoint hardening).
--
-- §1  tenants.upi_id — the column /api/member/pass and the renewal messages
--     read was created out-of-band (like the tenants table itself) and is not
--     declared by any earlier file. Declared here so a fresh environment
--     reproduces it instead of failing the read.
--
-- §2  fn_tenant_set_upi_id — there was NO write path for that column: the VPA
--     was hardcoded into the renewal cron as a personal Paytm QR. The owner can
--     now set it from Settings → Payments (UPI), and clearing it switches
--     renewal messages back to the neutral front-desk copy.
--
-- §3  fn_superadmin_list_tenants — was callable by the anon key with no
--     credential. The read now verifies the super admin's password inside
--     Postgres exactly like every fn_superadmin_* mutation (SQLSTATE 45005 on
--     failure), and the credential-less overload is dropped so PostgREST can no
--     longer dispatch to it.
--
-- Pending-file rule: run this file in the Supabase SQL Editor alongside 0019.
-- Until it has run, /super-admin prompts and then reports the missing function
-- (503 with this file named), and Settings → Payments save fails with the same
-- hint. Reads elsewhere are unaffected.
-- =============================================================================

begin;

-- §1 ---------------------------------------------------------------------------
alter table if exists public.tenants
  add column if not exists upi_id text;

comment on column public.tenants.upi_id is
  'Owner-configured UPI VPA (e.g. gymname@upi) used to build renewal payment links. Null = no link is sent and members are asked to pay at the front desk.';

commit;

begin;

-- §2 ---------------------------------------------------------------------------
create or replace function public.fn_tenant_set_upi_id(
  p_tenant_id uuid,
  p_upi_id    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_clean text := nullif(trim(coalesce(p_upi_id, '')), '');
  v_name  text;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  -- NPCI VPA shape: local part @ handle. Rejects URLs, phone numbers and free
  -- text so the upi:// link the member app builds can never be broken (or
  -- pointed at a different scheme) by whatever is saved here.
  if v_clean is not null and v_clean !~ '^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$' then
    raise exception 'Enter a UPI ID like gymname@upi (letters, digits, dot, dash or underscore before the @).'
      using errcode = '22023';
  end if;

  update public.tenants
     set upi_id = v_clean
   where id = p_tenant_id
  returning name into v_name;

  if v_name is null then
    raise exception 'Gym not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object('tenant_id', p_tenant_id, 'upi_id', v_clean);
end;
$$;

comment on function public.fn_tenant_set_upi_id(uuid, text) is
  'Stores or clears the gym''s UPI VPA. Validated against the NPCI address shape before it reaches any renewal message.';

grant execute on function public.fn_tenant_set_upi_id(uuid, text)
to anon, authenticated;

commit;

begin;

-- §3 ---------------------------------------------------------------------------
create or replace function public.fn_superadmin_list_tenants(
  p_identifier text,
  p_password   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin jsonb;
  v_rows  jsonb;
begin
  -- Same rule as every fn_superadmin_* mutation (0015 §7): the super admin's
  -- password is verified INSIDE Postgres against the bcrypt hash, and 45005 is
  -- raised before a single row is read. The client's own "I am super admin"
  -- session flag proves nothing — there is no server-verifiable session in
  -- this architecture — so the credential travels with the call. This is a
  -- read; the mismatch between 0015 §7's "reads are not gated" note and the
  -- P0 outcome is deliberate: an owner directory (names, phones) is exactly
  -- the data a leak of the anon key should not carry.
  v_admin := public.fn_superadmin_verify_password(p_identifier, p_password);
  if v_admin is null then
    raise exception 'Unauthorized' using errcode = '45005';
  end if;

  -- Same pinned column list as the 0015 reader, so a schema change elsewhere
  -- cannot silently widen what a browser receives.
  select coalesce(jsonb_agg(payload order by created_at desc nulls last), '[]'::jsonb)
    into v_rows
    from (
      select t.created_at,
             jsonb_build_object(
               'id',                  t.id,
               'name',                t.name,
               'slug',                t.slug,
               'owner_name',          t.owner_name,
               'phone',               t.phone,
               'subscription_tier',   coalesce(t.subscription_tier, 'starter'),
               'subscription_status', coalesce(t.subscription_status, 'active'),
               'trial_ends_at',       t.trial_ends_at,
               'created_at',          t.created_at
             ) as payload
        from public.tenants t
    ) s;

  return v_rows;
end;
$$;

comment on function public.fn_superadmin_list_tenants(text, text) is
  'Password-gated gym directory for /super-admin. The no-credential overload was dropped: "the same data is readable with the anon key anyway" still exposed owner names and phone numbers to anyone holding that key.';

-- The credential-less overload must go, or PostgREST keeps serving it.
drop function if exists public.fn_superadmin_list_tenants();

grant execute on function public.fn_superadmin_list_tenants(text, text)
to anon, authenticated;

commit;
