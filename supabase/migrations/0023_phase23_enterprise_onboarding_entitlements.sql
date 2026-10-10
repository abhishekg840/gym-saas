-- =============================================================================
-- 0023_phase23_enterprise_onboarding_entitlements.sql
--            (run after 0022_phase22_dual_gate_billing.sql)
--
-- Three capabilities, one additive file:
--
--   MODULE 1 — BIDIRECTIONAL AUTO-GATE (entry/exit auto-detect)
--   One punch, direction decided by the member's own state today: fn_gate_auto_punch
--   (QR kiosk), fn_hardware_auto_punch (RFID/biometric), fn_device_tenant (routes).
--   An open session = the most recent GRANTED 'in' today (IST) with no later
--   granted 'out'; that punch's next scan is the OUT (pairs session_id, stamps
--   duration_minutes, drops the live crowd count). Anything else is an IN.
--
--   MODULE 2 — SELF-SERVE ONBOARDING (public checkout -> provisioned gym)
--   create-order records a PENDING onboarding_requests row + platform_billing
--   ledger row (tenant_id NULL). Only the HMAC-verified Cashfree webhook calls
--   fn_onboard_provision — ONE idempotent transaction keyed on order_id that
--   creates the tenant, provisions the owner credential and marks it paid.
--
--   MODULE 3 — ENTERPRISE CONTROL: ENTITLEMENTS, FLAGS, PLANS, AUDIT
--   fn_resolve_entitlements is the enforcement read: /api/store/*, /api/hardware/*
--   and the scan gates answer 403 when a feature is off or the gym is suspended.
--   Flags: tier default -> platform override -> per-gym override. Every
--   super-admin override writes an immutable audit row with a MANDATORY reason.
--
--   EXISTING DATA SAFETY: flags default TRUE; locks fire only on an explicit
--   suspension/expiry — a gym provisioned before this file keeps every feature.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- MODULE 1 · 1. fn_gate_auto_punch — one scan, direction auto-detected (QR)
-- -----------------------------------------------------------------------------
-- Membership verdict is IDENTICAL to fn_gate_checkout (0022): a frozen or
-- expired member may not fabricate a clean walk-out at the kiosk either.
create or replace function public.fn_gate_auto_punch(
  p_tenant_id uuid,
  p_member_id uuid,
  p_method    text default 'qr_kiosk_auto'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member    public.members%rowtype;
  v_status    text;
  v_reason    text;
  v_in_id     uuid;
  v_in_at     timestamptz;
  v_session   uuid;
  v_duration  integer;
  v_att_id    uuid;
  v_today     date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_tenant_id is null or p_member_id is null then
    raise exception 'tenant_id and member_id are required' using errcode = '22023';
  end if;

  select * into v_member
    from public.members m
   where m.id = p_member_id and m.tenant_id = p_tenant_id;
  if not found then
    raise exception 'Member not found in this gym' using errcode = 'P0002';
  end if;

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
    v_reason := null;
  end if;

  if v_status <> 'granted' then
    insert into public.attendances (tenant_id, member_id, method, status, direction)
    values (p_tenant_id, p_member_id, coalesce(nullif(p_method, ''), 'qr_kiosk_auto'),
            v_status, null);
    return jsonb_build_object(
      'ok', false, 'access', 'DENIED', 'code', v_status, 'direction', null,
      'reason', v_reason, 'member_id', v_member.id, 'member_name', v_member.full_name,
      'duration_minutes', null, 'session_id', null
    );
  end if;

  -- OPEN session today: the latest granted ENTRY with no granted exit after it.
  -- NOT EXISTS (rather than "latest punch is 'in'") so in-out-in-out can never
  -- pair an exit to an already-closed entry.
  select a.id, coalesce(a.punch_time, a.scanned_at)
    into v_in_id, v_in_at
    from public.attendances a
   where a.tenant_id = p_tenant_id
     and a.member_id = p_member_id
     and a.status = 'granted'
     and coalesce(a.direction, 'in') = 'in'
     and (coalesce(a.punch_time, a.scanned_at) at time zone 'Asia/Kolkata')::date = v_today
     and not exists (
       select 1 from public.attendances o
        where o.tenant_id = a.tenant_id
          and o.member_id = a.member_id
          and o.status = 'granted'
          and o.direction = 'out'
          and coalesce(o.punch_time, o.scanned_at) > coalesce(a.punch_time, a.scanned_at)
     )
   order by coalesce(a.punch_time, a.scanned_at) desc
   limit 1;

  if v_in_id is not null then
    -- OUT: reuse the open entry's session id (or mint + backfill), stamp the
    -- duration. The OUT row IS the occupancy decrement (fn_gym_live_crowd).
    v_session := coalesce(
      (select a.session_id from public.attendances a where a.id = v_in_id),
      gen_random_uuid()
    );
    update public.attendances a
       set session_id = v_session
     where a.id = v_in_id and a.session_id is null;

    v_duration := greatest(
      0, floor(extract(epoch from (now() - v_in_at)) / 60)::integer
    );

    insert into public.attendances
      (tenant_id, member_id, method, status, direction, session_id, duration_minutes)
    values
      (p_tenant_id, p_member_id, coalesce(nullif(p_method, ''), 'qr_kiosk_auto'),
       'granted', 'out', v_session, v_duration)
    returning id into v_att_id;

    return jsonb_build_object(
      'ok', true, 'access', 'GRANTED', 'code', 'granted', 'direction', 'out',
      'reason', 'Session complete. See you tomorrow!',
      'member_id', v_member.id, 'member_name', v_member.full_name,
      'membership_end', v_member.membership_end,
      'days_left', greatest(0, coalesce(v_member.membership_end - current_date, 0)),
      'attendance_id', v_att_id, 'session_id', v_session,
      'checkin_at', v_in_at, 'checkout_at', now(),
      'duration_minutes', v_duration
    );
  end if;

  -- IN: no open session today -> this scan opens one.
  v_session := gen_random_uuid();
  insert into public.attendances
    (tenant_id, member_id, method, status, direction, session_id)
  values
    (p_tenant_id, p_member_id, coalesce(nullif(p_method, ''), 'qr_kiosk_auto'),
     'granted', 'in', v_session)
  returning id into v_att_id;

  return jsonb_build_object(
    'ok', true, 'access', 'GRANTED', 'code', 'granted', 'direction', 'in',
    'reason', 'Entry recorded. Welcome!',
    'member_id', v_member.id, 'member_name', v_member.full_name,
    'membership_end', v_member.membership_end,
    'days_left', greatest(0, coalesce(v_member.membership_end - current_date, 0)),
    'attendance_id', v_att_id, 'session_id', v_session,
    'checkin_at', now(), 'duration_minutes', null
  );
end;
$$;

comment on function public.fn_gate_auto_punch(uuid, uuid, text) is
  'Auto-gate: decides IN vs OUT from the member''s own granted punches today (IST), pairs the open session and stamps duration on the OUT.';

grant execute on function public.fn_gate_auto_punch(uuid, uuid, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- MODULE 1 · 2. fn_device_tenant — which gym owns this machine token?
-- -----------------------------------------------------------------------------
-- The hardware ROUTES need the tenant BEFORE the punch runs so they can enforce
-- entitlements (Module 3) with a plain 403 instead of a door decision. One tiny
-- definer read, same 45005 contract as fn_hardware_punch for an unknown key.
create or replace function public.fn_device_tenant(p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.hardware_devices%rowtype;
begin
  if nullif(trim(coalesce(p_api_key, '')), '') is null then
    raise exception 'api_key is required' using errcode = '22023';
  end if;

  select * into v_device from public.hardware_devices where api_key = trim(p_api_key);
  if v_device.id is null then
    raise exception 'Unknown device api_key' using errcode = '45005';
  end if;

  return jsonb_build_object(
    'tenant_id',   v_device.tenant_id,
    'device_id',   v_device.id,
    'device_name', v_device.device_name,
    'device_type', v_device.device_type
  );
end;
$$;

comment on function public.fn_device_tenant(text) is
  'Resolves a machine api_key to its tenant + device for entitlement pre-checks in the hardware routes. 45005 for an unknown key, exactly like fn_hardware_punch.';

grant execute on function public.fn_device_tenant(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- MODULE 1 · 3. fn_hardware_auto_punch — RFID/biometric auto-direction
-- -----------------------------------------------------------------------------
-- Self-contained twin of fn_hardware_punch: same api-key gate, same heartbeat,
-- same credential resolution (biometric wins; RFID key resolves to the serial
-- first, mirroring the 0011 overload), same membership verdict — but the write
-- is auto-directed: an open session today closes with a paired OUT + duration,
-- anything else opens an IN with a fresh session id. fn_hardware_punch itself
-- is deliberately NOT modified (Phase 10 made it the single door authority and
-- field boards depend on its exact behaviour).
create or replace function public.fn_hardware_auto_punch(
  p_api_key      text,
  p_biometric_id integer default null,
  p_rfid_card    text    default null,
  p_rfid_uid     text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device    public.hardware_devices%rowtype;
  v_member    public.members%rowtype;
  v_key       text := nullif(trim(coalesce(p_rfid_uid, '')), '');
  v_card      text := nullif(trim(coalesce(p_rfid_card, '')), '');
  v_serial    text;
  v_found     integer := 0;
  v_method    text;
  v_status    text;
  v_reason    text;
  v_in_id     uuid;
  v_in_at     timestamptz;
  v_session   uuid;
  v_duration  integer;
  v_att_id    uuid;
  v_today     date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if nullif(trim(coalesce(p_api_key, '')), '') is null then
    raise exception 'api_key is required' using errcode = '22023';
  end if;
  if p_biometric_id is null and v_card is null and v_key is null then
    raise exception 'Send biometric_id or rfid_card' using errcode = '22023';
  end if;

  select * into v_device from public.hardware_devices where api_key = trim(p_api_key);
  if v_device.id is null then
    raise exception 'Unknown device api_key' using errcode = '45005';
  end if;

  -- A punch is proof of life: keep the console green without waiting 30s.
  update public.hardware_devices
     set last_heartbeat = now(), status = 'online'
   where id = v_device.id;

  -- RFID key -> serial resolution (the 0011 rule): a key match wins, otherwise
  -- fall back to whatever the caller sent, so an unknown key never discards a
  -- valid serial that the board put in the other field.
  if v_key is not null then
    select m.rfid_card into v_serial
      from public.members m
     where upper(trim(m.rfid_uid)) = upper(v_key)
       and m.rfid_card is not null
       and trim(m.rfid_card) <> ''
     limit 1;
    v_serial := coalesce(v_serial, v_card, v_key);
  else
    v_serial := v_card;
  end if;

  -- Biometric wins when a device sends both: a fingerprint is the stronger claim.
  if p_biometric_id is not null then
    v_method := 'biometric';
    select count(*) into v_found
      from public.members m
     where m.tenant_id = v_device.tenant_id and m.biometric_id = p_biometric_id;
    if v_found = 1 then
      select * into v_member
        from public.members m
       where m.tenant_id = v_device.tenant_id and m.biometric_id = p_biometric_id;
    end if;
  else
    v_method := 'rfid';
    select count(*) into v_found
      from public.members m
     where m.tenant_id = v_device.tenant_id
       and upper(trim(m.rfid_card)) = upper(v_serial);
    if v_found = 1 then
      select * into v_member
        from public.members m
       where m.tenant_id = v_device.tenant_id
         and upper(trim(m.rfid_card)) = upper(v_serial);
    end if;
  end if;

  if v_found <> 1 then
    return jsonb_build_object(
      'unlock', false,
      'code', case when v_found = 0 then 'unknown_credential' else 'ambiguous_credential' end,
      'reason', case when v_found = 0
                      then 'Access Denied: Card or finger is not enrolled in this gym'
                      else 'Access Denied: That credential is enrolled more than once. See the front desk.'
                    end,
      'direction', null, 'session_id', null, 'duration_minutes', null,
      'method', v_method,
      'device_id', v_device.id, 'device_name', v_device.device_name,
      'tenant_id', v_device.tenant_id
    );
  end if;

  -- Same verdict ladder as fn_hardware_punch: freeze reads "frozen", never
  -- "expired", and a refused attempt is still logged for the audit trail.
  if v_member.is_frozen then
    v_status := 'blocked_frozen';
    v_reason := 'Access Denied: Membership is Frozen';
  elsif v_member.status in ('transferred', 'inactive') then
    v_status := 'blocked_expired';
    v_reason := 'Access Denied: Membership ' || v_member.status || '. See the front desk.';
  elsif v_member.membership_end is null or v_member.membership_end < current_date then
    v_status := 'blocked_expired';
    v_reason := 'Access Denied: Membership Expired';
  else
    v_status := 'granted';
    v_reason := null;
  end if;

  if v_status <> 'granted' then
    insert into public.attendances (tenant_id, member_id, method, status, device_id, direction)
    values (v_device.tenant_id, v_member.id, v_method, v_status, v_device.id, null);
    return jsonb_build_object(
      'unlock', false, 'code', v_status, 'reason', v_reason,
      'direction', null, 'session_id', null, 'duration_minutes', null,
      'member_id', v_member.id, 'member_name', v_member.full_name,
      'is_frozen', v_member.is_frozen,
      'membership_end', v_member.membership_end,
      'days_left', greatest(0, coalesce(v_member.membership_end - current_date, 0)),
      'method', v_method, 'device_id', v_device.id, 'device_name', v_device.device_name,
      'tenant_id', v_device.tenant_id
    );
  end if;

  -- OPEN session today (same rule as fn_gate_auto_punch) with device context.
  select a.id, coalesce(a.punch_time, a.scanned_at)
    into v_in_id, v_in_at
    from public.attendances a
   where a.tenant_id = v_device.tenant_id
     and a.member_id = v_member.id
     and a.status = 'granted'
     and coalesce(a.direction, 'in') = 'in'
     and (coalesce(a.punch_time, a.scanned_at) at time zone 'Asia/Kolkata')::date = v_today
     and not exists (
       select 1 from public.attendances o
        where o.tenant_id = a.tenant_id
          and o.member_id = a.member_id
          and o.status = 'granted'
          and o.direction = 'out'
          and coalesce(o.punch_time, o.scanned_at) > coalesce(a.punch_time, a.scanned_at)
     )
   order by coalesce(a.punch_time, a.scanned_at) desc
   limit 1;

  if v_in_id is not null then
    v_session := coalesce(
      (select a.session_id from public.attendances a where a.id = v_in_id),
      gen_random_uuid()
    );
    update public.attendances a
       set session_id = v_session
     where a.id = v_in_id and a.session_id is null;

    v_duration := greatest(
      0, floor(extract(epoch from (now() - v_in_at)) / 60)::integer
    );

    insert into public.attendances
      (tenant_id, member_id, method, status, device_id, direction, session_id, duration_minutes)
    values
      (v_device.tenant_id, v_member.id, v_method, 'granted', v_device.id,
       'out', v_session, v_duration)
    returning id into v_att_id;

    return jsonb_build_object(
      'unlock', true, 'code', 'granted', 'direction', 'out',
      'reason', 'Checkout recorded. See you next time.',
      'member_id', v_member.id, 'member_name', v_member.full_name,
      'member_phone', v_member.phone,
      'membership_end', v_member.membership_end,
      'days_left', greatest(0, coalesce(v_member.membership_end - current_date, 0)),
      'is_frozen', v_member.is_frozen,
      'attendance_id', v_att_id, 'session_id', v_session,
      'checkin_at', v_in_at, 'checkout_at', now(),
      'duration_minutes', v_duration,
      'method', v_method, 'device_id', v_device.id, 'device_name', v_device.device_name,
      'tenant_id', v_device.tenant_id
    );
  end if;

  v_session := gen_random_uuid();
  insert into public.attendances
    (tenant_id, member_id, method, status, device_id, direction, session_id)
  values
    (v_device.tenant_id, v_member.id, v_method, 'granted', v_device.id, 'in', v_session)
  returning id into v_att_id;

  return jsonb_build_object(
    'unlock', true, 'code', 'granted', 'direction', 'in',
    'reason', 'Access Approved: Welcome back',
    'member_id', v_member.id, 'member_name', v_member.full_name,
    'member_phone', v_member.phone,
    'membership_end', v_member.membership_end,
    'days_left', greatest(0, coalesce(v_member.membership_end - current_date, 0)),
    'is_frozen', v_member.is_frozen,
    'attendance_id', v_att_id, 'session_id', v_session,
    'checkin_at', now(), 'duration_minutes', null,
    'method', v_method, 'device_id', v_device.id, 'device_name', v_device.device_name,
    'tenant_id', v_device.tenant_id
  );
end;
$$;

comment on function public.fn_hardware_auto_punch(text, integer, text, text) is
  'Auto-gate hardware twin: resolves the device credential exactly like fn_hardware_punch, then auto-directs the punch IN or OUT (pairing the open session and stamping duration on the OUT).';

grant execute on function public.fn_hardware_auto_punch(text, integer, text, text)
to anon, authenticated;

commit;

begin;

-- -----------------------------------------------------------------------------
-- MODULE 2 · 1. onboarding_requests — the stranger's form, pending payment
-- -----------------------------------------------------------------------------
-- Definer-only (revoked from the API roles): the row carries the owner's contact
-- details AND — between provisioning and the owner's first sign-in — the one-time
-- temporary password. The success page reads it through fn_onboarding_status,
-- whose bearer token is the unguessable Cashfree order_id.
create table if not exists public.onboarding_requests (
  id                  uuid primary key default gen_random_uuid(),
  order_id            text not null unique,
  plan_id             text not null,
  billing_cycle       text not null default 'monthly',
  gym_name            text not null,
  slug                text not null,
  owner_name          text not null,
  owner_phone         text not null,
  owner_email         text,
  status              text not null default 'pending'
                        check (status in ('pending', 'provisioned', 'failed')),
  tenant_id           uuid references public.tenants(id) on delete set null,
  owner_user_id       uuid,
  owner_temp_password text,
  created_at          timestamptz not null default now(),
  provisioned_at      timestamptz
);

revoke all on table public.onboarding_requests from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- MODULE 2 · 2. fn_onboarding_record_order — create-order's pending ledger write
-- -----------------------------------------------------------------------------
-- Mirrors fn_platform_record_order (0022): the amount is re-derived here from the
-- plan id, never trusted from the request. Also reserves the slug against BOTH
-- live gyms and in-flight onboards, so two people racing through checkout with
-- the same slug cannot both provision (23505 on the loser).
create or replace function public.fn_onboarding_record_order(
  p_order_id           text,
  p_payment_session_id text,
  p_plan_id            text,
  p_billing_cycle      text,
  p_gym_name           text,
  p_slug               text,
  p_owner_name         text,
  p_owner_phone        text,
  p_owner_email        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan     text := lower(trim(coalesce(p_plan_id, '')));
  v_cycle    text := lower(trim(coalesce(p_billing_cycle, 'monthly')));
  v_amount   numeric;
  v_slug     text;
  v_gym      text := trim(coalesce(p_gym_name, ''));
  v_owner    text := trim(coalesce(p_owner_name, ''));
  v_phone    text;
  v_email    text := nullif(trim(coalesce(p_owner_email, '')), '');
  v_existing public.onboarding_requests%rowtype;
begin
  if nullif(trim(coalesce(p_order_id, '')), '') is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;
  if nullif(v_gym, '') is null then
    raise exception 'Gym name is required.' using errcode = '22023';
  end if;
  if nullif(v_owner, '') is null then
    raise exception 'Owner name is required.' using errcode = '22023';
  end if;

  v_phone := regexp_replace(coalesce(p_owner_phone, ''), '[^0-9]', '', 'g');
  if length(v_phone) > 10 then v_phone := right(v_phone, 10); end if;
  if length(v_phone) <> 10 then
    raise exception 'A 10-digit owner phone number is required.' using errcode = '22023';
  end if;

  if v_plan not in ('starter', 'pro') then
    raise exception 'plan_id must be starter or pro' using errcode = '22023';
  end if;
  if v_cycle not in ('monthly', 'yearly') then
    raise exception 'billing_cycle must be monthly or yearly' using errcode = '22023';
  end if;

  -- Server-authoritative price list (same numbers as 0022 and the create-order
  -- routes). Yearly = 10x monthly.
  v_amount := case
    when v_plan = 'starter' then (case when v_cycle = 'yearly' then 7990 else 799 end)
    else (case when v_cycle = 'yearly' then 14990 else 1499 end)
  end;

  v_slug := lower(coalesce(nullif(trim(coalesce(p_slug, '')), ''), v_gym));
  v_slug := trim(both '-' from regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g'));
  if nullif(v_slug, '') is null then
    raise exception 'Gym name must contain at least one letter or number.' using errcode = '22023';
  end if;

  if exists (select 1 from public.tenants t where lower(coalesce(t.slug, '')) = v_slug) then
    raise exception 'A gym with the slug "%" already exists.', v_slug using errcode = '23505';
  end if;
  if exists (select 1 from public.onboarding_requests o
              where lower(o.slug) = v_slug and o.status = 'pending') then
    raise exception 'A gym with the slug "%" is already being onboarded.', v_slug
      using errcode = '23505';
  end if;

  -- Idempotent on order_id: a retried create-order returns the original row.
  select * into v_existing from public.onboarding_requests o
   where o.order_id = trim(p_order_id);
  if found then
    return jsonb_build_object('ok', true, 'amount', v_amount, 'slug', v_existing.slug,
                              'already_recorded', true);
  end if;

  insert into public.onboarding_requests
    (order_id, plan_id, billing_cycle, gym_name, slug,
     owner_name, owner_phone, owner_email, status)
  values
    (trim(p_order_id), v_plan, v_cycle, v_gym, v_slug,
     v_owner, v_phone, v_email, 'pending');

  -- The platform ledger row carries tenant_id NULL: there is no gym yet. The
  -- webhook dispatch (fn_cashfree_dispatch) uses that NULL to tell a first-ever
  -- onboarding order from a renewal on an existing tenant.
  insert into public.platform_billing
    (tenant_id, order_id, payment_session_id, plan_id, billing_cycle, amount, status)
  values
    (null, trim(p_order_id),
     nullif(trim(coalesce(p_payment_session_id, '')), ''),
     v_plan, v_cycle, v_amount, 'pending');

  return jsonb_build_object('ok', true, 'amount', v_amount, 'slug', v_slug,
                            'already_recorded', false);
end;
$$;

comment on function public.fn_onboarding_record_order(text, text, text, text, text, text, text, text, text) is
  'Records a pending self-serve onboarding order: reserves the slug, writes the definer-only onboarding_requests row and a tenant-less platform_billing ledger row. Amount re-derived from the plan id.';

grant execute on function public.fn_onboarding_record_order(text, text, text, text, text, text, text, text, text)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- MODULE 2 · 3. fn_onboard_provision — the webhook's ONE provisioning write
-- -----------------------------------------------------------------------------
-- Called only from fn_cashfree_dispatch, which the webhook reaches after the
-- Cashfree HMAC verifies. Reads the pending ledger row FOR UPDATE (so a
-- redelivered webhook is a no-op, not a second gym), creates the tenant with an
-- ACTIVE subscription + the paid period, provisions the owner credential through
-- 0014's fn_staff_provision_owner (bcrypt + forced first-sign-in change) and
-- marks the ledger paid — all in ONE transaction keyed on order_id.
create or replace function public.fn_onboard_provision(
  p_order_id   text,
  p_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order   public.platform_billing%rowtype;
  v_on      public.onboarding_requests%rowtype;
  v_tenant  uuid;
  v_owner   jsonb;
  v_expiry  timestamptz;
  v_temp    text;
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

  select * into v_on
    from public.onboarding_requests o
   where o.order_id = trim(p_order_id)
   for update;
  if not found then
    -- A renewal order (tenant_id NOT NULL) must never reach this function;
    -- fn_cashfree_dispatch routes those to fn_platform_activate_subscription.
    if v_order.tenant_id is not null then
      raise exception 'Order is not an onboarding order' using errcode = '22023';
    end if;
    raise exception 'Onboarding request missing for this order' using errcode = 'P0002';
  end if;

  -- Idempotent: already provisioned -> return current state, change nothing.
  if v_on.status = 'provisioned' then
    return jsonb_build_object(
      'ok', true, 'already_provisioned', true, 'kind', 'onboarding',
      'tenant_id', v_on.tenant_id, 'slug', v_on.slug, 'gym_name', v_on.gym_name,
      'owner_phone', v_on.owner_phone, 'subscription_tier', v_on.plan_id
    );
  end if;

  -- Slug may have been taken between checkout and webhook (a console-created
  -- gym). Fail loudly so the webhook 500s and Cashfree retries; support then
  -- reconciles by order id rather than silently provisioning a squatted name.
  if exists (select 1 from public.tenants t where lower(coalesce(t.slug, '')) = lower(v_on.slug)) then
    update public.onboarding_requests o set status = 'failed' where o.id = v_on.id;
    raise exception 'Slug already taken by another gym' using errcode = '23505';
  end if;

  v_expiry := now() + (case when v_order.billing_cycle = 'yearly'
                            then interval '365 days' else interval '30 days' end);

  insert into public.tenants
    (name, slug, owner_name, phone, subscription_tier, subscription_status,
     subscription_expires_at)
  values
    (v_on.gym_name, lower(v_on.slug), v_on.owner_name, v_on.owner_phone,
     coalesce(v_on.plan_id, 'starter'), 'active', v_expiry)
  returning id into v_tenant;

  -- Owner credential: 12 hex chars (~48 bits) generated inside the transaction,
  -- bcrypt-hashed by fn_staff_provision_owner and flagged password_must_change,
  -- so it is a FIRST password for an account that cannot be used until it is
  -- replaced — never a secret that persists. It rides out on the success page
  -- poll (bearer = the order id) and stops being returned the moment the owner
  -- sets their own password.
  v_temp := substr(md5(gen_random_uuid()::text), 1, 12);

  v_owner := public.fn_staff_provision_owner(
    v_tenant,
    v_on.owner_phone,
    v_on.owner_name,
    v_temp
  );

  update public.platform_billing b
     set status      = 'paid',
         paid_at     = now(),
         payment_id  = nullif(trim(coalesce(p_payment_id, '')), '')
   where b.id = v_order.id;

  update public.onboarding_requests o
     set status              = 'provisioned',
         tenant_id           = v_tenant,
         owner_user_id       = (v_owner->>'user_id')::uuid,
         owner_temp_password = v_temp,
         provisioned_at      = now()
   where o.id = v_on.id;

  return jsonb_build_object(
    'ok', true, 'already_provisioned', false, 'kind', 'onboarding',
    'tenant_id', v_tenant, 'slug', lower(v_on.slug), 'gym_name', v_on.gym_name,
    'owner_phone', v_on.owner_phone,
    'subscription_tier', coalesce(v_on.plan_id, 'starter'),
    'subscription_expires_at', v_expiry
  );
end;
$$;

comment on function public.fn_onboard_provision(text, text) is
  'Webhook write for a PAID self-serve onboarding order: creates the gym, provisions the owner credential (bcrypt, forced change) and marks the ledger paid, in ONE idempotent transaction keyed on order_id.';

grant execute on function public.fn_onboard_provision(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- MODULE 2 · 4. fn_onboarding_status — the success page's poll
-- -----------------------------------------------------------------------------
-- The bearer token is the order_id: it is unguessable, was minted server-side
-- and is only ever shown to the payer. The temp password is returned ONLY while
-- the owner's credential still has password_must_change = true — the moment
-- they set their own password it becomes NULL forever, even to this function.
create or replace function public.fn_onboarding_status(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_on     public.onboarding_requests%rowtype;
  v_must   boolean := false;
  v_portal text;
begin
  if nullif(trim(coalesce(p_order_id, '')), '') is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;

  select * into v_on from public.onboarding_requests o
   where o.order_id = trim(p_order_id);
  if not found then
    -- Not an error shape: the success page shows "still confirming" for a
    -- moment while create-order's ledger write lands.
    return jsonb_build_object('ok', true, 'found', false, 'status', 'unknown');
  end if;

  if v_on.owner_user_id is not null then
    select coalesce(sc.password_must_change, false) into v_must
      from private.staff_credentials sc
     where sc.user_id = v_on.owner_user_id;
  end if;

  v_portal := v_on.slug || '.gym.glitchfiesta.in';

  return jsonb_build_object(
    'ok',            true,
    'found',         true,
    'status',        v_on.status,
    'plan_id',       v_on.plan_id,
    'billing_cycle', v_on.billing_cycle,
    'gym_name',      v_on.gym_name,
    'slug',          v_on.slug,
    'portal_host',   v_portal,
    'tenant_id',     v_on.tenant_id,
    'owner_name',    v_on.owner_name,
    'owner_phone',   v_on.owner_phone,
    -- Null once the owner has replaced it (or when not provisioned yet).
    'temp_password', case when v_on.status = 'provisioned' and v_must
                          then v_on.owner_temp_password else null end,
    'provisioned_at', v_on.provisioned_at
  );
end;
$$;

comment on function public.fn_onboarding_status(text) is
  'Self-serve onboarding poll for /onboard/success. Bearer = the unguessable order id. Discloses the one-time owner password only while password_must_change is still true.';

grant execute on function public.fn_onboarding_status(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- MODULE 2 · 5. fn_cashfree_dispatch — the webhook's single entry point
-- -----------------------------------------------------------------------------
-- tenant_id NULL on the ledger row = first-ever onboarding order -> provision.
-- Otherwise a renewal on an existing gym -> the 0022 activation (unchanged).
create or replace function public.fn_cashfree_dispatch(
  p_order_id   text,
  p_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
begin
  select b.tenant_id into v_tenant
    from public.platform_billing b
   where b.order_id = trim(coalesce(p_order_id, ''));
  if v_tenant is null and not found then
    raise exception 'Unknown order_id' using errcode = 'P0002';
  end if;

  if v_tenant is null then
    return public.fn_onboard_provision(trim(p_order_id), p_payment_id);
  end if;
  return public.fn_platform_activate_subscription(trim(p_order_id), p_payment_id);
end;
$$;

comment on function public.fn_cashfree_dispatch(text, text) is
  'Webhook dispatch: a tenant-less ledger row is a self-serve onboarding order (provision), anything else is a renewal (activate). Both callees are idempotent on order_id.';

grant execute on function public.fn_cashfree_dispatch(text, text) to anon, authenticated;

commit;

begin;

-- -----------------------------------------------------------------------------
-- MODULE 3 · 1. Feature-flag tables — platform-wide kill switches + per-gym
-- -----------------------------------------------------------------------------
-- Resolution order in fn_resolve_entitlements: TIER DEFAULT (all true) ->
-- platform_feature_flags (one row flips the switch for EVERY gym) ->
-- tenant_feature_flags (a per-gym override always wins). The flags are named
-- for what they gate in the API routes: qr_gate (scan verify/checkout), rfid
-- (card hardware), biometric (fingerprint hardware), pos_store (retail),
-- whatsapp (automation), crm (lead pipeline).
create table if not exists public.platform_feature_flags (
  flag       text primary key,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.tenant_feature_flags (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  flag       text not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (tenant_id, flag)
);

create index if not exists idx_tenant_feature_flags_tenant
  on public.tenant_feature_flags (tenant_id);

-- Platform flags are a control surface, not data: only the definer functions
-- read or write them (a browser must not be able to enumerate kill switches).
revoke all on table public.platform_feature_flags from public, anon, authenticated;
revoke all on table public.tenant_feature_flags from public, anon, authenticated;

-- Seed the six switches ON. An explicit super-admin act is required to turn a
-- feature off; nothing already running changes when this file is applied.
insert into public.platform_feature_flags (flag, enabled, updated_by) values
  ('qr_gate',   true, 'migration-0023'),
  ('rfid',      true, 'migration-0023'),
  ('biometric', true, 'migration-0023'),
  ('pos_store', true, 'migration-0023'),
  ('whatsapp',  true, 'migration-0023'),
  ('crm',       true, 'migration-0023')
on conflict (flag) do nothing;

-- -----------------------------------------------------------------------------
-- MODULE 3 · 2. platform_plans + tenant_limits — the Plan Builder's data
-- -----------------------------------------------------------------------------
-- max_members / max_devices NULL = unlimited. These are the catalog numbers
-- fn_resolve_entitlements returns as limits; a per-gym row in tenant_limits
-- overrides them without touching the catalog (the "custom quota override").
create table if not exists public.platform_plans (
  plan_id      text primary key,
  name         text not null,
  price_inr    integer not null check (price_inr >= 0),
  max_members  integer check (max_members is null or max_members >= 0),
  max_devices  integer check (max_devices is null or max_devices >= 0),
  updated_at   timestamptz not null default now()
);

insert into public.platform_plans (plan_id, name, price_inr, max_members, max_devices) values
  ('starter',  'Starter Club',   799,  300,   5),
  ('pro',      'Pro Fitness OS', 1499, null,  20),
  ('franchise','Franchise',      3499, null,  100)
on conflict (plan_id) do nothing;

revoke all on table public.platform_plans from public, anon, authenticated;

create table if not exists public.tenant_limits (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  max_members integer check (max_members is null or max_members >= 0),
  max_devices integer check (max_devices is null or max_devices >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

revoke all on table public.tenant_limits from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- MODULE 3 · 3. fn_resolve_entitlements — the enforcement read
-- -----------------------------------------------------------------------------
-- Called by lib/entitlements.ts from the API routes (store, hardware, scan) and
-- by the owner console's lock screen. NEVER trusts a UI flag: the answer is
-- computed from the tenant row + the two override tables, every request.
--
-- LOCK RULES (deliberately conservative so a pre-0023 gym is never locked by
-- accident): suspended/expired status locks; an ACTIVE gym only locks once its
-- PAID-through date has passed; a trialing gym locks once the trial AND any
-- paid-through date have both passed. A legacy gym with no dates at all stays
-- open until an admin suspends it.
create or replace function public.fn_resolve_entitlements(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant     public.tenants%rowtype;
  v_locked     boolean := false;
  v_reason     text := null;
  v_flags      jsonb;
  v_override   jsonb;
  v_plan       public.platform_plans%rowtype;
  v_limits     public.tenant_limits%rowtype;
  v_max_memb   integer;
  v_max_dev    integer;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  select * into v_tenant from public.tenants t where t.id = p_tenant_id;
  if not found then
    return jsonb_build_object(
      'active', false, 'locked', true, 'reason', 'unknown_tenant',
      'tier', 'starter', 'status', 'unknown',
      'flags', jsonb_build_object('qr_gate', false, 'rfid', false, 'biometric', false,
                                  'pos_store', false, 'whatsapp', false, 'crm', false),
      'limits', jsonb_build_object('max_members', 0, 'max_devices', 0)
    );
  end if;

  if coalesce(v_tenant.subscription_status, 'active') in ('suspended', 'expired') then
    v_locked := true;
    v_reason := 'subscription_inactive';
  elsif v_tenant.subscription_expires_at is not null
        and v_tenant.subscription_expires_at < now() then
    v_locked := true;
    v_reason := 'subscription_expired';
  elsif coalesce(v_tenant.subscription_status, 'active') = 'trialing'
        and v_tenant.trial_ends_at is not null
        and v_tenant.trial_ends_at < now()
        and (v_tenant.subscription_expires_at is null
             or v_tenant.subscription_expires_at < now()) then
    v_locked := true;
    v_reason := 'trial_expired';
  end if;

  -- Tier default: every switch ON. Restrictions are opt-in admin acts.
  v_flags := jsonb_build_object(
    'qr_gate', true, 'rfid', true, 'biometric', true,
    'pos_store', true, 'whatsapp', true, 'crm', true
  );

  -- Platform-wide overrides (one row flips every gym).
  select coalesce(jsonb_object_agg(f.flag, f.enabled), '{}'::jsonb)
    into v_override
    from public.platform_feature_flags f;
  v_flags := v_flags || v_override;

  -- Per-gym overrides always win.
  select coalesce(jsonb_object_agg(f.flag, f.enabled), '{}'::jsonb)
    into v_override
    from public.tenant_feature_flags f
   where f.tenant_id = p_tenant_id;
  v_flags := v_flags || v_override;

  -- Limits: catalog by tier, then per-gym override.
  select * into v_plan from public.platform_plans p
   where p.plan_id = coalesce(v_tenant.subscription_tier, 'starter');
  v_max_memb := v_plan.max_members;   -- null when the plan (or row) says unlimited
  v_max_dev  := v_plan.max_devices;

  select * into v_limits from public.tenant_limits l where l.tenant_id = p_tenant_id;
  if found then
    v_max_memb := v_limits.max_members;
    v_max_dev  := v_limits.max_devices;
  end if;

  return jsonb_build_object(
    'active',  not v_locked,
    'locked',  v_locked,
    'reason',  v_reason,
    'tier',    coalesce(v_tenant.subscription_tier, 'starter'),
    'status',  coalesce(v_tenant.subscription_status, 'active'),
    'flags',   v_flags,
    'limits',  jsonb_build_object('max_members', v_max_memb, 'max_devices', v_max_dev)
  );
end;
$$;

comment on function public.fn_resolve_entitlements(uuid) is
  'The entitlement truth for one gym: subscription lock + six feature flags (tier default -> platform override -> gym override) + member/device quotas. Re-read on every gated API call; never cached in the browser.';

grant execute on function public.fn_resolve_entitlements(uuid) to anon, authenticated;

commit;

begin;

-- -----------------------------------------------------------------------------
-- MODULE 4 · 1. platform_audit_logs — immutable record of every platform act
-- -----------------------------------------------------------------------------
-- Append-only for the app roles: nobody holding the anon key can insert, update
-- or delete an audit row. Only the SECURITY DEFINER mutations below write to it,
-- and each of them REQUIRES a reason before it will act.
create table if not exists public.platform_audit_logs (
  id         uuid primary key default gen_random_uuid(),
  action     text not null,
  actor      text not null,
  tenant_id  uuid,
  reason     text not null,
  payload    jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_audit_created
  on public.platform_audit_logs (created_at desc);
create index if not exists idx_platform_audit_tenant
  on public.platform_audit_logs (tenant_id, created_at desc);

revoke all on table public.platform_audit_logs from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- MODULE 4 · 2. fn_superadmin_set_subscription_status — now with a reason
-- -----------------------------------------------------------------------------
-- Re-created (5 args) from 0015 §7c with a MANDATORY p_reason and an audit row.
-- The 4-arg overload is dropped: keeping it would let a console skip the reason,
-- which is exactly the hole this closes.
create or replace function public.fn_superadmin_set_subscription_status(
  p_identifier text,
  p_password   text,
  p_tenant_id  uuid,
  p_status     text,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin   jsonb;
  v_status  text := lower(trim(coalesce(p_status, '')));
  v_reason  text := trim(coalesce(p_reason, ''));
  v_before  text;
  v_gym     text;
  v_audit   uuid;
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
  if nullif(v_reason, '') is null then
    raise exception 'A reason is required — every platform change is audited.'
      using errcode = '22023';
  end if;

  select coalesce(t.subscription_status, 'active'), t.name
    into v_before, v_gym
    from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'Unknown gym' using errcode = 'P0002';
  end if;

  update public.tenants t
     set subscription_status = v_status
   where t.id = p_tenant_id;

  insert into public.platform_audit_logs (action, actor, tenant_id, reason, payload)
  values ('subscription_status', coalesce(v_admin->>'full_name', p_identifier),
          p_tenant_id, v_reason,
          jsonb_build_object('gym', v_gym, 'from', v_before, 'to', v_status))
  returning id into v_audit;

  return jsonb_build_object(
    'ok', true, 'tenant_id', p_tenant_id, 'subscription_status', v_status,
    'audit_id', v_audit
  );
end;
$$;

drop function if exists public.fn_superadmin_set_subscription_status(text, text, uuid, text);

comment on function public.fn_superadmin_set_subscription_status(text, text, uuid, text, text) is
  'Suspend/activate a gym. Reason is mandatory and lands in platform_audit_logs with the verified actor. Replaces the 4-arg 0015 version.';

grant execute on function public.fn_superadmin_set_subscription_status(text, text, uuid, text, text)
to anon, authenticated;

-- ----------------------------------------------------------------------------
-- MODULE 4 · 3. fn_superadmin_set_subscription_tier — now with a reason
-- ----------------------------------------------------------------------------
-- Re-created (5 args) from 0015 §7d with a MANDATORY p_reason and an audit row.
create or replace function public.fn_superadmin_set_subscription_tier(
  p_identifier text,
  p_password   text,
  p_tenant_id  uuid,
  p_tier       text,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin  jsonb;
  v_tier   text := lower(trim(coalesce(p_tier, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_before text;
  v_gym    text;
  v_audit  uuid;
begin
  v_admin := public.fn_superadmin_verify_password(p_identifier, p_password);
  if v_admin is null then
    raise exception 'Unauthorized' using errcode = '45005';
  end if;
  if p_tenant_id is null then
    raise exception 'tenant_id is required.' using errcode = '22023';
  end if;
  if v_tier not in ('starter', 'pro', 'franchise', 'enterprise') then
    raise exception 'subscription_tier must be starter, pro, franchise or enterprise.'
      using errcode = '22023';
  end if;
  if nullif(v_reason, '') is null then
    raise exception 'A reason is required — every platform change is audited.'
      using errcode = '22023';
  end if;

  select coalesce(t.subscription_tier, 'starter'), t.name
    into v_before, v_gym
    from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'Unknown gym' using errcode = 'P0002';
  end if;

  update public.tenants t
     set subscription_tier = v_tier
   where t.id = p_tenant_id;

  insert into public.platform_audit_logs (action, actor, tenant_id, reason, payload)
  values ('subscription_tier', coalesce(v_admin->>'full_name', p_identifier),
          p_tenant_id, v_reason,
          jsonb_build_object('gym', v_gym, 'from', v_before, 'to', v_tier))
  returning id into v_audit;

  return jsonb_build_object(
    'ok', true, 'tenant_id', p_tenant_id, 'subscription_tier', v_tier,
    'audit_id', v_audit
  );
end;
$$;

drop function if exists public.fn_superadmin_set_subscription_tier(text, text, uuid, text);

comment on function public.fn_superadmin_set_subscription_tier(text, text, uuid, text, text) is
  'Re-tier a gym. Reason is mandatory and lands in platform_audit_logs with the verified actor. Replaces the 4-arg 0015 version.';

grant execute on function public.fn_superadmin_set_subscription_tier(text, text, uuid, text, text)
to anon, authenticated;

-- ----------------------------------------------------------------------------
-- MODULE 4 · 4. Feature-flag writes — platform kill switch + per-gym override
-- ----------------------------------------------------------------------------
-- Allowed flags are the six fn_resolve_entitlements gates. Every write is an
-- upsert (re-flipping is normal ops) and every write demands a reason.
create or replace function public.fn_superadmin_set_platform_flag(
  p_identifier text,
  p_password   text,
  p_flag       text,
  p_enabled    boolean,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin  jsonb;
  v_flag   text := lower(trim(coalesce(p_flag, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_before boolean;
  v_audit  uuid;
begin
  v_admin := public.fn_superadmin_verify_password(p_identifier, p_password);
  if v_admin is null then
    raise exception 'Unauthorized' using errcode = '45005';
  end if;
  if v_flag not in ('qr_gate', 'rfid', 'biometric', 'pos_store', 'whatsapp', 'crm') then
    raise exception 'Unknown feature flag.' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'enabled is required.' using errcode = '22023';
  end if;
  if nullif(v_reason, '') is null then
    raise exception 'A reason is required — every platform change is audited.'
      using errcode = '22023';
  end if;

  select f.enabled into v_before
    from public.platform_feature_flags f where f.flag = v_flag;

  insert into public.platform_feature_flags (flag, enabled, updated_by)
  values (v_flag, p_enabled, coalesce(v_admin->>'full_name', p_identifier))
  on conflict (flag) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by,
        updated_at = now();

  insert into public.platform_audit_logs (action, actor, tenant_id, reason, payload)
  values ('platform_flag', coalesce(v_admin->>'full_name', p_identifier),
          null, v_reason,
          jsonb_build_object('flag', v_flag, 'from', v_before, 'to', p_enabled))
  returning id into v_audit;

  return jsonb_build_object('ok', true, 'flag', v_flag, 'enabled', p_enabled,
                            'audit_id', v_audit);
end;
$$;

comment on function public.fn_superadmin_set_platform_flag(text, text, text, boolean, text) is
  'Platform-wide feature kill switch: one row flips the flag for every gym. Reason mandatory, audited.';

grant execute on function public.fn_superadmin_set_platform_flag(text, text, text, boolean, text)
to anon, authenticated;

-- MODULE_4_PART2

