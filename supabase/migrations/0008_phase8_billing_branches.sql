-- =============================================================================
-- 0008_phase8_billing_branches.sql   (run after 0007_phase7_media_identity.sql)
--
-- ForgeOS Modules 9 (billing half) and 11.2 (multi-branch foundation):
--
--   1. public.tenants   -> gym logo + GST identity so an invoice can be issued
--                          as a GST or non-GST document from the same table.
--   2. public.invoices  -> items snapshot (plan / POS product lines) and a
--                          transaction reference for the receipt header.
--   3. public.branches  -> one row per physical location, owned by a tenant;
--                          every gym that installs this gets a seeded
--                          "Main Branch" so the switcher is never empty.
--   4. branch_id on members / attendances / orders -> the three surfaces the
--                          owner filters by branch (roster, till, gate log).
--
-- Branch scoping rule used by the UI: null branch_id = unassigned, visible in
-- every branch filter as well as "All branches", so switching branches never
-- makes a gym's own records disappear.
--
-- Every statement is idempotent: safe to re-run in the SQL Editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Invoice identity on the gym
-- -----------------------------------------------------------------------------
-- Column names are additive: a fresh install and a pre-existing tenants table
-- both end up with the same shape, and no existing row is rewritten.
alter table if exists public.tenants
  add column if not exists logo_url         text,
  add column if not exists address          text,
  add column if not exists gstin            text,
  add column if not exists gst_enabled      boolean not null default false,
  add column if not exists gst_rate_percent numeric(5, 2) not null default 18;

comment on column public.tenants.gstin is
  'GSTIN printed on GST invoices. The UI warns when gst_enabled is on without one.';
comment on column public.tenants.gst_enabled is
  'False = plain invoice/receipt (non-GST). True = CGST/SGST breakdown at gst_rate_percent.';
comment on column public.tenants.logo_url is
  'Public logo URL rendered on the invoice header; falls back to the gym initials.';

-- Range guard on the rate: a mistyped 1800% would make every invoice absurd.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenants'::regclass
       and conname = 'tenants_gst_rate_percent_check'
  ) then
    alter table public.tenants
      add constraint tenants_gst_rate_percent_check
      check (gst_rate_percent >= 0 and gst_rate_percent <= 100);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Invoice line items + transaction reference
-- -----------------------------------------------------------------------------
-- POS sales freeze their cart here at checkout so a product rename next month
-- never rewrites yesterday's receipt; membership invoices keep reading the
-- plan from the member row as they always have.
alter table if exists public.invoices
  add column if not exists items             jsonb,
  add column if not exists payment_reference text;

comment on column public.invoices.items is
  'Frozen line items [{name, qty, unit_price, total}] written by the till at checkout. Null = membership invoice, line comes from the plan.';
comment on column public.invoices.payment_reference is
  'Transaction reference shown on the receipt: order id / UPI reference / bank ref.';

-- -----------------------------------------------------------------------------
-- 3. Branches (Module 11.2)
-- -----------------------------------------------------------------------------
create table if not exists public.branches (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 2 and 80),
  address    text check (address is null or length(address) <= 300),
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_branches_tenant on public.branches (tenant_id, is_active);

comment on table public.branches is
  'Physical locations owned by a tenant. Owner switches branch from the console top bar.';

-- The owner console reads and writes branches through the same tenant-scoped
-- route style it uses for leads; nothing sensitive lives in the row.
grant select, insert, update on public.branches to anon, authenticated;

-- Seed exactly one "Main Branch" per gym that has none, so the very first
-- render of the switcher already has something to select.
insert into public.branches (tenant_id, name)
select t.id, 'Main Branch'
  from public.tenants t
 where not exists (
   select 1 from public.branches b where b.tenant_id = t.id
 );

-- 3a. branch_id on the three filtered surfaces: the roster, the gate log and
--     the till's sales. Nullable on purpose — a punch through an unregistered
--     terminal or an old enrolment is "unassigned", not "wrong".
alter table if exists public.members
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

alter table if exists public.attendances
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

alter table if exists public.orders
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

alter table if exists public.invoices
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

create index if not exists idx_members_branch     on public.members (tenant_id, branch_id);
create index if not exists idx_attendances_branch on public.attendances (tenant_id, branch_id);
create index if not exists idx_orders_branch      on public.orders (tenant_id, branch_id);
create index if not exists idx_invoices_branch    on public.invoices (tenant_id, branch_id);

commit;

-- -----------------------------------------------------------------------------
-- What to eyeball after running this (RAISE NOTICE output in the SQL editor)
-- -----------------------------------------------------------------------------
do $$
begin
  raise notice 'tenants billing columns present (want 5): %',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants'
        and column_name in ('logo_url', 'address', 'gstin', 'gst_enabled', 'gst_rate_percent'));

  raise notice 'invoices new columns present (want 2): %',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices'
        and column_name in ('items', 'payment_reference'));

  raise notice 'branches table present=%, rows=%',
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'branches'),
    (select count(*) from public.branches);

  raise notice 'gyms without any branch (0 is ideal): %',
    (select count(*) from public.tenants t
      where not exists (select 1 from public.branches b where b.tenant_id = t.id));
end $$;

