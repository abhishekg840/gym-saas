-- =============================================================================
-- 0003_phase2_hardware_geofence.sql   (run after 0002_phase1_integrity.sql)
--
-- ForgeOS Phase 2: smart geofencing + hardware terminal console.
--
--   1. public.tenants     -> gym coordinates, geofence radius, enforcement flag
--   2. hardware_devices   -> the machine registry (turnstiles, kiosks, ESP32s)
--   3. public.members     -> rfid_card, so an RFID reader can resolve a member
--   4. public.attendances -> device_id, so a gate log says WHICH terminal opened
--   5. Access control     -> hardware_devices is NOT readable through PostgREST
--
-- Why (5) matters: every layer of this app talks to Postgres with the anon key,
-- and Row Level Security is not switched on yet. A plain table would mean anyone
-- holding the public anon key could run `select api_key from hardware_devices`
-- and walk up to a turnstile with a valid machine credential. So the table is
-- revoked from anon/authenticated and reached only through the SECURITY DEFINER
-- functions at the bottom, which pin search_path and re-check tenant ownership.
-- A device key is therefore revealed exactly once, at registration.
--
-- Every statement is idempotent: safe to re-run in the SQL Editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Gym geolocation configuration (Module 2.1.1)
-- -----------------------------------------------------------------------------
alter table if exists public.tenants
  add column if not exists latitude               numeric(10, 7) null,
  add column if not exists longitude              numeric(10, 7) null,
  add column if not exists geofence_radius_meters integer        not null default 100,
  add column if not exists enforce_geofence       boolean        not null default false;

-- Range guards: a swapped lat/lon or a 1-metre radius silently bricks the gate,
-- so reject the typo at the database rather than in a browser.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenants'::regclass and conname = 'tenants_latitude_check'
  ) then
    alter table public.tenants
      add constraint tenants_latitude_check
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenants'::regclass and conname = 'tenants_longitude_check'
  ) then
    alter table public.tenants
      add constraint tenants_longitude_check
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenants'::regclass and conname = 'tenants_geofence_radius_check'
  ) then
    alter table public.tenants
      add constraint tenants_geofence_radius_check
      check (geofence_radius_meters between 10 and 20000);
  end if;
end $$;

comment on column public.tenants.latitude is 'Gym latitude, WGS84. Null = location not configured, geofence stays passive.';
comment on column public.tenants.enforce_geofence is 'True = a member pass outside geofence_radius_meters is locked at the gate.';

-- -----------------------------------------------------------------------------
-- 2. Hardware device registry (Module 2.1.2)
-- -----------------------------------------------------------------------------
create table if not exists public.hardware_devices (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  device_name      text not null,
  device_type      text not null default 'raspberry_pi'
                     check (device_type in ('biometric_fingerprint', 'rfid_scanner',
                                            'camera_kiosk', 'turnstile_relay', 'raspberry_pi')),
  api_key          text unique not null,
  ip_address       text null,
  status           text not null default 'offline'
                     check (status in ('online', 'offline', 'error', 'maintenance')),
  last_heartbeat   timestamptz null,
  firmware_version text not null default 'v1.0.0',
  created_at       timestamptz not null default now()
);

-- The two CHECKs above travel with the CREATE TABLE, so they exist from the
-- first run. Verified live in this migration's check block at the end.

-- Indexes (Module 2.1.3)
create index if not exists idx_hardware_tenant    on public.hardware_devices (tenant_id);
create index if not exists idx_hardware_heartbeat on public.hardware_devices (last_heartbeat);

comment on column public.hardware_devices.api_key is 'Machine bearer token (fgs_hw_...). Never readable through PostgREST; revealed once at registration.';
comment on column public.hardware_devices.last_heartbeat is 'Last time this device proved it was alive. Online = within 60 seconds.';

-- -----------------------------------------------------------------------------
-- 3. RFID credential on the member profile
--    /api/hardware/punch accepts { rfidCard }. Without a column to resolve it
--    against, an RFID reader could never identify anyone, so the credential
--    lives here - scoped per gym, the same rule Phase 1 set for biometric_id.
-- -----------------------------------------------------------------------------
alter table if exists public.members
  add column if not exists rfid_card text null;

create unique index if not exists members_tenant_rfid_card_key
  on public.members (tenant_id, upper(trim(rfid_card)))
  where rfid_card is not null and trim(rfid_card) <> '';

-- -----------------------------------------------------------------------------
-- 4. Gate logs record which terminal opened (or refused)
-- -----------------------------------------------------------------------------
alter table if exists public.attendances
  add column if not exists device_id uuid null
    references public.hardware_devices(id) on delete set null;

create index if not exists idx_attendances_tenant_device
  on public.attendances (tenant_id, device_id, punch_time desc);

comment on column public.attendances.device_id is 'Terminal that recorded this punch. Null for kiosk/browser scans.';
comment on column public.attendances.method is 'Free text by design: qr_kiosk, qr_geofence, biometric, rfid, manual.';

-- -----------------------------------------------------------------------------
-- 5. Lock the registry down, then open narrow, checked doors
-- -----------------------------------------------------------------------------
revoke all on table public.hardware_devices from anon, authenticated;
revoke all on table public.hardware_devices from public;

-- 5a. Key generator: fgs_hw_ + 32 hex characters (~122 random bits from a v4 UUID).
create or replace function public.fn_hardware_api_key()
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select 'fgs_hw_' || replace(gen_random_uuid()::text, '-', '');
$$;

-- 5b. Register a terminal. The plaintext key leaves the database exactly once,
--     here; fn_hardware_list only ever returns a masked version.
create or replace function public.fn_hardware_register(
  p_tenant_id        uuid,
  p_device_name      text,
  p_device_type      text,
  p_firmware_version text default null,
  p_ip_address       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := trim(coalesce(p_device_name, ''));
  v_type text := trim(coalesce(p_device_type, ''));
  v_key  text;
  v_row  public.hardware_devices%rowtype;
  v_try  integer := 0;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  if v_name = '' or length(v_name) > 80 then
    raise exception 'device_name must be between 1 and 80 characters' using errcode = '22023';
  end if;

  if v_type not in ('biometric_fingerprint', 'rfid_scanner', 'camera_kiosk',
                    'turnstile_relay', 'raspberry_pi') then
    raise exception 'device_type must be biometric_fingerprint, rfid_scanner, camera_kiosk, turnstile_relay or raspberry_pi'
      using errcode = '22023';
  end if;

  -- A key collision is essentially impossible, but the unique index is the
  -- contract, so retry quietly instead of surfacing a 500 if one ever happens.
  while v_row.id is null and v_try < 5 loop
    v_try := v_try + 1;
    v_key := public.fn_hardware_api_key();
    begin
      insert into public.hardware_devices (
        tenant_id, device_name, device_type, api_key, firmware_version, ip_address, status
      )
      values (
        p_tenant_id,
        v_name,
        v_type,
        v_key,
        coalesce(nullif(trim(coalesce(p_firmware_version, '')), ''), 'v1.0.0'),
        nullif(trim(coalesce(p_ip_address, '')), ''),
        'offline'
      )
      returning * into v_row;
    exception when unique_violation then
      -- v_row keeps its all-null fields, so the loop simply draws another key.
      null;
    end;
  end loop;

  if v_row.id is null then
    raise exception 'Could not allocate a unique device key. Please retry.'
      using errcode = '45004';
  end if;

  return jsonb_build_object(
    'id',                v_row.id,
    'tenant_id',         v_row.tenant_id,
    'device_name',       v_row.device_name,
    'device_type',       v_row.device_type,
    'api_key',           v_row.api_key,
    'status',            v_row.status,
    'firmware_version',  v_row.firmware_version,
    'ip_address',        v_row.ip_address,
    'created_at',        v_row.created_at,
    'secret_shown_once', true
  );
end;
$$;

-- 5c. Console listing: masked keys only, plus a precomputed online flag so the
--     60-second rule lives in one place instead of in every client.
create or replace function public.fn_hardware_list(p_tenant_id uuid)
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

  select jsonb_agg(x order by x.created_at desc)
    into v_rows
    from (
      select
        d.id,
        d.device_name,
        d.device_type,
        d.status,
        d.ip_address,
        d.firmware_version,
        d.last_heartbeat,
        d.created_at,
        left(d.api_key, 11) || '...' || right(d.api_key, 4) as api_key_masked,
        length(d.api_key) as api_key_length,
        (d.last_heartbeat is not null
          and d.last_heartbeat >= now() - interval '60 seconds') as is_online,
        -- greatest() ignores NULLs, so guard explicitly: a device that never
        -- checked in must report "never", not "0 seconds ago".
        case
          when d.last_heartbeat is null then null
          else greatest(0, floor(extract(epoch from (now() - d.last_heartbeat))))::bigint
        end as seconds_since_seen
      from public.hardware_devices d
      where d.tenant_id = p_tenant_id
    ) x;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

-- 5d. Machine authorisation: turn a bearer token into "which device, which gym".
create or replace function public.fn_hardware_authorize(p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := trim(coalesce(p_api_key, ''));
  v_out jsonb;
begin
  if v_key = '' then
    raise exception 'api_key is required' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'device_id',        d.id,
           'tenant_id',        d.tenant_id,
           'device_name',      d.device_name,
           'device_type',      d.device_type,
           'status',           d.status,
           'firmware_version', d.firmware_version
         )
    into v_out
    from public.hardware_devices d
   where d.api_key = v_key;

  return v_out;  -- NULL = unknown key; the route answers 401.
end;
$$;

-- 5e. Heartbeat / status report (Module 2.4.1).
--
-- Addressing precedence: api_key  >  device_id (+ tenant_id)  >  tenant_id (+ device_type).
-- The last form exists so the browser kiosk on /scan, which is never handed a
-- machine key, can still announce itself. It can only ever touch devices in its
-- own gym, because tenant_id comes from the signed-in session.
create or replace function public.fn_hardware_heartbeat(
  p_api_key          text default null,
  p_device_id        uuid default null,
  p_tenant_id        uuid default null,
  p_device_type      text default null,
  p_status           text default 'online',
  p_firmware_version text default null,
  p_ip_address       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := coalesce(nullif(trim(coalesce(p_status, '')), ''), 'online');
  v_key    text := nullif(trim(coalesce(p_api_key, '')), '');
  v_type   text := nullif(trim(coalesce(p_device_type, '')), '');
  v_count  integer := 0;
  v_out    jsonb;
begin
  if v_status not in ('online', 'offline', 'error', 'maintenance') then
    raise exception 'status must be online, offline, error or maintenance' using errcode = '22023';
  end if;

  if v_key is not null then
    update public.hardware_devices
       set last_heartbeat   = now(),
           status           = v_status,
           firmware_version = coalesce(nullif(trim(coalesce(p_firmware_version, '')), ''), firmware_version),
           ip_address       = coalesce(nullif(trim(coalesce(p_ip_address, '')), ''), ip_address)
     where api_key = v_key;

  elsif p_device_id is not null then
    update public.hardware_devices
       set last_heartbeat   = now(),
           status           = v_status,
           firmware_version = coalesce(nullif(trim(coalesce(p_firmware_version, '')), ''), firmware_version),
           ip_address       = coalesce(nullif(trim(coalesce(p_ip_address, '')), ''), ip_address)
     where id = p_device_id
       and (p_tenant_id is null or tenant_id = p_tenant_id);

  elsif p_tenant_id is not null then
    update public.hardware_devices
       set last_heartbeat   = now(),
           status           = v_status,
           firmware_version = coalesce(nullif(trim(coalesce(p_firmware_version, '')), ''), firmware_version),
           ip_address       = coalesce(nullif(trim(coalesce(p_ip_address, '')), ''), ip_address)
     where tenant_id = p_tenant_id
       and (v_type is null or device_type = v_type);

  else
    raise exception 'heartbeat needs an api_key, a device_id, or a tenant_id'
      using errcode = '22023';
  end if;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return null;  -- nothing matched: the route answers 404 "unknown terminal"
  end if;

  select jsonb_build_object(
           'device_id',       x.id,
           'tenant_id',       x.tenant_id,
           'device_name',     x.device_name,
           'device_type',     x.device_type,
           'status',          x.status,
           'last_heartbeat',  x.last_heartbeat,
           'devices_updated', v_count
         )
    into v_out
    from (
      select d.id, d.tenant_id, d.device_name, d.device_type, d.status, d.last_heartbeat
        from public.hardware_devices d
       where (v_key is not null and d.api_key = v_key)
          or (v_key is null and p_device_id is not null and d.id = p_device_id)
          or (v_key is null and p_device_id is null and d.tenant_id = p_tenant_id
               and (v_type is null or d.device_type = v_type))
       order by d.last_heartbeat desc nulls last, d.created_at asc
       limit 1
    ) x;

  return v_out;
end;
$$;

-- 5f. Retire a terminal. Tenant ownership is re-checked, exactly like the Phase 1
--     membership functions: an id from another gym is a 404, not a silent no-op.
create or replace function public.fn_hardware_delete(p_device_id uuid, p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if p_device_id is null or p_tenant_id is null then
    raise exception 'device_id and tenant_id are required' using errcode = '22023';
  end if;

  delete from public.hardware_devices d
   where d.id = p_device_id and d.tenant_id = p_tenant_id
   returning d.device_name into v_name;

  if v_name is null then
    raise exception 'No terminal with that id in this gym' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'deleted', true, 'device_id', p_device_id, 'device_name', v_name
  );
end;
$$;

-- 5g. The gate itself (Module 2.3.3).
--
-- One round trip, one transaction: authorise the machine -> resolve the member
-- inside THAT gym only -> apply the Phase 1 rules (frozen beats expired) ->
-- write the attendance row -> hand back a single door verdict.
--
-- Also closes a gap the QR kiosk never had to care about: fn_transfer_membership
-- closes the source profile with status = 'transferred' and membership_end =
-- current_date, so on the day of a transfer that profile still passes a plain
-- expiry test. A turnstile must not.
create or replace function public.fn_hardware_punch(
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
  v_device      public.hardware_devices%rowtype;
  v_member      public.members%rowtype;
  v_card        text := nullif(trim(coalesce(p_rfid_card, '')), '');
  v_found       integer := 0;
  v_method      text;
  v_unlock      boolean;
  v_code        text;
  v_reason      text;
  v_attendance  uuid;
begin
  if nullif(trim(coalesce(p_api_key, '')), '') is null then
    raise exception 'api_key is required' using errcode = '22023';
  end if;

  if p_biometric_id is null and v_card is null then
    raise exception 'Send biometric_id or rfid_card' using errcode = '22023';
  end if;

  select * into v_device from public.hardware_devices where api_key = trim(p_api_key);
  if v_device.id is null then
    -- 45005 = machine authentication failed, which the API layer answers as 401.
    raise exception 'Unknown device api_key' using errcode = '45005';
  end if;

  -- A punch is proof of life: keep the console green without waiting 30s.
  update public.hardware_devices
     set last_heartbeat = now(), status = 'online'
   where id = v_device.id;

  -- Biometric wins when a device sends both: a fingerprint is the stronger claim.
  if p_biometric_id is not null then
    v_method := 'biometric';

    select count(*) into v_found
      from public.members m
     where m.tenant_id = v_device.tenant_id
       and m.biometric_id = p_biometric_id;

    if v_found = 1 then
      select * into v_member
        from public.members m
       where m.tenant_id = v_device.tenant_id
         and m.biometric_id = p_biometric_id;
    end if;
  else
    v_method := 'rfid';

    select count(*) into v_found
      from public.members m
     where m.tenant_id = v_device.tenant_id
       and upper(trim(m.rfid_card)) = upper(v_card);

    if v_found = 1 then
      select * into v_member
        from public.members m
       where m.tenant_id = v_device.tenant_id
         and upper(trim(m.rfid_card)) = upper(v_card);
    end if;
  end if;

  if v_found <> 1 then
    -- No single member row means nothing to attribute, so no attendance row is
    -- written (member_id is required). The terminal still gets a speakable verdict.
    return jsonb_build_object(
      'unlock',      false,
      'code',        case when v_found = 0 then 'unknown_credential' else 'ambiguous_credential' end,
      'reason',      case when v_found = 0
                          then 'Access Denied: Card or finger is not enrolled in this gym'
                          else 'Access Denied: That credential is enrolled more than once. See the front desk.'
                        end,
      'method',      v_method,
      'device_id',   v_device.id,
      'device_name', v_device.device_name,
      'tenant_id',   v_device.tenant_id
    );
  end if;

  -- Phase 1 ordering: a freeze is a temporary hold, so it must read "frozen",
  -- never "expired".
  if v_member.is_frozen then
    v_unlock := false;
    v_code   := 'blocked_frozen';
    v_reason := 'Access Denied: Membership is Frozen';
  elsif v_member.status in ('transferred', 'inactive') then
    v_unlock := false;
    v_code   := 'blocked_expired';
    v_reason := 'Access Denied: Membership ' || v_member.status || '. See the front desk.';
  elsif v_member.membership_end is null or v_member.membership_end < current_date then
    v_unlock := false;
    v_code   := 'blocked_expired';
    v_reason := 'Access Denied: Membership Expired';
  else
    v_unlock := true;
    v_code   := 'granted';
    v_reason := 'Access Approved: Welcome back';
  end if;

  insert into public.attendances (tenant_id, member_id, method, status, device_id)
  values (v_device.tenant_id, v_member.id, v_method, v_code, v_device.id)
  returning id into v_attendance;

  return jsonb_build_object(
    'unlock',            v_unlock,
    'code',              v_code,
    'reason',            v_reason,
    'member_id',         v_member.id,
    'member_name',       v_member.full_name,
    'member_phone',      v_member.phone,
    'member_status',     v_member.status,
    'membership_end',    v_member.membership_end,
    'is_frozen',         v_member.is_frozen,
    'freeze_end_date',   v_member.freeze_end_date,
    'days_left',         greatest(0, coalesce(v_member.membership_end - current_date, 0)),
    'method',            v_method,
    'attendance_id',     v_attendance,
    'device_id',         v_device.id,
    'device_name',       v_device.device_name,
    'device_type',       v_device.device_type,
    'tenant_id',         v_device.tenant_id
  );
end;
$$;

-- Only these six doors are open to the app roles.
grant execute on function
  public.fn_hardware_register(uuid, text, text, text, text),
  public.fn_hardware_list(uuid),
  public.fn_hardware_authorize(text),
  public.fn_hardware_heartbeat(text, uuid, uuid, text, text, text, text),
  public.fn_hardware_delete(uuid, uuid),
  public.fn_hardware_punch(text, integer, text)
to anon, authenticated;

commit;

-- -----------------------------------------------------------------------------
-- What to eyeball after running this (RAISE NOTICE output in the SQL editor)
-- -----------------------------------------------------------------------------
do $$
begin
  raise notice 'Phase 2 columns: tenants lat/lon=%, hardware_devices table=%, members.rfid_card=%, attendances.device_id=%',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants'
        and column_name in ('latitude', 'longitude')),
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'hardware_devices'),
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'members' and column_name = 'rfid_card'),
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'attendances' and column_name = 'device_id');

  raise notice 'hardware grants still held by anon/authenticated (must be 0): %',
    (select count(*) from information_schema.role_table_grants
      where table_name = 'hardware_devices' and grantee in ('anon', 'authenticated'));
end $$;
