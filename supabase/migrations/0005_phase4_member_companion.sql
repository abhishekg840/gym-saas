-- =============================================================================
-- 0005_phase4_member_companion.sql   (run after 0004_phase3_crm_trainer_store.sql)
--
-- ForgeOS Phase 4: the member companion app's own tables.
--
--   1. member_weights        -> the body-weight trend on the Health tab
--   2. workout_logs          -> the workout logger on the Training tab
--   3. store_reservations    -> "Reserve for desk pickup" from the Store tab
--   4. gym_announcements     -> the pinned notices on the member home screen
--   5. Member RPCs           -> the only way the browser reaches the four tables
--
-- Why RPCs rather than plain PostgREST reads: every layer of this app talks to
-- Postgres with the anon key, so a directly readable `workout_logs` table would
-- let anyone holding the public anon key page through every member's training
-- history. The four tables are revoked from anon/authenticated and reached only
-- through the SECURITY DEFINER functions at the bottom, which pin search_path
-- and re-resolve the tenant from the members row rather than trusting a
-- caller-supplied gym id.
--
-- Every statement is idempotent: safe to re-run in the SQL Editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Body weight trend (Module 4.2.1)
-- -----------------------------------------------------------------------------
-- One row per weigh-in. Several rows a day are allowed on purpose: the Health tab
-- charts the last N readings in logged_at order, so a member who weighs in
-- before and after a session sees both points instead of one being overwritten.
create table if not exists public.member_weights (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  member_id  uuid not null references public.members(id)  on delete cascade,
  weight_kg  numeric(5, 2) not null,
  logged_at  timestamptz not null default now()
);

-- The chart reads newest-first for exactly one member, so this index serves both
-- the history list and the "latest reading" lookup.
create index if not exists idx_member_weights_member_time
  on public.member_weights (member_id, logged_at desc);
create index if not exists idx_member_weights_tenant
  on public.member_weights (tenant_id);

do $$
begin
  -- 25-400 kg covers every human and catches the "kg typed into the lbs field"
  -- fat finger without blocking a genuine reading.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.member_weights'::regclass and conname = 'member_weights_kg_check'
  ) then
    alter table public.member_weights
      add constraint member_weights_kg_check
      check (weight_kg >= 25 and weight_kg <= 400);
  end if;

  -- Allow correcting a typo by backdating the entry rather than deleting history,
  -- but not by claiming a weigh-in from next week.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.member_weights'::regclass and conname = 'member_weights_logged_at_check'
  ) then
    alter table public.member_weights
      add constraint member_weights_logged_at_check
      check (logged_at <= now() + interval '1 day');
  end if;
end $$;

comment on column public.member_weights.weight_kg is 'Body weight in kilograms (25-400).';
comment on column public.member_weights.logged_at  is 'When the weigh-in happened. Backdatable up to now.';

-- -----------------------------------------------------------------------------
-- 2. Workout logger (Module 4.3.1)
-- -----------------------------------------------------------------------------
-- One row per exercise set. The logger writes a set at a time, so `sets` is
-- normally 1 and the repetition chip is simply reps; it exists as a column so a
-- "3 x 12" entry can be recorded in one line.
create table if not exists public.workout_logs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  member_id       uuid not null references public.members(id)  on delete cascade,
  workout_split   text not null,
  exercise_name   text not null,
  sets            integer not null default 1,
  reps            integer not null,
  weight_used     numeric(6, 2) not null default 0,
  logged_at       timestamptz not null default now()
);

-- "Show me the last time I did Bench Press" is the tab's main read, and the
-- split filter rides along so each day-routine card can load its own list.
create index if not exists idx_workout_logs_member_time
  on public.workout_logs (member_id, logged_at desc);
create index if not exists idx_workout_logs_member_split
  on public.workout_logs (member_id, workout_split, logged_at desc);
create index if not exists idx_workout_logs_tenant
  on public.workout_logs (tenant_id);
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.workout_logs'::regclass and conname = 'workout_logs_split_check'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_split_check
      check (workout_split in ('Push', 'Pull', 'Legs', 'Cardio', 'Full Body'));
  end if;

  -- Rejects reps = 0 and the "typed my bodyweight into reps" case. The upper
  -- bound is deliberately loose: 200 bodyweight reps is a legitimate session and
  -- the gym's business is not to argue about it.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.workout_logs'::regclass and conname = 'workout_logs_reps_check'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_reps_check
      check (sets >= 1 and sets <= 20 and reps >= 1 and reps <= 500);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.workout_logs'::regclass and conname = 'workout_logs_weight_check'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_weight_check
      check (weight_used >= 0 and weight_used <= 1000);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.workout_logs'::regclass and conname = 'workout_logs_exercise_check'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_exercise_check
      check (length(trim(coalesce(exercise_name, ''))) > 0);
  end if;
end $$;

comment on column public.workout_logs.workout_split is 'Push / Pull / Legs / Cardio / Full Body.';
comment on column public.workout_logs.weight_used  is 'Load in kilograms. 0 for bodyweight moves.';

-- -----------------------------------------------------------------------------
-- 3. Desk-pickup reservations (Module 4.4.1)
-- -----------------------------------------------------------------------------
-- A reservation does NOT decrement stock: the units leave the shelf when the desk
-- hands them over, which is fn_store_fulfil_reservation below. Stock moves on
-- fulfilment so a cancelled reservation never invents stock that was not there.
create table if not exists public.store_reservations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id)  on delete cascade,
  member_id    uuid not null references public.members(id)   on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  quantity     integer not null default 1,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  collected_at timestamptz null
);

-- The member's "my reservations" strip and the desk's pickup queue are both
-- "newest first for one scope", so both read these two indexes.
create index if not exists idx_store_reservations_member
  on public.store_reservations (member_id, created_at desc);
create index if not exists idx_store_reservations_queue
  on public.store_reservations (tenant_id, status, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.store_reservations'::regclass and conname = 'store_reservations_status_check'
  ) then
    alter table public.store_reservations
      add constraint store_reservations_status_check
      check (status in ('pending', 'picked_up', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.store_reservations'::regclass and conname = 'store_reservations_qty_check'
  ) then
    alter table public.store_reservations
      add constraint store_reservations_qty_check
      check (quantity >= 1 and quantity <= 20);
  end if;

  -- collected_at must agree with status: a cancelled order cannot have been
  -- collected, and a picked-up one must say when.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.store_reservations'::regclass and conname = 'store_reservations_collected_check'
  ) then
    alter table public.store_reservations
      add constraint store_reservations_collected_check
      check (
        (status = 'picked_up' and collected_at is not null)
        or (status <> 'picked_up' and collected_at is null)
      );
  end if;
end $$;

comment on column public.store_reservations.status       is 'pending -> picked_up | cancelled.';
comment on column public.store_reservations.collected_at is 'Set by fn_store_fulfil_reservation only.';
-- -----------------------------------------------------------------------------
-- 4. Pinned gym announcements (Module 4.1.3)
-- -----------------------------------------------------------------------------
create table if not exists public.gym_announcements (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  title      text not null,
  message    text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_gym_announcements_tenant_active
  on public.gym_announcements (tenant_id, is_active, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.gym_announcements'::regclass and conname = 'gym_announcements_title_check'
  ) then
    alter table public.gym_announcements
      add constraint gym_announcements_title_check
      check (length(trim(coalesce(title, ''))) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.gym_announcements'::regclass and conname = 'gym_announcements_message_check'
  ) then
    alter table public.gym_announcements
      add constraint gym_announcements_message_check
      check (length(trim(coalesce(message, ''))) > 0);
  end if;
end $$;

comment on table public.gym_announcements is
  'Pinned notices on the member home screen. is_active = false hides without deleting.';

-- -----------------------------------------------------------------------------
-- 5. Lock the four tables out of PostgREST, then expose narrow RPCs
-- -----------------------------------------------------------------------------
revoke all on public.member_weights     from anon, authenticated;
revoke all on public.workout_logs       from anon, authenticated;
revoke all on public.store_reservations from anon, authenticated;
revoke all on public.gym_announcements  from anon, authenticated;

-- -- 5a. Member dashboard bundle: everything the four tabs need in one round trip.
create or replace function public.fn_member_companion_data(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant        uuid;
  v_member        jsonb;
  v_trainer       jsonb;
  v_weights       jsonb;
  v_workouts      jsonb;
  v_reservations  jsonb;
  v_announcements jsonb;
begin
  -- The member's own tenant is read from the members row rather than taken from
  -- the caller, so a guessed member id cannot reach another gym's data.
  select m.tenant_id into v_tenant
    from public.members m
   where m.id = p_member_id;

  if v_tenant is null then
    raise exception 'Member not found';
  end if;

  select jsonb_build_object(
           'id', m.id,
           'full_name', m.full_name,
           'phone', m.phone,
           'membership_end', m.membership_end,
           'is_frozen', coalesce(m.is_frozen, false),
           'freeze_end_date', m.freeze_end_date,
           'status', m.status
         )
    into v_member
    from public.members m
   where m.id = p_member_id;

  -- Trainers are a tenant-level roster, so take the first active one as the
  -- member's point of contact. NULL is fine: the tab simply renders no card.
  select jsonb_build_object(
           'id', t.id,
           'name', t.name,
           'phone', t.phone,
           'specialization', t.specialization
         )
    into v_trainer
    from public.trainers t
   where t.tenant_id = v_tenant and t.is_active
   order by t.created_at
   limit 1;

  -- 30 weigh-ins is a couple of months of trend: enough to draw a line, small
  -- enough that a member with years of history does not ship all of it to a phone.
  select coalesce(jsonb_agg(jsonb_build_object(
             'id', w.id,
             'weight_kg', w.weight_kg,
             'logged_at', w.logged_at
           ) order by w.logged_at desc), '[]'::jsonb)
    into v_weights
    from (
      select id, weight_kg, logged_at
        from public.member_weights
       where member_id = p_member_id and tenant_id = v_tenant
       order by logged_at desc
       limit 30
    ) w;

  -- 60 sets covers roughly the last fortnight of a 4-day split.
  select coalesce(jsonb_agg(jsonb_build_object(
             'id', wl.id,
             'workout_split', wl.workout_split,
             'exercise_name', wl.exercise_name,
             'sets', wl.sets,
             'reps', wl.reps,
             'weight_used', wl.weight_used,
             'logged_at', wl.logged_at
           ) order by wl.logged_at desc), '[]'::jsonb)
    into v_workouts
    from (
      select id, workout_split, exercise_name, sets, reps, weight_used, logged_at
        from public.workout_logs
       where member_id = p_member_id and tenant_id = v_tenant
       order by logged_at desc
       limit 60
    ) wl;
select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id,
             'product_id', r.product_id,
             'product_name', r.product_name,
             'quantity', r.quantity,
             'status', r.status,
             'created_at', r.created_at
           ) order by r.created_at desc), '[]'::jsonb)
    into v_reservations
    from (
      select r.id, r.product_id, r.quantity, r.status, r.created_at,
             coalesce(p.name, 'Item') as product_name
        from public.store_reservations r
        left join public.products p on p.id = r.product_id
       where r.member_id = p_member_id and r.tenant_id = v_tenant
       order by r.created_at desc
       limit 30
    ) r;

  -- Only active notices, newest first. The member screen shows the top three.
  select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.id,
             'title', a.title,
             'message', a.message,
             'created_at', a.created_at
           ) order by a.created_at desc), '[]'::jsonb)
    into v_announcements
    from (
      select id, title, message, created_at
        from public.gym_announcements
       where tenant_id = v_tenant and is_active
       order by created_at desc
       limit 10
    ) a;

  return jsonb_build_object(
    'member', v_member,
    'tenant_id', v_tenant,
    'trainer', v_trainer,
    'weights', v_weights,
    'workouts', v_workouts,
    'reservations', v_reservations,
    'announcements', v_announcements
  );
end;
$$;

-- -- 5b. Append a weigh-in.
create or replace function public.fn_member_log_weight(
  p_member_id uuid,
  p_weight_kg  numeric,
  p_logged_at  timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_id     uuid;
begin
  if p_weight_kg is null or p_weight_kg < 25 or p_weight_kg > 400 then
    raise exception 'Enter a weight between 25 and 400 kg';
  end if;

  select tenant_id into v_tenant from public.members where id = p_member_id;
  if v_tenant is null then
    raise exception 'Member not found';
  end if;

  insert into public.member_weights (tenant_id, member_id, weight_kg, logged_at)
  values (v_tenant, p_member_id, round(p_weight_kg, 2), coalesce(p_logged_at, now()))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- -- 5c. Append a logged set.
create or replace function public.fn_member_log_workout(
  p_member_id   uuid,
  p_split       text,
  p_exercise    text,
  p_sets        integer default 1,
  p_reps        integer,
  p_weight_used numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_id     uuid;
begin
  if p_split not in ('Push', 'Pull', 'Legs', 'Cardio', 'Full Body') then
    raise exception 'Unknown workout split';
  end if;
  if p_exercise is null or length(trim(p_exercise)) = 0 then
    raise exception 'Exercise name is required';
  end if;
  if coalesce(p_sets, 1) < 1 or p_sets > 20 then
    raise exception 'Sets must be between 1 and 20';
  end if;
  if p_reps is null or p_reps < 1 or p_reps > 500 then
    raise exception 'Reps must be between 1 and 500';
  end if;
  if coalesce(p_weight_used, 0) < 0 or p_weight_used > 1000 then
    raise exception 'Weight must be between 0 and 1000 kg';
  end if;

  select tenant_id into v_tenant from public.members where id = p_member_id;
  if v_tenant is null then
    raise exception 'Member not found';
  end if;

  insert into public.workout_logs (
    tenant_id, member_id, workout_split, exercise_name, sets, reps, weight_used
  )
  values (
    v_tenant, p_member_id, p_split, trim(p_exercise),
    coalesce(p_sets, 1), p_reps, round(coalesce(p_weight_used, 0), 2)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
-- -- 5d. Reserve a product for desk pickup.
-- Idempotent per product: reserving the same item twice folds into one pending
-- line with the quantity topped up, so a double-tapped button does not create
-- two rows and a member cannot quietly hold the shelf for two reservations.
create or replace function public.fn_member_reserve_product(
  p_member_id  uuid,
  p_product_id uuid,
  p_quantity   integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_product  record;
  v_existing uuid;
begin
  if coalesce(p_quantity, 1) < 1 or p_quantity > 20 then
    raise exception 'Quantity must be between 1 and 20';
  end if;

  select tenant_id into v_tenant from public.members where id = p_member_id;
  if v_tenant is null then
    raise exception 'Member not found';
  end if;

  -- Scope the product read to this member's gym: a product id belonging to
  -- another tenant must not be reservable here.
  select p.id, p.name, p.stock_quantity
    into v_product
    from public.products p
   where p.id = p_product_id and p.tenant_id = v_tenant;

  if v_product.id is null then
    raise exception 'That product is not available at your gym';
  end if;

  -- Advisory lock so two concurrent taps serialise here instead of both passing
  -- the "already reserved?" check and then each taking the insert path.
  perform pg_advisory_xact_lock(hashtext(p_product_id::text));

  select r.id into v_existing
    from public.store_reservations r
   where r.member_id = p_member_id
     and r.product_id = p_product_id
     and r.status = 'pending'
   limit 1;

  if v_existing is not null then
    -- Top up the existing line, capped so the total can never exceed the shelf.
    update public.store_reservations
       set quantity = least(
             quantity + coalesce(p_quantity, 1),
             20,
             greatest(v_product.stock_quantity, 0)
           )
     where id = v_existing
     returning id into v_existing;

    return jsonb_build_object(
      'ok', true, 'id', v_existing, 'merged', true, 'product_name', v_product.name
    );
  end if;

  -- A reservation is a promise to the member, not a stock movement, so the units
  -- are still physically there: refuse only when the shelf is already empty.
  if v_product.stock_quantity < coalesce(p_quantity, 1) then
    raise exception 'Only % left in stock', v_product.stock_quantity;
  end if;

  insert into public.store_reservations (tenant_id, member_id, product_id, quantity)
  values (v_tenant, p_member_id, p_product_id, coalesce(p_quantity, 1))
  returning id into v_existing;

  return jsonb_build_object(
    'ok', true, 'id', v_existing, 'merged', false, 'product_name', v_product.name
  );
end;
$$;

-- -- 5e. Cancel a pending reservation. collected_at stays NULL, which the table
--      CHECK requires for the cancelled state.
create or replace function public.fn_member_cancel_reservation(
  p_member_id      uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.store_reservations r
     set status = 'cancelled'
   where r.id = p_reservation_id
     and r.member_id = p_member_id
     and r.status = 'pending';

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'That reservation is no longer pending';
  end if;

  return jsonb_build_object('ok', true, 'id', p_reservation_id, 'status', 'cancelled');
end;
$$;
-- -- 5f. Desk handover. The ONLY writer of collected_at and the only place
--      reservations touch stock, so a picked-up reservation can never be
--      replayed to decrement the shelf a second time.
create or replace function public.fn_store_fulfil_reservation(
  p_tenant_id      uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res  public.store_reservations%rowtype;
  v_left integer;
begin
  select r.* into v_res
    from public.store_reservations r
   where r.id = p_reservation_id
     and r.tenant_id = p_tenant_id;

  if v_res.id is null then
    raise exception 'Reservation not found for this gym';
  end if;

  -- Already picked_up or cancelled: refuse rather than double-decrement.
  if v_res.status <> 'pending' then
    raise exception 'Reservation is already %', v_res.status;
  end if;

  -- FOR UPDATE pins the shelf row for the rest of the transaction, so two desks
  -- handing out the last unit at the same moment cannot both pass the check.
  select p.stock_quantity into v_left
    from public.products p
   where p.id = v_res.product_id and p.tenant_id = p_tenant_id
     for update;

  if v_left is null then
    raise exception 'Product no longer exists';
  end if;

  if v_left < v_res.quantity then
    raise exception 'Only % left on the shelf', v_left;
  end if;

  update public.products
     set stock_quantity = stock_quantity - v_res.quantity
   where id = v_res.product_id and tenant_id = p_tenant_id;

  -- status and collected_at move together: the CHECK constraint rejects one
  -- without the other, so this can never half-apply.
  update public.store_reservations
     set status = 'picked_up', collected_at = now()
   where id = v_res.id and status = 'pending';

  return jsonb_build_object(
    'ok', true,
    'id', v_res.id,
    'quantity', v_res.quantity,
    'stock_left', v_left - v_res.quantity
  );
end;
$$;

-- -- 5g. Owner-facing announcement writer (posted from the gym side, not the app).
create or replace function public.fn_gym_post_announcement(
  p_tenant_id uuid,
  p_title     text,
  p_message   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Title is required';
  end if;
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'Message is required';
  end if;

  insert into public.gym_announcements (tenant_id, title, message)
  values (p_tenant_id, trim(p_title), trim(p_message))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- The member app reads its bundle and writes its own rows. The desk function is
-- granted too because the counter's Scan page runs in the same browser session.
grant execute on function
  public.fn_member_companion_data(uuid),
  public.fn_member_log_weight(uuid, numeric, timestamptz),
  public.fn_member_log_workout(uuid, text, text, integer, integer, numeric),
  public.fn_member_reserve_product(uuid, uuid, integer),
  public.fn_member_cancel_reservation(uuid, uuid),
  public.fn_store_fulfil_reservation(uuid, uuid),
  public.fn_gym_post_announcement(uuid, text, text)
to anon, authenticated;

commit;

-- -----------------------------------------------------------------------------
-- What to eyeball after running this (RAISE NOTICE output in the SQL editor)
-- -----------------------------------------------------------------------------
do $$
begin
  raise notice 'Phase 4 tables present (want 4): %',
    (select count(*) from information_schema.tables
      where table_schema = 'public'
        and table_name in ('member_weights', 'workout_logs',
                           'store_reservations', 'gym_announcements'));

  raise notice 'Phase 4 RPCs present (want 7): %',
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('fn_member_companion_data', 'fn_member_log_weight',
                          'fn_member_log_workout', 'fn_member_reserve_product',
                          'fn_member_cancel_reservation', 'fn_store_fulfil_reservation',
                          'fn_gym_post_announcement'));

  raise notice 'orphan weights (want 0): %',
    (select count(*) from public.member_weights w
      where not exists (select 1 from public.members m where m.id = w.member_id));

  raise notice 'orphan workout logs (want 0): %',
    (select count(*) from public.workout_logs l
      where not exists (select 1 from public.members m where m.id = l.member_id));

  raise notice 'reservations by status: %',
    (select coalesce(string_agg(status || '=' || n, ', ' order by status), '(none yet)')
       from (select status, count(*) as n from public.store_reservations group by status) s);
end $$;

commit;