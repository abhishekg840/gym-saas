-- ============================================================================
-- Phase 18 — the terminal that never says hello (Module: enrollment liveness)
-- ============================================================================
--
-- THE DEFECT
-- ----------
-- fn_hardware_claim_enrollment_job is what an R307 calls every couple of seconds
-- while it waits for work, and it resolved the device, expired dead jobs and
-- claimed a job — but it never wrote last_heartbeat. So the ESP32 was polling
-- happily while the console showed the reader as Offline.
--
-- It was visible on real data: a gym whose reader reported status='online' with
-- last_heartbeat five hours stale. `status` was left over from a punch; the
-- heartbeat had simply never been written by the poll loop. fn_hardware_list
-- derives is_online from last_heartbeat, so the enrollment modal refused to
-- start on a terminal that was, in fact, awake and answering.
--
-- WHY THE OTHER CHECK-IN DOORS WERE LEFT ALONE
-- --------------------------------------------
-- fn_hardware_punch (0003, ~line 465) writes last_heartbeat and status
-- immediately after resolving the device and BEFORE any decision branch, so
-- a DENIED member still counts as proof of life. fn_hardware_capture_enrollment
-- (0012, ~line 534) writes it on the capture path, and the gate route falls
-- through to fn_hardware_punch on every other path. 0010 and 0011 redefined only
-- the four-argument wrapper that defers to the three-argument punch, so neither
-- dropped the heartbeat. Verified, not assumed.
--
-- THE TWO FIXES IN THIS MIGRATION
-- -------------------------------
-- 1. HEARTBEAT (section 1) — fn_hardware_claim_enrollment_job never wrote
--    last_heartbeat, so the ESP32 could be polling happily while the console
--    showed the reader Offline. Visible on real data: status='online' left over
--    from a punch with last_heartbeat five hours stale. fn_hardware_list derives
--    is_online from last_heartbeat, so the enrollment modal refused to start on
--    a terminal that was, in fact, awake. The write sits AFTER the device is
--    proven and BEFORE the idle early-return, because "nothing to do" is the
--    overwhelmingly common case for a reader that is powered on.
--
-- 2. SLOT RETENTION (sections 2-3) — 0017's create fn always allocated the
--    lowest FREE slot, so every re-enroll bumped the member up a number for no
--    reason, and fn_hardware_report_enrollment would have collided with the
--    member's OWN live template row (fingerprint_templates_live_slot_key is
--    unique on device+slot) the moment a slot was reused. The create fn now
--    reuses the slot the member already holds on that terminal, and the report
--    fn recognises that row instead of failing a completed capture as a
--    conflict. The two changes only work as a pair.
--
-- This is a new migration rather than an edit to 0017 because 0017 is already
-- applied to live databases; editing it would change no one's schema.
-- ============================================================================

begin;

-- -----------------------------------------------------------------------------
-- fn_hardware_claim_enrollment_job — 0017's body, plus proof of life.
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

  -- >>> PHASE 18: the poll loop IS the heartbeat. <<<
  --
  -- Deliberately ABOVE the "no job" early-return below. A reader that polls
  -- forever and is handed nothing is still very much alive, and that is the
  -- overwhelmingly common case — so this must not depend on there being work.
  -- Mirrors fn_hardware_punch: presence of life implies the reader is online.
  update public.hardware_devices
     set last_heartbeat = now(),
         status         = 'online'
   where id = v_device.id;

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
    'device_id',    v_device.id,
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
  'Poll target for the ESP32: refreshes the device heartbeat, then atomically claims the oldest live enrollment for that terminal, or returns null when idle.';

grant execute on function public.fn_hardware_claim_enrollment_job(text, uuid)
  to anon, authenticated;

-- ------------------------------------------------------------------------------
-- Section 2 — fn_hardware_create_enrollment_job: RETAIN the member's slot
-- ------------------------------------------------------------------------------
-- 0017 always called fn_hardware_next_fingerprint_slot, which returns the lowest
-- FREE slot — so a member who already held slot 1 was bumped to slot 4 on every
-- re-enroll. The desk's own UI tells the operator "currently assigned: Slot #1,
-- re-enrolling will replace this template"; quietly moving the member to a
-- different number contradicts that sentence, walks the gym up the slot list,
-- and — with delete_slot then naming a slot that never changed — asked the
-- sensor to erase the very template it was about to overwrite.
--
-- The rule now: if the member has a LIVE template row on THIS terminal, that
-- slot is reused. A first enrollment still takes the lowest free slot under the
-- advisory lock, exactly as before.
--
-- SAFETY: the retained slot is only used when no OTHER member's live template
-- and no live reservation holds it on this terminal. If either does — legacy
-- data where two members shared a biometric_id — we fall back to the allocator
-- rather than dead-looping on 45013. delete_slot is null on a retained slot
-- (0017's `v_old_slot <> v_slot` case): the write itself replaces the member's
-- own template, so there is nothing extra to erase.
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

  -- The member's PREVIOUS binding, read BEFORE any slot is chosen because it is
  -- now the first-choice slot. The terminal-aware row is the authority; the
  -- legacy biometric_id only stands in when no template row exists (a member
  -- linked before 0017 whose backfill missed).
  v_old_slot := v_member.biometric_id;

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

  -- RETAIN, but only if the slot is genuinely this member's to reuse.
  if v_old_slot is not null
     and v_old_slot >= 1
     and not exists (
       select 1 from public.fingerprint_templates t
        where t.device_id = p_device_id
          and t.fingerprint_slot = v_old_slot
          and t.member_id <> p_member_id
          and t.superseded_by is null
          and t.erased_at is null
     )
     and not exists (
       select 1 from public.fingerprint_enrollments e
        where e.device_id = p_device_id
          and e.fingerprint_slot = v_old_slot
          and e.status in ('pending', 'claimed')
     ) then
    v_slot := v_old_slot;
  else
    -- First enrollment, or the legacy slot is contested: lowest free slot on
    -- THIS terminal. The advisory lock inside makes the read-insert atomic.
    v_slot := public.fn_hardware_next_fingerprint_slot(v_member.tenant_id, p_device_id);
  end if;

  v_token := 'fpenr_' || encode(gen_random_bytes(12), 'hex');
  insert into public.fingerprint_enrollments (
    tenant_id, member_id, device_id, fingerprint_slot, job_token,
    kind, previous_slot, expires_at
  )
  values (
    v_member.tenant_id, p_member_id, p_device_id, v_slot, v_token,
    'enroll',
    -- Same-slot retention deliberately records previous_slot = v_slot; section 3
    -- treats equality as "this IS the live row" rather than a supersede, and the
    -- delete_slot expression below only emits a DIFFERENT previous slot.
    case when v_old_slot >= 1 then v_old_slot else null end,
    now() + interval '10 minutes'
  )
  returning * into v_job;

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
    'retained_slot', v_slot = v_old_slot,
    'expires_at',    v_job.expires_at
  );
exception
  when unique_violation then
    -- The partial unique index refused the reservation — the retained slot was
    -- taken between the read above and this insert. The message tells the desk
    -- to try again, which re-runs the retention check against fresh data.
    raise exception 'That slot was just taken by another enrollment. Please try again.'
      using errcode = '45013';
end;
$$;

comment on function public.fn_hardware_create_enrollment_job(uuid, uuid, boolean) is
  'Queues one R307 enrollment for a member on a terminal. Reuses the slot the member already holds on that terminal when it is safely theirs; otherwise reserves the lowest free slot under the advisory lock.';

-- ------------------------------------------------------------------------------
-- Section 3 — fn_hardware_report_enrollment: recognise the RETAINED slot
-- ------------------------------------------------------------------------------
-- Section 2 hands a re-enrolled member their OWN slot back, which means the
-- success report below would insert a fingerprint_templates row that collides
-- with the member's own live row on fingerprint_templates_live_slot_key
-- (device_id + fingerprint_slot). Without this section that 23505 would be
-- caught by the generic conflict handler and the capture would be marked
-- failed with "That fingerprint slot is now used by another member" — true
-- only in the most technical sense, and wrong in every way that matters to
-- the desk: the capture just SUCCEEDED and the finger works.
--
-- So the success path now asks, before inserting: does a live row already sit
-- on this exact slot? Three answers:
--   - it belongs to ANOTHER member -> genuine conflict, refuse (unchanged).
--   - it belongs to THIS member    -> retained slot: refresh it in place, do
--     NOT supersede (the existing previous_slot <> fingerprint_slot guard
--     already refuses to), and skip the delete_slot erase.
--   - there is no row              -> insert, exactly as 0017 did.
--
-- Everything else — progress, unlink, failure/cancel, idempotent replay — is
-- byte-for-byte 0017 behaviour, restated only because CREATE OR REPLACE
-- rewrites the whole body.
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
  v_template public.fingerprint_templates%rowtype;
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
  -- ---- SUCCESS (enroll): bind the slot. -------------------------------------
  if v_status = 'succeeded' then
    select * into v_member from public.members m where m.id = v_job.member_id;
    if v_member.id is null then
      raise exception 'Member not found' using errcode = 'P0002';
    end if;

    -- PHASE 18: does a live row already sit on this exact slot? With section 2's
    -- retention the answer can be YES and the row can be THIS member's own —
    -- which is not a conflict at all, it is the row the capture just refreshed.
    select * into v_template
      from public.fingerprint_templates t
     where t.device_id = v_job.device_id
       and t.fingerprint_slot = v_job.fingerprint_slot
       and t.superseded_by is null
       and t.erased_at is null
     limit 1;

    if v_template.id is not null and v_template.member_id = v_job.member_id then
      -- RETAINED SLOT: the member's own live row. Refresh it in place rather
      -- than inserting a twin that fingerprint_templates_live_slot_key would
      -- reject. No supersede — it IS the live row — and no history churn.
      update public.fingerprint_templates
         set updated_at = now()
       where id = v_template.id
      returning * into v_template;

    else
      -- No live row on this slot (first enrollment, or a slot the member is
      -- moving ONTO): insert it. 23505 here means ANOTHER member holds the slot
      -- between reservation and report — a real conflict, not a transient one.
      -- Refuse rather than overwrite another member's credential, and do NOT
      -- touch members.biometric_id on the way out.
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
    end if;

    -- Supersede the binding this job replaces. Same slot (a retention re-enroll
    -- that re-picked the member's own number) is not a supersede — it IS the row.
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
    -- per-gym index refusing a number another member already holds. On a
    -- retained slot the UPDATE writes the value it already had, so it is a no-op
    -- that cannot trip the index.
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
      -- The device must erase a DIFFERENT slot it still holds. On a retained
      -- slot the write already replaced the member's own template, so there is
      -- deliberately nothing to erase and delete_slot is null.
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
  'Device-reported outcome for an enrollment job. Only a success writes members.biometric_id; progress updates the live stage; replay of a finished job is idempotent; a retained-slot re-enroll refreshes the member''s own live template row instead of colliding with it.';

-- Grants survive CREATE OR REPLACE (function identity is unchanged), but state
-- them so this file is self-contained and re-runnable from an empty database.
grant execute on function public.fn_hardware_create_enrollment_job(uuid, uuid, boolean)
  to anon, authenticated;
grant execute on function public.fn_hardware_report_enrollment(text, text, text, text, text, text)
  to anon, authenticated;

commit;