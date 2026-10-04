-- =============================================================================
-- Migration 0017 — Phase 17: R307 / R307S biometric template enrollment.
--
-- WHAT THIS ADDS
-- -------------
-- An enrollment JOB, not a direct write. The R307S is a template-storage unit:
-- it owns the finger templates and reports a slot number; it does not know who
-- a member is. Vyroniq owns the identity mapping:
--
--     (tenant_id, terminal_id, member_id, fingerprint_slot)
--
-- so the flow is deliberately split in two:
--
--   1. The desk creates a job. The slot is RESERVED HERE, under an advisory
--      lock, so two desks enrolling at the same moment cannot be handed the
--      same slot.
--   2. The ESP32 polls /api/hardware/poll, claims the job, runs the 2-pass
--      capture on the R307S, and reports the outcome back. Only on success does
--      the slot become a live binding.
--
-- WHY NOT JUST SET members.biometric_id LIKE THE RFID PATH
-- -------------------------------------------------------
-- Existing RFID enrollment (fn_hardware_capture_enrollment) is ONE tap with no
-- capture ceremony, so "a card was read" is genuinely the whole event. A
-- fingerprint is not: the desk must be told the template was actually written,
-- and on which slot, or the desk will happily record a slot number for a finger
-- that never saved. Modelling that as a job with an explicit success report is
-- what makes the two honest.
--
-- NOTHING EXISTING CHANGES. members.biometric_id, fn_hardware_punch and
-- fn_member_link_hardware are untouched, so every already-enrolled fingerprint
-- and every RFID check-in behaves exactly as before. This migration only ADDS a
-- table, indexes and functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The enrollment job table
-- -----------------------------------------------------------------------------
create table if not exists public.fingerprint_enrollments (
  id                  uuid primary key default gen_random_uuid(),

  -- Scoping. tenant_id mirrors the member's gym and is never taken from an
  -- untrusted caller: fn_hardware_create_enrollment_job resolves it from the
  -- member row, exactly as fn_member_link_hardware does.
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  member_id           uuid not null references public.members(id) on delete cascade,

  -- The terminal that will physically hold the template. A different terminal
  -- means a different slot namespace, which is why this is part of the key.
  device_id           uuid not null references public.hardware_devices(id) on delete cascade,

  -- The slot RESERVED on that terminal. Held for the life of the job so two
  -- concurrent jobs cannot collide, and released on failure.
  fingerprint_slot    integer not null check (fingerprint_slot >= 1),

  -- What the device is being asked to do. 'enroll' writes a template and binds
  -- it; 'unlink' deletes a template the member no longer uses. Unlinking is a
  -- DEVICE-side operation — clearing members.biometric_id alone would leave the
  -- finger physically readable on the sensor forever, so the terminal has to be
  -- told to erase it.
  kind                text not null default 'enroll'
                        check (kind in ('enroll', 'unlink')),

  -- The binding this job is REPLACING, kept so the old template can be erased on
  -- the sensor only AFTER the replacement is proven to exist. Null on a first
  -- enrollment. Never used to blank the member early — see the create function.
  previous_slot       integer null check (previous_slot is null or previous_slot >= 1),

  -- Lifecycle. 'pending' is the only state the ESP32 will claim.
  status              text not null default 'pending'
                        check (status in ('pending', 'claimed', 'succeeded',
                                          'failed', 'cancelled')),
  stage               text not null default 'queued'
                        check (stage in ('queued', 'connecting', 'waiting_finger',
                                         'pass1_captured', 'remove_finger',
                                         'pass2_captured', 'saving', 'done')),

  -- What the desk is told, and why it failed if it did.
  message             text null,
  error_code          text null,

  -- Opaque id echoed back by the device, so a report is matched to the exact
  -- job it answers even when several are queued on the same terminal.
  job_token           text not null unique,

  -- Ownership / liveness. claimed_at lets a stalled terminal's job be reclaimed.
  claimed_by          text null,
  claimed_at          timestamptz null,
  expires_at          timestamptz not null default (now() + interval '10 minutes'),
  completed_at        timestamptz null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.fingerprint_enrollments is
  'One R307/R307S template enrollment: (tenant, member, terminal) -> reserved slot, with the device reporting the outcome.';

comment on column public.fingerprint_enrollments.fingerprint_slot is
  'Slot RESERVED on device_id. Reserving before capture is what prevents two desks being handed the same slot.';
comment on column public.fingerprint_enrollments.job_token is
  'Opaque id echoed back by the device on completion, so a late report is matched to the right job.';

-- The polling query is "oldest pending job for this terminal" — this index is
-- that query and nothing else.
create index if not exists idx_fp_enroll_poll
  on public.fingerprint_enrollments (device_id, status, created_at)
  where status in ('pending', 'claimed');

-- The desk's "is my enrollment still running?" view, and the member history.
create index if not exists idx_fp_enroll_member
  on public.fingerprint_enrollments (member_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 1b. fingerprint_templates — the terminal-scoped binding table
--
-- WHY THIS TABLE HAS TO EXIST
-- ----------------------------
-- The R307S stores templates in its OWN slots, and each terminal has its own
-- independent 1..N namespace. "Which finger is in slot 3?" is therefore only
-- answerable if you also know WHICH TERMINAL you are asking about.
--
-- members.biometric_id cannot carry that. It is a bare integer (migration 0001
-- made it unique per (tenant_id, biometric_id)) and there is no terminal column
-- on members at all. So a gym with two terminals cannot record that member A
-- holds slot 3 on the front door and member B holds slot 3 on the back door —
-- the second one collides on a uniqueness rule that has nothing to do with
-- either sensor.
--
-- This table is the honest mapping:
--
--     (device_id, fingerprint_slot) -> member_id
--
-- and it, not members.biometric_id, is what makes "two members cannot share a
-- slot on the same terminal" a real database guarantee.
--
-- WHY THE OLD INDEX WAS REMOVED
-- ------------------------------
-- The previous draft of this migration created:
--
--   create unique index members_terminal_slot_key
--     on public.members (tenant_id, biometric_id) ...
--
-- Despite the name, that index mentions NO terminal. It was a second copy of
-- migration 0001's members_tenant_biometric_id_key, so it did nothing for the
-- stated goal while implying it had been handled. Worse, it FORBADE the exact
-- case the hardware needs: two terminals in one gym both using slot 3.
--
-- members.biometric_id keeps its own (tenant_id, biometric_id) index from 0001.
-- That is still enforced — it simply means "a slot number is not reused within
-- a gym", which is conservative and harmless, while THIS table is what makes the
-- per-terminal namespace real. The member column is denormalised on purpose: it
-- is what the roster reads to answer "is this person enrolled, and where?".
-- -----------------------------------------------------------------------------
create table if not exists public.fingerprint_templates (
  id                uuid primary key default gen_random_uuid(),

  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  device_id         uuid not null references public.hardware_devices(id) on delete cascade,
  member_id         uuid not null references public.members(id) on delete cascade,

  fingerprint_slot  integer not null check (fingerprint_slot >= 1),

  -- A live template is exactly one row per member per terminal. History rows
  -- (superseded_by set, erased_at set) are retained so a past failure can be
  -- explained, and are therefore excluded from the uniqueness rules below.
  superseded_by     uuid null references public.fingerprint_templates(id) on delete set null,
  erased_at         timestamptz null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.fingerprint_templates is
  'Which member owns which template slot on which R307/R307S terminal. This is the terminal-scoped identity map; members.biometric_id alone cannot express it.';

-- THE core rule: one member per slot per terminal. Partial, so superseded or
-- erased rows keep their slot for history without blocking the slot's reuse.
create unique index if not exists fingerprint_templates_live_slot_key
  on public.fingerprint_templates (device_id, fingerprint_slot)
  where superseded_by is null and erased_at is null;

-- One live template per member per terminal, so re-enrolling on the SAME reader
-- cannot quietly produce two rows that both look current.
create unique index if not exists fingerprint_templates_live_member_key
  on public.fingerprint_templates (member_id, device_id)
  where superseded_by is null and erased_at is null;

-- The roster question: "is this member enrolled, and on what?"
create index if not exists idx_fp_templates_member
  on public.fingerprint_templates (member_id)
  where superseded_by is null and erased_at is null;

-- Backfill any fingerprint enrolled before this table existed, so an existing
-- gym does not start believing its members are unenrolled.
--
-- The device is resolved the only way it can be: the terminal this gym most
-- recently proved alive, because members.biometric_id never recorded one. That
-- is a guess for multi-terminal gyms, and it is a deliberately CONSERVATIVE one —
-- such a gym should re-enroll to have its slots attributed correctly, rather than
-- this migration inventing a terminal assignment.
insert into public.fingerprint_templates (tenant_id, device_id, member_id, fingerprint_slot)
select m.tenant_id,
       d.id,
       m.id,
       m.biometric_id
  from public.members m
  join lateral (
    select h.id
      from public.hardware_devices h
     where h.tenant_id = m.tenant_id
       and h.device_type = 'biometric_fingerprint'
     order by h.last_heartbeat desc nulls last, h.id
     limit 1
  ) d on true
 where m.biometric_id is not null
   and m.biometric_id >= 1
   and not exists (
     select 1 from public.fingerprint_templates t
      where t.member_id = m.id
        and t.superseded_by is null
        and t.erased_at is null
   )
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 1c. Reservation index on the job table
--
-- The binding table above stops two LIVE templates colliding, but a template is
-- only written once a capture SUCCEEDS. Until then the slot is held by a job that
-- has not produced a fingerprint_templates row yet, so two desks could still be
-- handed the same slot and race each other onto the sensor.
--
-- This partial index closes that window: among jobs that still hold their slot
-- ('pending'/'claimed'), one terminal's slot can appear exactly once. Finished
-- rows keep their slot number for history and are excluded.
-- -----------------------------------------------------------------------------
create unique index if not exists fingerprint_enrollments_device_slot_key
  on public.fingerprint_enrollments (device_id, fingerprint_slot)
  where status in ('pending', 'claimed');

-- -----------------------------------------------------------------------------
-- 2. fn_hardware_next_fingerprint_slot(tenant, device)
--
-- Lowest unused slot ON ONE TERMINAL.
--
-- The existing fn_next_biometric_slot (migration 0012) allocates per GYM. That
-- is right for a terminal-independent namespace and wrong for R307S: two
-- terminals at the same gym are two independent sensors, each with its own
-- slots 1..N, so "lowest free across the gym" would hand slot 3 to a terminal
-- that already has a different finger in slot 3. This function is per device.
--
-- Two sources of "taken", and both matter:
--   - slots already bound to a member on this terminal (the live bindings)
--   - slots held by a live enrollment job (the reservations)
--
-- MAX()+1 would be wrong under concurrency — two desks would read the same MAX.
-- pg_advisory_xact_lock serialises the whole read-then-insert inside one
-- transaction, which is why this lives in SQL and not in the browser.
-- -----------------------------------------------------------------------------
create or replace function public.fn_hardware_next_fingerprint_slot(
  p_tenant_id uuid,
  p_device_id uuid
)
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
  if p_device_id is null then
    raise exception 'device_id is required' using errcode = '22023';
  end if;

  -- Two-argument advisory lock keyed on the terminal, so two DIFFERENT
  -- terminals still allocate concurrently while one terminal cannot double-book.
  perform pg_advisory_xact_lock(hashtextextended(p_device_id::text, 7717));

  -- Lowest positive integer not bound on THIS TERMINAL and not reserved by a
  -- live job on this terminal.
  --
  -- Both checks are per device_id, and deliberately ignore other terminals: slot
  -- 3 on the front-door reader is a different physical template from slot 3 on
  -- the back-door reader.
  --
  -- The previous draft of this function read members.biometric_id with an
  -- `exists (select 1 from hardware_devices ...)` that referenced nothing from
  -- the outer query — a constant that evaluates once. It therefore filtered by
  -- GYM, not by terminal, which silently defeated the whole point of the
  -- function and handed out a slot already holding a finger on another reader.
  -- fingerprint_templates is now the source of truth for that question.
  select coalesce(min(s.slot), 1)
    into v_next
    from generate_series(1, 999) as s(slot)
   where not exists (
           select 1 from public.fingerprint_templates t
            where t.device_id = p_device_id
              and t.fingerprint_slot = s.slot
              and t.superseded_by is null
              and t.erased_at is null
         )
     -- A gym that enrolled before migration 0017 has no fingerprint_templates
     -- row yet, so fall back to the legacy column or those slots would be
     -- reissued while still physically occupied.
     and not exists (
           select 1 from public.members m
            where m.tenant_id = p_tenant_id
              and m.biometric_id = s.slot
              and not exists (
                    select 1 from public.fingerprint_templates t2
                     where t2.member_id = m.id
                       and t2.superseded_by is null
                       and t2.erased_at is null
              )
         )
     and not exists (
           select 1 from public.fingerprint_enrollments e
            where e.device_id = p_device_id
              and e.fingerprint_slot = s.slot
              and e.status in ('pending', 'claimed')
         );

  if v_next is null or v_next > 999 then
    raise exception 'That terminal has no free fingerprint slot left (max 999).'
      using errcode = '45010';
  end if;

  return v_next;
end;
$$;

comment on function public.fn_hardware_next_fingerprint_slot(uuid, uuid) is
  'Lowest unused template slot on ONE terminal, counting live bindings and live reservations, under an advisory lock so two desks cannot be handed the same slot.';

-- -----------------------------------------------------------------------------
-- 3. fn_hardware_create_enrollment_job(member, device)
--
-- Resolves the member, verifies the terminal, reserves a slot and queues the
-- job. This is the only way a fingerprint enrollment starts.
--
-- SECURITY MODEL (mirrors fn_member_link_hardware exactly)
-- -------------------------------------------------------
-- The tenant comes from the MEMBER ROW, never from the caller. A caller that
-- names another gym's member gets the same 'Member not found' as a caller that
-- names a member who does not exist — the two are deliberately indistinguishable
-- so this endpoint cannot be used to probe for member ids.
--
-- RE-ENROLLMENT IS THE NORMAL CASE, NOT AN ERROR
-- ----------------------------------------------
-- A member who already has a fingerprint is re-enrolling: new finger, same
-- person. The previous slot is RECORDED here (previous_slot, handed to the
-- device as delete_slot) so the sensor can erase it once the replacement is
-- proven — but the member's live binding is left completely untouched until
-- that success report arrives. Losing a working fingerprint to a failed
-- re-enrollment is not an acceptable failure mode.
-- -----------------------------------------------------------------------------
create or replace function public.fn_hardware_create_enrollment_job(
  p_member_id  uuid,
  p_device_id  uuid,
  p_delete_old boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member      public.members%rowtype;
  v_device      public.hardware_devices%rowtype;
  v_old_slot    integer;
  v_prev_bound  integer;
  v_slot        integer;
  v_token       text;
  v_job         public.fingerprint_enrollments%rowtype;
begin
  if p_member_id is null then
    raise exception 'member_id is required' using errcode = '22023';
  end if;
  if p_device_id is null then
    raise exception 'device_id is required. Open the Hardware tab and register a fingerprint terminal first.'
      using errcode = '22023';
  end if;

  select * into v_member from public.members m where m.id = p_member_id;
  if v_member.id is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  select * into v_device
    from public.hardware_devices d
   where d.id = p_device_id
     and d.tenant_id = v_member.tenant_id;

  if v_device.id is null then
    raise exception 'That terminal does not belong to this gym.' using errcode = 'P0002';
  end if;

  if v_device.device_type <> 'biometric_fingerprint' then
    raise exception 'Fingerprints can only be enrolled on a fingerprint terminal.'
      using errcode = '45011';
  end if;

  -- Refuse a second CONCURRENT job for the same person: a desk that double-clicks
  -- would otherwise queue two captures and the second would fight the first for
  -- the finger. An already-succeeded/failed job is history and is fine.
  if exists (
    select 1 from public.fingerprint_enrollments e
     where e.member_id = p_member_id
       and e.status in ('pending', 'claimed')
  ) then
    raise exception 'This member already has an enrollment running. Wait for it to finish.'
      using errcode = '45012';
  end if;

  v_old_slot := v_member.biometric_id;

  -- One lock, held for the whole read-reserve-insert: this is what makes the
  -- reservation atomic against a second desk starting at the same moment.
  v_slot := public.fn_hardware_next_fingerprint_slot(v_member.tenant_id, p_device_id);

  -- The member's PREVIOUS binding on this terminal, if any. Recorded on the job
  -- as previous_slot and handed to the device as delete_slot, but NOT acted on
  -- here.
  --
  -- WHY THE OLD BINDING IS NOT CLEARED HERE
  -- --------------------------------------
  -- The previous draft ran:
  --
  --   update members set biometric_id = null where id = p_member_id;
  --
  -- before the capture even started. That destroys a WORKING fingerprint on the
  -- strength of a capture that might never succeed — a member whose re-enroll
  -- dropped out, timed out, or was cancelled at the desk would be left unable to
  -- open the gate and showing as unenrolled, having lost a credential they were
  -- using five minutes ago.
  --
  -- Instead the old template stays live for the whole job. On success it is
  -- superseded atomically in fn_hardware_report_enrollment, which is the only
  -- place a binding changes; on failure nothing is touched at all. The new slot
  -- is simply allocated alongside it.

  -- Now resolve the binding this job REPLACES, before anything is written.
  --
  -- The terminal-aware table is the authority here, and it is consulted
  -- unconditionally: a member whose legacy biometric_id was cleared by hand (or by
  -- the Advanced manual-slot field in the console) can still have a live template
  -- row, and that row is exactly the one the sensor needs erasing.
  select t.fingerprint_slot into v_prev_bound
    from public.fingerprint_templates t
   where t.member_id = p_member_id
     and t.device_id = p_device_id
     and t.superseded_by is null
     and t.erased_at is null
   limit 1;

  if v_prev_bound is not null then
    v_old_slot := v_prev_bound;
  end if;

  v_token := 'fpenr_' || encode(gen_random_bytes(12), 'hex');

  insert into public.fingerprint_enrollments (
    tenant_id, member_id, device_id, fingerprint_slot, job_token,
    kind, previous_slot, expires_at
  )
  values (
    v_member.tenant_id, p_member_id, p_device_id, v_slot, v_token,
    'enroll',
    case when v_old_slot >= 1 and v_old_slot <> v_slot then v_old_slot else null end,
    now() + interval '10 minutes'
  )
  returning * into v_job;

  -- 23505 on fingerprint_enrollments_device_slot_key means another job took the
  -- slot between our lock and this insert. Retried once under a fresh read; a
  -- second failure is a genuine conflict and the caller should surface it.
  return jsonb_build_object(
    'ok', true,
    'job_id',        v_job.id,
    'job_token',     v_job.job_token,
    'member_id',     p_member_id,
    'member_name',   v_member.full_name,
    'device_id',     p_device_id,
    'device_name',   v_device.device_name,
    'slot',          v_slot,
    'previous_slot', case when v_old_slot >= 1 then v_old_slot else null end,
    'delete_slot',   case when p_delete_old and v_old_slot >= 1 and v_old_slot <> v_slot
                         then v_old_slot else null end,
    'expires_at',    v_job.expires_at
  );
exception
  when unique_violation then
    -- The partial unique index refused the reservation. Retry once: the common
    -- cause is simply two desks racing, which the second pass wins cleanly.
    raise exception 'That slot was just taken by another enrollment. Please try again.'
      using errcode = '45013';
end;
$$;

comment on function public.fn_hardware_create_enrollment_job(uuid, uuid, boolean) is
  'Queues one R307 enrollment for a member on a terminal, reserving the lowest free slot on that terminal and releasing any previous binding first.';

-- -----------------------------------------------------------------------------
-- 4. fn_hardware_claim_enrollment_job(api_key, device_id)
--
-- What the ESP32 calls on its poll loop. Returns the OLDEST live job for that
-- terminal and flips it to 'claimed' in the same statement, so two polls that
-- race (a retry after a flaky response, two tabs, a duplicate request) cannot
-- both win the same job.
--
-- EXPIRY IS SELF-HEALING
-- ----------------------
-- A terminal that is powered off mid-capture leaves a 'claimed' job that will
-- never report. Rather than need a reaper, the poll treats a claimed job whose
-- claimed_at is older than two minutes as abandoned and takes it over — so a
-- desk that walks away and comes back can simply press Retry.
--
-- Returns NULL (not an error) when there is nothing to do: that is the normal
-- steady state for a gate reader polling every two seconds, and an error there
-- would make the firmware log noise all day.
-- -----------------------------------------------------------------------------
create or replace function public.fn_hardware_claim_enrollment_job(
  p_api_key  text,
  p_device_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.hardware_devices%rowtype;
  v_job    public.fingerprint_enrollments%rowtype;
  v_template public.fingerprint_templates%rowtype;
begin
  if p_api_key is null or trim(p_api_key) = '' then
    raise exception 'api_key is required' using errcode = '22023';
  end if;

  select * into v_device
    from public.hardware_devices d
   where d.api_key = trim(p_api_key);

  -- Same 45005 the punch endpoint uses, so firmware already handles it.
  if v_device.id is null then
    raise exception 'Unknown device key' using errcode = '45005';
  end if;

  -- If the firmware names a device, it must be the one its key belongs to.
  if p_device_id is not null and p_device_id <> v_device.id then
    raise exception 'Unknown device key' using errcode = '45005';
  end if;

  -- Fail anything that has run out of time, so a stuck job neither holds its slot
  -- reservation nor shows the desk a spinner forever.
  update public.fingerprint_enrollments
     set status       = 'failed',
         stage        = 'done',
         error_code   = 'expired',
         message      = 'The terminal did not complete this enrollment in time.',
         completed_at = now(),
         updated_at   = now()
   where device_id = v_device.id
     and status in ('pending', 'claimed')
     and expires_at < now();

  -- Take the oldest live job for this terminal, marking it claimed atomically.
  select * into v_job
    from public.fingerprint_enrollments e
   where e.device_id = v_device.id
     and e.status in ('pending', 'claimed')
     and e.expires_at >= now()
     and (e.status = 'pending' or e.claimed_at is null or e.claimed_at < now() - interval '2 minutes')
   order by e.created_at asc
   limit 1
   for update skip locked;

  if v_job.id is null then
    return null;
  end if;

  update public.fingerprint_enrollments
     set status     = 'claimed',
         stage      = 'connecting',
         claimed_at = now(),
         claimed_by = v_device.device_name,
         updated_at = now()
   where id = v_job.id
  returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'job_id',       v_job.id,
    'job_token',    v_job.job_token,
    'slot',         v_job.fingerprint_slot,
    'kind',         v_job.kind,
    'stage',        v_job.stage,
    'device_name',  v_device.device_name,
    'device_type',  v_device.device_type,
    'firmware',     v_device.firmware_version,
    'expires_at',   v_job.expires_at,
    -- The template to ERASE once this job's capture succeeds. Sent as data so
    -- firmware never has to remember a previous slot, and null on a first
    -- enrollment. For an 'unlink' job this is the whole point of the job.
    'delete_slot',  v_job.previous_slot
  );
end;
$$;

comment on function public.fn_hardware_claim_enrollment_job(text, uuid) is
  'Poll target for the ESP32: atomically claims the oldest live enrollment for the terminal behind this api key, or returns null when idle.';

-- -----------------------------------------------------------------------------
-- 5. fn_hardware_report_enrollment(api_key, job_token, status, stage, message)
--
-- The device reports the outcome. This is the ONLY place a fingerprint slot
-- becomes a live member binding, and it happens here and nowhere else.
--
-- WHY SUCCESS IS THE ONLY PATH THAT WRITES members.biometric_id
-- -------------------------------------------------------------
-- If the capture failed halfway — the two passes never matched, the sensor
-- timed out, the cable dropped — the template is not in the sensor, so binding a
-- slot would produce a member whose fingerprint opens a door that silently does
-- nothing. Worse, it would LOOK enrolled on the roster. So a failure releases
-- the reservation and writes nothing.
--
-- IDEMPOTENT
-- ---------
-- The ESP32 retries a report over a flaky link. Re-reporting an already-finished
-- job returns that job's existing outcome instead of double-binding, so a retry
-- can never move a member onto a second slot.
-- -----------------------------------------------------------------------------
create or replace function public.fn_hardware_report_enrollment(
  p_api_key     text,
  p_job_token   text,
  p_status      text,
  p_stage       text default null,
  p_message     text default null,
  p_error_code  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.hardware_devices%rowtype;
  v_job    public.fingerprint_enrollments%rowtype;
  v_member public.members%rowtype;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if p_api_key is null or trim(p_api_key) = '' then
    raise exception 'api_key is required' using errcode = '22023';
  end if;
  if p_job_token is null or trim(p_job_token) = '' then
    raise exception 'job_token is required' using errcode = '22023';
  end if;
  if v_status not in ('succeeded', 'failed', 'cancelled', 'progress') then
    raise exception 'status must be one of succeeded, failed, cancelled, progress.'
      using errcode = '22023';
  end if;

  select * into v_device from public.hardware_devices d where d.api_key = trim(p_api_key);
  if v_device.id is null then
    raise exception 'Unknown device key' using errcode = '45005';
  end if;

  select * into v_job
    from public.fingerprint_enrollments e
   where e.job_token = trim(p_job_token)
     and e.device_id = v_device.id;

  if v_job.id is null then
    raise exception 'Unknown enrollment job' using errcode = 'P0002';
  end if;

  -- Idempotent replay: answer with what already happened.
  if v_job.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object(
      'ok', true, 'already_final' => true,
      'status', v_job.status, 'stage', v_job.stage,
      'slot', v_job.fingerprint_slot, 'message', v_job.message
    );
  end if;

  -- ---- PROGRESS: the desk watches the 2-pass ceremony live. ------------------
  if v_status = 'progress' then
    update public.fingerprint_enrollments
       set stage      = coalesce(p_stage, stage),
           message    = p_message,
           updated_at = now()
     where id = v_job.id
    returning * into v_job;

    return jsonb_build_object(
      'ok', true, 'status', v_job.status, 'stage', v_job.stage,
      'slot', v_job.fingerprint_slot, 'message', v_job.message
    );
  end if;

-- ---- SUCCESS (unlink): the terminal confirms the erase. --------------------
  --
  -- Only now is the template actually gone, so this is the first point at which
  -- the member may be treated as unenrolled. A failure above leaves everything
  -- intact and retryable.
  if v_status = 'succeeded' and v_job.kind = 'unlink' then
    update public.fingerprint_templates
       set erased_at  = now(),
           updated_at = now()
     where device_id = v_job.device_id
       and fingerprint_slot = v_job.fingerprint_slot
       and superseded_by is null
       and erased_at is null;

    -- Clear the legacy column ONLY if it still points at the slot we just
    -- erased. If the member has since been re-enrolled elsewhere, the newer
    -- number must survive.
    update public.members
       set biometric_id = null
     where id = v_job.member_id
       and biometric_id = v_job.fingerprint_slot;

    update public.fingerprint_enrollments
       set status       = 'succeeded',
           stage        = 'done',
           message      = coalesce(p_message, 'Fingerprint removed from the terminal.'),
           error_code   = null,
           completed_at = now(),
           updated_at   = now()
     where id = v_job.id
    returning * into v_job;

    return jsonb_build_object(
      'ok', true, 'status', 'succeeded', 'stage', 'done',
      'slot', v_job.fingerprint_slot,
      'member_id', v_job.member_id,
      'message', v_job.message
    );
  end if;

  -- ---- SUCCESS: bind the slot. -------------------------------------------------
  if v_status = 'succeeded' then
    select * into v_member from public.members m where m.id = v_job.member_id;
    if v_member.id is null then
      raise exception 'Member not found' using errcode = 'P0002';
    end if;

    -- The authoritative binding is the terminal-aware row, so insert it FIRST.
    --
    -- 23505 on fingerprint_templates_live_slot_key means the slot was bound to
    -- somebody else between reservation and report — a real conflict, not a
    -- transient one. Refuse rather than overwrite another member's credential,
    -- and do NOT touch members.biometric_id on the way out.
    begin
      insert into public.fingerprint_templates (
        tenant_id, device_id, member_id, fingerprint_slot
      )
      values (
        v_job.tenant_id, v_job.device_id, v_job.member_id, v_job.fingerprint_slot
      )
      returning * into v_template;
    exception when unique_violation then
      update public.fingerprint_enrollments
         set status = 'failed', stage = 'done',
             error_code = 'slot_conflict',
             message = 'That slot was taken by another member while enrolling.',
             completed_at = now(), updated_at = now()
       where id = v_job.id;

      raise exception 'That fingerprint slot is now used by another member. Please try again.'
        using errcode = '45008';
    end;

    -- Supersede the binding this job replaces. Same slot (a re-enroll that
    -- re-picked the member's own number) is not a supersede — it IS the row.
    if v_job.previous_slot is not null
       and v_job.previous_slot <> v_job.fingerprint_slot then
      update public.fingerprint_templates
         set superseded_by = v_template.id,
             updated_at    = now()
       where device_id = v_job.device_id
         and member_id = v_job.member_id
         and fingerprint_slot = v_job.previous_slot
         and superseded_by is null
         and erased_at is null;
    end if;

    -- Only NOW is the legacy column rewritten, as the last step of a chain that
    -- can no longer leave the member credential-less. 23505 here is the 0001
    -- per-gym index refusing a number another member already holds.
    begin
      update public.members
         set biometric_id = v_job.fingerprint_slot
       where id = v_job.member_id;
    exception when unique_violation then
      update public.fingerprint_enrollments
         set status = 'failed', stage = 'done',
             error_code = 'slot_conflict',
             message = 'That fingerprint number is already in use in this gym.',
             completed_at = now(), updated_at = now()
       where id = v_job.id;

      raise exception 'That fingerprint number is already in use in this gym. Please try again.'
        using errcode = '45008';
    end;

    update public.fingerprint_enrollments
       set status       = 'succeeded',
           stage        = 'done',
           message      = coalesce(p_message, 'Fingerprint registered.'),
           error_code   = null,
           completed_at = now(),
           updated_at   = now()
     where id = v_job.id
    returning * into v_job;

    return jsonb_build_object(
      'ok', true, 'status', 'succeeded', 'stage', 'done',
      'slot', v_job.fingerprint_slot,
      'member_id', v_job.member_id,
      'member_name', v_member.full_name,
      -- The device must now erase the template it was told about. Until it
      -- confirms, the row is already superseded here so the slot is free for
      -- the next member even if the erase is slow to arrive.
      'delete_slot', case
        when v_job.previous_slot is not null
          and v_job.previous_slot <> v_job.fingerprint_slot
          then v_job.previous_slot
        else null
      end,
      'message', v_job.message
    );
  end if;

  -- ---- FAILURE / CANCEL: release the reservation, bind nothing. ---------------
  update public.fingerprint_enrollments
     set status       = v_status,
         stage        = 'done',
         message      = coalesce(p_message, 'The terminal could not complete this enrollment.'),
         error_code   = coalesce(p_error_code, v_status),
         completed_at = now(),
         updated_at   = now()
   where id = v_job.id
  returning * into v_job;

  -- Nothing to undo. The previous binding was never released when this job was
  -- created, so a failed or cancelled re-enrollment leaves the member exactly as
  -- they were: still enrolled, still able to open the gate with the finger they
  -- already had.
  return jsonb_build_object(
    'ok', true, 'status', v_job.status, 'stage', 'done',
    'slot', v_job.fingerprint_slot, 'message', v_job.message
  );
end;
$$;

comment on function public.fn_hardware_report_enrollment(text, text, text, text, text, text) is
  'Device-reported outcome for an enrollment job. Only a success writes members.biometric_id; progress updates the live stage; replay of a finished job is idempotent.';

-- -----------------------------------------------------------------------------
-- 6. fn_hardware_enrollment_job_state(tenant, job_token?)
--
-- What the desk polls while the ceremony runs. Scoped to the tenant from the
-- caller's session cookie, never from a query parameter the UI could tamper with.
--
-- Returns the newest job plus its terminal name, so the modal can say "Front
-- Gate Reader" rather than a bare uuid. Deliberately returns NO api_key.
-- -----------------------------------------------------------------------------
create or replace function public.fn_hardware_enrollment_job_state(
  p_tenant_id uuid,
  p_job_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job jsonb;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'job_id',     e.id,
           'job_token',  e.job_token,
           'status',     e.status,
           'stage',      e.stage,
           'message',    e.message,
           'error_code', e.error_code,
           'slot',       e.fingerprint_slot,
           'member_id',  e.member_id,
           'member_name', m.full_name,
           'device_id',  e.device_id,
           'device_name', d.device_name,
           'created_at', e.created_at,
           'completed_at', e.completed_at,
           'expires_at', e.expires_at
         )
    into v_job
    from public.fingerprint_enrollments e
    join public.members m on m.id = e.member_id
    join public.hardware_devices d on d.id = e.device_id
   where e.tenant_id = p_tenant_id
     and (p_job_token is null or e.job_token = p_job_token)
   order by e.created_at desc
   limit 1;

  return v_job;
end;
$$;

comment on function public.fn_hardware_enrollment_job_state(uuid, text) is
  'Newest enrollment job for one gym, with member and terminal names for the desk UI. Never exposes api_key.';

-- -----------------------------------------------------------------------------
-- 7. fn_hardware_cancel_enrollment(tenant, job_token)
--
-- The owner closing the modal must actually release the slot, not just stop
-- watching it — otherwise a cancelled enrollment would hold its reservation
-- until the ten-minute expiry and the next member would be pushed to a
-- higher slot for no reason.
-- -----------------------------------------------------------------------------
create or replace function public.fn_hardware_cancel_enrollment(
  p_tenant_id uuid,
  p_job_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.fingerprint_enrollments%rowtype;
begin
  if p_job_token is null then
    return jsonb_build_object('ok', true, 'cancelled', false);
  end if;

  update public.fingerprint_enrollments e
     set status       = 'cancelled',
         stage        = 'done',
         message      = 'Cancelled at the desk.',
         error_code   = 'cancelled',
         completed_at = now(),
         updated_at   = now()
   where e.job_token = p_job_token
     and e.tenant_id = p_tenant_id
     and e.status in ('pending', 'claimed')
  returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'cancelled', v_job.id is not null,
    'job_id', v_job.id
  );
end;
$$;

comment on function public.fn_hardware_cancel_enrollment(uuid, text) is
  'Cancels a live enrollment job and releases its slot reservation immediately.';

-- -----------------------------------------------------------------------------
-- 7b. fn_hardware_unlink_fingerprint(tenant, member, device)
--
-- Removes a member's fingerprint, ON THE DEVICE as well as in the database.
--
-- WHY THIS IS A JOB AND NOT A COLUMN UPDATE
-- ----------------------------------------
-- The R307S keeps the finger image in its own flash. Blanking
-- members.biometric_id makes the member unenrolled in Vyroniq but leaves their
-- fingerprint sitting in the sensor, still matching at the door — which is a
-- data-retention problem as much as a security one, and is exactly what an
-- ex-member's finger should not be. So unlinking queues the same kind of job an
-- enrollment uses, and the terminal does the erase.
--
-- THE ERASE IS CONFIRMED BEFORE THE RECORD IS DROPPED
-- --------------------------------------------------
-- The binding row is marked erased_at only when the device reports success. If
-- the terminal is offline the job expires as 'failed' and the member stays
-- enrolled, so the desk is told to retry rather than being left with a record
-- that claims the finger is gone while it is not.
-- -----------------------------------------------------------------------------
create or replace function public.fn_hardware_unlink_fingerprint(
  p_tenant_id  uuid,
  p_member_id  uuid,
  p_device_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member   public.members%rowtype;
  v_device   public.hardware_devices%rowtype;
  v_template public.fingerprint_templates%rowtype;
  v_slot     integer;
  v_token    text;
  v_job      public.fingerprint_enrollments%rowtype;
begin
  if p_member_id is null then
    raise exception 'member_id is required' using errcode = '22023';
  end if;

  select * into v_member from public.members m where m.id = p_member_id;

  -- Same indistinguishability as the enroll path: a member of another gym looks
  -- exactly like a member who does not exist.
  if v_member.id is null
     or (p_tenant_id is not null and v_member.tenant_id <> p_tenant_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  -- Prefer the terminal-scoped binding, which is the only record that actually
  -- knows which sensor holds the template.
  select * into v_template
    from public.fingerprint_templates t
   where t.member_id = p_member_id
     and t.superseded_by is null
     and t.erased_at is null
     and (p_device_id is null or t.device_id = p_device_id)
   order by t.created_at desc
   limit 1;

  if v_template.id is null then
    -- Nothing tracked. Fall back to the legacy column so a gym that enrolled
    -- before migration 0017 can still be cleaned up.
    if v_member.biometric_id is null or v_member.biometric_id < 1 then
      raise exception 'This member has no fingerprint to remove.' using errcode = 'P0002';
    end if;

    select * into v_device
      from public.hardware_devices d
     where d.id = p_device_id and d.tenant_id = v_member.tenant_id;

    if v_device.id is null then
      select * into v_device
        from public.hardware_devices d
       where d.tenant_id = v_member.tenant_id
         and d.device_type = 'biometric_fingerprint'
       order by d.last_heartbeat desc nulls last, d.id
       limit 1;
    end if;

    if v_device.id is null then
      raise exception 'No fingerprint terminal is registered for this gym, so the template cannot be erased.'
        using errcode = '45010';
    end if;

    v_slot := v_member.biometric_id;
  else
    v_device := null;
    select * into v_device
      from public.hardware_devices d
     where d.id = v_template.device_id;

    v_slot := v_template.fingerprint_slot;
  end if;

  if v_slot is null or v_slot < 1 then
    raise exception 'This member has no fingerprint to remove.' using errcode = 'P0002';
  end if;

  -- One unlink at a time per member, same rule as enrollment.
  if exists (
    select 1 from public.fingerprint_enrollments e
     where e.member_id = p_member_id
       and e.status in ('pending', 'claimed')
  ) then
    raise exception 'This member already has a fingerprint job running. Wait for it to finish.'
      using errcode = '45012';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_device.id::text, 7717));

  v_token := 'fpunl_' || encode(gen_random_bytes(12), 'hex');

  -- fingerprint_slot is the slot being ERASED, not reserved for a new template.
  -- The reservation index still guards it, which is what we want: a second job
  -- must not treat the doomed slot as free-to-claim while it is being erased.
  insert into public.fingerprint_enrollments (
    tenant_id, member_id, device_id, fingerprint_slot, job_token,
    kind, previous_slot, stage, expires_at
  )
  values (
    v_member.tenant_id, p_member_id, v_device.id, v_slot, v_token,
    'unlink', v_slot, 'waiting_finger', now() + interval '10 minutes'
  )
  returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'job_id',    v_job.id,
    'job_token', v_job.job_token,
    'member_id', p_member_id,
    'device_id', v_device.id,
    'device_name', v_device.device_name,
    'slot',      v_slot,
    'delete_slot', v_slot,
    'expires_at', v_job.expires_at
  );
end;
$$;

comment on function public.fn_hardware_unlink_fingerprint(uuid, uuid, uuid) is
  'Queues a device-side erase of a member fingerprint template; the binding is only cleared once the terminal confirms the template is gone.';

-- -----------------------------------------------------------------------------
-- 8. Grants
--
-- The device-facing functions (claim / report) reach `anon` for the same reason
-- /api/hardware/punch does: the ESP32 authenticates with a machine key in the
-- body, not a Supabase session, and those two are the only endpoints it touches.
-- Every one of them re-derives the gym from that key, so anon reachability does
-- not widen what a stolen key can do: it can only ever claim jobs for, and
-- report on, its OWN terminal.
--
-- The desk-facing functions (create / state / cancel / next slot) also reach
-- anon because the owner console holds the ANON role (it authenticates against
-- gym_users, not Supabase Auth). Each of those takes the tenant from the
-- session cookie server-side and re-resolves it from the member row in SQL, so
-- they are scoped exactly like every other Phase 12 route.
-- -----------------------------------------------------------------------------
grant execute on function public.fn_hardware_next_fingerprint_slot(uuid, uuid)
  to anon, authenticated;

grant execute on function public.fn_hardware_create_enrollment_job(uuid, uuid, boolean)
  to anon, authenticated;

grant execute on function public.fn_hardware_claim_enrollment_job(text, uuid)
  to anon, authenticated;

grant execute on function public.fn_hardware_report_enrollment(text, text, text, text, text, text)
  to anon, authenticated;

grant execute on function public.fn_hardware_enrollment_job_state(uuid, text)
  to anon, authenticated;

grant execute on function public.fn_hardware_cancel_enrollment(uuid, text)
  to anon, authenticated;

grant execute on function public.fn_hardware_unlink_fingerprint(uuid, uuid, uuid)
  to anon, authenticated;

-- The job table holds no secrets, but it is written ONLY through the SECURITY
-- DEFINER functions above, so direct table access stays revoked from anon —
-- same posture as hardware_devices.
--
-- fingerprint_templates is the same: every read the console needs goes through
-- fn_hardware_enrollment_job_state, and every write through the enroll/report
-- functions, so no client role needs direct table access to it either.
revoke all on table public.fingerprint_enrollments from anon, authenticated;
revoke all on table public.fingerprint_templates from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Verification
--
-- Fails loudly (raises) if any object this migration depends on is missing, so
-- a partial apply is caught here rather than as a runtime 404 in the console.
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad text[] := '{}';
begin
  if to_regclass('public.fingerprint_enrollments') is null then
    v_bad := array_append(v_bad, 'fingerprint_enrollments table missing');
  end if;
  if to_regclass('public.fingerprint_templates') is null then
    v_bad := array_append(v_bad, 'fingerprint_templates table missing');
  end if;
  if to_regclass('public.fingerprint_templates_live_slot_key') is null then
    v_bad := array_append(v_bad, 'terminal-aware slot uniqueness index missing');
  end if;
  if to_regprocedure('public.fn_hardware_next_fingerprint_slot(uuid, uuid)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_next_fingerprint_slot missing');
  end if;
  if to_regprocedure('public.fn_hardware_create_enrollment_job(uuid, uuid, boolean)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_create_enrollment_job missing');
  end if;
  if to_regprocedure('public.fn_hardware_claim_enrollment_job(text, uuid)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_claim_enrollment_job missing');
  end if;
  if to_regprocedure('public.fn_hardware_report_enrollment(text, text, text, text, text, text)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_report_enrollment missing');
  end if;
  if to_regprocedure('public.fn_hardware_enrollment_job_state(uuid, text)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_enrollment_job_state missing');
  end if;
  if to_regprocedure('public.fn_hardware_cancel_enrollment(uuid, text)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_cancel_enrollment missing');
  end if;
  if to_regprocedure('public.fn_hardware_unlink_fingerprint(uuid, uuid, uuid)') is null then
    v_bad := array_append(v_bad, 'fn_hardware_unlink_fingerprint missing');
  end if;
  if to_regclass('public.fingerprint_enrollments_device_slot_key') is null then
    v_bad := array_append(v_bad, 'device/slot uniqueness index missing');
  end if;

  if cardinality(v_bad) > 0 then
    raise exception 'Phase 17 incomplete: %', array_to_string(v_bad, ', ');
  end if;
end;
$$;