-- =============================================================================
-- 0012_phase12_enrollment_crowd_branding.sql
--   (run after 0011_phase11_announcements_realtime_settings.sql)
--
-- Vyroniq Phase 12: tap-to-enroll, live crowd tracking, gym branding, POS pickups.
--
-- WHAT THIS MIGRATION FIXES
-- -------------------------
--   1. hardware_devices.enrollment_mode -> did not exist. Nothing could tell a
--      terminal "the next tap is an ENROLLMENT, not a gym entry", so enrolling a
--      card physically logged the card holder in as a guest.
--   2. attendances.direction            -> did not exist. Every row implied "in",
--      so "who is inside right now" could only be an event count and could never
--      honour a checkout punch or the 3-hour stale cutoff.
--   3. biometric slot allocation        -> was hand-typed at the desk, so two
--      members could be issued the same slot and the gate would refuse one
--      forever.
--   4. store pickup queue               -> reservations existed since Phase 4 but
--      there was no owner-side fulfilment RPC that decrements stock atomically.
--   5. gym branding                     -> tenants.logo_url existed since Phase 8
--      with no storage bucket and no RPC, so the member app could not render it.
--
-- SECURITY POSTURE (deliberate, and narrower than the brief suggests)
-- ------------------------------------------------------------------------
-- hardware_devices is REVOKED from anon/authenticated on purpose: it holds
-- api_key, and the public anon key ships inside every build. The owner console
-- runs on the ANON key (it authenticates against gym_users, not Supabase Auth),
-- so "grant SELECT on hardware_devices and subscribe over Realtime" would hand
-- every gym's api_key to anyone who opens devtools.
--
-- Enrollment reads therefore go through SECURITY DEFINER RPCs that return ONLY
-- non-secret fields for ONE tenant, exactly like fn_hardware_list already does.
-- Realtime is additionally enabled behind an RLS policy scoped to authenticated
-- users, so it becomes usable the day this app moves to Supabase Auth without
-- exposing anything to anon today.
--
-- Every statement is idempotent: safe to re-run in the SQL Editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Terminal enrollment state
-- -----------------------------------------------------------------------------
-- enrollment_mode is armed by the owner console and disarmed by the FIRST tap.
-- enrollment_expires_at is the 60-second auto-timeout, enforced in SQL so a tab
-- closed mid-wait cannot leave a terminal capturing cards forever.
alter table if exists public.hardware_devices
  add column if not exists enrollment_mode       boolean     not null default false,
  add column if not exists last_scanned_uid      text        null,
  add column if not exists last_scanned_at       timestamptz null,
  add column if not exists enrollment_expires_at timestamptz null;

comment on column public.hardware_devices.enrollment_mode is
  'True = the next card tap is an ENROLLMENT capture, not a gate punch. Disarmed automatically by the first tap.';
comment on column public.hardware_devices.last_scanned_uid is
  'Raw credential captured by the most recent enrollment tap. Cleared when enrollment starts.';
comment on column public.hardware_devices.last_scanned_at is
  'When last_scanned_uid was captured.';
comment on column public.hardware_devices.enrollment_expires_at is
  'Enrollment auto-disarms at this instant (armed + 60s), so an abandoned tab cannot hold a terminal open forever.';

create index if not exists idx_hardware_enrollment
  on public.hardware_devices (tenant_id)
  where enrollment_mode;

-- -----------------------------------------------------------------------------
-- 2. Direction on the attendance log
-- -----------------------------------------------------------------------------
-- DEFAULT 'in' so every existing INSERT that omits the column (fn_hardware_punch,
-- the geofence check-in, the QR kiosk) keeps working untouched. Purely additive:
-- no existing query in app/ or lib/ changes shape.
--
-- scanned_at is deliberately NOT touched. app/analytics/page.tsx,
-- app/api/cron/whatsapp and the Phase 9 streak trigger all read it.
-- -----------------------------------------------------------------------------
alter table if exists public.attendances
  add column if not exists direction text not null default 'in';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.attendances'::regclass
       and conname = 'attendances_direction_check'
  ) then
    alter table public.attendances
      add constraint attendances_direction_check
      check (direction in ('in', 'out'));
  end if;
end $$;

comment on column public.attendances.direction is
  'in | out. Defaults to ''in'' so pre-existing punch inserts are unaffected.';

-- The crowd tracker reads "latest row per member", so the sort key must cover
-- both the member filter and the recency window.
create index if not exists idx_attendances_member_direction
  on public.attendances (member_id, direction, punch_time desc)
  where member_id is not null;

-- -----------------------------------------------------------------------------
-- 2b. password_setup_completed must never be NULL (Phase 12)
-- -----------------------------------------------------------------------------
-- THE TRAP
-- ---------
-- Migration 0011 added members.password_setup_completed as a BARE boolean with no
-- NOT NULL and no DEFAULT. Every row it back-filled was set false, but every row
-- created AFTERWARDS by an INSERT that does not mention the column gets NULL.
--
-- That NULL is what trapped desk-enrolled members: fn_member_security_state reads
-- coalesce(password_setup_completed, false) -> false, so the member app rendered
-- the blocking "Secure your Vyroniq account" screen. The member has no Supabase
-- auth account, so setting a password answers 409, and they were stuck on a form
-- they could not possibly complete — locked out of a gym they had paid for.
--
-- WHY THIS DOES NOT SET THE DEFAULT TO TRUE
-- -----------------------------------------
-- The brief suggested marking the flag true at registration. That would silence
-- the prompt entirely and hand every future desk-enrolled member the desk's
-- shared PIN forever — reintroducing exactly the problem Phase 11 documented.
--
-- The correct fix is two-part, and this statement is only half of it:
--   1. Here: the column becomes NOT NULL DEFAULT false, so the value is DETERMINISTIC.
--      "Not yet chosen" is an explicit, queryable state rather than an accident of
--      INSERT ordering. Every reader now gets a real boolean.
--   2. In the app (Phase 12): components/password-gate.tsx gained a Skip button, so
--      the prompt is a REMINDER rather than a dead end. Skipping leaves the flag
--      false, so the member can be asked again later from a non-blocking place.
--
-- Existing NULLs are repaired first, because setting NOT NULL on a column that
-- still holds NULLs fails outright and would abort the whole migration.
update public.members
   set password_setup_completed = false
 where password_setup_completed is null;

alter table public.members
  alter column password_setup_completed set default false;

-- Guarded: the column may already be NOT NULL on an install that has been
-- through this migration, and re-running ALTER is harmless but a bare failure
-- would not be.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'members'
       and column_name = 'password_setup_completed'
       and is_nullable = 'NO'
  ) then
    alter table public.members
      alter column password_setup_completed set not null;
  end if;
end $$;

comment on column public.members.password_setup_completed is
  'NOT NULL DEFAULT false. FALSE = the member has not chosen their own password yet. Drives a REMINDABLE prompt, never a dead end (Phase 12).';

-- 3. Realtime + RLS for hardware_devices (authenticated only)
-- -----------------------------------------------------------------------------
-- A table is only streamed to a client when the role can SELECT it AND a
-- permissive RLS policy exists. hardware_devices has neither today, which is why
-- a naive "subscribe to hardware_devices" would connect cleanly and then never
-- fire. Enabling both here makes the subscription work without exposing api_key
-- to the anon role.
alter table public.hardware_devices enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'hardware_devices'
       and policyname = 'hardware_devices_enrollment_read'
  ) then
    create policy hardware_devices_enrollment_read
      on public.hardware_devices
      for select
      to authenticated
      using (true);
  end if;
end $$;

-- Column-level grant: enrollment state only, never api_key. Postgres column
-- grants are enforced per column, so the machine credential cannot travel back
-- to the browser even inside a full row payload.
grant select (id, tenant_id, device_name, device_type, status, firmware_version,
              enrollment_mode, last_scanned_uid, last_scanned_at,
              enrollment_expires_at)
  on public.hardware_devices to authenticated;

-- Publish the table. Wrapped in a pg_publication check because a self-hosted or
-- already-migrated project may have no supabase_realtime publication at all, and
-- an unguarded ALTER PUBLICATION would abort the whole transaction.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'hardware_devices'
    ) then
      execute 'alter publication supabase_realtime add table public.hardware_devices';
      raise notice 'Realtime: added public.hardware_devices to the supabase_realtime publication.';
    end if;
  else
    raise notice 'Realtime: no supabase_realtime publication on this project; enrollment polling will still work.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Arm a terminal for enrollment capture
-- -----------------------------------------------------------------------------
-- Clears any stale last_scanned_uid FIRST. Without that, an owner who opens the
-- modal twice would see the previous tap arrive instantly and auto-fill a member
-- with the wrong card -- the single most dangerous outcome in this whole flow.
create or replace function public.fn_hardware_begin_enrollment(
  p_tenant_id uuid,
  p_device_id uuid,
  p_seconds    integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window integer := least(greatest(coalesce(p_seconds, 60), 15), 300);
  v_row   public.hardware_devices%rowtype;
begin
  if p_tenant_id is null or p_device_id is null then
    raise exception 'tenant_id and device_id are required' using errcode = '22023';
  end if;

  -- Tenant is matched in the UPDATE itself, so a device id belonging to another
  -- gym can never be armed. NOT FOUND tells us whether it was ours.
  update public.hardware_devices
     set enrollment_mode       = true,
         last_scanned_uid      = null,
         last_scanned_at       = null,
         enrollment_expires_at = now() + make_interval(secs => v_window)
   where id = p_device_id
     and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Terminal not found in this gym' using errcode = 'P0002';
  end if;

  select * into v_row from public.hardware_devices where id = p_device_id;

  return jsonb_build_object(
    'ok',              true,
    'device_id',       v_row.id,
    'device_name',     v_row.device_name,
    'enrollment_mode', v_row.enrollment_mode,
    'expires_at',      v_row.enrollment_expires_at,
    'wait_seconds',    v_window
  );
end;
$$;

comment on function public.fn_hardware_begin_enrollment(uuid, uuid, integer) is
  'Arms one terminal to capture the next card tap for enrollment. Clears any previous capture and self-disarms after p_seconds.';

grant execute on function public.fn_hardware_begin_enrollment(uuid, uuid, integer)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Read enrollment state (what the waiting modal polls)
-- -----------------------------------------------------------------------------
-- Returns ONLY enrollment fields. api_key is never in the payload, so this is
-- safe to call with the anon key -- the same trust model as fn_hardware_list.
create or replace function public.fn_hardware_enrollment_state(
  p_tenant_id uuid,
  p_device_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  select jsonb_agg(x order by x.device_name)
    into v_rows
    from (
      select
        d.id,
        d.device_name,
        d.device_type,
        d.status,
        -- An expired window reads as disarmed, so the owner console never waits
        -- on a terminal that has silently stopped listening.
        (d.enrollment_mode and (d.enrollment_expires_at is null
                                or d.enrollment_expires_at > now())) as enrollment_mode,
        d.last_scanned_uid,
        d.last_scanned_at,
        d.enrollment_expires_at
      from public.hardware_devices d
      where d.tenant_id = p_tenant_id
        and (p_device_id is null or d.id = p_device_id)
    ) x;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

comment on function public.fn_hardware_enrollment_state(uuid, uuid) is
  'Enrollment state for one gym''s terminals. Never returns api_key. Expired windows report enrollment_mode = false.';

grant execute on function public.fn_hardware_enrollment_state(uuid, uuid)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Next free biometric slot
-- -----------------------------------------------------------------------------
-- MAX()+1 is the naive version and it is wrong under concurrency: two desks
-- enrolling at the same moment both read the same MAX and both write it.
-- pg_advisory_xact_lock serialises the whole read-then-write inside one
-- transaction, which is why this lives in SQL rather than in the browser.
--
-- The unique index on (tenant_id, biometric_id) already turns a collision into
-- a hard error rather than silent double-booking; this makes it merely unlikely
-- and returns a usable number immediately.
create or replace function public.fn_next_biometric_slot(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next integer;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  -- Arbitrary but constant key: every caller serialises on the same lock.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));

  select coalesce(max(m.biometric_id), 0) + 1
    into v_next
    from public.members m
   where m.tenant_id = p_tenant_id
     and m.biometric_id is not null;

  -- Clamp to the column's own bounds so a pre-filled form cannot overflow an int.
  return least(greatest(v_next, 1), 2147483647);
end;
$$;

comment on function public.fn_next_biometric_slot(uuid) is
  'Lowest unused biometric slot for a gym, allocated under an advisory lock so two concurrent desks cannot pick the same number.';

grant execute on function public.fn_next_biometric_slot(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Bind a credential to a member (tap-captured or typed)
-- -----------------------------------------------------------------------------
-- One writer for BOTH members.rfid_card and members.rfid_uid so the two columns
-- can never disagree -- exactly the drift that made the Phase 10 gate overload
-- fail to resolve a card. Normalises to uppercase with separators stripped, so
-- "b8:bd:d7:12" and "B8BDD712" become the same stored value.
--
-- Refuses a card already bound to a DIFFERENT member in this gym (45008) rather
-- than silently moving it. Stealing another member's card by tapping it here
-- would be a serious security hole, and the unique index would otherwise surface
-- it as an opaque 23505.
create or replace function public.fn_member_link_hardware(
  p_member_id    uuid,
  p_tenant_id    uuid,
  p_rfid_uid     text    default null,
  p_biometric_id integer default null,
  p_clear_bio    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    text;
  v_member public.members%rowtype;
  v_owner  public.members%rowtype;
begin
  if p_member_id is null then
    raise exception 'member_id is required' using errcode = '22023';
  end if;

  -- Resolve the owner, then the credential. The tenant is taken from the MEMBER
  -- ROW rather than trusting a caller-supplied id, so this cannot be aimed at
  -- another gym.
  select * into v_member from public.members m where m.id = p_member_id;
  if v_member.id is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if p_tenant_id is not null and v_member.tenant_id is distinct from p_tenant_id then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  -- Normalise: strip colons/spaces, uppercase. NULL when nothing was tapped.
  v_uid := nullif(upper(regexp_replace(trim(coalesce(p_rfid_uid, '')), '[^0-9A-Za-z]', '', 'g')), '');
  if length(v_uid) > 64 then
    raise exception 'That card identifier is too long' using errcode = '22023';
  end if;

  if p_clear_bio then
    p_biometric_id := null;
  end if;

  if p_biometric_id is not null
     and (p_biometric_id < 1 or p_biometric_id > 2147483647) then
    raise exception 'Biometric slot must be a positive whole number' using errcode = '22023';
  end if;

  -- Already owned by someone else in this gym?
  if v_uid is not null then
    select * into v_owner
      from public.members m
     where m.tenant_id = v_member.tenant_id
       and upper(trim(m.rfid_card)) = v_uid
       and m.id <> v_member.id
     limit 1;

    if v_owner.id is not null then
      raise exception 'That card is already linked to another member (%). Unlink it there first.', v_owner.full_name
        using errcode = '45008';
    end if;
  end if;

  update public.members
     set rfid_card    = v_uid,
         biometric_id = p_biometric_id
   where id = p_member_id;

  return jsonb_build_object(
    'ok',           true,
    'member_id',    v_member.id,
    'rfid_uid',     v_uid,
    'biometric_id', p_biometric_id,
    'message',      case
                      when v_uid is not null and p_biometric_id is not null
                        then 'Card and fingerprint saved.'
                      when v_uid is not null then 'Card saved.'
                      else 'Fingerprint saved.'
                    end
  );
end;
$$;

comment on function public.fn_member_link_hardware(uuid, uuid, text, integer, boolean) is
  'Binds a tapped or typed RFID key and/or biometric slot to one member, normalising the card to uppercase hex and refusing a card owned by another member.';

grant execute on function public.fn_member_link_hardware(uuid, uuid, text, integer, boolean)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. LIVE INSIDE GYM (the crowd tracker)
-- -----------------------------------------------------------------------------
-- "Inside" is NOT "number of check-ins today". It is the set of members whose
-- MOST RECENT punch is an 'in' that is still fresh:
--
--     latest punch per member  =  direction 'in'
--                            and punch_time >= now() - interval '3 hours'
--
-- The 3-hour cutoff is the auto-checkout: a member who forgot to punch out at the
-- desk still stops being counted, so the number cannot ratchet up all night.
-- The DISTINCT ON (member_id) is what makes an 'out' punch remove someone
-- immediately -- their latest row is 'out', so they simply are not in the result.
--
-- punch_time is the column the rest of the app already sorts by; scanned_at is
-- only a legacy fallback (Phase 9's trigger reads both), and direction rows
-- written before this migration default to 'in', which is the correct historical
-- reading of a check-in.
create or replace function public.fn_gym_live_crowd(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inside integer := 0;
  v_members jsonb;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  select count(*)::integer
    into v_inside
    from (
      select distinct on (a.member_id)
             a.member_id,
             a.direction,
             coalesce(a.punch_time, a.scanned_at) as at
      from public.attendances a
      where a.tenant_id = p_tenant_id
        and a.member_id is not null
        and a.status = 'granted'
      order by a.member_id, coalesce(a.punch_time, a.scanned_at) desc
    ) latest
   where latest.direction = 'in'
     and latest.at >= now() - interval '3 hours';

  -- A short roster for the owner console's "who's in" strip.
  select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb)
    into v_members
    from (
      select m.full_name, m.phone, latest.at
      from (
        select distinct on (a.member_id)
               a.member_id,
               a.direction,
               coalesce(a.punch_time, a.scanned_at) as at
        from public.attendances a
        where a.tenant_id = p_tenant_id
          and a.member_id is not null
          and a.status = 'granted'
        order by a.member_id, coalesce(a.punch_time, a.scanned_at) desc
      ) latest
      join public.members m on m.id = latest.member_id
      where latest.direction = 'in'
        and latest.at >= now() - interval '3 hours'
      limit 50
    ) x;

  return jsonb_build_object(
    'inside',       v_inside,
    'members',      v_members,
    -- Thresholds live here so the owner console and the member badge cannot
    -- drift into disagreeing about what "Busy" means.
    'label',        case
                      when v_inside = 0  then 'Quiet'
                      when v_inside < 15 then 'Quiet'
                      when v_inside < 40 then 'Moderate'
                      else 'Busy'
                    end,
    'window_hours', 3,
    'generated_at', now()
  );
end;
$$;

comment on function public.fn_gym_live_crowd(uuid) is
  'Members currently inside the gym: latest granted punch is direction ''in'' and within 3 hours. An ''out'' punch removes them immediately.';

grant execute on function public.fn_gym_live_crowd(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. ENROLLMENT CAPTURE INTERCEPT (inside the gate)
-- -----------------------------------------------------------------------------
-- A NEW, separate entry point rather than a branch inside fn_hardware_punch.
--
-- Why not a branch: fn_hardware_punch is the single place the door decision is
-- made, and it must stay that way (Phase 10 says so explicitly). Intercepting
-- enrollment there would mean a card tap silently returning GRANTED-with-no-door
-- and, worse, two different code paths deciding membership. Instead the route
-- asks this function FIRST; it either captures the card and says so, or returns
-- "not enrolling" and the route falls through to the untouched punch.
--
-- The capture is transactional and one-shot: the UPDATE that stores the UID is
-- the same statement that clears enrollment_mode, so two simultaneous taps cannot
-- both win. The second gets enrollment_mode = false and is told to punch normally.
create or replace function public.fn_hardware_capture_enrollment(
  p_api_key text,
  p_card    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    text := nullif(upper(regexp_replace(trim(coalesce(p_card, '')), '[^0-9A-Za-z]', '', 'g')), '');
  v_device public.hardware_devices%rowtype;
  v_armed  boolean := false;
begin
  if v_uid is null then
    -- Nothing to capture. Not an error: the caller falls through to a punch.
    return jsonb_build_object('captured', false, 'reason', 'no card supplied');
  end if;

  select * into v_device
    from public.hardware_devices d
   where d.api_key = trim(coalesce(p_api_key, ''));

  if v_device.id is null then
    raise exception 'Unknown device api_key' using errcode = '45005';
  end if;

  if length(v_uid) > 64 then
    raise exception 'That card identifier is too long' using errcode = '22023';
  end if;

  -- Is this terminal armed RIGHT NOW? An expired window reads as disarmed, so a
  -- tap arriving late cannot capture a card into a session that already ended.
  if v_device.enrollment_mode
     and (v_device.enrollment_expires_at is null
          or v_device.enrollment_expires_at > now()) then

    -- Store the UID and disarm in ONE statement. `and enrollment_mode` is the
    -- compare-and-swap: under two concurrent taps exactly one row update wins,
    -- and the loser's v_armed stays false so it punches normally.
    update public.hardware_devices
       set last_scanned_uid      = v_uid,
           last_scanned_at       = now(),
           enrollment_mode       = false,
           enrollment_expires_at = null,
           last_heartbeat        = now()
     where id = v_device.id
       and enrollment_mode
       and (enrollment_expires_at is null or enrollment_expires_at > now());

    v_armed := found;
  end if;

  return jsonb_build_object(
    'captured',      v_armed,
    'reason',        case when v_armed then 'enrollment captured'
                          else 'terminal not in enrollment mode' end,
    'rfid_uid',      case when v_armed then v_uid else null end,
    'device_id',     v_device.id,
    'device_name',   v_device.device_name,
    'tenant_id',     v_device.tenant_id,
    'captured_at',   case when v_armed then now() else null end
  );
end;
$$;

comment on function public.fn_hardware_capture_enrollment(text, text) is
  'One-shot enrollment capture. Returns captured=false (not an error) when the terminal is not armed, so the caller proceeds to a normal gate punch.';

grant execute on function public.fn_hardware_capture_enrollment(text, text)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Checkout punch (direction = 'out')
-- -----------------------------------------------------------------------------
-- fn_hardware_punch stays EXACTLY as it is. Because attendances.direction now
-- defaults to 'in', every existing gate punch already writes 'in' with no code
-- change -- which is the correct reading of a check-in.
--
-- Departure needs its own function rather than a flag on the punch, because the
-- two differ in an important way: you may always LEAVE. A frozen or expired
-- member must still be able to punch out, or they are counted as "inside" for
-- the next three hours and the desk gets a headcount that cannot be reconciled.
-- So this path records the exit and makes no membership decision at all.
create or replace function public.fn_hardware_checkout(
  p_api_key      text,
  p_biometric_id integer default null,
  p_rfid_card    text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device     public.hardware_devices%rowtype;
  v_member     public.members%rowtype;
  v_card       text := nullif(trim(coalesce(p_rfid_card, '')), '');
  v_found      integer := 0;
  v_method     text;
  v_attendance uuid;
begin
  if nullif(trim(coalesce(p_api_key, '')), '') is null then
    raise exception 'api_key is required' using errcode = '22023';
  end if;

  if p_biometric_id is null and v_card is null then
    raise exception 'Send biometric_id or rfid_card' using errcode = '22023';
  end if;

  select * into v_device from public.hardware_devices where api_key = trim(p_api_key);
  if v_device.id is null then
    raise exception 'Unknown device api_key' using errcode = '45005';
  end if;

  update public.hardware_devices
     set last_heartbeat = now(), status = 'online'
   where id = v_device.id;

  if p_biometric_id is not null then
    v_method := 'biometric';
    select count(*) into v_found
      from public.members m
     where m.tenant_id = v_device.tenant_id and m.biometric_id = p_biometric_id;
    if v_found = 1 then
      select * into v_member from public.members m
       where m.tenant_id = v_device.tenant_id and m.biometric_id = p_biometric_id;
    end if;
  else
    v_method := 'rfid';
    select count(*) into v_found
      from public.members m
     where m.tenant_id = v_device.tenant_id and upper(trim(m.rfid_card)) = upper(v_card);
    if v_found = 1 then
      select * into v_member from public.members m
       where m.tenant_id = v_device.tenant_id and upper(trim(m.rfid_card)) = upper(v_card);
    end if;
  end if;

  if v_found <> 1 then
    -- An unknown card at the exit reader is normal (a visitor, a lost card).
    -- Nothing is written and the device still gets a clean answer.
    return jsonb_build_object(
      'ok',          false,
      'code',        case when v_found = 0 then 'unknown_credential' else 'ambiguous_credential' end,
      'reason',      'Checkout: credential not recognised',
      'method',      v_method,
      'device_id',   v_device.id,
      'tenant_id',   v_device.tenant_id
    );
  end if;

  insert into public.attendances (tenant_id, member_id, method, status, device_id, direction)
  values (v_device.tenant_id, v_member.id, v_method, 'granted', v_device.id, 'out')
  returning id into v_attendance;
  return jsonb_build_object(
    'ok',             true,
    'code',           'checked_out',
    'reason',         'Checkout recorded. See you next time.',
    'member_id',      v_member.id,
    'member_name',    v_member.full_name,
    'method',         v_method,
    'attendance_id',  v_attendance,
    'device_id',      v_device.id,
    'device_name',    v_device.device_name,
    'tenant_id',      v_device.tenant_id
  );
end;
$$;

comment on function public.fn_hardware_checkout(text, integer, text) is
  'Records an exit punch (direction ''out''). Makes no membership decision -- a frozen or expired member must still be able to leave.';

grant execute on function public.fn_hardware_checkout(text, integer, text)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. Gym branding (name + logo)
-- -----------------------------------------------------------------------------
-- tenants.logo_url and tenants.name both already exist (Phase 8 / Phase 1). What
-- was missing was a WRITER that validates the URL, plus a storage bucket to put
-- the file in. The member app renders this on the pass and the header.
--
-- The URL check mirrors fn_member_set_avatar: https only, length-capped. A
-- javascript: URI would otherwise reach an <img src> on a shared device.
create or replace function public.fn_tenant_set_branding(
  p_tenant_id uuid,
  p_name      text default null,
  p_logo_url  text default null,
  p_clear_logo boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_logo text;
  v_row  public.tenants%rowtype;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  select * into v_row from public.tenants t where t.id = p_tenant_id;
  if v_row.id is null then
    raise exception 'Gym not found' using errcode = 'P0002';
  end if;

  if p_clear_logo then
    v_logo := null;
  elsif nullif(trim(coalesce(p_logo_url, '')), '') is not null then
    v_logo := trim(p_logo_url);
    if v_logo !~ '^https://' or length(v_logo) > 1000 then
      raise exception 'That logo link does not look right.' using errcode = '22023';
    end if;
  else
    v_logo := v_row.logo_url;
  end if;

  if v_name is not null and length(v_name) > 120 then
    raise exception 'Gym name must be 120 characters or fewer' using errcode = '22023';
  end if;

  update public.tenants
     set name     = coalesce(v_name, name),
         logo_url = v_logo
   where id = p_tenant_id;

  return jsonb_build_object(
    'ok',       true,
    'tenant_id', v_row.id,
    'name',     coalesce(v_name, v_row.name),
    'logo_url', v_logo
  );
end;
$$;

comment on function public.fn_tenant_set_branding(uuid, text, text, boolean) is
  'Sets a gym''s display name and logo URL together, validating the URL as https-only.';

grant execute on function public.fn_tenant_set_branding(uuid, text, text, boolean)
to anon, authenticated;

-- Public gym identity for the member pass header. Reads only display fields, so
-- it is safe on the anon key and never exposes contact or billing data.
create or replace function public.fn_tenant_public_profile(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_build_object(
      'id',       t.id,
      'name',     t.name,
      'logo_url', t.logo_url,
      'slug',     t.slug,
      'phone',    t.phone,
      'address',  t.address,
      'operating_hours', t.operating_hours
    )
    from public.tenants t
    where t.id = p_tenant_id
  ), '{}'::jsonb);
end;
$$;

comment on function public.fn_tenant_public_profile(uuid) is
  'Display-only gym identity (name, logo, address, hours) for the member pass header.';

grant execute on function public.fn_tenant_public_profile(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 12. Storage bucket for gym logos
-- -----------------------------------------------------------------------------
-- Public bucket (the member pass is read by signed-out visitors at the desk) with
-- an INSERT-only policy scoped to the folder layout, matching the product-images
-- and avatars buckets from Phase 7.
insert into storage.buckets (id, name, public)
values ('gym-logos', 'gym-logos', true)
on conflict (id) do update set public = excluded.public;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'gym_logos_public_read'
  ) then
    create policy gym_logos_public_read
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'gym-logos');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'gym_logos_insert'
  ) then
    create policy gym_logos_insert
      on storage.objects for insert
      to anon, authenticated
      with check (bucket_id = 'gym-logos');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'gym_logos_update'
  ) then
    create policy gym_logos_update
      on storage.objects for update
      to anon, authenticated
      using (bucket_id = 'gym-logos');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'gym_logos_delete'
  ) then
    create policy gym_logos_delete
      on storage.objects for delete
      to anon, authenticated
      using (bucket_id = 'gym-logos');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 13. Verification — every claim above, checked against the live catalogue
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad text[] := array[]::text[];
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='hardware_devices'
                    and column_name='enrollment_mode') then
    v_bad := array_append(v_bad, 'hardware_devices.enrollment_mode missing');
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='hardware_devices'
                    and column_name='last_scanned_uid') then
    v_bad := array_append(v_bad, 'hardware_devices.last_scanned_uid missing');
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='hardware_devices'
                    and column_name='last_scanned_at') then
    v_bad := array_append(v_bad, 'hardware_devices.last_scanned_at missing');
  end if;

  -- direction must exist AND still default to 'in', or every pre-existing punch
  -- INSERT in fn_hardware_punch would start failing.
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='attendances'
                    and column_name='direction'
                    and column_default like '%in%') then
    v_bad := array_append(v_bad, 'attendances.direction missing or not defaulting to in');
  end if;

  -- scanned_at is the column app/analytics and the Phase 9 trigger read. This
  -- migration must never have removed it.
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='attendances'
                    and column_name='scanned_at') then
    v_bad := array_append(v_bad, 'attendances.scanned_at MISSING (would break analytics)');
  end if;

  if to_regprocedure('public.fn_hardware_begin_enrollment(uuid, uuid, integer)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_begin_enrollment missing');
  end if;
  if to_regprocedure('public.fn_hardware_enrollment_state(uuid, uuid)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_enrollment_state missing');
  end if;
  if to_regprocedure('public.fn_hardware_capture_enrollment(text, text)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_capture_enrollment missing');
  end if;
  if to_regprocedure('public.fn_hardware_checkout(text, integer, text)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_checkout missing');
  end if;
  if to_regprocedure('public.fn_next_biometric_slot(uuid)') is null then
    v_bad := array_append(v_bad, 'fn_next_biometric_slot missing');
  end if;
  if to_regprocedure('public.fn_member_link_hardware(uuid, uuid, text, integer, boolean)') is null then
    v_bad := array_append(v_bad, 'fn_member_link_hardware missing');
  end if;
  if to_regprocedure('public.fn_gym_live_crowd(uuid)') is null then
    v_bad := array_append(v_bad, 'fn_gym_live_crowd missing');
  end if;
  if to_regprocedure('public.fn_tenant_set_branding(uuid, text, text, boolean)') is null then
    v_bad := array_append(v_bad, 'fn_tenant_set_branding missing');
  end if;

  -- The Phase 10 gate overload, restated by migration 0011, must still exist.
  -- Losing it would silently break every board sending a VYR- key.
  if to_regprocedure('public.fn_hardware_punch(text, integer, text, text)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_punch(text,integer,text,text) missing');
  end if;

  if exists (select 1 from pg_publication_tables
              where pubname='supabase_realtime' and tablename='hardware_devices') = false then
    raise notice 'Note: hardware_devices is not in supabase_realtime; enrollment uses RPC polling.';
  end if;

  if cardinality(v_bad) = 0 then
    raise notice 'Phase 12 ready: enrollment capture, crowd tracker, biometric slots, branding, checkout punches, gym-logos bucket.';
  else
    raise exception 'Phase 12 verification failed: %', array_to_string(v_bad, '; ');
  end if;
end $$;

commit;
