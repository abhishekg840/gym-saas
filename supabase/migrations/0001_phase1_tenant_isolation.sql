-- =====================================================================
-- ForgeOS :: Phase 1 — Core Commercial MVP & Strict Multi-Tenant Isolation
-- File   : supabase/migrations/0001_phase1_tenant_isolation.sql
-- Target : PostgreSQL 15+ (Supabase)
-- Mode   : IDEMPOTENT — every statement is safe to re-run.
--
-- Contents
--   1. tenant_id column + FK + indexes on members / plans / attendances / invoices
--   2. Backfill of tenant_id from existing ownership relations
--   3. members: drop global uniques on (biometric_id)/(phone), add composite uniques
--   4. members: membership freeze columns
--   5. membership_transfers audit table
--   6. Transactional RPCs used by /api/membership/actions
--   7. Post-flight verification (read-only)
--
-- SECURITY NOTE
--   The client currently uses the anon key with an application-level session,
--   so tenant scoping is enforced by (a) mandatory .eq('tenant_id', ...) filters
--   in the data layer and (b) tenant re-validation inside the RPCs below.
--   Turning on RLS is a Phase-2 task requiring Supabase Auth sessions first —
--   enabling it now would break every existing query. See section 8.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists "pgcrypto";
exception
  when others then
    raise notice 'pgcrypto not created (already present / insufficient privileges): %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 1a. tenant_id columns
-- ---------------------------------------------------------------------
alter table if exists public.members      add column if not exists tenant_id uuid;
alter table if exists public.plans        add column if not exists tenant_id uuid;
alter table if exists public.attendances  add column if not exists tenant_id uuid;
alter table if exists public.invoices     add column if not exists tenant_id uuid;

-- ---------------------------------------------------------------------
-- 1b. Foreign keys -> public.tenants(id) on delete cascade
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['members', 'plans', 'attendances', 'invoices'] loop
    if exists (select 1 from pg_class where oid = ('public.' || t)::regclass)
       and not exists (
         select 1 from pg_constraint
         where conrelid = ('public.' || t)::regclass
           and conname  = t || '_tenant_id_fkey'
       ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id) on delete cascade',
        t, t || '_tenant_id_fkey'
      );
      raise notice 'FK added: %.%', t, t || '_tenant_id_fkey';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1c. Tenant-scoped indexes (every hot path filters by tenant_id)
-- ---------------------------------------------------------------------
create index if not exists idx_members_tenant            on public.members (tenant_id);
create index if not exists idx_members_tenant_bio        on public.members (tenant_id, biometric_id);
create index if not exists idx_members_tenant_end        on public.members (tenant_id, membership_end);
create index if not exists idx_plans_tenant              on public.plans (tenant_id);
create index if not exists idx_attendances_tenant_punch  on public.attendances (tenant_id, punch_time desc);
create index if not exists idx_attendances_tenant_member on public.attendances (tenant_id, member_id);
create index if not exists idx_invoices_tenant_issued    on public.invoices (tenant_id, issued_at desc);
create index if not exists idx_invoices_tenant_member    on public.invoices (tenant_id, member_id);


-- ---------------------------------------------------------------------
-- 1d. Membership freeze columns on members
-- ---------------------------------------------------------------------
alter table if exists public.members
  add column if not exists is_frozen         boolean not null default false,
  add column if not exists freeze_start_date date    null,
  add column if not exists freeze_end_date   date    null,
  add column if not exists total_freeze_days integer not null default 0;

-- Keep freeze bookkeeping coherent even for hand-written SQL edits.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.members'::regclass
      and conname  = 'members_freeze_window_check'
  ) then
    alter table public.members
      add constraint members_freeze_window_check
      check (
        freeze_end_date is null
        or freeze_start_date is null
        or freeze_end_date >= freeze_start_date
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.members'::regclass
      and conname  = 'members_total_freeze_days_check'
  ) then
    alter table public.members
      add constraint members_total_freeze_days_check
      check (total_freeze_days >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Backfill tenant_id
--    a) attendances / invoices inherit the tenant of their member.
--    b) members / plans: in a single-tenant deployment legacy rows belong to
--       that one tenant. With >1 tenant we refuse to guess rather than
--       silently corrupt isolation, and report the orphans instead.
-- ---------------------------------------------------------------------
update public.attendances a
   set tenant_id = m.tenant_id
  from public.members m
 where a.tenant_id is null
   and a.member_id = m.id
   and m.tenant_id is not null;

update public.invoices i
   set tenant_id = m.tenant_id
  from public.members m
 where i.tenant_id is null
   and i.member_id = m.id
   and m.tenant_id is not null;

do $$
declare
  v_tenant_count  integer;
  v_single_tenant uuid;
  v_orphans       integer;
begin
  select count(*) into v_tenant_count from public.tenants;

  if v_tenant_count = 1 then
    select id into v_single_tenant from public.tenants limit 1;

    update public.members set tenant_id = v_single_tenant where tenant_id is null;
    update public.plans   set tenant_id = v_single_tenant where tenant_id is null;
    raise notice 'Single-tenant bootstrap: assigned tenant % to orphan members/plans', v_single_tenant;
  else
    select count(*) into v_orphans from public.members where tenant_id is null;
    raise notice 'Multi-tenant DB (% tenants). Orphan members left NULL: % row(s).', v_tenant_count, v_orphans;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3a. members: drop GLOBAL uniqueness on biometric_id / phone.
--     Covers both table constraints and standalone unique indexes, because
--     "unique" in Supabase projects is frequently created as an index only.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname as objname
      from pg_constraint c
     where c.conrelid = 'public.members'::regclass
       and c.contype  = 'u'
       and cardinality(c.conkey) = 1
       and (
             select a.attname
               from pg_attribute a
              where a.attrelid = 'public.members'::regclass
                and a.attnum   = c.conkey[1]
           ) in ('biometric_id', 'phone')
  loop
    execute format('alter table public.members drop constraint %I', r.objname);
    raise notice 'Dropped global unique constraint: %', r.objname;
  end loop;

  for r in
    select ic.relname as objname
      from pg_index     i
      join pg_class     ic on ic.oid = i.indexrelid
      join pg_attribute a  on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     where i.indrelid   = 'public.members'::regclass
       and i.indisunique
       and cardinality(i.indkey::int[]) = 1
       and a.attname in ('biometric_id', 'phone')
       and not exists (select 1 from pg_constraint pc where pc.conindid = i.indexrelid)
  loop
    execute format('drop index if exists public.%I', r.objname);
    raise notice 'Dropped global unique index: %', r.objname;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3b. members: composite (tenant_id, ...) uniqueness.
--     Partial so that members without a biometric slot (NULL) never collide.
--     If live data already violates these, we surface the offenders instead of
--     deleting a gym's member records.
-- ---------------------------------------------------------------------
do $$
begin
  create unique index members_tenant_biometric_id_key
    on public.members (tenant_id, biometric_id)
    where biometric_id is not null;
exception
  when duplicate_table then
    raise notice 'Index members_tenant_biometric_id_key already exists — skipped.';
  when unique_violation then
    raise exception
      'Cannot create UNIQUE(tenant_id, biometric_id): duplicate biometric slots inside one gym. '
      || 'Resolve them, then re-run this migration. Offenders: %',
      (select string_agg('tenant ' || left(tenant_id::text, 8) || ' / slot ' || biometric_id || ' / ' || full_name, ' | ')
         from (select tenant_id, biometric_id, min(full_name) as full_name
                 from public.members
                where biometric_id is not null and tenant_id is not null
                group by tenant_id, biometric_id
               having count(*) > 1) d);
end $$;

do $$
begin
  create unique index members_tenant_phone_key
    on public.members (tenant_id, phone)
    where phone is not null and phone <> '';
exception
  when duplicate_table then
    raise notice 'Index members_tenant_phone_key already exists — skipped.';
  when unique_violation then
    raise exception
      'Cannot create UNIQUE(tenant_id, phone): duplicate phone numbers inside one gym. '
      || 'Resolve them, then re-run this migration. Offenders: %',
      (select string_agg('tenant ' || left(tenant_id::text, 8) || ' / ' || phone || ' x' || c, ' | ')
         from (select tenant_id, phone, count(*) as c
                 from public.members
                where phone is not null and phone <> '' and tenant_id is not null
                group by tenant_id, phone
               having count(*) > 1) d);
end $$;

-- ---------------------------------------------------------------------
-- 4. membership_transfers audit table
-- ---------------------------------------------------------------------
create table if not exists public.membership_transfers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants(id)  on delete cascade,
  from_member_id   uuid references public.members(id)  on delete set null,
  to_name          text,
  to_phone         text,
  transferred_days integer,
  transferred_at   timestamptz not null default now()
);

create index if not exists idx_membership_transfers_tenant on public.membership_transfers (tenant_id, transferred_at desc);
create index if not exists idx_membership_transfers_from   on public.membership_transfers (from_member_id);

-- ---------------------------------------------------------------------
-- 5. members.status: widen (or create) the CHECK so 'frozen' and
--    'transferred' are legal. Existing distinct values are preserved so we
--    never invalidate data a gym already recorded under another label.
-- ---------------------------------------------------------------------
do $$
declare
  r          record;
  v_allowed  text;
  v_cols     text[];
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.members'::regclass
       and c.contype  = 'c'
       and c.conname ilike '%status%'
  loop
    execute format('alter table public.members drop constraint %I', r.conname);
    raise notice 'Dropped legacy status check: %', r.conname;
  end loop;

  select array_agg(distinct s order by s)
    into v_cols
    from (select unnest(array['active', 'expired', 'inactive', 'frozen', 'transferred']) as s
          union
          select distinct coalesce(status, 'active') from public.members) s;

  v_allowed := 'check (status = any (array[' ||
               (select string_agg(quote_literal(x), ', ') from unnest(v_cols) x) ||
               ']))';

  execute 'alter table public.members add constraint members_status_check ' || v_allowed;
  raise notice 'members_status_check rebuilt as: %', v_allowed;
end $$;

-- ---------------------------------------------------------------------
-- 6a. fn_freeze_membership
--     Locks the row, re-validates tenant ownership inside the DB, and refuses
--     a double-freeze. Returns the mutated row as jsonb for the UI.
-- ---------------------------------------------------------------------
create or replace function public.fn_freeze_membership(
  p_member_id  uuid,
  p_tenant_id  uuid,
  p_start_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.members%rowtype;
  v_start  date := coalesce(p_start_date, current_date);
begin
  if p_member_id is null or p_tenant_id is null then
    raise exception 'member_id and tenant_id are required' using errcode = '22023';
  end if;

  select * into v_member
    from public.members
   where id = p_member_id
     and tenant_id = p_tenant_id      -- a cross-tenant probe simply 404s
     for update;

  if not found then
    raise exception 'Member not found in this gym' using errcode = 'P0002';
  end if;

  if v_member.is_frozen then
    raise exception 'Membership is already frozen (since %)', coalesce(v_member.freeze_start_date::text, 'an earlier date')
      using errcode = '45001';
  end if;

  if v_start > current_date then
    raise exception 'Freeze start date cannot be in the future' using errcode = '22023';
  end if;

  update public.members
     set is_frozen         = true,
         freeze_start_date = v_start,
         freeze_end_date   = null,
         status            = 'frozen'
   where id = v_member.id
  returning * into v_member;

  return jsonb_build_object(
    'member_id',         v_member.id,
    'full_name',         v_member.full_name,
    'is_frozen',         v_member.is_frozen,
    'freeze_start_date', v_member.freeze_start_date,
    'status',            v_member.status,
    'membership_end',    v_member.membership_end,
    'message',           'Membership frozen. Gate access blocked until unfrozen.'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6b. fn_unfreeze_membership
--     Adds back EXACTLY the number of calendar days the plan spent frozen.
--     The extension base is GREATEST(membership_end, unfreeze_date) so a plan
--     that lapsed while frozen is not credited against a stale past date.
-- ---------------------------------------------------------------------
create or replace function public.fn_unfreeze_membership(
  p_member_id uuid,
  p_tenant_id uuid,
  p_end_date  date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member    public.members%rowtype;
  v_start     date;
  v_end       date := coalesce(p_end_date, current_date);
  v_days      integer;
  v_base      date;
  v_new_end   date;
begin
  if p_member_id is null or p_tenant_id is null then
    raise exception 'member_id and tenant_id are required' using errcode = '22023';
  end if;

  select * into v_member
    from public.members
   where id = p_member_id
     and tenant_id = p_tenant_id
     for update;

  if not found then
    raise exception 'Member not found in this gym' using errcode = 'P0002';
  end if;

  if not v_member.is_frozen then
    raise exception 'Membership is not currently frozen' using errcode = '45001';
  end if;

  v_start := coalesce(v_member.freeze_start_date, v_end);

  if v_end < v_start then
    raise exception 'Unfreeze date (%) is before the freeze start date (%)', v_end, v_start
      using errcode = '22023';
  end if;

  v_days    := (v_end - v_start);                          -- exact elapsed days
  v_base    := greatest(coalesce(v_member.membership_end, v_end), v_end);
  v_new_end := v_base + v_days;

  update public.members
     set is_frozen         = false,
         freeze_end_date   = v_end,
         total_freeze_days = coalesce(total_freeze_days, 0) + v_days,
         membership_end    = v_new_end,
         status            = case when v_new_end >= current_date then 'active' else 'expired' end
   where id = v_member.id
  returning * into v_member;

  return jsonb_build_object(
    'member_id',         v_member.id,
    'full_name',         v_member.full_name,
    'is_frozen',         v_member.is_frozen,
    'freeze_start_date', v_member.freeze_start_date,
    'freeze_end_date',   v_member.freeze_end_date,
    'days_added',        v_days,
    'total_freeze_days', v_member.total_freeze_days,
    'membership_end',    v_member.membership_end,
    'status',            v_member.status,
    'message',           format('Unfrozen. %s day(s) added. New expiry %s.', v_days, v_member.membership_end)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6c. fn_transfer_membership
--     Moves every remaining valid day from the source member to a target
--     phone, writes the audit row, and retires the source in ONE transaction.
--     The source's biometric slot is released (set NULL) because the physical
--     fingerprint belongs to the person who just left the gym.
-- ---------------------------------------------------------------------
create or replace function public.fn_transfer_membership(
  p_member_id  uuid,
  p_tenant_id  uuid,
  p_to_name    text,
  p_to_phone   text,
  p_to_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source    public.members%rowtype;
  v_target    public.members%rowtype;
  v_name      text := trim(coalesce(p_to_name, ''));
  v_phone     text := regexp_replace(coalesce(p_to_phone, ''), '[^0-9]', '', 'g');
  v_days      integer;
  v_transfer  public.membership_transfers%rowtype;
begin
  if p_member_id is null or p_tenant_id is null then
    raise exception 'member_id and tenant_id are required' using errcode = '22023';
  end if;

  if v_name = '' then
    raise exception 'Recipient name is required' using errcode = '22023';
  end if;

  v_phone := case when length(v_phone) > 10 then right(v_phone, 10) else v_phone end;

  if length(v_phone) <> 10 then
    raise exception 'Recipient phone must be a valid 10-digit number' using errcode = '22023';
  end if;

  select * into v_source
    from public.members
   where id = p_member_id
     and tenant_id = p_tenant_id
     for update;

  if not found then
    raise exception 'Member not found in this gym' using errcode = 'P0002';
  end if;

  if v_source.status = 'transferred' then
    raise exception 'This membership has already been transferred' using errcode = '45001';
  end if;

  v_days := greatest(coalesce(v_source.membership_end, current_date) - current_date, 0);

  if v_days <= 0 then
    raise exception 'No remaining valid days left to transfer (expiry %)',
      coalesce(v_source.membership_end::text, 'unknown')
      using errcode = '45002';
  end if;

  if exists (
    select 1 from public.members
     where tenant_id = p_tenant_id
       and phone = v_phone
       and id <> v_source.id
       and status is distinct from 'transferred'
  ) then
    raise exception 'A member with phone % already exists in this gym', v_phone
      using errcode = '45003';
  end if;

  insert into public.membership_transfers
         (tenant_id, from_member_id, to_name, to_phone, transferred_days)
  values (p_tenant_id, v_source.id, v_name, v_phone, v_days)
  returning * into v_transfer;

  insert into public.members
         (tenant_id, full_name, phone, plan_id,
          membership_start, membership_end, amount_paid, status,
          is_frozen, total_freeze_days, notes)
  values (p_tenant_id, v_name, v_phone,
          coalesce(p_to_plan_id, v_source.plan_id),
          current_date, current_date + v_days, 0, 'active',
          false, 0,
          format('Transfer of %s day(s) from %s (%s) on %s',
                 v_days, v_source.full_name, v_source.phone, current_date))
  returning * into v_target;

  update public.members
     set status         = 'transferred',
         membership_end = current_date,
         biometric_id   = null,
         is_frozen      = false,
         notes          = coalesce(notes, '') ||
                          format(' | Transferred %s day(s) to %s (%s) on %s',
                                 v_days, v_name, v_phone, current_date)
   where id = v_source.id;

  return jsonb_build_object(
    'transfer_id',       v_transfer.id,
    'transferred_days',  v_transfer.transferred_days,
    'from_member_id',    v_source.id,
    'from_name',         v_source.full_name,
    'to_member_id',      v_target.id,
    'to_name',           v_target.full_name,
    'to_phone',          v_target.phone,
    'to_membership_end', v_target.membership_end,
    'message',           format('%s day(s) moved to %s. %s is now marked transferred.', v_days, v_name, v_source.full_name)
  );
end;
$$;

-- The dashboard talks to Postgres with the anon key, so these must be callable
-- by it. Each function re-validates p_tenant_id against the row it locks, which
-- is what actually stops Gym A from mutating Gym B's members.
grant execute on function public.fn_freeze_membership(uuid, uuid, date)              to anon, authenticated, service_role;
grant execute on function public.fn_unfreeze_membership(uuid, uuid, date)            to anon, authenticated, service_role;
grant execute on function public.fn_transfer_membership(uuid, uuid, text, text, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Post-flight verification (read-only, prints a summary)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  raise notice '=== ForgeOS Phase 1 verification ===';
  for r in
    select 'members'::text as tbl, count(*) as rows_total, count(*) filter (where tenant_id is null) as rows_without_tenant from public.members
    union all select 'plans', count(*), count(*) filter (where tenant_id is null) from public.plans
    union all select 'attendances', count(*), count(*) filter (where tenant_id is null) from public.attendances
    union all select 'invoices', count(*), count(*) filter (where tenant_id is null) from public.invoices
  loop
    raise notice 'table % | rows % | missing tenant_id %', r.tbl, r.rows_total, r.rows_without_tenant;
  end loop;
  raise notice 'membership_transfers rows: %', (select count(*) from public.membership_transfers);
end $$;

-- ---------------------------------------------------------------------
-- 8. RLS (Phase 2 — deliberately NOT enabled here)
--    These policies are ready but commented out. They only become meaningful
--    once the app authenticates with Supabase Auth so that
--    auth.jwt() -> >'user_metadata' -> >'tenant_id' is populated. Enabling RLS
--    today (anon key, no JWT claim) would make every table read as empty and
--    take the whole product down.
-- ---------------------------------------------------------------------
-- alter table public.members             enable row level security;
-- alter table public.plans               enable row level security;
-- alter table public.attendances         enable row level security;
-- alter table public.invoices            enable row level security;
-- alter table public.membership_transfers enable row level security;
--
-- create policy tenant_members on public.members
--   for all to authenticated
--   using (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid)
--   with check (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid);

commit;





