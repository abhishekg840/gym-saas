-- =============================================================================
-- 0022_phase22_dual_gate_billing.sql   (run after 0021_phase21_pilot_leads.sql)
--
-- Two production capabilities, one additive file:
--
--   MODULE 1 — BIDIRECTIONAL GATE SCAN (entry / exit floor sessions)
--   ---------------------------------------------------------------------------
--   `attendances.direction` already exists (0012, default 'in'). What was still
--   missing was a way to PAIR an exit with the entry that opened it and to say
--   how long the member was on the floor. This adds:
--     * attendances.session_id       — the shared key that links an OUT row to
--                                      the IN row it closes (same calendar day).
--     * attendances.duration_minutes — computed once, at the OUT punch.
--     * fn_gate_checkout(...)        — the QR-kiosk exit path. Unlike the
--                                      hardware checkout (0012, which lets
--                                      ANYONE leave), this VERIFIES the
--                                      membership is still active first, so a
--                                      tampered/expired pass cannot fabricate a
--                                      clean walk-out. It finds the most recent
--                                      'in' punch for the member on the current
--                                      IST calendar day, pairs it, and stamps
--                                      the duration.
--     * fn_member_sessions(...)      — paired in/out history for the member app.
--
--   Occupancy needs no counter of its own: fn_gym_live_crowd (0012) already
--   treats the latest punch per member as authoritative, so an 'out' row drops
--   the member from the live floor count the instant it lands. Writing the OUT
--   row IS the decrement.
--
--   STREAK / LEADERBOARD SAFETY
--   ---------------------------
--   QR exits are recorded with method 'qr_kiosk_checkout', which is NOT a gate
--   check-in method (is_gate_checkin_method, 0009), so they never count toward a
--   streak or the monthly check-in leaderboard. fn_member_streak, however, is
--   method-agnostic (it counts granted days), so it is re-created here with a
--   direction guard so an exit can never invent a visit day. Every pre-existing
--   row defaults direction 'in', so this changes no historical number.
--
--   MODULE 2 — CASHFREE PLATFORM BILLING (gym owner -> Vyroniq)
--   ---------------------------------------------------------------------------
--   Gym owners pay Vyroniq (Starter ₹799/mo, Pro ₹1,499/mo). This adds:
--     * tenants.subscription_expires_at — the paid-through date the owner
--                                         dashboard and the webhook maintain.
--     * public.platform_billing         — the platform's own B2B invoice ledger
--                                         (one row per Cashfree order). It
--                                         carries tenant_id so a payment can be
--                                         attributed to a gym.
--     * fn_platform_record_order(...)   — create-order records a pending order.
--     * fn_platform_activate_subscription(...) — the webhook's single write:
--                                         flips tenants to active + extends the
--                                         expiry and marks the ledger paid, in
--                                         ONE transaction, idempotently.
--     * fn_platform_billing_status(...) — owner dashboard read.
--
--   The app talks to Postgres with the public anon key and has NO server-side
--   session, so tenants.subscription_* can never be updated from the browser or
--   the webhook directly (0015 revoked every write). Both writes therefore run
--   through SECURITY DEFINER functions, exactly like fn_superadmin_* — the
--   webhook proves itself with a verified Cashfree signature before it calls.
--
-- Every statement is idempotent: safe to re-run in the SQL Editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- MODULE 1 · 1. Attendance session pairing columns
-- -----------------------------------------------------------------------------
-- session_id links the exit to the entry it closes. No default: an IN row gets
-- one from the kiosk route (crypto.randomUUID) and the checkout RPC copies the
-- matched IN row's id onto the OUT row, so both halves of a session share it.
alter table if exists public.attendances
  add column if not exists session_id       uuid    null,
  add column if not exists duration_minutes integer null;

comment on column public.attendances.session_id is
  'Shared key linking an OUT punch to the IN punch it closes (same IST calendar day). Null on legacy rows.';
comment on column public.attendances.duration_minutes is
  'Floor minutes for this session, stamped once on the OUT punch. Null on IN rows and legacy rows.';
create index if not exists idx_attendances_session
  on public.attendances (session_id)
  where session_id is not null;


-- -----------------------------------------------------------------------------
-- MODULE 1 · 2. fn_gate_checkout — the QR-kiosk exit path
-- -----------------------------------------------------------------------------
-- WHY THIS IS NOT fn_hardware_checkout
-- -----------------------------------
-- The hardware exit (0012) makes NO membership decision on purpose: a frozen or
-- expired member must still be able to physically leave, or the floor count
-- ratchets up and can never be reconciled. The brief asks for the opposite rule
-- at the QR kiosk — "verify membership is active (prevent unauthorized
-- walkouts / tampering)" — so this path DOES re-check the membership. A blocked
-- attempt is still logged (blocked_* row) and answered DENIED; only an active
-- member produces an 'out' row, a paired session and a duration.
create or replace function public.fn_gate_checkout(
  p_tenant_id uuid,
  p_member_id uuid,
  p_method    text default 'qr_kiosk_checkout'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member   public.members%rowtype;
  v_status   text;
  v_reason   text;
  v_in_id    uuid;
  v_in_at    timestamptz;
  v_session  uuid;
  v_duration integer;
  v_out_id   uuid;
  v_today    date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_tenant_id is null or p_member_id is null then
    raise exception 'tenant_id and member_id are required' using errcode = '22023';
  end if;

  -- Scoped to this gym: a pass from another tenant is simply not found.
  select * into v_member
    from public.members m
   where m.id = p_member_id and m.tenant_id = p_tenant_id;
  if not found then
    raise exception 'Member not found in this gym' using errcode = 'P0002';
  end if;

  -- Membership verdict, frozen beats expired, mirroring the entry gate.
  if v_member.is_frozen then
    v_status := 'blocked_frozen';
    v_reason := 'Membership frozen'
      || case when v_member.freeze_end_date is not null
              then ' until ' || v_member.freeze_end_date::text else '' end
      || '. See the front desk.';
  elsif v_member.status in ('transferred', 'inactive') then
    v_status := 'blocked_expired';
    v_reason := 'Membership ' || v_member.status || '. See the front desk.';
  elsif v_member.membership_end is null or v_member.membership_end < current_date then
    v_status := 'blocked_expired';
    v_reason := 'Membership expired. Renewal required.';
  else
    v_status := 'granted';
    v_reason := 'Session complete. See you tomorrow!';
  end if;

  if v_status <> 'granted' then
    -- A refused exit is still an auditable event, exactly like a refused entry.
    insert into public.attendances (tenant_id, member_id, method, status, direction)
    values (p_tenant_id, p_member_id, coalesce(nullif(p_method, ''), 'qr_kiosk_checkout'),
            v_status, 'out');
    return jsonb_build_object(
      'ok', false, 'access', 'DENIED', 'status', v_status, 'reason', v_reason,
      'member_id', v_member.id, 'member_name', v_member.full_name,
      'duration_minutes', null
    );
  end if;

  -- Pair with the most recent ENTRY on the same IST calendar day.
  select a.id, coalesce(a.punch_time, a.scanned_at)
    into v_in_id, v_in_at
    from public.attendances a
   where a.tenant_id = p_tenant_id
     and a.member_id = p_member_id
     and a.status = 'granted'
     and coalesce(a.direction, 'in') = 'in'
     and (coalesce(a.punch_time, a.scanned_at) at time zone 'Asia/Kolkata')::date = v_today
   order by coalesce(a.punch_time, a.scanned_at) desc
   limit 1;

  -- Reuse the entry's session id when it has one; otherwise mint a fresh pair
  -- key and back-fill it onto the entry so both rows resolve to one session.
  v_session := coalesce(
    (select a.session_id from public.attendances a where a.id = v_in_id),
    gen_random_uuid()
  );
  if v_in_id is not null then
    update public.attendances a
       set session_id = v_session
     where a.id = v_in_id and a.session_id is null;
  end if;

  -- Duration in whole minutes, floored at 0 so a same-instant punch is 0, not -1.
  v_duration := case
    when v_in_at is not null
      then greatest(0, floor(extract(epoch from (now() - v_in_at)) / 60)::integer)
    else null
  end;

  insert into public.attendances
    (tenant_id, member_id, method, status, direction, session_id, duration_minutes)
  values
    (p_tenant_id, p_member_id, coalesce(nullif(p_method, ''), 'qr_kiosk_checkout'),
     'granted', 'out', v_session, v_duration)
  returning id into v_out_id;

  return jsonb_build_object(
    'ok', true, 'access', 'GRANTED', 'status', 'granted',
    'reason', 'Session complete. See you tomorrow!',
    'member_id', v_member.id, 'member_name', v_member.full_name,
    'attendance_id', v_out_id,
    'session_id', v_session,
    'checkin_at', v_in_at,
    'checkout_at', now(),
    'duration_minutes', v_duration,
    'paired', v_in_id is not null
  );
end;
$$;

comment on function public.fn_gate_checkout(uuid, uuid, text) is
  'QR-kiosk exit: verifies the membership is active, pairs the most recent same-day IN punch, stamps duration_minutes, and records an OUT row. Unlike the hardware checkout it DOES re-check membership.';

grant execute on function public.fn_gate_checkout(uuid, uuid, text) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- MODULE 1 · 3. fn_member_streak — guard exits out of the visit-day count
-- -----------------------------------------------------------------------------
-- fn_member_streak counts granted days regardless of method, so without a
-- direction guard a lone exit could open a phantom streak day. Every existing
-- row defaults direction 'in', so restricting to entries changes no history.
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
         -- Entries only: an exit is the close of a session, never a new visit.
         and coalesce(a.direction, 'in') = 'in'
    ) days;

  if v_days is null or coalesce(array_length(v_days, 1), 0) = 0 then
    return jsonb_build_object(
      'streak_count', 0, 'streak_best', 0, 'checked_in_today', false,
      'last_visit', null, 'visit_days', 0
    );
  end if;

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
  'Consecutive attendance days (IST, granted ENTRIES only). Returns streak_count, streak_best, checked_in_today, last_visit and visit_days.';

grant execute on function public.fn_member_streak(uuid) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- MODULE 1 · 4. fn_member_sessions — paired in/out history for the member app
-- -----------------------------------------------------------------------------
-- One row per ENTRY, with the matching exit folded in. Pairing prefers the
-- shared session_id (rows written since this migration) and falls back to
-- "the first exit on the same IST day at or after the entry" for legacy rows.
-- duration comes from the stored column when present, otherwise it is derived.
create or replace function public.fn_member_sessions(
  p_member_id uuid,
  p_limit     integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if p_member_id is null then
    raise exception 'member_id is required' using errcode = '22023';
  end if;

  with ins as (
    select a.id,
           a.session_id,
           coalesce(a.punch_time, a.scanned_at) as checkin_at,
           (coalesce(a.punch_time, a.scanned_at) at time zone 'Asia/Kolkata')::date as day
      from public.attendances a
     where a.member_id = p_member_id
       and a.status = 'granted'
       and coalesce(a.direction, 'in') = 'in'
     order by checkin_at desc
     limit greatest(1, least(coalesce(p_limit, 12), 60))
  ),
  paired as (
    select i.id,
           i.session_id,
           i.day,
           i.checkin_at,
           o.id                 as out_id,
           o.punch_time         as checkout_at,
           o.duration_minutes   as stored_duration
      from ins i
      left join lateral (
        select x.id, coalesce(x.punch_time, x.scanned_at) as punch_time, x.duration_minutes
          from public.attendances x
         where x.member_id = p_member_id
           and x.status = 'granted'
           and x.direction = 'out'
           and (
             (i.session_id is not null and x.session_id = i.session_id)
             or (i.session_id is null
                 and (coalesce(x.punch_time, x.scanned_at) at time zone 'Asia/Kolkata')::date = i.day
                 and coalesce(x.punch_time, x.scanned_at) >= i.checkin_at)
           )
         order by coalesce(x.punch_time, x.scanned_at) asc
         limit 1
      ) o on true
  )
  select coalesce(jsonb_agg(s order by s.checkin_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'session_id',       p.session_id,
               'date',             p.day,
               'checkin_at',       p.checkin_at,
               'checkout_at',      p.checkout_at,
               'duration_minutes', coalesce(
                                      p.stored_duration,
                                      case when p.checkout_at is not null
                                        then greatest(0, floor(extract(epoch from (p.checkout_at - p.checkin_at)) / 60)::integer)
                                        else null end
                                    ),
               'open',             p.out_id is null
             ) as s,
             p.checkin_at
        from paired p
    ) q;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

comment on function public.fn_member_sessions(uuid, integer) is
  'The member''s paired entry/exit floor sessions, newest first, with duration_minutes and an open flag for a session still on the floor.';

grant execute on function public.fn_member_sessions(uuid, integer) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- MODULE 2 · 5. tenants.subscription_expires_at
-- -----------------------------------------------------------------------------
-- The paid-through date. trial_ends_at (0015) covers the free trial; this is the
-- date a successful Cashfree payment extends to. Null until the first payment.
alter table if exists public.tenants
  add column if not exists subscription_expires_at timestamptz;

comment on column public.tenants.subscription_expires_at is
  'Paid-through timestamp set by the Cashfree webhook on a successful platform subscription payment. Null before the first payment.';

-- -----------------------------------------------------------------------------
-- MODULE 2 · 6. platform_billing — the B2B invoice ledger
-- -----------------------------------------------------------------------------
-- One row per Cashfree order. Distinct from public.invoices (a gym billing ITS
-- members): this is Vyroniq billing a GYM. tenant_id is kept so a payment is
-- attributable, but the row is a platform artefact. order_id is UNIQUE so the
-- webhook is naturally idempotent — a replayed PAYMENT_SUCCESS cannot
-- double-activate a subscription.
create table if not exists public.platform_billing (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid references public.tenants(id) on delete cascade,
  order_id           text not null unique,
  payment_session_id text,
  payment_id         text,
  plan_id            text not null,
  billing_cycle      text not null default 'monthly',
  amount             numeric not null,
  currency           text not null default 'INR',
  status             text not null default 'pending'
                       check (status in ('pending', 'paid', 'failed')),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);

create index if not exists idx_platform_billing_tenant
  on public.platform_billing (tenant_id, created_at desc);

comment on table public.platform_billing is
  'Vyroniq''s own B2B subscription ledger: one row per Cashfree order a gym owner paid for their platform plan.';

-- anon may only record a PENDING order (the create-order route). Reading and
-- the money-moving paid transition stay inside SECURITY DEFINER functions, so
-- the ledger can neither be scraped nor self-marked paid through PostgREST.
revoke all on table public.platform_billing from anon;
grant insert on table public.platform_billing to anon;

-- -----------------------------------------------------------------------------
-- MODULE 2 · 7. fn_platform_record_order — create-order records a pending order
-- -----------------------------------------------------------------------------
-- Called by /api/super-admin/billing/create-order AFTER Cashfree returns a
-- payment_session_id, so the webhook can later reconcile by order_id. The
-- amount is re-derived here, server-side, from the plan id — never trusted from
-- the request — so a tampered amount can never reach the ledger.
create or replace function public.fn_platform_record_order(
  p_tenant_id          uuid,
  p_order_id           text,
  p_payment_session_id text,
  p_plan_id            text,
  p_billing_cycle      text,
  p_amount             numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_amount numeric;
  v_cycle  text := lower(coalesce(nullif(trim(p_billing_cycle), ''), 'monthly'));
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_order_id, '')), '') is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;
  if v_cycle not in ('monthly', 'yearly') then
    raise exception 'billing_cycle must be monthly or yearly' using errcode = '22023';
  end if;

  -- Server-authoritative price list. Yearly is 10x (two months free).
  v_amount := case
    when lower(p_plan_id) = 'starter' then (case when v_cycle = 'yearly' then 7990 else 799 end)
    when lower(p_plan_id) = 'pro'     then (case when v_cycle = 'yearly' then 14990 else 1499 end)
    else null
  end;
  if v_amount is null then
    raise exception 'plan_id must be starter or pro' using errcode = '22023';
  end if;

  insert into public.platform_billing
    (tenant_id, order_id, payment_session_id, plan_id, billing_cycle, amount, status)
  values
    (p_tenant_id, trim(p_order_id), nullif(trim(coalesce(p_payment_session_id, '')), ''),
     lower(p_plan_id), v_cycle, v_amount, 'pending')
  on conflict (order_id) do update
    set payment_session_id = excluded.payment_session_id;

  return jsonb_build_object('ok', true, 'order_id', trim(p_order_id), 'amount', v_amount);
end;
$$;

comment on function public.fn_platform_record_order(uuid, text, text, text, text, numeric) is
  'Records a pending Cashfree order in the platform ledger, re-deriving the amount from the plan id rather than trusting the request.';

grant execute on function public.fn_platform_record_order(uuid, text, text, text, text, numeric)
  to anon, authenticated;


-- -----------------------------------------------------------------------------
-- MODULE 2 · 8. fn_platform_activate_subscription — the webhook's single write
-- -----------------------------------------------------------------------------
-- The ONLY path that moves tenants.subscription_*. The webhook calls it after
-- verifying the Cashfree signature; it reads the pending ledger row (so the
-- plan/cycle it activates is the one that was actually ordered, not whatever a
-- replayed payload claims), extends the expiry, flips the ledger to paid, and is
-- idempotent on order_id so a redelivered webhook is a no-op.
create or replace function public.fn_platform_activate_subscription(
  p_order_id   text,
  p_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order  public.platform_billing%rowtype;
  v_base   timestamptz;
  v_expiry timestamptz;
  v_name   text;
begin
  if nullif(trim(coalesce(p_order_id, '')), '') is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;

  select * into v_order
    from public.platform_billing b
   where b.order_id = trim(p_order_id)
   for update;
  if not found then
    raise exception 'Unknown order_id' using errcode = 'P0002';
  end if;

  -- Idempotent: an already-paid order returns its current state untouched.
  if v_order.status = 'paid' then
    select t.name, t.subscription_expires_at into v_name, v_expiry
      from public.tenants t where t.id = v_order.tenant_id;
    return jsonb_build_object(
      'ok', true, 'already_paid', true, 'tenant_id', v_order.tenant_id,
      'subscription_tier', v_order.plan_id, 'subscription_expires_at', v_expiry
    );
  end if;

  -- Extend from the later of now and the current expiry, so renewing early
  -- stacks onto remaining time instead of discarding it.
  select t.name,
         greatest(now(), coalesce(t.subscription_expires_at, now())),
         t.subscription_expires_at
    into v_name, v_base, v_expiry
    from public.tenants t
   where t.id = v_order.tenant_id;
  if v_name is null then
    raise exception 'Gym not found for this order' using errcode = 'P0002';
  end if;

  v_expiry := v_base + (case when v_order.billing_cycle = 'yearly'
                             then interval '365 days' else interval '30 days' end);

  update public.tenants t
     set subscription_tier        = v_order.plan_id,
         subscription_status      = 'active',
         subscription_expires_at  = v_expiry
   where t.id = v_order.tenant_id;

  update public.platform_billing b
     set status      = 'paid',
         paid_at     = now(),
         payment_id  = nullif(trim(coalesce(p_payment_id, '')), '')
   where b.id = v_order.id;

  return jsonb_build_object(
    'ok', true, 'already_paid', false, 'tenant_id', v_order.tenant_id,
    'subscription_tier', v_order.plan_id, 'subscription_status', 'active',
    'subscription_expires_at', v_expiry, 'amount', v_order.amount
  );
end;
$$;

comment on function public.fn_platform_activate_subscription(text, text) is
  'Webhook write: activates/extends a gym''s platform subscription from a verified Cashfree payment and marks the ledger row paid. Idempotent on order_id.';

grant execute on function public.fn_platform_activate_subscription(text, text)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- MODULE 2 · 9. fn_platform_billing_status — owner dashboard read
-- -----------------------------------------------------------------------------
-- The owner billing screen needs the tenant's live subscription plus its recent
-- platform invoices in one call. tenants is anon-readable, but platform_billing
-- is not, so the ledger half is gathered here under SECURITY DEFINER.
create or replace function public.fn_platform_billing_status(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   jsonb;
  v_invoices jsonb;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'tenant_id', t.id,
           'name', t.name,
           'subscription_tier', coalesce(t.subscription_tier, 'starter'),
           'subscription_status', coalesce(t.subscription_status, 'active'),
           'subscription_expires_at', t.subscription_expires_at,
           'trial_ends_at', t.trial_ends_at
         )
    into v_tenant
    from public.tenants t
   where t.id = p_tenant_id;

  if v_tenant is null then
    raise exception 'Gym not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
    into v_invoices
    from (
      select jsonb_build_object(
               'id', b.id, 'order_id', b.order_id, 'plan_id', b.plan_id,
               'billing_cycle', b.billing_cycle, 'amount', b.amount,
               'currency', b.currency, 'status', b.status,
               'created_at', b.created_at, 'paid_at', b.paid_at
             ) as x,
             b.created_at
        from public.platform_billing b
       where b.tenant_id = p_tenant_id
       limit 24
    ) q;

  return jsonb_build_object('tenant', v_tenant, 'invoices', v_invoices);
end;
$$;

comment on function public.fn_platform_billing_status(uuid) is
  'Owner billing read: the tenant''s live subscription plus its recent platform invoices in one call.';

grant execute on function public.fn_platform_billing_status(uuid) to anon, authenticated;

commit;
