-- =============================================================================
-- Phase 10 — Vyroniq identity: auto hardware credentials & avatar plumbing
-- =============================================================================
-- Phase 9 gave the gym its retention engine. This phase closes the two loops a
-- member actually notices on day one, and fixes the one promise the product
-- used to break:
--
--   1. members.avatar_url           -> the photo the member uploads themselves
--      (mirrors public.profiles.avatar_url, which 0007 introduced for staff).
--   2. members.rfid_uid             -> the SYSTEM key printed on the card.
--   3. members.biometric_slot_id    -> the terminal slot the finger is bound to.
--
-- The load-bearing rule of this migration: neither credential is ever typed.
-- A BEFORE INSERT/UPDATE trigger derives them from the row the front desk
-- already fills in (rfid_card / biometric_id), so a member can only ever hold
-- a credential that some piece of hardware actually issued. No API, form field
-- or client write sets them to an arbitrary value.
--
--   4. fn_member_hardware_identity() -> the read side. It returns the RFID key
--      MASKED (never in full over the wire) plus a display-ready slot label.
--   5. fn_member_set_avatar()        -> one write for the photo, so
--      profiles.avatar_url and members.avatar_url can never disagree.
--   6. fn_hardware_punch(... p_rfid_uid) -> an ADDITIVE overload so the gate
--      accepts the system RFID key alongside the raw card serial. The
--      three-argument original is left exactly as it is and still owns the
--      membership decision, so the two doors cannot answer differently.
--
-- Everything is idempotent: safe to re-run from the SQL editor.
--
-- Run order: after 0009_phase9_gamification_retention.sql.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. The avatars bucket now has to hold a phone-camera sized photo
-- -----------------------------------------------------------------------------
-- 0007 shipped it at 2 MB. The member uploader accepts up to 5 MB, and a
-- storage-level limit below the app-level one fails at upload time with an
-- opaque "row too big" the client cannot explain, so the two are aligned here.
update storage.buckets
   set file_size_limit = 5242880
 where id = 'avatars';

comment on column storage.buckets.file_size_limit is
  'Product photos up to 5MB, avatars up to 5MB — the client mirrors these limits.';

-- -----------------------------------------------------------------------------
-- 1. The three member columns
-- -----------------------------------------------------------------------------
alter table if exists public.members
  add column if not exists avatar_url          text,
  add column if not exists rfid_uid            text,
  add column if not exists biometric_slot_id   text;

comment on column public.members.avatar_url is
  'Public Storage URL of the member photo. Mirrored from public.profiles.avatar_url by fn_member_set_avatar().';
comment on column public.members.rfid_uid is
  'SYSTEM-ASSIGNED RFID key printed on the card (VYR-XXXXXXXX). Minted by fn_members_auto_identity() from rfid_card — never typed, never client-supplied.';
comment on column public.members.biometric_slot_id is
  'SYSTEM-ASSIGNED terminal slot the fingerprint is bound to (SLOT-042). Minted by fn_members_auto_identity() from biometric_id.';

-- Partial unique index rather than a table constraint: NULL means "no card
-- issued yet", and a plain UNIQUE would allow only one such member per install.
create unique index if not exists members_rfid_uid_unique
  on public.members (upper(trim(rfid_uid)))
  where rfid_uid is not null and trim(rfid_uid) <> '';

create unique index if not exists members_biometric_slot_unique
  on public.members (upper(trim(biometric_slot_id)))
  where biometric_slot_id is not null and trim(biometric_slot_id) <> '';

-- -----------------------------------------------------------------------------
-- 2. The auto-identity trigger — the reason nobody ever types a slot number
-- -----------------------------------------------------------------------------
-- Runs BEFORE INSERT and BEFORE UPDATE, so a card enrolled at the desk later
-- is picked up too. Two rules, both derived (never invented):
--
--   rfid_card set     -> rfid_uid          = VYR- + 8 hex
--   biometric_id set  -> biometric_slot_id = SLOT- + zero-padded slot
--
-- A value that is already present is never overwritten, so a gym that reissues
-- a card keeps the key printed on the physical card. The derived key is seeded
-- from the card serial itself, which makes it stable: re-running this migration
-- cannot orphan a card that is already in a member's wallet.
create or replace function public.fn_members_auto_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card text := nullif(trim(coalesce(new.rfid_card, '')), '');
  v_bio  integer;
begin
  if v_card is not null then
    if new.rfid_uid is null or trim(new.rfid_uid) = '' then
      -- Deterministic per card serial, so the same card always mints the same
      -- key; the tenant salt keeps two gyms' identical serials from colliding.
      new.rfid_uid := 'VYR-' || upper(substr(
        md5(v_card || ':' || coalesce(new.tenant_id::text, 'none')), 1, 8));
    end if;
  else
    -- The card was removed at the desk: the key goes with it, otherwise the
    -- member keeps a credential the gate can no longer resolve.
    new.rfid_uid := null;
  end if;

  v_bio := new.biometric_id;
  if v_bio is not null and (new.biometric_slot_id is null or trim(new.biometric_slot_id) = '') then
    new.biometric_slot_id := 'SLOT-' || lpad(v_bio::text, 3, '0');
  end if;

  return new;
end;
$$;

comment on function public.fn_members_auto_identity() is
  'BEFORE INSERT/UPDATE: derives rfid_uid from rfid_card and biometric_slot_id from biometric_id. Never overwrites an existing credential.';

drop trigger if exists trg_members_auto_identity on public.members;
create trigger trg_members_auto_identity
  before insert or update of rfid_card, biometric_id, rfid_uid, biometric_slot_id
  on public.members
  for each row execute function public.fn_members_auto_identity();

-- Backfill: an install that already enrolled members with a card or fingerprint
-- gets their credentials minted by the same rule the trigger would have used.
update public.members
   set rfid_uid = 'VYR-' || upper(substr(
         md5(trim(rfid_card) || ':' || coalesce(tenant_id::text, 'none')), 1, 8))
 where rfid_card is not null
   and trim(rfid_card) <> ''
   and (rfid_uid is null or trim(rfid_uid) = '');

update public.members
   set biometric_slot_id = 'SLOT-' || lpad(biometric_id::text, 3, '0')
 where biometric_id is not null
   and (biometric_slot_id is null or trim(biometric_slot_id) = '');

-- -----------------------------------------------------------------------------
-- 3. Read side: fn_member_hardware_identity
-- -----------------------------------------------------------------------------
-- The member app renders this in the "Hardware Identity" card. The full RFID
-- key never leaves the database: the app only needs the last four characters to
-- recognise the member's own card, and a credential readable off a screenshot
-- is not a credential. The slot label is cosmetic (#042).
create or replace function public.fn_member_hardware_identity(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rfid text;
  v_slot text;
  v_bio  integer;
begin
  select nullif(trim(m.rfid_uid), ''), nullif(trim(m.biometric_slot_id), ''), m.biometric_id
    into v_rfid, v_slot, v_bio
    from public.members m
   where m.id = p_member_id;

  -- No credential at all reads as "ask the desk", not as an error.
  if v_rfid is null and v_slot is null then
    return null;
  end if;

  return jsonb_build_object(
    'rfid_masked', case when v_rfid is null then null
                        else '•••• ' || upper(right(v_rfid, 4)) end,
    'rfid_tail',   case when v_rfid is null then null
                        else upper(right(v_rfid, 4)) end,
    'rfid_linked', v_rfid is not null,
    'slot_id',     v_slot,
    'slot_label',  case when v_slot is null then null
                        else '#' || lpad(regexp_replace(v_slot, '\D', '', 'g'), 3, '0') end,
    'biometric_linked', v_bio is not null
  );
end;
$$;

comment on function public.fn_member_hardware_identity(uuid) is
  'Read-only hardware identity for the member app: masked RFID key + terminal slot label. NULL when no credential is issued.';

-- -----------------------------------------------------------------------------
-- 4. Write side: fn_member_set_avatar
-- -----------------------------------------------------------------------------
-- One call, both columns. Two independent client updates could half-apply (photo
-- on the profile, initials in the roster) which is exactly the "I uploaded it
-- and nothing happened" bug. The function also refuses anything that is not an
-- https Storage URL, so a javascript: URI can never reach an <img src> later.
create or replace function public.fn_member_set_avatar(
  p_member_id  uuid,
  p_avatar_url text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url    text := nullif(trim(coalesce(p_avatar_url, '')), '');
  v_tenant uuid;
begin
  if p_member_id is null then
    raise exception 'member id is required' using errcode = '22023';
  end if;

  if v_url is not null and (v_url !~ '^https://' or length(v_url) > 1000) then
    raise exception 'That image link does not look right.' using errcode = '22023';
  end if;

  select m.tenant_id into v_tenant from public.members m where m.id = p_member_id;
  if v_tenant is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  update public.members
     set avatar_url = v_url
   where id = p_member_id;

  insert into public.profiles (user_id, tenant_id, avatar_url, updated_at)
  values (p_member_id, v_tenant, v_url, now())
  on conflict (user_id) do update
     set avatar_url = excluded.avatar_url,
         tenant_id  = coalesce(public.profiles.tenant_id, excluded.tenant_id),
         updated_at = now();

  return true;
end;
$$;

comment on function public.fn_member_set_avatar(uuid, text) is
  'Sets or clears (null) one member photo across members.avatar_url and profiles.avatar_url in a single statement.';

grant execute on function
  public.fn_member_hardware_identity(uuid),
  public.fn_member_set_avatar(uuid, text)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. The gate accepts the system RFID key (additive overload)
-- -----------------------------------------------------------------------------
-- An RC522 reader reports the card's raw serial, but a member's phone shows
-- their VYR- key. This overload resolves the key to the card serial and then
-- hands straight to the ORIGINAL three-argument fn_hardware_punch, which stays
-- the only place the membership decision is made — frozen / expired / granted
-- cannot drift between the two doors.
--
-- NO defaults on the trailing parameters, deliberately: a four-argument
-- signature whose last two were optional would make every existing
-- fn_hardware_punch(key, slot, card) call ambiguous, and Postgres would answer
-- "function is not unique". Without defaults a 3-argument call can only ever
-- match the original, and a 4-argument call can only ever match this one.
create or replace function public.fn_hardware_punch(
  p_api_key      text,
  p_biometric_id integer,
  p_rfid_card    text,
  p_rfid_uid     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key  text := nullif(trim(coalesce(p_rfid_uid, '')), '');
  v_card text;
begin
  if v_key is null then
    return public.fn_hardware_punch(p_api_key, p_biometric_id, p_rfid_card);
  end if;

  -- An unknown key resolves to NULL card, and the original function then
  -- answers with its own speakable DENIED verdict rather than an exception the
  -- device firmware would have to parse.
  select m.rfid_card into v_card
    from public.members m
   where upper(trim(m.rfid_uid)) = upper(v_key)
     and m.rfid_card is not null
     and trim(m.rfid_card) <> ''
   limit 1;

  return public.fn_hardware_punch(p_api_key, p_biometric_id, v_card);
end;
$$;

comment on function public.fn_hardware_punch(text, integer, text, text) is
  'Gate overload accepting the system RFID key (members.rfid_uid); resolves it to the card serial and defers to fn_hardware_punch(text,integer,text).';

grant execute on function public.fn_hardware_punch(text, integer, text, text)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. The Negotiation lane (Phase 10, Module 25)
-- -----------------------------------------------------------------------------
-- lib/crm.ts has carried a 'negotiation' stage since Phase 8, but the Phase 3
-- CHECK constraint was never widened to allow it. Any lead the front desk
-- dragged into that lane was rejected by the database with a 23514 the UI could
-- only render as "Request failed" — the lane looked like it worked and silently
-- lost the write.
--
-- The constraint is dropped and re-added with the full six-stage vocabulary the
-- board renders: new, contacted, trial_booked, negotiation, converted, lost.
-- 'trial_completed' stays in the constraint even though the board folds it, so
-- a row that already carries it is not invalidated by this migration.
do $$
begin
  -- Anything outside the widened set is folded back to 'new' BEFORE the
  -- constraint is replaced, otherwise the ALTER would fail on dirty data.
  update public.leads
     set status = 'new'
   where status is null
      or trim(status) = ''
      or status not in ('new', 'contacted', 'trial_booked', 'trial_completed',
                        'negotiation', 'converted', 'lost');

  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.leads'::regclass and conname = 'leads_status_check'
  ) then
    alter table public.leads drop constraint leads_status_check;
  end if;

  alter table public.leads
    add constraint leads_status_check
    check (status in ('new', 'contacted', 'trial_booked', 'trial_completed',
                      'negotiation', 'converted', 'lost'));
end $$;

comment on column public.leads.status is
  'Pipeline stage: new, contacted, trial_booked, trial_completed, negotiation, converted, lost.';

-- -----------------------------------------------------------------------------
-- 8. Confirmation
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  select (
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'members'
               and column_name = 'rfid_uid')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'members'
                   and column_name = 'biometric_slot_id')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'members'
                   and column_name = 'avatar_url')
    and to_regprocedure('public.fn_member_hardware_identity(uuid)') is not null
    and to_regprocedure('public.fn_member_set_avatar(uuid, text)') is not null
    and to_regprocedure('public.fn_hardware_punch(text, integer, text, text)') is not null
    and exists (
      select 1 from pg_constraint
       where conrelid = 'public.leads'::regclass
         and conname = 'leads_status_check'
         and pg_get_constraintdef(oid) like '%negotiation%'
    )
  ) into v_ok;

  if v_ok then
    raise notice 'Phase 10 ready: members.rfid_uid / biometric_slot_id / avatar_url, auto-identity trigger, hardware identity + avatar RPCs, gate RFID-key overload, leads Negotiation lane.';
  else
    raise exception 'Phase 10 verification failed — check the statements above.';
  end if;
end $$;

commit;
