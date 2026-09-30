-- =============================================================================
-- 0004_phase3_crm_trainer_store.sql   (run after 0003_phase2_hardware_geofence.sql)
--
-- ForgeOS Phase 3: Lead CRM pipeline, trainer / personal-training roster and the
-- gym store point of sale.
--
--   1. public.leads            -> 6 stage pipeline (new ... converted / lost)
--   2. public.trainers         -> trainer profiles + commission rate
--   3. public.pt_subscriptions -> a client's PT package and its session counter
--   4. public.products         -> store inventory
--   5. public.orders           -> POS sales with a jsonb receipt
--   6. Functions               -> every multi-row write happens inside one
--                                 tenant-checked SECURITY DEFINER transaction
--
-- Reconciling the pre-existing leads table
-- ----------------------------------------
-- An earlier build of app/leads/page.tsx inserted directly into a hand-made
-- public.leads that had (full_name, phone, goal, stage, trial_date, notes).
-- Phase 3's contract is (full_name, phone, source, status, follow_up_date, ...).
-- Rather than drop data, this migration:
--   * adds the missing columns if the table already exists,
--   * backfills status from the legacy stage values,
--   * relaxes the legacy goal/stage NOT NULLs so the new code can omit them,
--   * adopts orphan rows into the tenant when the install has exactly one gym.
-- The legacy columns are kept: nothing is destroyed, they are just no longer the
-- source of truth.
--
-- Every statement is idempotent: safe to re-run in the SQL Editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Lead management CRM (Module 3.1.1)
-- -----------------------------------------------------------------------------
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  full_name      text not null,
  phone          text not null,
  email          text null,
  source         text not null default 'walk-in',
  status         text not null default 'new',
  trial_date     date null,
  follow_up_date date null,
  notes          text null,
  created_at     timestamptz not null default now()
);

-- A fresh install gets the table above. A pre-Phase-3 install gets the columns
-- it is missing, added one at a time so no existing row is rewritten.
alter table if exists public.leads
  add column if not exists tenant_id      uuid,
  add column if not exists email          text,
  add column if not exists source         text,
  add column if not exists status         text,
  add column if not exists follow_up_date date;

-- 1a. Backfill the pipeline stage from the legacy `stage` column (when present).
--     new -> new, trial -> trial_booked, completed -> trial_completed, and the
--     two terminal states carry over unchanged.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'leads' and column_name = 'stage'
  ) then
    execute $mig$
      update public.leads
         set status = case stage
                        when 'trial'     then 'trial_booked'
                        when 'completed' then 'trial_completed'
                        when 'converted' then 'converted'
                        when 'lost'      then 'lost'
                        else 'new'
                      end
       where status is null
    $mig$;
  end if;
end $$;

update public.leads set status = 'new'     where status is null or trim(status) = '';
update public.leads set source = 'walk-in' where source is null or trim(source) = '';

-- 1b. A lead whose status is outside the pipeline would break the CHECK below,
--     so fold anything unrecognised back into 'new' first.
update public.leads
   set status = 'new'
 where status not in ('new', 'contacted', 'trial_booked', 'trial_completed', 'converted', 'lost');

-- 1c. Adopt pre-existing rows that have no gym attached. Only safe when the
--     install runs a single gym; with two or more the origin is unknowable, so
--     those rows stay invisible to the tenant-scoped API instead of being
--     guessed into the wrong gym.
do $$
declare
  v_tenants integer;
  v_only    uuid;
  v_orphans integer;
begin
  select count(*) into v_tenants from public.tenants;
  select count(*) into v_orphans from public.leads where tenant_id is null;

  if v_tenants = 1 and v_orphans > 0 then
    select id into v_only from public.tenants limit 1;
    update public.leads set tenant_id = v_only where tenant_id is null;
    raise notice 'Adopted % orphan lead row(s) into the only gym in this install.', v_orphans;
  elsif v_orphans > 0 then
    raise notice 'Left % lead row(s) without a tenant: this install has % gyms, so the owner cannot be inferred.', v_orphans, v_tenants;
  end if;
end $$;

-- 1d. The legacy columns were NOT NULL with no default, which would make every
--     Phase 3 INSERT fail even though the pipeline no longer reads them. Give
--     them a default and drop the NOT NULL instead of dropping the column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'leads'
       and column_name = 'goal' and is_nullable = 'NO'
  ) then
    alter table public.leads alter column goal drop not null;
    alter table public.leads alter column goal set default '';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'leads'
       and column_name = 'stage' and is_nullable = 'NO'
  ) then
    alter table public.leads alter column stage drop not null;
    alter table public.leads alter column stage set default 'new';
  end if;
end $$;

-- 1e. Pipeline vocabulary, enforced at the database.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.leads'::regclass and conname = 'leads_status_check'
  ) then
    alter table public.leads
      add constraint leads_status_check
      check (status in ('new', 'contacted', 'trial_booked', 'trial_completed', 'converted', 'lost'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.leads'::regclass and conname = 'leads_phone_check'
  ) then
    alter table public.leads
      add constraint leads_phone_check
      check (length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) between 6 and 15);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.leads'::regclass and conname = 'leads_full_name_check'
  ) then
    alter table public.leads
      add constraint leads_full_name_check
      check (length(trim(coalesce(full_name, ''))) > 0);
  end if;
end $$;

-- 1f. Foreign key, added separately: a legacy table may predate tenants, and the
--     constraint can only be attached once every row has an owner.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.leads'::regclass and conname = 'leads_tenant_id_fkey'
  ) and not exists (select 1 from public.leads where tenant_id is null) then
    alter table public.leads
      add constraint leads_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_leads_tenant_status    on public.leads (tenant_id, status);
create index if not exists idx_leads_tenant_follow_up on public.leads (tenant_id, follow_up_date);
create index if not exists idx_leads_tenant_created   on public.leads (tenant_id, created_at desc);

comment on column public.leads.status is 'Pipeline stage: new, contacted, trial_booked, trial_completed, converted, lost.';
comment on column public.leads.follow_up_date is 'Day the front desk promised to call back. Drives the overdue badge.';

-- -----------------------------------------------------------------------------
-- 2. Trainers and personal training (Module 3.1.2)
-- -----------------------------------------------------------------------------
create table if not exists public.trainers (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  name                    text not null,
  phone                   text not null,
  specialization          text null,
  commission_rate_percent numeric(5, 2) not null default 20.00,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now()
);

create index if not exists idx_trainers_tenant_active on public.trainers (tenant_id, is_active);
create index if not exists idx_trainers_tenant_name   on public.trainers (tenant_id, name);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainers'::regclass and conname = 'trainers_commission_check'
  ) then
    alter table public.trainers
      add constraint trainers_commission_check
      check (commission_rate_percent >= 0 and commission_rate_percent <= 100);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainers'::regclass and conname = 'trainers_name_check'
  ) then
    alter table public.trainers
      add constraint trainers_name_check
      check (length(trim(coalesce(name, ''))) > 0);
  end if;
end $$;

comment on column public.trainers.commission_rate_percent is 'Share of the PT fee paid to the trainer, 0-100.';

-- 2a. A PT package is a block of sessions with an expiry and a cash value. The
--     session counter lives on the subscription so a punch is one UPDATE, which
--     is what makes "two trainers punching at once" safe.
create table if not exists public.pt_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  member_id          uuid not null references public.members(id) on delete cascade,
  trainer_id         uuid not null references public.trainers(id) on delete cascade,
  total_sessions     integer not null,
  completed_sessions integer not null default 0,
  amount_paid        numeric(10, 2) not null,
  start_date         date not null,
  end_date           date not null,
  status             text not null default 'active',
  created_at         timestamptz not null default now()
);

create index if not exists idx_pt_tenant_trainer on public.pt_subscriptions (tenant_id, trainer_id);
create index if not exists idx_pt_tenant_member  on public.pt_subscriptions (tenant_id, member_id);
create index if not exists idx_pt_tenant_status  on public.pt_subscriptions (tenant_id, status);
create index if not exists idx_pt_tenant_start   on public.pt_subscriptions (tenant_id, start_date desc);

-- 2b. A negative session count or a package with a session budget of zero is
--     nonsense, and an end date before the start date would make the expiry
--     badge lie, so all three are rejected at the database.
update public.pt_subscriptions set completed_sessions = 0 where completed_sessions < 0;
update public.pt_subscriptions set end_date = start_date where end_date < start_date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pt_subscriptions'::regclass and conname = 'pt_sessions_check'
  ) then
    alter table public.pt_subscriptions
      add constraint pt_sessions_check
      check (total_sessions > 0 and completed_sessions >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pt_subscriptions'::regclass and conname = 'pt_window_check'
  ) then
    alter table public.pt_subscriptions
      add constraint pt_window_check
      check (end_date >= start_date);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pt_subscriptions'::regclass and conname = 'pt_status_check'
  ) then
    alter table public.pt_subscriptions
      add constraint pt_status_check
      check (status in ('active', 'completed', 'expired', 'cancelled'));
  end if;
end $$;

comment on column public.pt_subscriptions.completed_sessions is 'Punched sessions. fn_pt_log_session is the only writer.';

-- -----------------------------------------------------------------------------
-- 3. Gym store inventory and POS sales (Module 3.1.3)
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  name                text not null,
  category            text not null,
  cost_price          numeric(10, 2) not null,
  selling_price       numeric(10, 2) not null,
  stock_quantity      integer not null default 0,
  low_stock_threshold integer not null default 5,
  sku                 text null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_products_tenant_category on public.products (tenant_id, category);
create index if not exists idx_products_tenant_name     on public.products (tenant_id, name);
create index if not exists idx_products_tenant_sku      on public.products (tenant_id, upper(trim(sku)));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.products'::regclass and conname = 'products_money_check'
  ) then
    alter table public.products
      add constraint products_money_check
      check (cost_price >= 0 and selling_price >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.products'::regclass and conname = 'products_stock_check'
  ) then
    alter table public.products
      add constraint products_stock_check
      check (stock_quantity >= 0 and low_stock_threshold >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.products'::regclass and conname = 'products_category_check'
  ) then
    alter table public.products
      add constraint products_category_check
      check (category in ('protein', 'supplements', 'merchandise', 'beverages', 'gear'));
  end if;
end $$;

-- 3a. A sale. member_id is nullable so a walk-in guest can buy a shake, and the
--     receipt is snapshotted into jsonb: a price change next month must not
--     rewrite what a customer was charged today.
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  member_id      uuid null references public.members(id) on delete set null,
  total_amount   numeric(10, 2) not null,
  payment_method text not null default 'Cash/UPI',
  items          jsonb not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_orders_tenant_created on public.orders (tenant_id, created_at desc);
create index if not exists idx_orders_tenant_member  on public.orders (tenant_id, member_id);
create index if not exists idx_orders_items          on public.orders using gin (items);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass and conname = 'orders_total_check'
  ) then
    alter table public.orders
      add constraint orders_total_check
      check (total_amount >= 0);
  end if;

  -- The receipt is an array of lines. A jsonb object here would let a broken
  -- client store a sale the store page can never render.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass and conname = 'orders_items_check'
  ) then
    alter table public.orders
      add constraint orders_items_check
      check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0);
  end if;
end $$;

comment on column public.orders.items is 'Frozen receipt lines: [{ product_id, name, quantity, price, subtotal }].';

-- =============================================================================
-- 4. Functions
--    Every multi-row write below runs inside ONE transaction, re-checks that the
--    row belongs to p_tenant_id, and is SECURITY DEFINER with a pinned
--    search_path - the same contract Phase 1 and Phase 2 established.
-- =============================================================================

-- 4a. Lead -> member conversion (Module 3.2).
--     Two entry points are supported on purpose:
--       * the front desk picks a plan and converts straight from the lead card
--         (p_member_id null: a member row is created here),
--       * or the dashboard enrols the prospect and then links the record back
--         (p_member_id given: the lead simply flips to 'converted').
--     Either way the lead can only be converted once, which stops a double tap
--     from creating two memberships.
create or replace function public.fn_lead_convert_to_member(
  p_lead_id     uuid,
  p_tenant_id   uuid,
  p_plan_id     uuid    default null,
  p_amount_paid numeric default null,
  p_member_id   uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead      public.leads%rowtype;
  v_member    public.members%rowtype;
  v_plan      public.plans%rowtype;
  v_duration  integer := 30;
  v_amount    numeric := greatest(coalesce(p_amount_paid, 0), 0);
  v_phone     text;
  v_invoice   uuid;
  v_created   boolean := false;
  v_plan_name text;
begin
  if p_lead_id is null or p_tenant_id is null then
    raise exception 'lead_id and tenant_id are required' using errcode = '22023';
  end if;

  select * into v_lead
    from public.leads
   where id = p_lead_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'Lead not found in this gym' using errcode = 'P0002';
  end if;

  if v_lead.status = 'converted' then
    raise exception 'This lead has already been converted' using errcode = '45006';
  end if;

  if p_member_id is not null then
    select * into v_member
      from public.members
     where id = p_member_id and tenant_id = p_tenant_id;

    if not found then
      raise exception 'Member not found in this gym' using errcode = 'P0002';
    end if;
  else
    if p_plan_id is not null then
      select * into v_plan
        from public.plans
       where id = p_plan_id and (tenant_id = p_tenant_id or tenant_id is null);
      if found then
        v_duration  := greatest(coalesce(v_plan.duration_days, 30), 1);
        v_plan_name := v_plan.name;
      end if;
    end if;

    -- Same rule as 0001: a phone is stored as its trailing 10 digits so
    -- "+91 90000 00013" and "9000000013" are the same person.
    v_phone := regexp_replace(coalesce(v_lead.phone, ''), '[^0-9]', '', 'g');
    if length(v_phone) > 10 then
      v_phone := right(v_phone, 10);
    end if;

    insert into public.members
           (tenant_id, full_name, phone, email, plan_id,
            membership_start, membership_end, amount_paid, status)
    values (p_tenant_id, v_lead.full_name, v_phone, v_lead.email, p_plan_id,
            current_date, current_date + v_duration, v_amount, 'active')
    returning * into v_member;

    v_created := true;
  end if;

  update public.leads set status = 'converted' where id = v_lead.id;

  -- The fee belongs in the revenue ledger too. Idempotent by construction: this
  -- runs at most once per lead because the status is now 'converted'.
  if v_created and v_amount > 0 then
    begin
      insert into public.invoices (tenant_id, member_id, amount, payment_method, status)
      values (p_tenant_id, v_member.id, v_amount, 'Enrollment', 'paid')
      returning id into v_invoice;
    exception when others then
      -- invoices is a pre-Phase-1 table whose exact NOT NULL set varies between
      -- installs. The membership is the important artefact, so a rejected
      -- receipt must never roll the enrolment back.
      v_invoice := null;
    end;
  end if;

  return jsonb_build_object(
    'lead_id',        v_lead.id,
    'lead_name',      v_lead.full_name,
    'member_id',      v_member.id,
    'member_created', v_created,
    'full_name',      v_member.full_name,
    'phone',          v_member.phone,
    'plan_name',      v_plan_name,
    'amount_paid',    case when v_created then v_amount else coalesce(v_member.amount_paid, 0) end,
    'membership_end', v_member.membership_end,
    'status',         'converted',
    'invoice_id',     v_invoice
  );
end;
$$;

-- 4b. Trainer payout report (Module 3.3).
--     Commission is earned on the PT fee actually collected inside a window
--     (defaults to the current calendar month), weighted by each trainer's own
--     rate at the time the report is run. A client who bought a 12-session block
--     counts as revenue once - not once per session - so the payout number can
--     be handed to a trainer as-is.
create or replace function public.fn_trainer_payout_report(
  p_tenant_id uuid,
  p_from      date default null,
  p_to        date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from       date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to         date := coalesce(p_to, current_date);
  v_trainers   jsonb;
  v_revenue    numeric := 0;
  v_commission numeric := 0;
  v_sessions   integer := 0;
  v_subs       integer := 0;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  -- A reversed window (to before from) reports the single day in question
  -- instead of silently returning zero for every trainer.
  if v_to < v_from then
    v_to := v_from;
  end if;

  with subs as (
    select ps.trainer_id,
           count(distinct ps.member_id) as clients,
           count(*)                     as subscriptions,
           sum(ps.total_sessions)       as sessions_total,
           sum(ps.completed_sessions)   as sessions_completed,
           sum(ps.amount_paid)          as revenue
      from public.pt_subscriptions ps
     where ps.tenant_id  = p_tenant_id
       and ps.start_date >= v_from
       and ps.start_date <= v_to
     group by ps.trainer_id
  ),
  report as (
    select t.id,
           t.name,
           t.phone,
           t.specialization,
           t.commission_rate_percent,
           t.is_active,
           coalesce(s.clients, 0)              as clients,
           coalesce(s.subscriptions, 0)        as subscriptions,
           coalesce(s.sessions_total, 0)       as sessions_total,
           coalesce(s.sessions_completed, 0)   as sessions_completed,
           greatest(coalesce(s.sessions_total, 0) - coalesce(s.sessions_completed, 0), 0) as sessions_remaining,
           coalesce(s.revenue, 0)              as revenue,
           round(coalesce(s.revenue, 0) * t.commission_rate_percent / 100.0, 2) as commission
      from public.trainers t
      left join subs s on s.trainer_id = t.id
     where t.tenant_id = p_tenant_id
  )
  select coalesce(jsonb_agg(to_jsonb(report) order by report.name), '[]'::jsonb),
         coalesce(sum(report.revenue), 0),
         coalesce(sum(report.commission), 0),
         coalesce(sum(report.sessions_completed), 0),
         coalesce(sum(report.subscriptions), 0)
    into v_trainers, v_revenue, v_commission, v_sessions, v_subs
    from report;

  return jsonb_build_object(
    'tenant_id',         p_tenant_id,
    'from',              v_from,
    'to',                v_to,
    'trainers',          v_trainers,
    'total_revenue',     v_revenue,
    'total_commission',  v_commission,
    'sessions_completed', v_sessions,
    'subscriptions',     v_subs
  );
end;
$$;

-- 4c. Sell a PT package (Module 3.3).
--     Both the member and the trainer are re-read with the tenant filter, so a
--     crafted member_id from another gym cannot be attached to this gym's
--     trainer (or vice versa).
create or replace function public.fn_pt_create_subscription(
  p_tenant_id     uuid,
  p_member_id     uuid,
  p_trainer_id    uuid,
  p_total_sessions integer,
  p_amount_paid   numeric,
  p_start_date    date default null,
  p_end_date      date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member  public.members%rowtype;
  v_trainer public.trainers%rowtype;
  v_start   date := coalesce(p_start_date, current_date);
  v_end     date := coalesce(p_end_date, coalesce(p_start_date, current_date) + 30);
  v_amount  numeric := coalesce(p_amount_paid, 0);
  v_row     public.pt_subscriptions%rowtype;
  v_invoice uuid;
begin
  if p_tenant_id is null or p_member_id is null or p_trainer_id is null then
    raise exception 'tenant_id, member_id and trainer_id are required' using errcode = '22023';
  end if;

  if p_total_sessions is null or p_total_sessions <= 0 or p_total_sessions > 1000 then
    raise exception 'total_sessions must be between 1 and 1000' using errcode = '22023';
  end if;

  if v_amount < 0 then
    raise exception 'amount_paid cannot be negative' using errcode = '22023';
  end if;

  if v_end < v_start then
    raise exception 'end_date cannot be before start_date' using errcode = '22023';
  end if;

  select * into v_member
    from public.members
   where id = p_member_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Member not found in this gym' using errcode = 'P0002';
  end if;

  select * into v_trainer
    from public.trainers
   where id = p_trainer_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Trainer not found in this gym' using errcode = 'P0002';
  end if;

  insert into public.pt_subscriptions
         (tenant_id, member_id, trainer_id, total_sessions, completed_sessions,
          amount_paid, start_date, end_date, status)
  values (p_tenant_id, v_member.id, v_trainer.id, p_total_sessions, 0,
          v_amount, v_start, v_end, 'active')
  returning * into v_row;

  if v_amount > 0 then
    begin
      insert into public.invoices (tenant_id, member_id, amount, payment_method, status)
      values (p_tenant_id, v_member.id, v_amount, 'Personal Training', 'paid')
      returning id into v_invoice;
    exception when others then
      v_invoice := null;
    end;
  end if;

  return jsonb_build_object(
    'subscription_id',    v_row.id,
    'tenant_id',          v_row.tenant_id,
    'member_id',          v_row.member_id,
    'member_name',        v_member.full_name,
    'member_phone',       v_member.phone,
    'trainer_id',         v_row.trainer_id,
    'trainer_name',       v_trainer.name,
    'total_sessions',     v_row.total_sessions,
    'completed_sessions', v_row.completed_sessions,
    'sessions_remaining', v_row.total_sessions - v_row.completed_sessions,
    'amount_paid',        v_row.amount_paid,
    'start_date',         v_row.start_date,
    'end_date',           v_row.end_date,
    'status',             v_row.status,
    'invoice_id',         v_invoice
  );
end;
$$;

-- 4d. Punch one completed PT session (+1) (Module 3.3).
--     SELECT ... FOR UPDATE makes the counter safe when two trainers punch the
--     same client's last two sessions at the same moment: the second one waits,
--     then sees the updated count instead of overwriting it.
create or replace function public.fn_pt_log_session(
  p_subscription_id uuid,
  p_tenant_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      public.pt_subscriptions%rowtype;
  v_member   text;
  v_trainer  text;
  v_reopened boolean := false;
begin
  if p_subscription_id is null or p_tenant_id is null then
    raise exception 'subscription_id and tenant_id are required' using errcode = '22023';
  end if;

  select * into v_row
    from public.pt_subscriptions
   where id = p_subscription_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'PT package not found in this gym' using errcode = 'P0002';
  end if;

  if v_row.status = 'cancelled' then
    raise exception 'This PT package was cancelled' using errcode = '45001';
  end if;

  -- A finished block can be re-opened only by the front desk adding sessions
  -- through fn_pt_create_subscription; punching past the budget is refused
  -- rather than quietly inflating the count.
  if v_row.completed_sessions >= v_row.total_sessions then
    raise exception 'All % sessions in this PT package are already complete', v_row.total_sessions
      using errcode = '45001';
  end if;

  update public.pt_subscriptions
     set completed_sessions = completed_sessions + 1,
         status = case
                    when completed_sessions + 1 >= total_sessions then 'completed'
                    else 'active'
                  end
   where id = v_row.id
   returning * into v_row;

  v_reopened := (v_row.completed_sessions < v_row.total_sessions);

  select m.full_name, t.name
    into v_member, v_trainer
    from public.members  m
    join public.trainers t on t.id = v_row.trainer_id
   where m.id = v_row.member_id;

  return jsonb_build_object(
    'subscription_id',    v_row.id,
    'member_id',          v_row.member_id,
    'member_name',        v_member,
    'trainer_id',         v_row.trainer_id,
    'trainer_name',       v_trainer,
    'total_sessions',     v_row.total_sessions,
    'completed_sessions', v_row.completed_sessions,
    'sessions_remaining', greatest(v_row.total_sessions - v_row.completed_sessions, 0),
    'status',             v_row.status,
    'package_finished',   not v_reopened,
    'end_date',           v_row.end_date
  );
end;
$$;

-- 4e. POS checkout (Module 3.4).
--     One transaction per sale: every line is validated against THIS gym's
--     catalogue, the stock is decremented under a row lock, the order and its
--     frozen receipt are written, and the revenue ledger is updated. If any line
--     fails - unknown product, wrong gym, not enough stock - the whole sale rolls
--     back, so the shelf count and the receipt can never disagree.
create or replace function public.fn_store_checkout(
  p_tenant_id      uuid,
  p_items          jsonb,
  p_member_id      uuid default null,
  p_payment_method text default 'Cash/UPI'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item        jsonb;
  v_product     public.products%rowtype;
  v_product_id  uuid;
  v_qty         integer;
  v_lines       jsonb := '[]'::jsonb;
  v_stock       jsonb := '[]'::jsonb;
  v_total       numeric := 0;
  v_member      public.members%rowtype;
  v_method      text := coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'Cash/UPI');
  v_order       public.orders%rowtype;
  v_invoice     uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A single sale can hold at most 50 lines' using errcode = '22023';
  end if;

  -- A walk-in guest sends no member_id: the sale is still recorded, it simply
  -- carries no loyalty identity.
  if p_member_id is not null then
    select * into v_member
      from public.members
     where id = p_member_id and tenant_id = p_tenant_id;

    if not found then
      raise exception 'Member not found in this gym' using errcode = 'P0002';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Every cart line must be an object' using errcode = '22023';
    end if;

    if jsonb_typeof(v_item -> 'quantity') <> 'number' then
      raise exception 'Every cart line needs a numeric quantity' using errcode = '22023';
    end if;

    v_qty := floor((v_item ->> 'quantity')::numeric)::integer;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then
      raise exception 'Quantity must be between 1 and 9999' using errcode = '22023';
    end if;

    if coalesce(v_item ->> 'product_id', '') = '' then
      raise exception 'Every cart line needs a product_id' using errcode = '22023';
    end if;
    v_product_id := (v_item ->> 'product_id')::uuid;

    -- FOR UPDATE: two tills selling the last shaker must not both succeed.
    select * into v_product
      from public.products
     where id = v_product_id and tenant_id = p_tenant_id
     for update;

    if not found then
      raise exception 'Product not found in this gym' using errcode = 'P0002';
    end if;

    if v_product.stock_quantity < v_qty then
      raise exception 'Only % left of %', v_product.stock_quantity, v_product.name
        using errcode = '45007';
    end if;

    update public.products
       set stock_quantity = stock_quantity - v_qty
     where id = v_product.id;

    v_total := v_total + (v_product.selling_price * v_qty);

    -- The receipt line is snapshotted: a price change tomorrow must not rewrite
    -- what this customer was charged today.
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id,
      'name',       v_product.name,
      'category',   v_product.category,
      'quantity',   v_qty,
      'price',      v_product.selling_price,
      'subtotal',   round(v_product.selling_price * v_qty, 2)
    );

    v_stock := v_stock || jsonb_build_object(
      'product_id',     v_product.id,
      'name',           v_product.name,
      'stock_quantity', v_product.stock_quantity - v_qty
    );
  end loop;

  insert into public.orders (tenant_id, member_id, total_amount, payment_method, items)
  values (p_tenant_id, v_member.id, round(v_total, 2), v_method, v_lines)
  returning * into v_order;

  -- Mirror the sale into the revenue ledger the analytics page already reads.
  -- Guarded: invoices predates Phase 1, so a walk-in sale must never be able to
  -- roll back a completed transaction just because that table refused the row.
  begin
    insert into public.invoices (tenant_id, member_id, amount, payment_method, status)
    values (p_tenant_id, v_order.member_id, v_order.total_amount, v_method, 'paid')
    returning id into v_invoice;
  exception when others then
    v_invoice := null;
  end;

  return jsonb_build_object(
    'order_id',       v_order.id,
    'tenant_id',      v_order.tenant_id,
    'member_id',      v_order.member_id,
    'member_name',    v_member.full_name,
    'is_walk_in',     v_order.member_id is null,
    'total_amount',   v_order.total_amount,
    'payment_method', v_order.payment_method,
    'items',          v_order.items,
    'line_count',     jsonb_array_length(v_order.items),
    'created_at',     v_order.created_at,
    'invoice_id',     v_invoice,
    'revenue_logged', v_invoice is not null,
    'stock_updates',  v_stock
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Grants - the app roles may call these five doors and nothing else new.
-- -----------------------------------------------------------------------------
grant execute on function
  public.fn_lead_convert_to_member(uuid, uuid, uuid, numeric, uuid),
  public.fn_trainer_payout_report(uuid, date, date),
  public.fn_pt_create_subscription(uuid, uuid, uuid, integer, numeric, date, date),
  public.fn_pt_log_session(uuid, uuid),
  public.fn_store_checkout(uuid, jsonb, uuid, text)
to anon, authenticated;

commit;

-- -----------------------------------------------------------------------------
-- What to eyeball after running this (RAISE NOTICE output in the SQL editor)
-- -----------------------------------------------------------------------------
do $$
begin
  raise notice 'Phase 3 tables present (want 5): %',
    (select count(*) from information_schema.tables
      where table_schema = 'public'
        and table_name in ('leads', 'trainers', 'pt_subscriptions', 'products', 'orders'));

  raise notice 'Phase 3 RPCs present (want 5): %',
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('fn_lead_convert_to_member', 'fn_trainer_payout_report',
                          'fn_pt_create_subscription', 'fn_pt_log_session',
                          'fn_store_checkout'));

  raise notice 'leads rows still without a tenant (0 is ideal): %',
    (select count(*) from public.leads where tenant_id is null);

  raise notice 'leads stage mix: %',
    (select coalesce(string_agg(status || '=' || n, ', ' order by status), '(no leads yet)')
       from (select status, count(*) as n from public.leads group by status) s);

  raise notice 'products at or below their low stock threshold: %',
    (select count(*) from public.products where stock_quantity <= low_stock_threshold);
end $$;

commit;
