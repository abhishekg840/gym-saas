begin;

-- =============================================================================
-- Phase 14 -- privilege + RLS repair, and credential isolation.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Phase 13 (0013_phase13_real_credentials.sql) introduced real bcrypt
-- credentials and, in the same breath, three defects that broke sign-in and the
-- Member Smart Pass while leaving the database MORE exposed than before:
--
--   1. It ran `revoke select on public.members from anon, authenticated` and
--      then granted a hand-picked SUBSET of columns. Postgres evaluates
--      privileges per referenced column, so select('*') -- and any query naming
--      a column outside that list, such as the amount_paid and
--      total_freeze_days selected by /api/member/pass -- fails the WHOLE query
--      with SQLSTATE 42501 "permission denied for table members". No grant-only
--      fix can resolve this: '*' expands to every column, so a table that must
--      answer select('*') cannot also hide one.
--
--   2. It enabled RLS on `members` but created a policy only for `gym_users`.
--      With RLS enabled and no matching policy, Postgres returns ZERO rows, so
--      even the columns it had granted were invisible. The pass silently
--      answered "no membership found" instead of erroring.
--
--   3. It created the verifier functions with `set search_path = public,
--      pg_temp`. On Supabase pgcrypto is installed in the `extensions` schema,
--      so crypt() / gen_salt() are unresolvable inside those functions and
--      every call fails with:
--          42883  function crypt(text, text) does not exist
--      /api/auth/login matched the words "does not exist" and reported
--      "migration 0013 has not been applied" -- blaming a migration that was in
--      fact applied and sending the operator to re-run a file that could not
--      possibly help.
--
--   4. Net effect on exposure: with the column-level revoke not actually in
--      force, the anon key could read gym_users.password_hash, the PLAINTEXT
--      gym_users.pin_code, and members.totp_secret / access_pin straight out of
--      PostgREST. That is exactly the leak Phase 13 set out to close.
--
-- THE FIX
-- -------
-- Secrets move OUT of the exposed tables and INTO a `private` schema that
-- PostgREST does not serve. With password_hash (and every other plaintext or
-- hashed secret) gone from public, the public tables are safe to grant in FULL,
-- so select('*') works again for every existing query. The verifiers keep
-- reading and writing credentials through SECURITY DEFINER functions, now with a
-- search_path that includes `extensions` so crypt() resolves.
--
-- Run once. Safe to re-run: every step is guarded or idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. pgcrypto must be present AND reachable from the functions below.
--    `create extension if not exists` is a no-op when it already exists (the
--    normal Supabase case: installed in `extensions`). If it was never
--    installed, this creates it there.
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

-- `set search_path = public, extensions, pg_temp` (used below) resolves crypt()
-- whether pgcrypto lives in `extensions` (Supabase default) or `public` (a
-- self-hosted install). Naming a schema that does not exist is not an error in
-- Postgres, so this is safe everywhere.

-- -----------------------------------------------------------------------------
-- 0b. Make this file self-sufficient.
--
-- Section 2 reads password_hash / pin_code / password_must_change off the public
-- tables before dropping them. Those columns were introduced by 0013, so on an
-- install that somehow has them missing the copy would abort. Recreating them
-- first makes 0014 runnable on its own, and they are dropped again in section 3
-- -- so nothing observable is left behind.
-- -----------------------------------------------------------------------------
alter table public.gym_users
  add column if not exists password_hash         text        null,
  add column if not exists password_changed_at   timestamptz null,
  add column if not exists password_must_change  boolean     not null default false;

alter table public.members
  add column if not exists password_hash         text        null,
  add column if not exists password_changed_at   timestamptz null,
  add column if not exists password_must_change  boolean     not null default false;

-- 0013 also created the four verifier functions with a search_path that cannot
-- resolve crypt(). Dropping them means section 6 recreates them correctly rather
-- than leaving a `create or replace` against a body this file is already
-- rewriting. The `if exists` keeps this safe if they were never created.
drop function if exists public.fn_staff_verify_password(text, text);
drop function if exists public.fn_member_verify_password(text, text);
drop function if exists public.fn_member_set_password(uuid, text, text, text);
drop function if exists public.fn_staff_set_password(uuid, text, text, text);
drop function if exists public.fn_member_issue_temp_password(text, text, uuid, text);

-- =============================================================================
-- 1. Private schema -- credential storage that PostgREST never serves.
-- =============================================================================
create schema if not exists private;

-- Revoke USAGE first. Without USAGE on the schema nothing inside is reachable
-- even if a table grant were ever added by mistake.
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

-- No privileges for anyone, and RLS enabled with NO policies. RLS-with-no-policy
-- denies every row even if a GRANT is added later by mistake.
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

-- =============================================================================
-- 2. Carry the existing credentials across BEFORE dropping anything.
-- =============================================================================

-- 2a. Member credentials. The coalesce(excluded, existing) in the conflict clause
--     means a re-run can never blank a hash that is already stored.
insert into private.member_credentials (member_id, password_hash, password_changed_at, password_must_change)
select m.id, m.password_hash, m.password_changed_at, coalesce(m.password_must_change, false)
  from public.members m
 where m.password_hash is not null
    or coalesce(m.password_must_change, false)
on conflict (member_id) do update
   set password_hash        = coalesce(excluded.password_hash, private.member_credentials.password_hash),
       password_changed_at  = coalesce(excluded.password_changed_at, private.member_credentials.password_changed_at),
       password_must_change = excluded.password_must_change;

-- 2b. Staff credentials, plus the one-time PIN -> bcrypt upgrade for any account
--     that never received a hash. pin_code is a PLAINTEXT secret, so this both
--     preserves access and removes the plaintext column in section 3.
insert into private.staff_credentials (user_id, password_hash, password_changed_at, password_must_change)
select u.id,
       case
         when u.password_hash is not null then u.password_hash
         when u.pin_code is not null and trim(u.pin_code) <> '' then crypt(u.pin_code, gen_salt('bf'))
         else null
       end,
       coalesce(u.password_changed_at,
                case when u.pin_code is not null and trim(u.pin_code) <> '' then now() end),
       coalesce(u.password_must_change, false)
         or (u.password_hash is null and u.pin_code is not null and trim(u.pin_code) <> '')
  from public.gym_users u
 where u.password_hash is not null
    or coalesce(u.password_must_change, false)
    or (u.pin_code is not null and trim(u.pin_code) <> '')
on conflict (user_id) do update
   set password_hash        = coalesce(excluded.password_hash, private.staff_credentials.password_hash),
       password_changed_at  = coalesce(excluded.password_changed_at, private.staff_credentials.password_changed_at),
       password_must_change = excluded.password_must_change;

-- =============================================================================
-- 3. Remove the secrets from the PostgREST-exposed tables.
--
-- These are the columns that made select('*') unsafe. password_hash,
-- password_changed_at and password_must_change now live in
-- private.*_credentials; pin_code, totp_secret and access_pin are plaintext
-- secrets with no remaining reader and are destroyed outright.
--
-- password_setup_completed is deliberately KEPT on members: it is a non-secret
-- UI flag that /api/member/account and fn_member_security_state both read.
-- =============================================================================
alter table public.members drop column if exists password_hash;
alter table public.members drop column if exists password_changed_at;
alter table public.members drop column if exists password_must_change;

alter table public.gym_users drop column if exists password_hash;
alter table public.gym_users drop column if exists password_changed_at;
alter table public.gym_users drop column if exists password_must_change;

-- Plaintext secrets. Nothing in the app reads these any more; keeping them
-- would keep the Phase 13 leak open on every select('*').
alter table public.gym_users drop column if exists pin_code;
alter table public.members drop column if exists totp_secret;
alter table public.members drop column if exists access_pin;

-- =============================================================================
-- 4. Privileges: grant the PUBLIC tables in full.
--
-- This is safe now, and it is what makes select('*') work again. The prior
-- column-subset grant is revoked first so no stale ACL entry survives, then a
-- single table-level grant replaces it.
-- =============================================================================
revoke select on public.members   from anon, authenticated;
revoke select on public.gym_users from anon, authenticated;

grant select on public.members   to anon, authenticated;
grant select on public.gym_users to anon, authenticated;

-- =============================================================================
-- 5. RLS: permissive SELECT policies so RLS stops zeroing out every row.
--
-- members previously had RLS enabled and NO policy, which made the table read as
-- empty to anon. These are the two policies named in the fix brief, plus the
-- gym_users equivalent so both tables behave identically.
--
-- Deliberately SELECT-only. Adding permissive INSERT/UPDATE/DELETE policies here
-- would let anyone holding the public anon key edit or delete members -- a far
-- worse outcome than the bug being fixed.
-- =============================================================================
alter table public.members   enable row level security;
alter table public.gym_users enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'members' and policyname = 'members_read'
  ) then
    create policy members_read on public.members
      for select to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'gym_users' and policyname = 'gym_users_read'
  ) then
    create policy gym_users_read on public.gym_users
      for select to anon, authenticated
      using (true);
  end if;
end $$;

-- The Phase 13 policy name (gym_users_directory_read) is superseded by
-- gym_users_read. Drop it so there is exactly one SELECT policy per table.
drop policy if exists gym_users_directory_read on public.gym_users;

-- =============================================================================
-- 6. Recreate the Phase 13 functions against private.*_credentials.
--
-- Same signatures, same JSON contract, same NULL-means-wrong-credential rule, so
-- /api/auth/login, /api/auth/set-password and /api/auth/issue-temp-password keep
-- working untouched. Three changes, all load-bearing:
--
--   a) search_path now includes extensions, so crypt() resolves. This is the
--      42883 fix.
--   b) credentials are read from private.*_credentials, never from the
--      anon-readable public tables.
--   c) `v_row public.members%rowtype` became an explicit column list, so the
--      functions no longer depend on the public row shape at all.
-- =============================================================================

create or replace function public.fn_staff_verify_password(
  p_identifier text,
  p_password   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_pw   text := coalesce(p_password, '');
  v_hash text;
  v_row  record;
begin
  if nullif(trim(coalesce(p_identifier, '')), '') is null or v_pw = '' then
    return null;
  end if;

  select u.id, u.tenant_id, u.full_name, u.phone, u.email, u.role,
         c.password_hash, coalesce(c.password_must_change, false)
    into v_row
    from public.gym_users u
    left join private.staff_credentials c on c.user_id = u.id
   where u.phone = trim(p_identifier)
      or lower(trim(u.email)) = lower(trim(p_identifier))
      or u.id::text = trim(p_identifier)
   limit 1;

  if v_row.id is null then return null; end if;

  v_hash := v_row.password_hash;
  -- NULL and a bcrypt mismatch are deliberately the SAME answer: this function
  -- must not distinguish "no such account" from "wrong password".
  if v_hash is null or (crypt(v_pw, v_hash) = v_hash) is not true then
    return null;
  end if;

  return jsonb_build_object(
    'user_id',              v_row.id,
    'full_name',            v_row.full_name,
    'phone',                v_row.phone,
    'email',                v_row.email,
    'role',                 v_row.role,
    'tenant_id',            v_row.tenant_id,
    'password_must_change', coalesce(v_row.password_must_change, false)
  );
end;
$$;

create or replace function public.fn_member_verify_password(
  p_identifier text,
  p_password   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_pw   text := coalesce(p_password, '');
  v_hash text;
  v_row  record;
begin
  if nullif(trim(coalesce(p_identifier, '')), '') is null or v_pw = '' then
    return null;
  end if;

  select m.id, m.full_name, m.phone, m.email, m.username, m.tenant_id,
         m.password_setup_completed,
         c.password_hash, coalesce(c.password_must_change, false)
    into v_row
    from public.members m
    left join private.member_credentials c on c.member_id = m.id
   where m.phone = trim(p_identifier)
      or lower(trim(m.username)) = lower(replace(trim(p_identifier), '@', ''))
      or lower(trim(coalesce(m.email, ''))) = lower(trim(p_identifier))
   limit 1;

  if v_row.id is null then return null; end if;

  v_hash := v_row.password_hash;
  if v_hash is null or (crypt(v_pw, v_hash) = v_hash) is not true then
    return null;
  end if;

  return jsonb_build_object(
    'member_id',                v_row.id,
    'full_name',                v_row.full_name,
    'phone',                    v_row.phone,
    'email',                    v_row.email,
    'username',                 v_row.username,
    'tenant_id',                v_row.tenant_id,
    'password_must_change',     coalesce(v_row.password_must_change, false),
    'password_setup_completed', coalesce(v_row.password_setup_completed, false)
  );
end;
$$;

create or replace function public.fn_member_set_password(
  p_member_id        uuid,
  p_current_password text,
  p_new_password     text,
  p_confirm          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash    text;
  v_current text;
  v_new     text := coalesce(p_new_password, '');
begin
  if p_member_id is null then raise exception 'member_id is required' using errcode = '22023'; end if;

  if not exists (select 1 from public.members m where m.id = p_member_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if octet_length(v_new) < 8 or octet_length(v_new) > 72 then
    raise exception 'Password must be 8-72 characters.' using errcode = '22023';
  end if;
  if v_new !~ '[A-Za-z]' or v_new !~ '[0-9]' then
    raise exception 'Include at least one letter and one number.' using errcode = '22023';
  end if;
  if p_confirm is not null and v_new <> p_confirm then
    raise exception 'Passwords do not match.' using errcode = '22023';
  end if;

  select c.password_hash into v_hash
    from private.member_credentials c where c.member_id = p_member_id;

  v_current := coalesce(p_current_password, '');
  if v_hash is not null then
    if v_current = '' or (crypt(v_current, v_hash) = v_hash) is not true then
      raise exception 'Current password incorrect.' using errcode = '45009';
    end if;
  end if;

  insert into private.member_credentials (member_id, password_hash, password_changed_at, password_must_change)
  values (p_member_id, crypt(v_new, gen_salt('bf')), now(), false)
  on conflict (member_id) do update
     set password_hash        = excluded.password_hash,
         password_changed_at  = excluded.password_changed_at,
         password_must_change = false;

  update public.members set password_setup_completed = true where id = p_member_id;

  return jsonb_build_object('ok', true, 'member_id', p_member_id, 'password_setup_completed', true);
end;
$$;

create or replace function public.fn_staff_set_password(
  p_user_id          uuid,
  p_current_password text,
  p_new_password     text,
  p_confirm          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash    text;
  v_current text;
  v_new     text := coalesce(p_new_password, '');
begin
  if p_user_id is null then raise exception 'user_id is required' using errcode = '22023'; end if;

  if not exists (select 1 from public.gym_users u where u.id = p_user_id) then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  if octet_length(v_new) < 8 or octet_length(v_new) > 72 then
    raise exception 'Password must be 8-72 characters.' using errcode = '22023';
  end if;
  if v_new !~ '[A-Za-z]' or v_new !~ '[0-9]' then
    raise exception 'Include at least one letter and one number.' using errcode = '22023';
  end if;
  if p_confirm is not null and v_new <> p_confirm then
    raise exception 'Passwords do not match.' using errcode = '22023';
  end if;

  select c.password_hash into v_hash
    from private.staff_credentials c where c.user_id = p_user_id;

  v_current := coalesce(p_current_password, '');
  if v_hash is not null then
    if v_current = '' or (crypt(v_current, v_hash) = v_hash) is not true then
      raise exception 'Current password incorrect.' using errcode = '45009';
    end if;
  end if;

  insert into private.staff_credentials (user_id, password_hash, password_changed_at, password_must_change)
  values (p_user_id, crypt(v_new, gen_salt('bf')), now(), false)
  on conflict (user_id) do update
     set password_hash        = excluded.password_hash,
         password_changed_at  = excluded.password_changed_at,
         password_must_change = false;

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end;
$$;

create or replace function public.fn_member_issue_temp_password(
  p_owner_identifier text,
  p_owner_password   text,
  p_member_id        uuid,
  p_temp_password    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_owner  jsonb;
  v_tenant uuid;
  v_temp   text := coalesce(p_temp_password, '');
begin
  if p_member_id is null then raise exception 'member_id is required' using errcode = '22023'; end if;

  v_owner := public.fn_staff_verify_password(p_owner_identifier, p_owner_password);
  if v_owner is null or coalesce(v_owner->>'role', '') not in ('owner', 'super_admin') then
    raise exception 'Unauthorized' using errcode = '45005';
  end if;

  v_tenant := nullif(v_owner->>'tenant_id', '')::uuid;

  if not exists (
    select 1 from public.members m where m.id = p_member_id and m.tenant_id is not distinct from v_tenant
  ) then
    raise exception 'Member not found in your gym' using errcode = 'P0002';
  end if;

  if v_temp = '' or octet_length(v_temp) > 72 then
    raise exception 'Invalid temp password' using errcode = '22023';
  end if;

  insert into private.member_credentials (member_id, password_hash, password_changed_at, password_must_change)
  values (p_member_id, crypt(v_temp, gen_salt('bf')), now(), true)
  on conflict (member_id) do update
     set password_hash        = excluded.password_hash,
         password_changed_at  = excluded.password_changed_at,
         password_must_change = true;

  update public.members set password_setup_completed = false where id = p_member_id;

  return jsonb_build_object('ok', true, 'member_id', p_member_id);
end;
$$;

-- =============================================================================
-- 7. Owner provisioning.
--
-- /super-admin used to INSERT into gym_users with a plaintext pin_code, which
-- meant writing a credential through the public anon key. That column is gone,
-- so creation moves behind this SECURITY DEFINER function: the caller supplies a
-- first password, it is hashed with the same bcrypt the verifiers use, and the
-- owner is forced to change it at first sign-in.
--
-- password_must_change = true on purpose -- an owner created from a console form
-- should not keep a password the super admin typed on their behalf.
-- =============================================================================
create or replace function public.fn_staff_provision_owner(
  p_tenant_id     uuid,
  p_phone         text,
  p_full_name     text,
  p_temp_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_phone text;
  v_pass  text := coalesce(p_temp_password, '');
  v_user  uuid;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_phone) > 10 then v_phone := right(v_phone, 10); end if;

  if length(v_phone) <> 10 then
    raise exception 'A 10-digit owner phone number is required.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Owner name is required.' using errcode = '22023';
  end if;
  if octet_length(v_pass) < 4 or octet_length(v_pass) > 72 then
    raise exception 'Initial password must be 4-72 characters.' using errcode = '22023';
  end if;
  if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Unknown gym' using errcode = 'P0002';
  end if;

  insert into public.gym_users (tenant_id, phone, full_name, role)
  values (p_tenant_id, v_phone, trim(p_full_name), 'owner')
  returning id into v_user;

  insert into private.staff_credentials (user_id, password_hash, password_changed_at, password_must_change)
  values (v_user, crypt(v_pass, gen_salt('bf')), now(), true);

  return jsonb_build_object('ok', true, 'user_id', v_user, 'password_must_change', true);
end;
$$;

comment on function public.fn_staff_provision_owner(uuid, text, text, text) is
  'Creates a gym owner with a bcrypt-hashed first password, forced to change at first sign-in. Replaces the anon-key INSERT that wrote a plaintext pin_code.';

-- =============================================================================
-- 8. Grants on the callable surface.
-- =============================================================================
grant execute on function
  public.fn_staff_verify_password(text, text),
  public.fn_member_verify_password(text, text),
  public.fn_member_set_password(uuid, text, text, text),
  public.fn_staff_set_password(uuid, text, text, text),
  public.fn_member_issue_temp_password(text, text, uuid, text),
  public.fn_staff_provision_owner(uuid, text, text, text)
to anon, authenticated;

-- =============================================================================
-- 9. Verification -- fail the migration loudly rather than leaving a
--    half-repaired database behind. Each check names the symptom it prevents.
-- =============================================================================
do $$
declare
  v_bad text[] := array[]::text[];
begin
  -- (a) select('*') must not hit 42501 on either table.
  if not has_table_privilege('anon', 'public.members', 'SELECT') then
    v_bad := array_append(v_bad, 'anon still cannot SELECT the whole members table');
  end if;
  if not has_table_privilege('anon', 'public.gym_users', 'SELECT') then
    v_bad := array_append(v_bad, 'anon still cannot SELECT the whole gym_users table');
  end if;

  -- (b) The permissive SELECT policies must exist, or RLS returns zero rows and
  --     the Member Smart Pass silently finds nobody.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='members' and policyname='members_read') then
    v_bad := array_append(v_bad, 'policy members_read is missing (RLS would return 0 rows)');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gym_users' and policyname='gym_users_read') then
    v_bad := array_append(v_bad, 'policy gym_users_read is missing (RLS would return 0 rows)');
  end if;

  -- (c) No credential column may remain on an anon-readable table.
  if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name in ('members','gym_users')
                 and column_name in ('password_hash','password_changed_at','pin_code','totp_secret','access_pin')) then
    v_bad := array_append(v_bad, 'a credential column still exists on public.members / public.gym_users');
  end if;

  -- (d) The credentials themselves must have survived the move.
  if not exists (select 1 from private.staff_credentials where password_hash is not null) then
    v_bad := array_append(v_bad, 'no staff credential survived the move to private.staff_credentials');
  end if;

  -- (e) The whole point: crypt() must resolve inside the verifiers. proconfig is
  --     the authoritative record of a function's SET clause, so this fails if a
  --     future edit ever drops extensions from the search_path again.
  if not exists (
    select 1
      from pg_proc p
      join unnest(coalesce(p.proconfig, array[]::text[])) as cfg(cfg) on true
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'fn_staff_verify_password'
       and cfg like 'search_path=%extensions%'
  ) then
    v_bad := array_append(v_bad, 'fn_staff_verify_password search_path does not include extensions (crypt() would 42883)');
  end if;

  if cardinality(v_bad) > 0 then
    raise exception 'Phase 14 verification failed: %', array_to_string(v_bad, '; ');
  end if;

  raise notice 'Phase 14 applied cleanly: secrets isolated, select(*) restored, RLS policies in place.';
end $$;

commit;
