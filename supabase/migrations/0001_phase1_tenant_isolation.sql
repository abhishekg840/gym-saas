begin;

-- 0. Extensions
create extension if not exists "pgcrypto";

-- 1a. tenant_id columns
alter table if exists public.members      add column if not exists tenant_id uuid;
alter table if exists public.plans        add column if not exists tenant_id uuid;
alter table if exists public.attendances  add column if not exists tenant_id uuid;
alter table if exists public.invoices     add column if not exists tenant_id uuid;

-- 1b. Foreign keys -> public.tenants(id)
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
    end if;
  end loop;
end $$;

-- 1c. Indexes
create index if not exists idx_members_tenant            on public.members (tenant_id);
create index if not exists idx_members_tenant_bio        on public.members (tenant_id, biometric_id);
create index if not exists idx_members_tenant_end        on public.members (tenant_id, membership_end);
create index if not exists idx_plans_tenant              on public.plans (tenant_id);
create index if not exists idx_attendances_tenant_punch  on public.attendances (tenant_id, punch_time desc);
create index if not exists idx_attendances_tenant_member on public.attendances (tenant_id, member_id);
create index if not exists idx_invoices_tenant_issued    on public.invoices (tenant_id, issued_at desc);
create index if not exists idx_invoices_tenant_member    on public.invoices (tenant_id, member_id);

-- 1d. Membership freeze columns
alter table if exists public.members
  add column if not exists is_frozen         boolean not null default false,
  add column if not exists freeze_start_date date     null,
  add column if not exists freeze_end_date   date     null,
  add column if not exists total_freeze_days integer not null default 0;

-- 2. Backfill tenant_id
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

-- 3a. Drop legacy unique constraints on biometric_id and phone
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
  end loop;
end $$;

-- 3b. Composite unique indexes per tenant
create unique index if not exists members_tenant_biometric_id_key
  on public.members (tenant_id, biometric_id)
  where biometric_id is not null;

create unique index if not exists members_tenant_phone_key
  on public.members (tenant_id, phone)
  where phone is not null and phone <> '';

-- 4. membership_transfers audit table
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

-- 5. Membership status check
do $$
declare
  r record;
  v_cols text[];
  v_allowed text;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.members'::regclass
       and c.contype  = 'c'
       and c.conname ilike '%status%'
  loop
    execute format('alter table public.members drop constraint %I', r.conname);
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
end $$;

-- 6a. RPC: fn_freeze_membership
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
     and tenant_id = p_tenant_id
     for update;

  if not found then
    raise exception 'Member not found in this gym' using errcode = 'P0002';
  end if;

  if v_member.is_frozen then
    raise exception 'Membership is already frozen' using errcode = '45001';
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
    'message',           'Membership frozen. Gate access blocked.'
  );
end;
$$;

-- 6b. RPC: fn_unfreeze_membership
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
  v_member   public.members%rowtype;
  v_start    date;
  v_end      date := coalesce(p_end_date, current_date);
  v_days     integer;
  v_base     date;
  v_new_end  date;
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
  v_days := (v_end - v_start);
  if v_days < 0 then v_days := 0; end if;

  v_base := greatest(coalesce(v_member.membership_end, v_end), v_end);
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
    'membership_end',    v_member.membership_end,
    'status',            v_member.status
  );
end;
$$;

-- 6c. RPC: fn_transfer_membership
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
  v_source   public.members%rowtype;
  v_target   public.members%rowtype;
  v_name     text := trim(coalesce(p_to_name, ''));
  v_phone    text := regexp_replace(coalesce(p_to_phone, ''), '[^0-9]', '', 'g');
  v_days     integer;
  v_transfer public.membership_transfers%rowtype;
begin
  if p_member_id is null or p_tenant_id is null then
    raise exception 'member_id and tenant_id are required' using errcode = '22023';
  end if;

  if v_name = '' then
    raise exception 'Recipient name is required' using errcode = '22023';
  end if;

  if length(v_phone) > 10 then 
    v_phone := right(v_phone, 10); 
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
    raise exception 'No remaining valid days left to transfer' using errcode = '45002';
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
          format('Transfer of %s day(s) from %s on %s', v_days, v_source.full_name, current_date))
  returning * into v_target;

  update public.members
     set status         = 'transferred',
         membership_end = current_date,
         biometric_id   = null,
         is_frozen      = false
   where id = v_source.id;

  return jsonb_build_object(
    'transfer_id',       v_transfer.id,
    'transferred_days',  v_transfer.transferred_days,
    'from_name',         v_source.full_name,
    'to_name',           v_target.full_name,
    'to_phone',          v_target.phone,
    'to_membership_end', v_target.membership_end
  );
end;
$$;

-- Permissions
grant execute on function public.fn_freeze_membership(uuid, uuid, date)               to anon, authenticated, service_role;
grant execute on function public.fn_unfreeze_membership(uuid, uuid, date)             to anon, authenticated, service_role;
grant execute on function public.fn_transfer_membership(uuid, uuid, text, text, uuid) to anon, authenticated, service_role;

commit;