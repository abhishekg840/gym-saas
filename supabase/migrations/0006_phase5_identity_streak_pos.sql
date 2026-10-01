-- =============================================================================
-- 0006_phase5_identity_streak_pos.sql   (run after 0005_phase4_member_companion.sql)
--
-- ForgeOS Phase 5: member identity, attendance streaks and the desk pickup queue.
--
--   1. members.username      -> a member can sign in with @handle or email
--      members.email         -> and an email address works as an identifier too
--   2. Streak engine         -> consecutive attendance days, Snapchat style
--   3. Self-service handle   -> fn_member_set_username renames what the gym minted
--   4. Companion bundle v2   -> fn_member_companion_data also returns the handle,
--                               the streak and the last visit
--   5. Desk pickup queue     -> fn_store_pending_reservations for the POS board and
--                               fn_store_complete_pickup for "Complete Pickup & Bill"
--
-- Geofencing is deliberately NOT touched here: Phase 5 removed the location lock
-- from the member pass entirely. The gym coordinates stay on public.tenants
-- because the owner Hardware Console still uses them for a distance self-check.
--
-- Every statement is idempotent: safe to re-run from the Supabase SQL Editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Member identity: a unique @handle on every member row
-- -----------------------------------------------------------------------------
-- Globally unique rather than unique-per-gym: the sign-in screen asks for one
-- string, and two members in two gyms both called @rahul would make that promise
-- a lie. The handle is what the member types, so it has to be unambiguous on its
-- own.
alter table if exists public.members add column if not exists username text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.members'::regclass and conname = 'members_username_format'
  ) then
    -- Lowercase letters, digits, dot and underscore, 3-24 characters. No spaces,
    -- no leading punctuation, and no '@' - the '@' is presentation, added by the
    -- app, so that "@Rahul" and "rahul" cannot become two accounts.
    alter table public.members
      add constraint members_username_format
      check (username is null or username ~ '^[a-z0-9][a-z0-9._]{2,23}$');
  end if;
end $$;

create unique index if not exists members_username_unique
  on public.members (lower(username))
  where username is not null;

create index if not exists members_tenant_username
  on public.members (tenant_id, username);

comment on column public.members.username is
  'Unique public handle. Sign-in accepts it with or without the leading @. Lowercase, 3-24 chars.';

-- ---- 1a. Email sign-in --------------------------------------------------------
-- The sign-in screen also accepts an email address. The column is added here
-- rather than assumed to exist: a gym that enrolled everyone by phone number has
-- no reason to have it, and the login route would answer 500 without it.
alter table if exists public.members add column if not exists email text;

-- Case-insensitive uniqueness, because "Rahul@Gym.com" and "rahul@gym.com" are one
-- mailbox and therefore one account. Legacy rows may already contain duplicates,
-- so a collision degrades to a plain lookup index instead of aborting the run -
-- the migration must stay safe to re-run on a live database.
do $$
begin
  begin
    create unique index if not exists members_email_unique
      on public.members (lower(email))
      where email is not null;
  exception when unique_violation then
    raise notice 'members.email has duplicate values; created members_email_lookup (non-unique) instead. Clean the duplicates and re-run to get the unique index.';
    create index if not exists members_email_lookup on public.members (lower(email));
  end;
end $$;

comment on column public.members.email is
  'Optional email address. Sign-in accepts it case-insensitively when present.';


-- ---- 1b. Backfill existing members -------------------------------------------
-- Two members enrolled in the same second must not collide, so the candidate is
-- checked against the whole table and extended with a counter until it is free.
do $$
declare
  r           record;
  v_base      text;
  v_digits    text;
  v_candidate text;
  v_suffix    integer;
begin
  for r in
    select id, full_name, phone
      from public.members
     where username is null
     order by created_at nulls first, id
  loop
    -- Name first, digits last: "rahulkumar021" reads like a handle, "a8f3c1" does not.
    v_base := lower(regexp_replace(coalesce(r.full_name, ''), '[^a-zA-Z0-9]', '', 'g'));
    if length(v_base) < 3 then
      v_base := 'member';
    end if;
    v_base := substr(v_base, 1, 16);

    v_digits := right(regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g'), 3);
    v_candidate := substr(v_base || coalesce(nullif(v_digits, ''), ''), 1, 24);

    -- A handle is a promise of uniqueness; step aside rather than fail the run.
    v_suffix := 1;
    while exists (select 1 from public.members m where lower(m.username) = v_candidate) loop
      v_suffix := v_suffix + 1;
      v_candidate := substr(v_base, 1, 20) || v_suffix::text;
    end loop;

    update public.members set username = v_candidate where id = r.id;
  end loop;
end $$;

-- ---- 1b. Auto-assign on enrolment -------------------------------------------
-- Every provisioning path (the dashboard form, fn_lead_convert_to_member, a raw
-- INSERT from the SQL editor) gets a handle without each path remembering to mint
-- one. Only fills a blank: a handle a member chose themselves is never overwritten.
create or replace function public.fn_members_assign_username()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_base      text;
  v_digits    text;
  v_candidate text;
  v_suffix    integer := 0;
begin
  if new.username is not null and length(trim(new.username)) > 0 then
    new.username := lower(regexp_replace(trim(new.username), '^@+', ''));
    return new;
  end if;

  v_base := lower(regexp_replace(coalesce(new.full_name, ''), '[^a-zA-Z0-9]', '', 'g'));
  if length(v_base) < 3 then
    v_base := 'member';
  end if;
  v_base := substr(v_base, 1, 16);

  v_digits := right(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), 3);

  loop
    v_suffix := v_suffix + 1;
    v_candidate := case
      when v_suffix = 1 then substr(v_base || coalesce(nullif(v_digits, ''), ''), 1, 24)
      else substr(v_base, 1, 20) || v_suffix::text
    end;

    exit when not exists (select 1 from public.members m where lower(m.username) = v_candidate);
  end loop;

  new.username := v_candidate;
  return new;
end;
$$;

drop trigger if exists trg_members_assign_username on public.members;
create trigger trg_members_assign_username
  before insert on public.members
  for each row execute function public.fn_members_assign_username();

comment on function public.fn_members_assign_username() is
  'Mints a unique @handle for every new member when none was supplied.';

-- -----------------------------------------------------------------------------
-- 2. Attendance streak
-- -----------------------------------------------------------------------------
-- A "day" means a calendar day in the gym's local time (IST), not a rolling 24
-- hours: a member who trains at 11:30 PM and again at 6:00 AM is on a two-day
-- streak, which is what they expect to see. A streak stays alive until the day
-- after the last visit ends, so a member who has not trained *yet today* still
-- sees yesterday's number rather than a zero that would punish them for it.
create or replace function public.fn_member_streak(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days   date[];
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_count  integer := 0;
  v_best   integer := 0;
  v_run    integer := 0;
  v_cursor date;
  v_total  integer := 0;
  i        integer;
begin
  select array_agg(d order by d desc), count(*)
    into v_days, v_total
    from (
      select distinct (a.punch_time at time zone 'Asia/Kolkata')::date as d
        from public.attendances a
       where a.member_id = p_member_id
         and a.status = 'granted'
         and a.punch_time is not null
    ) days;

  if v_days is null or coalesce(array_length(v_days, 1), 0) = 0 then
    return jsonb_build_object(
      'streak_count', 0,
      'streak_best', 0,
      'checked_in_today', false,
      'last_visit', null,
      'visit_days', 0
    );
  end if;

  -- ---- current streak, walking back from today or yesterday
  if v_days[1] >= v_today - 1 then
    v_count := 1;
    v_cursor := v_days[1];
    for i in 2 .. array_length(v_days, 1) loop
      if v_days[i] = v_cursor - 1 then
        v_count := v_count + 1;
        v_cursor := v_days[i];
      else
        exit;
      end if;
    end loop;
  end if;

  -- ---- best streak this member has ever put together
  v_best := 1;
  v_run := 1;
  v_cursor := v_days[1];
  for i in 2 .. array_length(v_days, 1) loop
    if v_days[i] = v_cursor - 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    if v_run > v_best then
      v_best := v_run;
    end if;
    v_cursor := v_days[i];
  end loop;

  return jsonb_build_object(
    'streak_count', v_count,
    'streak_best', greatest(v_best, v_count),
    'checked_in_today', v_days[1] = v_today,
    'last_visit', to_jsonb(v_days[1]),
    'visit_days', v_total
  );
end;
$$;

comment on function public.fn_member_streak(uuid) is
  'Consecutive attendance days (IST calendar days, status = granted). Returns streak_count, streak_best, checked_in_today, last_visit and visit_days.';

-- -----------------------------------------------------------------------------
-- 3. Self-service handle
-- -----------------------------------------------------------------------------
-- The auto-generated handle is derived from a name and a phone tail, which is
-- fine for signing in but rarely what someone wants on their own profile screen.
create or replace function public.fn_member_set_username(
  p_member_id uuid,
  p_username  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean text;
  v_taken text;
begin
  v_clean := lower(regexp_replace(trim(coalesce(p_username, '')), '^@+', ''));

  if v_clean !~ '^[a-z0-9][a-z0-9._]{2,23}$' then
    raise exception 'Pick a handle of 3 to 24 characters: letters, numbers, dot or underscore.'
      using errcode = '22023';
  end if;

  select m.username into v_taken
    from public.members m
   where lower(m.username) = v_clean
     and m.id <> p_member_id
   limit 1;

  if v_taken is not null then
    raise exception 'That handle is already taken. Try another one.' using errcode = '23505';
  end if;

  update public.members set username = v_clean where id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'username', v_clean);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Member dashboard bundle, v2 (adds the handle, the streak and the last visit)
-- -----------------------------------------------------------------------------
-- Same contract as Phase 4, plus the fields the Home and Profile tabs need. The
-- streak is computed in SQL rather than on the phone: the phone only ever holds
-- the last 30 weigh-ins and 60 sets, and would have to re-derive the run from a
-- truncated history every time it rendered.
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
  v_streak        jsonb;
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
           'username', m.username,
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

  v_streak := public.fn_member_streak(p_member_id);

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
    'announcements', v_announcements,
    'streak', v_streak
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Desk pickup queue (Store & POS)
-- -----------------------------------------------------------------------------
-- store_reservations is revoked from anon/authenticated, so the POS board cannot
-- read it directly: this is the only door. It is scoped by tenant, so one gym can
-- never see (or hand over) another gym's reservations.
create or replace function public.fn_store_pending_reservations(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows  jsonb;
  v_count integer := 0;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(row order by row ->> 'reserved_at'), '[]'::jsonb), count(*)
    into v_rows, v_count
    from (
      select jsonb_build_object(
               'id',               r.id,
               'member_id',        r.member_id,
               'member_name',      coalesce(m.full_name, 'Member'),
               'member_phone',     m.phone,
               'member_username',  m.username,
               'product_id',       r.product_id,
               'product_name',     coalesce(p.name, 'Item'),
               'product_category', p.category,
               'unit_price',       p.selling_price,
               'quantity',         r.quantity,
               'total_amount',     round(coalesce(p.selling_price, 0) * r.quantity, 2),
               'stock_available',  p.stock_quantity,
               'waiting_minutes',  greatest(
                 0,
                 floor(extract(epoch from (now() - r.created_at)) / 60)::integer
               ),
               'reserved_at',      r.created_at
             ) as row
        from public.store_reservations r
        left join public.members  m on m.id = r.member_id
        left join public.products p on p.id = r.product_id
       where r.tenant_id = p_tenant_id
         and r.status = 'pending'
    ) pending;

  return jsonb_build_object('ok', true, 'count', coalesce(v_count, 0), 'reservations', v_rows);
end;
$$;

comment on function public.fn_store_pending_reservations(uuid) is
  'Pending desk pickups for one gym, oldest first, with the member and product details the POS board shows.';

-- Completes a pickup and bills it in the same transaction: the shelf is
-- decremented by fn_store_fulfil_reservation, then an order row is written so the
-- takings land in the day's revenue like any counter sale.
create or replace function public.fn_store_complete_pickup(
  p_tenant_id      uuid,
  p_reservation_id uuid,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res     public.store_reservations%rowtype;
  v_product public.products%rowtype;
  v_member  public.members%rowtype;
  v_method  text := coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'Cash/UPI');
  v_line    jsonb;
  v_order   public.orders%rowtype;
  v_invoice uuid;
  v_stock   jsonb;
begin
  if p_tenant_id is null or p_reservation_id is null then
    raise exception 'tenant_id and reservation_id are required' using errcode = '22023';
  end if;

  select * into v_res
    from public.store_reservations r
   where r.id = p_reservation_id and r.tenant_id = p_tenant_id;

  if v_res.id is null then
    raise exception 'Reservation not found for this gym' using errcode = 'P0002';
  end if;

  select * into v_product
    from public.products p
   where p.id = v_res.product_id and p.tenant_id = p_tenant_id;

  if v_product.id is null then
    raise exception 'Product no longer exists' using errcode = 'P0002';
  end if;

  select * into v_member from public.members m where m.id = v_res.member_id;

  -- Stock move + status flip. Raises if the shelf cannot cover the promise.
  v_stock := public.fn_store_fulfil_reservation(p_tenant_id, p_reservation_id);

  v_line := jsonb_build_array(
    jsonb_build_object(
      'product_id', v_product.id,
      'name',       v_product.name,
      'category',   v_product.category,
      'quantity',   v_res.quantity,
      'price',      v_product.selling_price,
      'subtotal',   round(v_product.selling_price * v_res.quantity, 2)
    )
  );

  insert into public.orders (tenant_id, member_id, total_amount, payment_method, items)
  values (
    p_tenant_id,
    v_res.member_id,
    round(v_product.selling_price * v_res.quantity, 2),
    v_method,
    v_line
  )
  returning * into v_order;

  -- Mirrors fn_store_checkout: a ledger failure must never undo a handed-over item.
  begin
    insert into public.invoices (tenant_id, member_id, amount, payment_method, status)
    values (p_tenant_id, v_order.member_id, v_order.total_amount, v_method, 'paid')
    returning id into v_invoice;
  exception when others then
    v_invoice := null;
  end;

  return jsonb_build_object(
    'order_id',         v_order.id,
    'reservation_id',   v_res.id,
    'tenant_id',        v_order.tenant_id,
    'member_id',        v_order.member_id,
    'member_name',      v_member.full_name,
    'reservation_kind', 'desk_pickup',
    'is_walk_in',       v_order.member_id is null,
    'total_amount',     v_order.total_amount,
    'payment_method',   v_order.payment_method,
    'items',            v_order.items,
    'line_count',       jsonb_array_length(v_order.items),
    'created_at',       v_order.created_at,
    'invoice_id',       v_invoice,
    'revenue_logged',   v_invoice is not null,
    'stock_updates',    v_stock
  );
end;
$$;

comment on function public.fn_store_complete_pickup(uuid, uuid, text) is
  'Hands a reserved item over the desk, decrements stock and writes the bill in one transaction.';

-- A reservation the member never collects (or changed their mind about) is closed
-- here rather than deleted, so the history survives for the owner.
create or replace function public.fn_store_cancel_reservation(
  p_tenant_id      uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  update public.store_reservations r
     set status = 'cancelled'
   where r.id = p_reservation_id
     and r.tenant_id = p_tenant_id
     and r.status = 'pending'
  returning r.id into v_id;

  if v_id is null then
    raise exception 'That reservation is already closed or does not belong to this gym.'
      using errcode = '45001';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'cancelled');
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Grants - the member app and the counter may call these doors
-- -----------------------------------------------------------------------------
grant execute on function
  public.fn_member_streak(uuid),
  public.fn_member_set_username(uuid, text),
  public.fn_store_pending_reservations(uuid),
  public.fn_store_complete_pickup(uuid, uuid, text),
  public.fn_store_cancel_reservation(uuid, uuid)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- What to eyeball after running this (RAISE NOTICE output in the SQL editor)
-- -----------------------------------------------------------------------------
do $$
begin
  raise notice 'members.username column present (want 1): %',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'members' and column_name = 'username');

  raise notice 'members without a handle (want 0): %',
    (select count(*) from public.members where username is null);

  raise notice 'Phase 5 functions present (want 5): %',
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('fn_member_streak', 'fn_member_set_username',
                          'fn_store_pending_reservations', 'fn_store_complete_pickup',
                          'fn_store_cancel_reservation'));

  raise notice 'username trigger present (want 1): %',
    (select count(*) from pg_trigger where tgname = 'trg_members_assign_username');
end $$;

commit;

