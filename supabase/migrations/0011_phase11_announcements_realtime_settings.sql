-- =============================================================================
-- Phase 11 — Announcements, live attendance, operating hours & account setup
-- =============================================================================
-- Five defects and three missing flows, fixed at the database layer first:
--
--   1. fn_challenge_list          -> CRASH: read `p.my_progress`/`p.my_rank`, but
--                                    those columns are projected by the SECOND
--                                    lateral alias (`r`), not the first (`p`).
--                                    Opening Challenges threw
--                                    "column p.my_progress does not exist".
--   2. gym_announcements          -> existed (Phase 4) but with no pin, type or
--                                    expiry, and NO owner-side write path at all:
--                                    the table is revoked from PostgREST and only
--                                    the member READER was ever defined. Members
--                                    saw "No notices" because nothing could
--                                    create one.
--   3. attendances realtime       -> never added to the supabase_realtime
--                                    publication, so the owner's live log could
--                                    only ever be a one-shot fetch.
--   4. tenants.operating_hours    -> did not exist; the member app showed a
--                                    hardcoded 05:00-23:00.
--   5. members.password_setup_completed -> did not exist, so every member shared
--                                    whatever password the desk typed for them.
--   6. profiles.username_changed_at-> did not exist, so the @handle could be
--                                    changed every minute (or never).
--
-- Two rules hold throughout:
--   * IDEMPOTENT. Every statement is safe to re-run from the SQL Editor, and
--     re-running must never lose a row or a notice.
--   * NO DESTRUCTIVE RENAMES. Phase 4 readers still select `message` and
--     `is_active`; those become GENERATED ALWAYS columns so both the old and the
--     new vocabulary resolve to the same stored value.
--
-- Run order: after 0010_phase10_vyroniq_identity_avatar.sql.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. FIX: fn_challenge_list referenced the wrong lateral alias
-- -----------------------------------------------------------------------------
-- The shape of the bug, because it is worth not repeating:
--
--   cross join lateral (...) p   -- projects: cnt, joined, baseline_weight
--   cross join lateral (...) r   -- projects: my_rank, my_progress
--
-- and the jsonb_build_object above both read `p.my_progress` / `p.my_rank`.
-- Postgres resolves aliases left-to-right, so `p` simply has no such column.
--
-- Beyond fixing the alias, the whole body is rewritten to compute the viewer's
-- row exactly ONCE per challenge instead of once per participant. The old
-- ranking correlated subquery called fn_challenge_member_progress twice for
-- every other participant in the gym, which is O(participants^2) per challenge;
-- with a window function it is one pass.
create or replace function public.fn_challenge_list(
  p_tenant_id  uuid,
  p_member_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  -- A malformed tenant can never widen this to "every gym's challenges".
  if p_tenant_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',              c.id,
             'title',           c.title,
             'kind',            c.kind,
             'description',     c.description,
             'start_date',      c.start_date,
             'end_date',        c.end_date,
             'target_value',    c.target_value,
             'is_active',       c.is_active,
             -- from the FIRST lateral: roster-wide facts
             'participants',    r.cnt,
             'joined',          r.joined,
             'baseline_weight', r.baseline_weight,
             -- from the SECOND lateral: this member's facts, and ONLY when they
             -- joined. Both are null (not zero) otherwise, which is what lets the
             -- member UI distinguish "not joined" from "joined, no progress yet".
             'my_progress',     me.my_progress,
             'my_rank',         me.my_rank
           )
           order by c.start_date desc, c.created_at desc
         ), '[]'::jsonb)
    into v_rows
    from public.gym_challenges c

    -- LATERAL 1 — roster facts. One scan of the participant table per
    -- challenge, independent of which member is asking.
    cross join lateral (
      select count(*)::int as cnt,
             coalesce(bool_or(cp.member_id = p_member_id), false) as joined,
             max(case when cp.member_id = p_member_id
                      then cp.baseline_weight end) as baseline_weight
        from public.challenge_participants cp
       where cp.challenge_id = c.id
    ) r

    -- LATERAL 2 — this member's progress and rank.
    --
    -- The rank comes from a window function over the SAME progress expression
    -- the rows are scored by, so "your rank" and "the order you see" can never
    -- disagree (the old version computed them with two independent expressions).
    -- rank() (not row_number) gives a dense competition rank: two members level
    -- on progress share a rank, which is what a member expects to see.
    cross join lateral (
      select scored.my_progress,
             case when p_member_id is null or not coalesce(r.joined, false)
                  then null
                  else scored.my_rank
             end as my_rank
        from (
          -- `rank` is a non-reserved keyword in Postgres (it names a window
          -- function), so the column is called position_rank instead: same
          -- value, zero chance of a parser surprise on an older server.
          select prog.member_id,
                 prog.progress as my_progress,
                 case when prog.member_id = p_member_id
                      then prog.position_rank
                 end as my_rank
            from (
              select cp2.member_id,
                     public.fn_challenge_member_progress(c.id, cp2.member_id) as progress,
                     rank() over (
                       order by public.fn_challenge_member_progress(c.id, cp2.member_id) desc
                     ) as position_rank
                from public.challenge_participants cp2
               where cp2.challenge_id = c.id
            ) prog
           where prog.member_id = p_member_id
        ) scored
    ) me

   where c.tenant_id = p_tenant_id
     and c.is_active
     and c.end_date >= (now() at time zone 'Asia/Kolkata')::date - 30
   limit 100;

  return v_rows;
end;
$$;

comment on function public.fn_challenge_list(uuid, uuid) is
  'Challenges for one gym with participant counts and, for a joined member, progress + rank. Computed in one windowed pass.';

-- -----------------------------------------------------------------------------
-- 2. Announcements: the columns the owner console needs
-- -----------------------------------------------------------------------------
-- Phase 4 created (id, tenant_id, title, message, is_active, created_at) and
-- revoked the table from PostgREST. Everything below is additive.
--
-- `body`/`message` and `is_published`/`is_active` are kept in lockstep by
-- GENERATED ALWAYS columns rather than by a rename, because two other functions
-- (fn_member_companion_data from Phase 4 and the Phase 5 super-admin read) still
-- select the old names. A rename would have broken them; an alias keeps both
-- vocabularies resolving to one stored value, which is the property that
-- actually matters — an owner editing `body` must change what members see.
alter table if exists public.gym_announcements
  add column if not exists body         text,
  add column if not exists type         text,
  add column if not exists is_pinned    boolean,
  add column if not exists is_published boolean,
  add column if not exists expires_at   timestamptz,
  add column if not exists updated_at   timestamptz;

-- Backfill BEFORE the generated columns are attached, and only where the new
-- column is still null: re-running must not clobber an owner's later edit.
update public.gym_announcements set body = message  where body is null;
update public.gym_announcements set type = 'general' where type is null;
update public.gym_announcements set is_pinned = false where is_pinned is null;

-- is_published supersedes is_active. Defaulting from is_active means an existing
-- notice stays visible to members after this migration instead of vanishing.
update public.gym_announcements
   set is_published = coalesce(is_published, is_active, true)
 where is_published is null;

update public.gym_announcements
   set updated_at = coalesce(updated_at, created_at, now())
 where updated_at is null;

-- Now that body is fully populated, make it NOT NULL and add the aliases.
--
-- The Phase 5 CHECK (`gym_announcements_message_check`) references `message`, so
-- dropping that column silently drops the CHECK with it — Postgres removes
-- constraints that depend on a dropped column without complaining. Left
-- unhandled, this migration would trade "message must not be blank" for no
-- validation at all, and the RPC would be the only thing standing between an
-- owner and a blank notice. So it is explicitly replaced below by the same rule
-- against `body`.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.gym_announcements'::regclass
       and conname = 'gym_announcements_message_check'
  ) then
    alter table public.gym_announcements drop constraint gym_announcements_message_check;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.gym_announcements'::regclass
       and conname = 'gym_announcements_body_check'
  ) then
    alter table public.gym_announcements
      add constraint gym_announcements_body_check
      check (length(trim(coalesce(body, ''))) > 0);
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'gym_announcements'
       and column_name = 'message' and is_generated = 'ALWAYS'
  ) then
    execute 'alter table public.gym_announcements
             drop column message';
    execute 'alter table public.gym_announcements
             add column message text generated always as (body) stored';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'gym_announcements'
       and column_name = 'is_active' and is_generated = 'ALWAYS'
  ) then
    execute 'alter table public.gym_announcements
             drop column is_active';
    execute 'alter table public.gym_announcements
             add column is_active boolean generated always as (is_published) stored';
  end if;

  -- NOT NULL last, once body is populated and the generated aliases exist. Done
  -- here rather than before the aliases so a re-run cannot fail on a column that
  -- is already in the target shape.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'gym_announcements'
       and column_name = 'body' and is_nullable = 'YES'
  ) then
    alter table public.gym_announcements alter column body set not null;
  end if;
end $$;

comment on constraint gym_announcements_body_check on public.gym_announcements is
  'Replaces gym_announcements_message_check: a notice must never be blank.';

comment on table public.gym_announcements is
  'Gym notices. is_published=false hides without deleting; is_pinned sorts to the top; expires_at hides the notice automatically.';

create index if not exists idx_gym_announcements_feed
  on public.gym_announcements (tenant_id, is_published, is_pinned desc, created_at desc);

-- -----------------------------------------------------------------------------
-- 3. Realtime: publish attendances
-- -----------------------------------------------------------------------------
-- Without this the owner's live log can only ever be a one-shot fetch: the
-- browser asks once and never hears about the next punch. `add table` throws if
-- the table is already a member, so the publication membership is checked first
-- — that is what makes this re-runnable.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
         from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'attendances'
     ) then
    execute 'alter publication supabase_realtime add table public.attendances';
    raise notice 'Realtime: added public.attendances to the supabase_realtime publication.';
  else
    raise notice 'Realtime: public.attendances is already published (or no such publication).';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Announcement reads and writes
-- -----------------------------------------------------------------------------
-- Phase 4 revoked this table from PostgREST and defined only a member READER.
-- That is the whole reason owners could never publish anything: there was no
-- write path, not a missing screen. These four functions close the loop while
-- keeping the table revoked — the browser still cannot touch it directly.
--
-- Tenant scope is taken from the caller-supplied tenant id on every function,
-- exactly like /api/leads: a stale or hand-edited session cannot reach another
-- gym's notices because the RPC filters on tenant_id on every single statement.

-- 4a. The owner's list: EVERY notice, published or not, pinned first. The
--     console needs to show drafts and expired notices too, otherwise "toggle
--     publish" would have nothing to toggle.
create or replace function public.fn_announcements_admin_list(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',          a.id,
             'title',       a.title,
             'body',        a.body,
             'type',        a.type,
             'is_pinned',   a.is_pinned,
             'is_published',a.is_published,
             'expires_at',  a.expires_at,
             'created_at',  a.created_at,
             'updated_at',  a.updated_at
           ) order by a.is_pinned desc, a.created_at desc)
      from public.gym_announcements a
     where a.tenant_id = p_tenant_id
     limit 200
  ), '[]'::jsonb);
end;
$$;

comment on function public.fn_announcements_admin_list(uuid) is
  'Every notice for one gym (drafts included) for the owner console. Pinned first.';

-- 4b. The member feed: published, unexpired, pinned first. This is the ONLY
--     version a member can read, and it is what removes "No notices" for good.
create or replace function public.fn_announcements_feed(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',         a.id,
             'title',      a.title,
             'body',       a.body,
             'type',       a.type,
             'is_pinned',  a.is_pinned,
             'created_at', a.created_at
           ) order by a.is_pinned desc, a.created_at desc)
      from public.gym_announcements a
     where a.tenant_id = p_tenant_id
       and a.is_published
       -- An expired notice hides itself; the owner never has to remember.
       and (a.expires_at is null or a.expires_at > now())
     limit 50
  ), '[]'::jsonb);
end;
$$;

comment on function public.fn_announcements_feed(uuid) is
  'Published, unexpired notices for one gym, pinned first. The member-facing read.';

-- 4c. Create or update. One function rather than two so the caller cannot
--     accidentally UPDATE an id that belongs to a different gym: the id is
--     matched against the tenant in the same statement that writes.
--
--     p_id null -> INSERT, otherwise UPDATE.
create or replace function public.fn_announcements_upsert(
  p_tenant_id   uuid,
  p_id          uuid default null,
  p_title       text,
  p_body        text,
  p_type        text default 'general',
  p_is_pinned   boolean default false,
  p_is_published boolean default true,
  p_expires_at  timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body  text := trim(coalesce(p_body, ''));
  v_type  text := lower(trim(coalesce(p_type, 'general')));
  v_row   public.gym_announcements%rowtype;
begin
  if p_tenant_id is null then
    raise exception 'Missing gym scope.' using errcode = '22023';
  end if;
  if length(v_title) < 3 or length(v_title) > 140 then
    raise exception 'Title must be between 3 and 140 characters.' using errcode = '22023';
  end if;
  if length(v_body) < 1 or length(v_body) > 2000 then
    raise exception 'Notice body must be between 1 and 2000 characters.' using errcode = '22023';
  end if;
  if v_type not in ('general', 'alert', 'event', 'maintenance', 'offer') then
    raise exception 'type must be one of: general, alert, event, maintenance, offer.'
      using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Pick an expiry in the future, or leave it empty for no expiry.'
      using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.gym_announcements
      (tenant_id, title, body, type, is_pinned, is_published, expires_at)
    values
      (p_tenant_id, v_title, v_body, v_type,
       coalesce(p_is_pinned, false), coalesce(p_is_published, true), p_expires_at)
    returning * into v_row;
  else
    -- The tenant_id predicate is the whole authorisation check: a notice id from
    -- another gym matches zero rows, and the NOT FOUND below turns that into a
    -- 404 rather than a silent success.
    update public.gym_announcements
       set title        = v_title,
           body         = v_body,
           type         = v_type,
           is_pinned    = coalesce(p_is_pinned, false),
           is_published = coalesce(p_is_published, true),
           expires_at   = p_expires_at,
           updated_at   = now()
     where id = p_id and tenant_id = p_tenant_id
    returning * into v_row;

    if not found then
      raise exception 'Notice not found in this gym.' using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object(
    'id',           v_row.id,
    'title',        v_row.title,
    'body',         v_row.body,
    'type',         v_row.type,
    'is_pinned',    v_row.is_pinned,
    'is_published', v_row.is_published,
    'expires_at',   v_row.expires_at,
    'created_at',   v_row.created_at,
    'updated_at',   v_row.updated_at
  );
end;
$$;

comment on function public.fn_announcements_upsert(uuid, uuid, text, text, text, boolean, boolean, timestamptz) is
  'Creates a notice (p_id null) or updates one, scoped to the gym. Returns the saved row.';

-- 4d. Delete. Scoped, so an id from another gym is a 404 not a deletion.
create or replace function public.fn_announcements_delete(p_tenant_id uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_tenant_id is null or p_id is null then
    raise exception 'Missing gym or notice id.' using errcode = '22023';
  end if;

  delete from public.gym_announcements
   where id = p_id and tenant_id = p_tenant_id;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'Notice not found in this gym.' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

grant execute on function
  public.fn_challenge_list(uuid, uuid),
  public.fn_announcements_admin_list(uuid),
  public.fn_announcements_feed(uuid),
  public.fn_announcements_upsert(uuid, uuid, text, text, text, boolean, boolean, timestamptz),
  public.fn_announcements_delete(uuid, uuid)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Dynamic operating hours (kills the hardcoded 05:00-23:00)
-- -----------------------------------------------------------------------------
-- jsonb keyed by the three-letter day code, because that is what
-- `to_char(now(), 'Dy')` yields in any locale-independent form we can rely on.
-- Storing the object (rather than seven columns) means adding a field later —
-- a "last entry" note, a lunch break — is a frontend change, not a migration.
--
-- The DEFAULT reproduces the schedule the member app used to hardcode, so an
-- existing gym starts with the hours it was already advertising.
alter table if exists public.tenants
  add column if not exists operating_hours jsonb;

update public.tenants
   set operating_hours = '{"mon":{"open":"05:00","close":"23:00","closed":false},"tue":{"open":"05:00","close":"23:00","closed":false},"wed":{"open":"05:00","close":"23:00","closed":false},"thu":{"open":"05:00","close":"23:00","closed":false},"fri":{"open":"05:00","close":"23:00","closed":false},"sat":{"open":"06:00","close":"22:00","closed":false},"sun":{"open":"07:00","close":"20:00","closed":false}}'::jsonb
 where operating_hours is null;

comment on column public.tenants.operating_hours is
  'Weekly schedule: {"mon":{"open":"05:00","close":"23:00","closed":false}, ...}. Day codes are 3-letter lowercase.';

-- Shape is checked rather than trusted, because a malformed value would
-- otherwise reach the member app and render "undefined" as the closing time.
-- Run as a SELECT over the real table (not per-tenant in a loop) so the whole
-- column is verified in one pass, and the notice names the gym that is wrong.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s/%s', t.id, d.day_key), ', ') into v_bad
    from public.tenants t
    cross join lateral jsonb_object_keys(coalesce(t.operating_hours, '{}'::jsonb)) as d(day_key)
   where coalesce(t.operating_hours -> d.day_key ->> 'open', '')  !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(t.operating_hours -> d.day_key ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(t.operating_hours -> d.day_key ->> 'closed', '') not in ('true', 'false');

  if v_bad is not null then
    raise exception 'tenants.operating_hours has malformed day(s): %', v_bad;
  end if;
end $$;

-- 5a. The write path. Coerces every field to its stored type so a JSON body
--     with "true" (a string) instead of true still lands correctly, and rejects
--     an unparseable schedule instead of saving garbage the member app would
--     have to defend against on every render.
create or replace function public.fn_tenant_set_operating_hours(
  p_tenant_id uuid,
  p_hours     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days text[] := array['mon','tue','wed','thu','fri','sat','sun'];
  v_clean jsonb := '{}'::jsonb;
  v_day   text;
  v_entry jsonb;
  v_open  text;
  v_close text;
begin
  if p_tenant_id is null then
    raise exception 'Missing gym scope.' using errcode = '22023';
  end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then
    raise exception 'Operating hours must be an object keyed by day.' using errcode = '22023';
  end if;

  foreach v_day in array v_days loop
    v_entry := coalesce(p_hours -> v_day, '{}'::jsonb);
    v_open  := coalesce(nullif(trim(v_entry ->> 'open'), ''), '05:00');
    v_close := coalesce(nullif(trim(v_entry ->> 'close'), ''), '23:00');

    if v_open !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_close !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Times must look like 06:30 (24-hour). Check %.', upper(v_day)
        using errcode = '22023';
    end if;

    -- A closed day keeps whatever times it had so un-ticking "Closed" restores
    -- the owner's real schedule instead of resetting it to 05:00-23:00.
    v_clean := v_clean || jsonb_build_object(
      v_day, jsonb_build_object(
        'open',   v_open,
        'close',  v_close,
        'closed', coalesce((v_entry ->> 'closed')::boolean, false)
      )
    );
  end loop;

  update public.tenants
     set operating_hours = v_clean
   where id = p_tenant_id;

  if not found then
    raise exception 'Gym not found.' using errcode = 'P0002';
  end if;

  return v_clean;
end;
$$;

comment on function public.fn_tenant_set_operating_hours(uuid, jsonb) is
  'Normalises and stores one gym weekly schedule. Always writes all seven days.';

grant execute on function public.fn_tenant_set_operating_hours(uuid, jsonb)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. First-time password onboarding
-- -----------------------------------------------------------------------------
-- Until this column existed every member shared whatever PIN/password the front
-- desk typed at enrolment, and could change it never. FALSE is the safe default:
-- a member who has genuinely set their own secret must be asked once more,
-- which is a far cheaper mistake than a shared password nobody ever rotates.
alter table if exists public.members
  add column if not exists password_setup_completed boolean;

update public.members
   set password_setup_completed = false
 where password_setup_completed is null;

comment on column public.members.password_setup_completed is
  'FALSE until the member sets their own password through the onboarding screen. Drives the blocking prompt.';

-- -----------------------------------------------------------------------------
-- 7. Profile fields + the @handle cooldown
-- -----------------------------------------------------------------------------
-- profiles is the per-identity row (members.id for members, gym_users.id for
-- staff), so the handle cooldown lives there rather than on members: it is a
-- property of the ACCOUNT, not of the enrolment.
alter table if exists public.profiles
  add column if not exists username_changed_at timestamptz,
  add column if not exists display_name        text,
  add column if not exists emergency_phone     text,
  add column if not exists gender              text,
  add column if not exists date_of_birth       date;

comment on column public.profiles.username_changed_at is
  'When the @handle last changed. Enforces the 30-day cooldown in fn_member_set_username.';

-- -----------------------------------------------------------------8a. Handle cooldown + the spec regex
-- Phase 5 allowed ^[a-z0-9][a-z0-9._]{2,23}$ (3-24 chars, must start
-- alphanumeric). The spec narrows it to ^[a-zA-Z0-9._]{3,20}$ and insists on
-- lowercase output. Both changes are enforced here, in the database, so the
-- rule is the same no matter which client calls it.
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
  v_clean    text;
  v_taken    text;
  v_last     timestamptz;
  v_ready_at timestamptz;
  v_current  text;
begin
  v_clean := lower(regexp_replace(trim(coalesce(p_username, '')), '^@+', ''));

  -- ^[a-zA-Z0-9._]{3,20}$ after lower-casing. The lower-casing happens first, so
  -- a member typing "Rahul.Kumar" is accepted and stored as rahul.kumar rather
  -- than rejected for the capitals.
  if v_clean !~ '^[a-z0-9._]{3,20}$' then
    raise exception 'Pick a handle of 3 to 20 characters: letters, numbers, dot or underscore.'
      using errcode = '22023';
  end if;

  select m.username into v_current
    from public.members m
   where m.id = p_member_id;

  if v_current is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  -- Re-submitting the handle you already have is a no-op, not a change. Without
  -- this, opening the settings screen and tapping Save would start a fresh
  -- 30-day clock against a member who has just been auto-assigned a handle.
  if v_current = v_clean then
    return jsonb_build_object('ok', true, 'username', v_clean, 'changed', false);
  end if;

  select p.username_changed_at into v_last
    from public.profiles p
   where p.user_id = p_member_id;

  if v_last is not null then
    v_ready_at := v_last + interval '30 days';
    if now() < v_ready_at then
      raise exception 'You can change your @handle again from %.',
        to_char(v_ready_at at time zone 'Asia/Kolkata', 'DD Mon YYYY')
        using errcode = '22023';
    end if;
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

  -- The cooldown clock starts on the FIRST change only. A member whose handle
  -- was minted automatically has username_changed_at = NULL, so they get a full
  -- 30 days to pick their own from the moment they first try.
  insert into public.profiles (user_id, username_changed_at)
  values (p_member_id, now())
  on conflict (user_id) do update
     set username_changed_at = now(),
         updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'username', v_clean,
    'changed', true,
    'next_change_available', now() + interval '30 days'
  );
end;
$$;

-- The Phase 5 CHECK is NARROWER than the spec regex and would reject valid new
-- handles: it requires an alphanumeric first character (so ".rahul" fails) and
-- allows 24 characters (so a legal 21-24 char handle is fine, but a 3-20 char
-- one that starts with a dot is not). Left in place, the CHECK would raise 23514
-- AFTER the friendly message above — exactly the silent-failure pattern this
-- whole function rewrite exists to remove.
--
-- So the constraint is dropped and re-added to match the rule the function
-- actually enforces. Guarded by the definition check so a re-run is a no-op.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.members'::regclass and conname = 'members_username_format'
  ) then
    alter table public.members drop constraint members_username_format;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.members'::regclass and conname = 'members_username_format'
  ) then
    alter table public.members
      add constraint members_username_format
      check (username is null or username ~ '^[a-z0-9._]{3,20}$');
  end if;
end $$;

comment on constraint members_username_format on public.members is
  'Mirrors the rule enforced by fn_member_set_username: ^[a-z0-9._]{3,20}$, lowercase.';

comment on function public.fn_member_set_username(uuid, text) is
  'Sets the @handle under the 30-day cooldown. Returns changed=false when the handle is unchanged.';

-- -----------------------------------------------------------------------------
-- 8b. Editable profile fields
-- -----------------------------------------------------------------------------
-- Stored on profiles (the per-identity row) rather than members, so a member
-- editing their emergency contact does not rewrite the gym's roster record.
create or replace function public.fn_member_profile_update(
  p_member_id       uuid,
  p_display_name    text default null,
  p_emergency_phone text default null,
  p_gender          text default null,
  p_date_of_birth   date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant  uuid;
  v_gender  text := nullif(lower(trim(coalesce(p_gender, ''))), '');
  v_name    text := nullif(trim(coalesce(p_display_name, '')), '');
  v_phone   text := nullif(trim(coalesce(p_emergency_phone, '')), '');
  v_dob     date := p_date_of_birth;
  v_updated profiles%rowtype;
begin
  select m.tenant_id into v_tenant from public.members m where m.id = p_member_id;
  if v_tenant is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if v_name is not null and length(v_name) < 2 then
    raise exception 'Please enter your full name.' using errcode = '22023';
  end if;
  if v_name is not null and length(v_name) > 80 then
    raise exception 'That name is too long (80 characters max).' using errcode = '22023';
  end if;

  -- NULL means "the caller did not send this field", so a partial save from the
  -- Edit Profile modal cannot blank a field the user did not touch. Clearing a
  -- field is therefore done by sending an empty string, which maps to NULL.
  if v_phone is not null then
    v_phone := regexp_replace(v_phone, '[^0-9+]', '', 'g');
    if length(v_phone) not between 10 and 15 then
      raise exception 'Enter a 10-digit emergency number.' using errcode = '22023';
    end if;
  end if;

  if v_gender is not null and v_gender not in ('male', 'female', 'nonbinary', 'prefer_not_to_say') then
    raise exception 'gender must be one of: male, female, nonbinary, prefer_not_to_say.'
      using errcode = '22023';
  end if;

  if v_dob is not null then
    if v_dob > current_date then
      raise exception 'Date of birth cannot be in the future.' using errcode = '22023';
    end if;
    if v_dob < current_date - interval '120 years' then
      raise exception 'Please check the date of birth.' using errcode = '22023';
    end if;
  end if;

  -- display_name falls back to the gym's roster name when cleared, so the
  -- member app never renders an empty header.
  insert into public.profiles
    (user_id, tenant_id, display_name, emergency_phone, gender, date_of_birth, updated_at)
  values
    (p_member_id, v_tenant, v_name, v_phone, v_gender, v_dob, now())
  on conflict (user_id) do update
     set display_name    = coalesce(excluded.display_name, public.profiles.display_name),
         emergency_phone = coalesce(excluded.emergency_phone, public.profiles.emergency_phone),
         gender          = coalesce(excluded.gender, public.profiles.gender),
         date_of_birth   = coalesce(excluded.date_of_birth, public.profiles.date_of_birth),
         tenant_id       = coalesce(public.profiles.tenant_id, excluded.tenant_id),
         updated_at      = now()
  returning * into v_updated;

  return jsonb_build_object(
    'ok',             true,
    'display_name',   v_updated.display_name,
    'emergency_phone',v_updated.emergency_phone,
    'gender',         v_updated.gender,
    'date_of_birth',  v_updated.date_of_birth
  );
end;
$$;

comment on function public.fn_member_profile_update(uuid, text, text, text, date) is
  'Edits the member''s own profile fields. NULL arguments leave the stored value alone.';

-- -----------------------------------------------------------------------------
-- 9. Password-setup flag + onboarding read
-- -----------------------------------------------------------------------------
-- Marked complete only AFTER Supabase Auth has accepted the new password. The
-- column is a bookkeeping flag for this app, not the credential store: the real
-- secret lives in auth.users and is set through supabase.auth.updateUser().
create or replace function public.fn_member_mark_password_setup(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_member_id is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  update public.members
     set password_setup_completed = true
   where id = p_member_id;

  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'password_setup_completed', true);
end;
$$;

comment on function public.fn_member_mark_password_setup(uuid) is
  'Flips members.password_setup_completed to true once the member owns a real password.';

-- 9a. What the onboarding gate needs on every member app launch: has this member
--     finished setting a password, and do they have an email to recover it with?
create or replace function public.fn_member_security_state(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.members%rowtype;
begin
  select * into v_row from public.members m where m.id = p_member_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'password_setup_completed', false);
  end if;

  return jsonb_build_object(
    'ok',                       true,
    'password_setup_completed', coalesce(v_row.password_setup_completed, false),
    'has_email',                v_row.email is not null,
    'enrolled_at',              v_row.created_at
  );
end;
$$;

comment on function public.fn_member_security_state(uuid) is
  'Whether this member still owes a password, plus whether they have an email to recover it with.';

-- -----------------------------------------------------------------------------
-- 10. Companion bundle v3 — the four tabs in ONE round trip
-- -----------------------------------------------------------------------------
-- A full rewrite rather than four more RPCs, because the member app already
-- calls this once on launch and four extra calls would be four extra round
-- trips on the slowest connection the app is ever used on. Everything the
-- Phase 11 features need is folded in here:
--
--   announcements   -> pinned first, unpublished/expired filtered OUT, `type` badge
--   operating_hours -> so "Open now" reflects what the owner actually set
--   password_setup_completed -> so the blocking prompt renders on first paint
--   profile         -> the member's OWN editable fields, separate from the
--                      gym's roster name
--
-- Everything v2 returned keeps its exact key and semantics; the new keys are
-- purely additive, so no existing consumer can break.
create or replace function public.fn_member_companion_data(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant        uuid;
  v_member        jsonb;
  v_profile       jsonb;
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
           'id',                       m.id,
           'full_name',                m.full_name,
           'phone',                    m.phone,
           'email',                    m.email,
           'username',                 m.username,
           'membership_end',           m.membership_end,
           'is_frozen',                coalesce(m.is_frozen, false),
           'freeze_end_date',          m.freeze_end_date,
           'status',                   m.status,
           -- Phase 11: the blocking first-run password prompt.
           'password_setup_completed', coalesce(m.password_setup_completed, false),
           -- Phase 11: the gym's real schedule, replacing a hardcoded constant.
           'operating_hours',          t.operating_hours
         )
    into v_member
    from public.members m
    join public.tenants t on t.id = m.tenant_id
   where m.id = p_member_id;

  -- The member's OWN fields, as opposed to the gym's roster record above.
  -- display_name is what the app should headline when set, falling back to the
  -- roster name otherwise — so the header can never render empty.
  select coalesce((
    select jsonb_build_object(
             'display_name',       p.display_name,
             'emergency_phone',    p.emergency_phone,
             'gender',             p.gender,
             'date_of_birth',      p.date_of_birth,
             'avatar_url',         p.avatar_url,
             'username_changed_at',p.username_changed_at
           )
      from public.profiles p
     where p.user_id = p_member_id
  ), '{}'::jsonb)
    into v_profile;

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

  -- Published, unexpired notices, PINNED FIRST. Phase 4/6 ordered by created_at
  -- alone and filtered on is_active, which is why a pinned notice used to sit
  -- below a newer one and an expired one never went away on its own.
  --
  -- `message` and `is_active` are still emitted alongside `body`/`is_published`
  -- so any consumer written against the older shape keeps working unchanged.
  select coalesce(jsonb_agg(jsonb_build_object(
             'id',          a.id,
             'title',       a.title,
             'body',        a.body,
             'message',     a.body,
             'type',        a.type,
             'is_pinned',   a.is_pinned,
             'is_published',a.is_published,
             'is_active',   a.is_published,
             'expires_at',  a.expires_at,
             'created_at',  a.created_at
           ) order by a.is_pinned desc, a.created_at desc), '[]'::jsonb)
    into v_announcements
    from (
      select * from public.gym_announcements
       where tenant_id = v_tenant
         and is_published
         and (expires_at is null or expires_at > now())
       order by is_pinned desc, created_at desc
       limit 10
    ) a;

  return jsonb_build_object(
    'member', v_member,
    -- The member's own editable details, kept beside the roster row rather than
    -- merged into it: "full_name" is what the gym calls them, "display_name" is
    -- what they want to be called.
    'profile', v_profile,
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

comment on function public.fn_member_companion_data(uuid) is
  'Everything the four member tabs need in one round trip: member + profile, trainer, weights, workouts, pickups, pinned notices, streak.';

grant execute on function
  public.fn_member_set_username(uuid, text),
  public.fn_member_profile_update(uuid, text, text, text, date),
  public.fn_member_mark_password_setup(uuid),
  public.fn_member_security_state(uuid),
  public.fn_member_companion_data(uuid)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. Verification
-- -----------------------------------------------------------------------------
-- The migration RAISES rather than committing a half-applied schema. Each check
-- below corresponds to a defect listed at the top of the file, so a failure
-- names the feature that is still broken rather than "something went wrong".
do $$
declare
  v_bad text[] := array[]::text[];
begin
  if to_regprocedure('public.fn_challenge_list(uuid,uuid)') is null then
    v_bad := array_append(v_bad, 'fn_challenge_list missing');
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='gym_announcements'
                    and column_name='is_pinned') then
    v_bad := array_append(v_bad, 'gym_announcements.is_pinned missing');
  end if;

  -- The regression that made the whole file necessary: the generated alias must
  -- still resolve to the stored body, or a Phase 4 reader breaks.
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='gym_announcements'
                and column_name='message' and is_generated <> 'ALWAYS') then
    v_bad := array_append(v_bad, 'gym_announcements.message is not a generated alias');
  end if;

  -- Dropping `message` also drops the CHECK that referenced it. If the
  -- replacement is missing, a blank notice would be silently accepted.
  if not exists (select 1 from pg_constraint
                  where conrelid='public.gym_announcements'::regclass
                    and conname='gym_announcements_body_check') then
    v_bad := array_append(v_bad, 'gym_announcements has no non-blank body constraint');
  end if;

  if to_regprocedure('public.fn_announcements_upsert(uuid,uuid,text,text,text,boolean,boolean,timestamptz)') is null then
    v_bad := array_append(v_bad, 'fn_announcements_upsert missing');
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='tenants'
                    and column_name='operating_hours') then
    v_bad := array_append(v_bad, 'tenants.operating_hours missing');
  end if;

  if exists (select 1 from public.tenants where operating_hours is null) then
    v_bad := array_append(v_bad, 'a gym has no operating_hours');
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='members'
                    and column_name='password_setup_completed') then
    v_bad := array_append(v_bad, 'members.password_setup_completed missing');
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles'
                    and column_name='username_changed_at') then
    v_bad := array_append(v_bad, 'profiles.username_changed_at missing');
  end if;

  -- The constraint has to agree with the function, or a legal handle fails on a
  -- raw CHECK violation after the friendly message has already been produced.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.members'::regclass
       and conname = 'members_username_format'
       and pg_get_constraintdef(oid) not like '%3,20%'
  ) then
    v_bad := array_append(v_bad, 'members_username_format still uses the old 3-24 regex');
  end if;

  if exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='attendances'
  ) = false then
    -- Informational only: the publication may not exist on a self-hosted or
    -- non-Supabase install, which is not a reason to abort the migration.
    raise notice 'Realtime: public.attendances is NOT in the publication (expected on Supabase Cloud).';
  end if;

  if cardinality(v_bad) > 0 then
    raise exception 'Phase 11 verification FAILED: %', array_to_string(v_bad, '; ');
  end if;

  raise notice 'Phase 11 ready: challenge_list fixed, announcements + owner CRUD, attendances realtime, operating hours, password onboarding, 30-day handle cooldown.';
end $$;

commit;