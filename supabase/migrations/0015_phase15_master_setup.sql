begin;

-- =============================================================================
-- Phase 15 -- MASTER SETUP (consolidated, self-sufficient, re-runnable).
--
-- WHY THIS FILE EXISTS ON TOP OF 0013 AND 0014
-- --------------------------------------------
-- 0013 introduced bcrypt credentials. 0014 repaired them: the hashes moved into
-- a non-served `private` schema, every function's search_path gained
-- `extensions` so crypt() resolves, and the public tables got permissive SELECT
-- policies so `select('*')` stops failing and stops returning zero rows. Both
-- files are correct, and both are ALREADY APPLIED on this deployment.
--
-- What is still missing, and what this file supplies:
--
--   1. A DEFAULT CREDENTIAL for every account that has none. After 0014, an
--      account whose `password_hash is null` cannot sign in at all --
--      fn_*_verify_password returns NULL by design, and NULL is deliberately
--      indistinguishable from "wrong password". A gym migrated before PINs were
--      ever issued therefore has members who are silently locked out and cannot
--      be rescued from the login screen either. The desk default is 1234 for
--      members and owners, admin1234 for the platform super admin; every one of
--      them is flagged password_must_change = true, so /setup-password forces a
--      replacement at first sign-in.
--
--   2. A SEEDED SUPER ADMIN IDENTITY. `public.gym_users` had no platform row at
--      all, so /super-admin was unreachable and its tenant mutations were being
--      performed with the public anon key -- see 3.
--
--   3. THE `fn_superadmin_*` CALLABLE SURFACE. app/super-admin/page.tsx used to
--      INSERT and UPDATE public.tenants straight from the browser with the anon
--      key, which means ANY holder of the public key could create unlimited
--      gyms, suspend a paying customer, or move a gym onto a cheaper tier, with
--      no credential of any kind. Platform writes now go through SECURITY
--      DEFINER functions that require the super admin's own password, and the
--      table's write grants are revoked.
--
--   4. ONE CONSOLIDATED, IDEMPOTENT SCRIPT. 0013 and 0014 must be run in order,
--      and 0014 depends on columns 0013 adds. This file re-asserts the end state
--      of both and adds the missing pieces, so it can be pasted into the SQL
--      Editor as a single "make the database correct" step. Every statement is
--      guarded, so re-running it is a no-op.
--
-- TRANSACTION SHAPE
-- -----------------
-- Deliberately one transaction per numbered section rather than one for the
-- whole file. If section 7 fails on a live database, the credential backfill
-- and the super-admin seed from sections 4 and 5 are already committed and the
-- operator has a working sign-in to debug from, instead of a full rollback.
--
-- ORDERING CONTRACT
-- -----------------
-- `public.tenants` and `public.gym_users` are NOT created by any migration in
-- this repo -- they predate it and were made out-of-band. This file therefore
-- creates them ONLY as a fallback (`create table if not exists`) and then adds
-- every column it depends on with `add column if not exists`. It never drops a
-- column it did not itself introduce.
--
-- Run once. Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. pgcrypto must exist AND be reachable from every function below.
--    `set search_path = public, extensions, pg_temp` resolves crypt() whether
--    pgcrypto lives in `extensions` (Supabase default) or `public` (self-hosted).
--    This is the 42883 fix from 0014, repeated so this file stands alone.
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

-- =============================================================================
-- 1. Credential storage: the `private` schema.
--
-- A hash must never sit on a table that answers `select('*')` from the browser,
-- because PostgREST cannot hide one column from a star expansion. `private` is
-- not in PostgREST's exposed schema list, so nothing inside it is reachable with
-- the anon key however the grants fall.
-- =============================================================================
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.member_credentials (
  member_id            uuid primary key references public.members(id) on delete cascade,
  password_hash        text,
  password_changed_at  timestamptz,
  password_must_change boolean not null default false
);

create table if not exists private.staff_credentials (
  user_id              uuid primary key references public.gym_users(id) on delete cascade,
  password_hash        text,
  password_changed_at  timestamptz,
  password_must_change boolean not null default false
);

-- No grants, and RLS enabled with NO policies: belt AND braces. Even if a GRANT
-- were added by mistake later, RLS-with-no-policy still denies every row.
revoke all on private.member_credentials from public, anon, authenticated;
revoke all on private.staff_credentials   from public, anon, authenticated;

alter table private.member_credentials enable row level security;
alter table private.staff_credentials   enable row level security;

comment on schema private is
  'Credential storage. Never exposed through PostgREST; reachable only from SECURITY DEFINER functions.';
comment on table private.member_credentials is
  'members.password_hash and friends, moved out of the anon-readable table.';
comment on table private.staff_credentials is
  'gym_users.password_hash and friends, moved out of the anon-readable table.';

commit;

begin;

-- =============================================================================
-- 2. Public tables: shape, grants and RLS.
--
-- Re-asserts the end state of 0014, so this file also repairs a database that
-- only ever saw 0013 (or neither). Nothing here is destructive to data:
--   * the fallback CREATE only fires when the table is genuinely absent;
--   * `add column if not exists` is a no-op on the normal path;
--   * the DROP COLUMN statements target only the plaintext/hashed secrets 0014
--     already removed, so on a healthy database they match nothing.
-- =============================================================================

-- 2a. Fallback creation. `create table if not exists` with a column list that
--     differs from the live table is a NO-OP, not an error, so this is safe to
--     keep on a database where these tables already exist.
create table if not exists public.tenants (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text,
  owner_name          text,
  phone               text,
  subscription_tier   text not null default 'starter',
  subscription_status text not null default 'active',
  trial_ends_at       timestamptz,
  created_at          timestamptz not null default now()
);

create table if not exists public.gym_users (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  full_name   text,
  phone       text,
  email       text,
  role        text not null default 'receptionist',
  created_at  timestamptz not null default now()
);

-- 2b. Columns this file depends on. All non-secret.
alter table public.tenants
  add column if not exists name                text,
  add column if not exists slug                text,
  add column if not exists owner_name          text,
  add column if not exists phone               text,
  add column if not exists subscription_tier   text,
  add column if not exists subscription_status text,
  add column if not exists trial_ends_at       timestamptz,
  add column if not exists created_at          timestamptz default now();

-- created_at matters beyond bookkeeping: section 3 (de-duplication) and section
-- 5 (super-admin seed) both use it as the tie-break that makes "which row wins"
-- deterministic across re-runs. It is added rather than assumed, because these
-- two tables were created out-of-band and no migration here guarantees a shape.
alter table public.gym_users
  add column if not exists tenant_id  uuid,
  add column if not exists full_name  text,
  add column if not exists phone      text,
  add column if not exists email      text,
  add column if not exists role       text,
  add column if not exists created_at timestamptz default now();

-- 2c. Remove the secrets from the PostgREST-exposed tables.
--     password_hash / password_changed_at / password_must_change now live in
--     private.*_credentials. pin_code, totp_secret and access_pin are PLAINTEXT
--     secrets with no remaining reader anywhere in the app and are destroyed.
alter table public.members   drop column if exists password_hash;
alter table public.members   drop column if exists password_changed_at;
alter table public.members   drop column if exists password_must_change;
alter table public.members   drop column if exists totp_secret;
alter table public.members   drop column if exists access_pin;

alter table public.gym_users drop column if exists password_hash;
alter table public.gym_users drop column if exists password_changed_at;
alter table public.gym_users drop column if exists password_must_change;
alter table public.gym_users drop column if exists pin_code;

-- 2d. Table-level SELECT for the browser. The per-column grant 0013 used made
--     `select('*')` fail with 42501, because a star expands to every column and
--     one ungranted column fails the whole statement. A star-capable table
--     cannot hide a column, which is exactly why the secrets had to leave.
grant select on public.members   to anon, authenticated;
grant select on public.gym_users to anon, authenticated;
grant select on public.tenants   to anon, authenticated;

-- 2e. RLS: permissive SELECT policies, so RLS stops zeroing every row.
--     `members` previously had RLS ON with NO policy, which made the table read
--     as EMPTY rather than erroring -- the Member Smart Pass answered "no
--     membership found" and it looked like data loss.
--     Deliberately SELECT-only: permissive INSERT/UPDATE/DELETE policies would
--     let anyone holding the public anon key edit or delete members.
alter table public.members   enable row level security;
alter table public.gym_users enable row level security;
alter table public.tenants   enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'members' and policyname = 'members_read'
  ) then
    create policy members_read on public.members
      for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'gym_users' and policyname = 'gym_users_read'
  ) then
    create policy gym_users_read on public.gym_users
      for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'tenants' and policyname = 'tenants_read'
  ) then
    create policy tenants_read on public.tenants
      for select to anon, authenticated using (true);
  end if;
end $$;

-- The Phase 13 policy name is superseded by gym_users_read. Dropped so there is
-- exactly one SELECT policy per table and the intent is unambiguous.
drop policy if exists gym_users_directory_read on public.gym_users;

commit;

begin;

-- =============================================================================
-- 3. De-duplicate public.gym_users on the natural key (tenant_id, phone).
--
-- WHY THIS IS HERE AND WHY IT IS SO NARROW
-- ----------------------------------------
-- (tenant_id, phone) is the key /api/auth/login and fn_staff_verify_password
-- actually match on, and they both `limit 1`. A second row for the same key is
-- therefore unreachable dead weight, and worse: whichever row Postgres returns
-- first wins, so an operator can appear to "lose" their password depending on
-- plan order. That is the class of bug this phase is clearing up.
--
-- It is safe because it can only ever remove an EXACT repeat of the key it
-- matches on:
--   * rows with a NULL/blank phone are never touched -- a NULL key is not a
--     duplicate, it is an un-keyed row;
--   * rows with a NULL tenant_id (the platform super admin) are never touched;
--   * the survivor is chosen deterministically -- the row that HAS a usable
--     credential wins, otherwise the oldest, otherwise the lowest id -- so a
--     re-run cannot flip-flop between two candidates;
--   * the same phone at a DIFFERENT gym is untouched, because (tenant_id, phone)
--     differs. Two gyms may legitimately share a staff number.
--
-- The cascade on private.staff_credentials removes the duplicate's credential
-- row with it, which is correct: it belonged to a row that no longer exists.
-- =============================================================================
do $$
declare
  v_pair  record;
  v_keep  uuid;
  v_drop  integer;
  v_total integer := 0;
begin
  for v_pair in
    select u.tenant_id, u.phone
      from public.gym_users u
     where u.tenant_id is not null
       and nullif(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), '') is not null
     group by u.tenant_id, u.phone
    having count(*) > 1
  loop
    select u.id into v_keep
      from public.gym_users u
      left join private.staff_credentials c on c.user_id = u.id
     where u.tenant_id = v_pair.tenant_id
       and u.phone     = v_pair.phone
     order by (c.password_hash is not null) desc,   -- keep the working account first
              u.created_at nulls last,
              u.id
     limit 1;

    if v_keep is null then
      continue;
    end if;

    delete from public.gym_users u
     where u.tenant_id = v_pair.tenant_id
       and u.phone     = v_pair.phone
       and u.id       <> v_keep
       -- Never delete an owner/super_admin in favour of a receptionist, even if
       -- the receptionist happened to hold a credential. The role is privileged,
       -- and losing it silently would lock a gym's owner out of their own gym.
       and coalesce(u.role, '') not in ('owner', 'super_admin');

    get diagnostics v_drop = row_count;
    if v_drop > 0 then
      v_total := v_total + v_drop;
      raise notice 'Phase 15: removed % duplicate gym_users row(s) for tenant % phone %',
        v_drop, v_pair.tenant_id, v_pair.phone;
    end if;
  end loop;

  raise notice 'Phase 15: gym_users de-duplication complete (% row(s) removed).', v_total;
end $$;

commit;

begin;

-- =============================================================================
-- 4. Default credentials for every account that has none.
--
-- THE FAILURE THIS FIXES
-- ----------------------
-- After 0014, `fn_*_verify_password` returns NULL when `password_hash is null`,
-- and NULL is deliberately indistinguishable from "wrong password" -- an account
-- oracle is worse than a vague error. So an account with no hash is simply
-- unreachable: it cannot be signed into, and it cannot be rescued from the login
-- screen either. A gym migrated before PINs were ever issued has members in
-- exactly that state.
--
-- WHAT IS INSTALLED
-- -----------------
--   * members, and staff other than the super admin ....... 1234
--   * the platform super admin ........................ admin1234
--
-- Every one of them also sets `password_must_change = true`, so the very next
-- sign-in lands on /setup-password and the shared default is replaced before any
-- real work happens. A member's `password_setup_completed` is forced back to
-- false to match, because /api/member/account reads it to decide whether to
-- render the "set your password" prompt.
--
-- ONLY a NULL hash is written. An account that already holds a credential is
-- never reset -- a migration must not be able to hand out a working password for
-- somebody's live account.
-- =============================================================================

-- 4a. Members with no credential at all.
insert into private.member_credentials (member_id, password_hash, password_changed_at, password_must_change)
select m.id, crypt('1234', gen_salt('bf')), now(), true
  from public.members m
 where not exists (
   select 1 from private.member_credentials c
    where c.member_id = m.id
      and c.password_hash is not null
 )
on conflict (member_id) do nothing;

-- The UI flag has to agree with the credential, or the member is shown a
-- "password already set" screen for a credential they have never seen.
update public.members m
   set password_setup_completed = false
 where coalesce(m.password_setup_completed, false) is not false
   and exists (
     select 1 from private.member_credentials c
      where c.member_id = m.id
        and c.password_must_change
   );

-- 4b. Staff with no credential at all, excluding the super admin -- section 5
--     owns that row and gives it a different password.
insert into private.staff_credentials (user_id, password_hash, password_changed_at, password_must_change)
select u.id, crypt('1234', gen_salt('bf')), now(), true
  from public.gym_users u
 where coalesce(u.role, '') <> 'super_admin'
   and not exists (
     select 1 from private.staff_credentials c
      where c.user_id = u.id
        and c.password_hash is not null
   )
on conflict (user_id) do nothing;

-- 4c. Report, so the operator can see the backfill actually happened.
do $$
declare
  v_members bigint;
  v_staff   bigint;
begin
  select count(*) into v_members
    from private.member_credentials where password_must_change;
  select count(*) into v_staff
    from private.staff_credentials where password_must_change;

  raise notice 'Phase 15: % member credential(s) and % staff credential(s) are flagged password_must_change.',
    v_members, v_staff;
end $$;

commit;

begin;

-- =============================================================================
-- 5. Seed the platform super admin.
--
-- The console at /super-admin lists every gym and can create, suspend and re-tier
-- them. Before this phase there was no platform identity in the database at all,
-- which is precisely why that page had to write public.tenants straight from the
-- browser with the anon key -- section 7 gives it a real credential to prove.
--
-- THE IDENTITY
--   phone      9999000001     10 digits, matching the login identifier shape
--   email      admin@vyroniq.com
--   password   admin1234      first sign-in only, must_change = true
--   tenant_id  NULL           a super admin owns the PLATFORM, not a gym. A NULL
--                             tenant is what makes /api/auth/login route them to
--                             /super-admin and skip the per-gym forced change.
--
-- `on conflict do nothing` would need a unique constraint this table may not
-- have, so existence is checked explicitly. That also makes the CHOICE of "the"
-- super admin deterministic when several exist (receptionist-era test rows,
-- most likely): the oldest wins.
-- =============================================================================
do $$
declare
  v_admin uuid;
  v_has   boolean;
begin
  select u.id into v_admin
    from public.gym_users u
   where coalesce(u.role, '') = 'super_admin'
   order by u.created_at nulls last, u.id
   limit 1;

  if v_admin is null then
    insert into public.gym_users (tenant_id, full_name, phone, email, role)
    values (null, 'Vyroniq Platform Admin', '9999000001', 'admin@vyroniq.com', 'super_admin')
    returning id into v_admin;

    raise notice 'Phase 15: created the platform super admin (phone 9999000001).';
  else
    -- Backfill only the blanks. Never overwrite a value an operator set.
    update public.gym_users
       set phone     = coalesce(nullif(phone, ''), '9999000001'),
           email     = coalesce(nullif(email, ''), 'admin@vyroniq.com'),
           full_name = coalesce(nullif(full_name, ''), 'Vyroniq Platform Admin')
     where id = v_admin;

    raise notice 'Phase 15: platform super admin already exists (%).', v_admin;
  end if;

  select exists (
    select 1 from private.staff_credentials c
     where c.user_id = v_admin
       and c.password_hash is not null
  ) into v_has;

  if v_has then
    -- Deliberately NOT reset: a live platform credential must not be replaced by
    -- a migration. The reset snippet is at the bottom of this file for the case
    -- where the existing password is genuinely lost.
    raise notice 'Phase 15: super admin already holds a password; left untouched.';
  else
    insert into private.staff_credentials (user_id, password_hash, password_changed_at, password_must_change)
    values (v_admin, crypt('admin1234', gen_salt('bf')), now(), true)
    on conflict (user_id) do update
       set password_hash        = excluded.password_hash,
           password_changed_at  = excluded.password_changed_at,
           password_must_change = true;

    raise notice 'Phase 15: super admin password set to admin1234 (change on first sign-in).';
  end if;
end $$;

commit;

begin;

-- =============================================================================
-- 6. Preconditions.
--
-- This file deliberately does NOT redefine the five credential functions
-- (fn_staff_verify_password, fn_member_verify_password, fn_member_set_password,
-- fn_staff_set_password, fn_member_issue_temp_password). They were written in
-- 0013 and CORRECTED in 0014, and copying their bodies here would create two
-- drifting copies of the same security-critical logic -- the exact failure mode
-- 0014 exists to clean up.
--
-- Instead the dependency is asserted. A missing function is a deployment fault
-- that must stop the script loudly, not a silent half-applied state.
-- =============================================================================
do $$
declare
  v_missing text[] := array[]::text[];
  v_fn      text;
begin
  foreach v_fn in array array[
    'fn_staff_verify_password',
    'fn_member_verify_password',
    'fn_member_set_password',
    'fn_staff_set_password',
    'fn_member_issue_temp_password'
  ] loop
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_fn
    ) then
      v_missing := array_append(v_missing, v_fn);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception
      'Phase 15 cannot continue: the credential functions % are missing. Run supabase/migrations/0013_phase13_real_credentials.sql and then supabase/migrations/0014_phase14_privilege_rls_repair.sql first.',
      array_to_string(v_missing, ', ')
      using errcode = '42883';
  end if;

  raise notice 'Phase 15: credential functions present.';
end $$;

commit;

begin;

-- =============================================================================
-- 7. fn_superadmin_* -- the platform callable surface.
--
-- THE HOLE THIS CLOSES
-- --------------------
-- app/super-admin/page.tsx used to run, from the BROWSER with the public anon
-- key:
--     supabase.from('tenants').insert([...])                        create a gym
--     supabase.from('tenants').update({ subscription_status: ... }) suspend a gym
--     supabase.from('tenants').update({ subscription_tier: ... })   change billing
--
-- Anybody holding the public anon key -- which ships in the browser bundle by
-- definition -- could therefore create unlimited gyms, suspend a paying customer,
-- or move a gym onto the cheapest tier. There was no credential check of any
-- kind, because "super admin" was only ever enforced in the client.
--
-- THERE IS NO SERVER-VERIFIABLE SESSION IN THIS ARCHITECTURE
-- ----------------------------------------------------------
-- The gym session is localStorage plus a tenant cookie, so a route handler has
-- nothing trustworthy to check, and a client-supplied "I am the super admin" flag
-- would be worth exactly nothing. This is the same constraint
-- fn_member_issue_temp_password already solves, and this file follows its rule:
-- the caller must PROVE the super admin's own password, verified INSIDE Postgres
-- against the bcrypt hash. Nothing destructive happens until that check passes.
--
-- READS ARE NOT GATED, WRITES ARE
-- -------------------------------
-- fn_superadmin_list_tenants takes no credential. The gym directory is already
-- readable through the anon key by design -- lib/session.ts needs it to hydrate
-- the gym name -- so gating the read would add friction without removing
-- exposure. Every MUTATION is gated.
--
-- All of these are SECURITY DEFINER with `search_path = public, extensions,
-- pg_temp`, so crypt() resolves and private.staff_credentials is reachable.
-- =============================================================================

create or replace function public.fn_superadmin_verify_password(
  p_identifier text,
  p_password   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row jsonb;
begin
  -- Reuse the staff verifier, so there is exactly ONE place that decides what a
  -- correct password is, then narrow it to the platform role. An owner passing
  -- their OWN valid credentials therefore still fails here, which is the point.
  v_row := public.fn_staff_verify_password(p_identifier, p_password);

  if v_row is null then
    return null;
  end if;

  if coalesce(v_row->>'role', '') <> 'super_admin' then
    return null;
  end if;

  return v_row;
end;
$$;

comment on function public.fn_superadmin_verify_password(text, text) is
  'Verifies a super-admin credential inside Postgres. Returns NULL for both "no such account" and "not a super admin", so it cannot be used as a role oracle.';

commit;

begin;

-- 7a. DIRECTORY READ -- no credential required (see the note in section 7).
--     Returns a jsonb ARRAY so the browser gets one stable value back that does
--     not depend on PostgREST's inferred row shape for `tenants`.
create or replace function public.fn_superadmin_list_tenants()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rows jsonb;
begin
  -- `payload` rather than `row`: ROW is a keyword in Postgres and using it as an
  -- alias is legal but confusing enough to be worth avoiding.
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

comment on function public.fn_superadmin_list_tenants() is
  'Read-only gym directory for /super-admin. Deliberately unauthenticated: the same data is already readable with the anon key, so gating the read would add friction without removing exposure.';

commit;

begin;

-- 7b. CREATE A GYM. Gated on the super admin's own password.
--
-- Delegates the owner row to 0014's fn_staff_provision_owner rather than
-- inserting a credential by hand, so "how an owner credential is created" has
-- exactly one implementation and the forced first-sign-in change is guaranteed.
--
-- p_owner_password defaults to '1234' -- the desk default this phase standardises
-- on -- and the provisioner flags it password_must_change.
create or replace function public.fn_superadmin_create_tenant(
  p_identifier      text,
  p_password        text,
  p_name            text,
  p_slug            text,
  p_owner_name      text,
  p_owner_phone     text,
  p_tier            text default 'pro',
  p_owner_password  text default '1234'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin  jsonb;
  v_name   text := trim(coalesce(p_name, ''));
  v_slug   text;
  v_tier   text := lower(trim(coalesce(p_tier, 'pro')));
  v_phone  text;
  v_tenant uuid;
  v_owner  jsonb;
begin
  v_admin := public.fn_superadmin_verify_password(p_identifier, p_password);
  if v_admin is null then
    raise exception 'Unauthorized' using errcode = '45005';
  end if;

  if nullif(v_name, '') is null then
    raise exception 'Gym name is required.' using errcode = '22023';
  end if;

  if v_tier not in ('starter', 'pro', 'franchise') then
    raise exception 'subscription_tier must be starter, pro or franchise.' using errcode = '22023';
  end if;

  -- Same slug rule the console applied client-side, now enforced where it cannot
  -- be bypassed.
  v_slug := lower(coalesce(nullif(trim(coalesce(p_slug, '')), ''), v_name));
  v_slug := trim(both '-' from regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g'));

  if nullif(v_slug, '') is null then
    raise exception 'Gym name must contain at least one letter or number.' using errcode = '22023';
  end if;

  if exists (select 1 from public.tenants t where lower(coalesce(t.slug, '')) = v_slug) then
    raise exception 'A gym with the slug "%" already exists.', v_slug using errcode = '23505';
  end if;

  -- owner_name falls back to the gym name rather than being written as NULL: it
  -- is a display field on the console, and the live table may carry a NOT NULL
  -- constraint this repo has no migration for.
  insert into public.tenants (name, slug, owner_name, phone, subscription_tier, subscription_status)
  values (v_name,
          v_slug,
          coalesce(nullif(trim(coalesce(p_owner_name, '')), ''), v_name),
          nullif(trim(coalesce(p_owner_phone, '')), ''),
          v_tier,
          'active')
  returning id into v_tenant;

  -- Owner account. fn_staff_provision_owner validates the phone, hashes the first
  -- password and sets password_must_change = true. Called unconditionally: it is
  -- the only place that knows how a credential is written, and it already refuses
  -- a bad phone with a human-readable message.
  v_phone := nullif(trim(coalesce(p_owner_phone, '')), '');

  if v_phone is not null and nullif(trim(coalesce(p_owner_name, '')), '') is not null then
    v_owner := public.fn_staff_provision_owner(
      v_tenant,
      v_phone,
      p_owner_name,
      coalesce(nullif(trim(coalesce(p_owner_password, '')), ''), '1234')
    );
  else
    v_owner := null;
  end if;

  return jsonb_build_object(
    'ok',                 true,
    'tenant_id',          v_tenant,
    'slug',               v_slug,
    'owner_user_id',      v_owner->>'user_id',
    'owner_password_set', v_owner is not null
  );
end;
$$;

comment on function public.fn_superadmin_create_tenant(text, text, text, text, text, text, text, text) is
  'Creates a gym and its owner from the /super-admin console, authorised by the super admin password. Replaces the anon-key INSERT the browser used to run.';

commit;

begin;

-- 7c. SUSPEND / ACTIVATE a gym.
create or replace function public.fn_superadmin_set_subscription_status(
  p_identifier text,
  p_password   text,
  p_tenant_id  uuid,
  p_status     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin  jsonb;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  v_admin := public.fn_superadmin_verify_password(p_identifier, p_password);
  if v_admin is null then
    raise exception 'Unauthorized' using errcode = '45005';
  end if;

  if p_tenant_id is null then
    raise exception 'tenant_id is required.' using errcode = '22023';
  end if;

  if v_status not in ('active', 'suspended', 'trialing', 'expired') then
    raise exception 'subscription_status must be active, suspended, trialing or expired.'
      using errcode = '22023';
  end if;

  update public.tenants t
     set subscription_status = v_status
   where t.id = p_tenant_id;

  -- `not found` rather than a prior EXISTS: the UPDATE is the existence check, so
  -- there is no window between the two statements.
  if not found then
    raise exception 'Unknown gym' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'subscription_status', v_status);
end;
$$;

-- 7d. CHANGE BILLING TIER.
create or replace function public.fn_superadmin_set_subscription_tier(
  p_identifier text,
  p_password   text,
  p_tenant_id  uuid,
  p_tier       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin jsonb;
  v_tier  text := lower(trim(coalesce(p_tier, '')));
begin
  v_admin := public.fn_superadmin_verify_password(p_identifier, p_password);
  if v_admin is null then
    raise exception 'Unauthorized' using errcode = '45005';
  end if;

  if p_tenant_id is null then
    raise exception 'tenant_id is required.' using errcode = '22023';
  end if;

  if v_tier not in ('starter', 'pro', 'franchise') then
    raise exception 'subscription_tier must be starter, pro or franchise.' using errcode = '22023';
  end if;

  update public.tenants t
     set subscription_tier = v_tier
   where t.id = p_tenant_id;

  if not found then
    raise exception 'Unknown gym' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'subscription_tier', v_tier);
end;
$$;

commit;

begin;

-- =============================================================================
-- 8. fn_tenant_set_geofence -- the owner-side tenant write, moved off the anon
--    key so that section 9 can revoke `update` on public.tenants.
--
-- /api/hardware/geofence used to run `supabase.from('tenants').update({...})`
-- with the anon key. That is the SAME exposure as the super-admin writes: the
-- geofence columns are what the gate compares a member's position against, so
-- anyone bearing the anon key could switch enforcement off, or move the fence
-- onto their own doorstep and walk the turnstile from home.
--
-- Scope comes from the tenant id, which the route takes from the signed-in
-- session cookie and validates as a UUID before calling this (a non-UUID is a
-- hard 403, never an unscoped update). That is the trust model the owner console
-- already runs on -- see the header of the geofence route -- and it is now
-- enforced by a function that cannot be talked into touching any column other
-- than the four it names.
--
-- The validation below is a deliberate copy of the route's own checks. Duplicated
-- on purpose: the route gives the person at the desk a fast, specific message,
-- and this function is what actually guarantees the invariant for every caller,
-- including one that is not this route.
-- =============================================================================
create or replace function public.fn_tenant_set_geofence(
  p_tenant_id              uuid,
  p_latitude               double precision,
  p_longitude              double precision,
  p_geofence_radius_meters integer,
  p_enforce_geofence       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_name   text;
  v_radius integer := coalesce(p_geofence_radius_meters, 200);
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required.' using errcode = '22023';
  end if;

  -- Half a coordinate pair is the classic paste mistake and would leave the gate
  -- comparing a real latitude against a null longitude forever.
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'latitude and longitude must be saved together.' using errcode = '22023';
  end if;

  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    raise exception 'latitude must be between -90 and 90.' using errcode = '22023';
  end if;

  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'longitude must be between -180 and 180.' using errcode = '22023';
  end if;

  if v_radius < 10 or v_radius > 20000 then
    raise exception 'geofence_radius_meters must be between 10 and 20000.' using errcode = '22023';
  end if;

  -- Refusing to arm an unmarked gym is the difference between "geofence off" and
  -- "every member locked out", so it is a hard error rather than a silent no-op.
  if coalesce(p_enforce_geofence, false) and p_latitude is null then
    raise exception 'Save the gym coordinates before switching geofence enforcement on.'
      using errcode = '22023';
  end if;

  update public.tenants t
     set latitude               = p_latitude,
         longitude              = p_longitude,
         geofence_radius_meters = v_radius,
         enforce_geofence       = coalesce(p_enforce_geofence, false)
   where t.id = p_tenant_id
  returning t.name into v_name;

  if not found then
    raise exception 'Unknown gym' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok',                     true,
    'tenant_id',              p_tenant_id,
    'tenant_name',            v_name,
    'latitude',               p_latitude,
    'longitude',              p_longitude,
    'geofence_radius_meters', v_radius,
    'enforce_geofence',       coalesce(p_enforce_geofence, false)
  );
end;
$$;

comment on function public.fn_tenant_set_geofence(uuid, double precision, double precision, integer, boolean) is
  'Owner-side write of the four geofence columns on public.tenants. Replaces the browser UPDATE that ran with the anon key.';

commit;

begin;

-- =============================================================================
-- 9. Close the write path on public.tenants.
--
-- Every writer now has a function to go through:
--     create / suspend / re-tier  -> fn_superadmin_*        (super-admin password)
--     geofence columns            -> fn_tenant_set_geofence (validated tenant id)
--
-- So the anon key no longer needs -- and must no longer have -- INSERT, UPDATE or
-- DELETE on the platform table that decides which gyms exist and whether they are
-- switched on.
--
-- SELECT stays, and section 2e keeps the permissive `tenants_read` policy,
-- because the browser genuinely reads the gym directory (the console list,
-- lib/session.ts's tenant hydration, the geofence GET).
-- =============================================================================
revoke insert, update, delete, truncate on public.tenants from anon, authenticated;
grant  select on public.tenants to anon, authenticated;

commit;

begin;

-- =============================================================================
-- 10. Grants on the callable surface.
--
-- anon is intentional, not an oversight: this app authenticates against
-- public.gym_users rather than Supabase Auth, so the browser is permanently the
-- `anon` role and a `revoke ... from anon` would simply break the console. Each
-- function below performs its own credential check, so holding EXECUTE is not an
-- escalation -- it is the only way the flow can work.
-- =============================================================================
grant execute on function
  public.fn_superadmin_verify_password(text, text),
  public.fn_superadmin_list_tenants(),
  public.fn_superadmin_create_tenant(text, text, text, text, text, text, text, text),
  public.fn_superadmin_set_subscription_status(text, text, uuid, text),
  public.fn_superadmin_set_subscription_tier(text, text, uuid, text),
  public.fn_tenant_set_geofence(uuid, double precision, double precision, integer, boolean)
to anon, authenticated;

-- fn_staff_provision_owner is called BY fn_superadmin_create_tenant. Because that
-- caller is SECURITY DEFINER it already runs as the owner, so it needs no anon
-- grant -- and granting one would let an unauthenticated caller mint an owner
-- account directly, which is strictly worse than the anon-key tenant INSERT this
-- phase is removing.
revoke execute on function public.fn_staff_provision_owner(uuid, text, text, text)
  from public, anon, authenticated;

commit;

begin;

-- =============================================================================
-- 11. Verification.
--
-- Fails loudly rather than leaving a half-applied state that looks healthy from
-- the app. Each check mirrors a bug this phase exists to fix:
--
--   11a  0013 left credential columns on the public tables (the leak)
--   11b  0013's per-column grant broke select('*'), and a missing policy made RLS
--        return zero rows instead of erroring
--   11c  the anon key could write the platform table
--   11d  there was no platform identity to sign in as
-- =============================================================================
do $$
declare
  v_bad   text[] := array[]::text[];
  v_count bigint;
begin
  -- 11a. No credential column may live on a PostgREST-served table.
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('members', 'gym_users')
     and column_name in ('password_hash', 'password_changed_at', 'password_must_change',
                         'pin_code', 'totp_secret', 'access_pin');
  if v_count > 0 then
    v_bad := array_append(v_bad, format('%s secret column(s) still on a public table', v_count));
  end if;

  -- 11b. select('*') must be possible again (42501 regression guard), and RLS
  --      must not be silently zeroing rows (no-policy regression guard).
  if not has_table_privilege('anon', 'public.members', 'SELECT') then
    v_bad := array_append(v_bad, 'anon cannot SELECT public.members in full');
  end if;
  if not has_table_privilege('anon', 'public.tenants', 'SELECT') then
    v_bad := array_append(v_bad, 'anon cannot SELECT public.tenants in full');
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'members'
                    and policyname = 'members_read') then
    v_bad := array_append(v_bad, 'policy members_read is missing (RLS would return 0 rows)');
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'gym_users'
                    and policyname = 'gym_users_read') then
    v_bad := array_append(v_bad, 'policy gym_users_read is missing (RLS would return 0 rows)');
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'tenants'
                    and policyname = 'tenants_read') then
    v_bad := array_append(v_bad, 'policy tenants_read is missing (RLS would return 0 rows)');
  end if;

  -- 11c. The anon key must no longer be able to write the platform table.
  if has_table_privilege('anon', 'public.tenants', 'INSERT')
     or has_table_privilege('anon', 'public.tenants', 'UPDATE')
     or has_table_privilege('anon', 'public.tenants', 'DELETE') then
    v_bad := array_append(v_bad, 'anon can still write public.tenants with the public key');
  end if;

  -- 11d. The super admin must exist AND be able to sign in.
  select count(*) into v_count from public.gym_users where coalesce(role, '') = 'super_admin';
  if v_count = 0 then
    v_bad := array_append(v_bad, 'no super_admin row exists in public.gym_users');
  end if;

  select count(*) into v_count
    from public.gym_users u
    join private.staff_credentials c on c.user_id = u.id
   where coalesce(u.role, '') = 'super_admin' and c.password_hash is not null;
  if v_count = 0 then
    v_bad := array_append(v_bad, 'the super_admin has no usable password');
  end if;

  if cardinality(v_bad) > 0 then
    raise exception 'Phase 15 verification failed: %', array_to_string(v_bad, '; ');
  end if;

  raise notice 'Phase 15 applied cleanly.';
end $$;

commit;

begin;

-- -----------------------------------------------------------------------------
-- 11e. REPORT-ONLY SUMMARY -- an intentional scope boundary, stated not hidden.
--
-- public.members and public.gym_users still accept INSERT/UPDATE/DELETE from the
-- anon key, because the owner console, the POS, the enrolment form and the CRM
-- all write them directly today. Locking those down means moving every one of
-- those writes behind a tenant-checked function; doing that in the same migration
-- as the credential work would bundle two very different risk profiles into one
-- change. Phase 14 made the same call, for the same reason.
--
-- Section 9 fixes the table that is different in KIND: `tenants` decides which
-- gyms exist and whether they are switched ON, so an anon-key write there is a
-- platform-level compromise rather than a single-gym data edit.
--
-- These notices are the operator's checklist. They do NOT fail the migration,
-- because a genuinely empty database would trip them.
-- -----------------------------------------------------------------------------
do $$
declare
  v_no_cred  bigint;
  v_no_staff bigint;
begin
  select count(*) into v_no_cred
    from public.members m
   where not exists (
     select 1 from private.member_credentials c
      where c.member_id = m.id and c.password_hash is not null
   );
  if v_no_cred > 0 then
    raise notice
      'Phase 15 notice: % member(s) still have no credential. A NULL hash cannot sign in; section 4 covers every row that existed when this ran.',
      v_no_cred;
  end if;

  select count(*) into v_no_staff
    from public.gym_users u
   where coalesce(u.role, '') <> 'super_admin'
     and not exists (
       select 1 from private.staff_credentials c
        where c.user_id = u.id and c.password_hash is not null
     );
  if v_no_staff > 0 then
    raise notice 'Phase 15 notice: % staff account(s) still have no credential.', v_no_staff;
  end if;

  raise notice
    'Phase 15 complete. Default credentials -- members/owners 1234, super admin admin1234 -- all flagged password_must_change = true, so /setup-password forces a replacement at first sign-in.';
end $$;

commit;

-- =============================================================================
-- OPERATOR RESET SNIPPET -- commented out on purpose.
--
-- Uncomment and run ONLY to force a new super-admin password, e.g. the existing
-- one is genuinely lost. The migration itself never does this, because replacing
-- a live platform credential on every run would be indefensible.
--
--   update private.staff_credentials
--      set password_hash        = crypt('admin1234', gen_salt('bf')),
--          password_changed_at  = now(),
--          password_must_change = true
--    where user_id = (select id from public.gym_users where role = 'super_admin' limit 1);
-- =============================================================================

