-- =============================================================================
-- 0009_phase9_gamification_retention.sql   (run after 0008_phase8_billing_branches.sql)
--
-- ForgeOS Modules 7, 8 (attendance half) and the data spine for 10:
--
--   1. member_streaks          -> stored current_streak / best_streak /
--                                 last_checkin_date, maintained ONLY by real
--                                 gate check-ins (QR / biometric / RFID /
--                                 kiosk / geo-verified mobile). Opening the
--                                 app writes no attendance row, so it can never
--                                 move a streak.
--   2. member_badges           -> auto-awarded 🔥 7-day streak, ⚡ 30-day
--                                 streak and 🏋️ 100kg bench club rows.
--   3. workout_logs.is_pr      -> per-exercise personal-record flag set at
--                                 insert time, plus fn_member_stats for the
--                                 volume / PR panel.
--   4. gym_challenges          -> 30-day attendance / weight-loss challenges
--                                 with participants, progress and rank.
--   5. fn_monthly_leaderboard  -> top 10 of the current IST month by
--                                 check-ins, volume lifted or streak.
--   6. fn_member_self_checkin  -> geo-fenced mobile attendance: the phone's
--                                 GPS fix is verified against the tenant's
--                                 geofence BEFORE the attendance row exists.
--
-- Security model matches the phases before it: member-scoped tables are
-- revoked from anon/authenticated and reached through SECURITY DEFINER
-- functions with pinned search_path. gym_challenges stays directly writable
-- exactly like leads/products, because the owner console has always written
-- those tables straight through the anon key with a tenant filter.
--
-- Every statement is idempotent: safe to re-run in the SQL Editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. One shared definition of "this counts as a real check-in"
-- -----------------------------------------------------------------------------
-- A POSITIVE list on purpose. A method nobody has used for a physical gate can
-- never sneak into a streak by default, and the app itself (dashboard opens,
-- weigh-ins, store sales) inserts no attendance rows at all — so "opening the
-- app must NOT increment streak" holds structurally, not by convention.
create or replace function public.is_gate_checkin_method(p_method text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_method, '') in (
    'qr', 'qr_kiosk', 'qr_geofence',
    'biometric', 'biometric_rfid', 'rfid_card',
    'hardware_punch', 'manual', 'gate',
    'mobile_geo', 'geofence'
  );
$$;

comment on function public.is_gate_checkin_method(text) is
  'True when an attendance method is a physical/QR gate check-in (streak-eligible).';

-- -----------------------------------------------------------------------------
-- 1. member_streaks — the counters the gamification surfaces read
-- -----------------------------------------------------------------------------
create table if not exists public.member_streaks (
  member_id         uuid primary key references public.members(id) on delete cascade,
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  current_streak    integer not null default 0 check (current_streak >= 0),
  best_streak       integer not null default 0 check (best_streak >= 0),
  last_checkin_date date,
  updated_at        timestamptz not null default now()
);

create index if not exists idx_member_streaks_tenant on public.member_streaks (tenant_id);
create index if not exists idx_member_streaks_current on public.member_streaks (tenant_id, current_streak desc);

comment on table public.member_streaks is
  'Stored check-in streak per member. Written only by the attendance trigger; never by the app.';

-- Counter rows are an implementation detail keyed by member id: like workout
-- history, they are not browsable through PostgREST.
revoke all on public.member_streaks from anon, authenticated;

-- 1a. Backfill from the full attendance history (IST calendar days, gate
--     methods only, granted rows only) so day one shows honest numbers.
with days as (
  select distinct
         a.member_id,
         a.tenant_id,
         (a.punch_time at time zone 'Asia/Kolkata')::date as d
    from public.attendances a
   where a.member_id is not null
     and a.tenant_id is not null
     and a.status = 'granted'
     and a.punch_time is not null
     and public.is_gate_checkin_method(a.method)
),
marked as (
  select member_id,
         tenant_id,
         d,
         lag(d) over (partition by member_id order by d) as prev
    from days
),
runs as (
  select member_id,
         tenant_id,
         d,
         sum(case when prev is null or prev = d - 1 then 0 else 1 end)
           over (partition by member_id order by d) as run_id
    from marked
),
runlen as (
  select member_id,
         min(tenant_id) as tenant_id,
         run_id,
         count(*)       as len,
         max(d)         as end_d
    from runs
   group by 1, 3
),
latest as (
  select distinct on (member_id) member_id, tenant_id, len, end_d
    from runlen
   order by member_id, end_d desc
),
best as (
  select member_id, max(len) as best_len
    from runlen
   group by 1
)
insert into public.member_streaks (tenant_id, member_id, current_streak, best_streak, last_checkin_date)
select l.tenant_id,
       l.member_id,
       case when l.end_d >= (now() at time zone 'Asia/Kolkata')::date - 1 then l.len else 0 end,
       coalesce(b.best_len, l.len),
       l.end_d
  from latest l
  join best b on b.member_id = l.member_id
on conflict (member_id) do nothing;

-- 1b. The engine: every attendance row moves its member's streak exactly once.
--     Same day twice (a morning and an evening session) is one streak day, so
--     the update is guarded by last_checkin_date rather than blindly adding.
create or replace function public.fn_streak_on_attendance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day    date := (coalesce(new.punch_time, new.scanned_at, now()) at time zone 'Asia/Kolkata')::date;
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_prev   integer;
  v_last   date;
  v_next   integer;
begin
  -- Only granted gate check-ins count. Blocked attempts and unknown methods
  -- leave the counters alone; app opens never reach this trigger at all.
  if new.member_id is null then
    return new;
  end if;
  if new.status is distinct from 'granted' then
    return new;
  end if;
  if not public.is_gate_checkin_method(new.method) then
    return new;
  end if;

  -- Belt and braces: a row with no resolvable gym must not fail the punch that
  -- produced it — it simply carries no streak.
  if new.tenant_id is null then
    select m.tenant_id into new.tenant_id from public.members m where m.id = new.member_id;
    if new.tenant_id is null then
      return new;
    end if;
  end if;

  insert into public.member_streaks (tenant_id, member_id)
  values (new.tenant_id, new.member_id)
  on conflict (member_id) do nothing;

  select s.current_streak, s.last_checkin_date
    into v_prev, v_last
    from public.member_streaks s
   where s.member_id = new.member_id;

  v_prev := coalesce(v_prev, 0);

  -- A punch recorded for a day we have already moved past (imported history)
  -- must not rewind or duplicate the stored run.
  if v_day > v_today then
    return new;
  end if;

  v_next :=
    case
      when v_day = v_last      then v_prev
      when v_day = v_last + 1  then v_prev + 1
      else 1
    end;

  update public.member_streaks s
     set current_streak    = v_next,
         best_streak       = greatest(s.best_streak, v_next),
         last_checkin_date = case
                               when s.last_checkin_date is null or s.last_checkin_date < v_day
                               then v_day else s.last_checkin_date
                             end,
         updated_at        = now()
   where s.member_id = new.member_id;

  -- Badge evaluation rides the same event so a 7-day streak awards the moment
  -- the gate grants the seventh check-in.
  perform public.fn_badges_evaluate(new.member_id);

  return new;
end;
$$;

comment on function public.fn_streak_on_attendance() is
  'AFTER INSERT trigger: maintains member_streaks from granted gate check-ins and evaluates badges.';

drop trigger if exists trg_attendance_streak on public.attendances;
create trigger trg_attendance_streak
  after insert on public.attendances
  for each row
  execute function public.fn_streak_on_attendance();

-- -----------------------------------------------------------------------------
-- 2. member_badges — auto-awarded achievements
-- -----------------------------------------------------------------------------
-- One row per (member, badge). Badges are never earned by clicking anything:
-- the trigger paths above and below evaluate the conditions the moment a
-- qualifying event is recorded, so a badge can never be faked from the client
-- and never has to be "claimed".
create table if not exists public.member_badges (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  badge_key   text not null check (length(badge_key) between 1 and 40),
  awarded_at  timestamptz not null default now(),
  unique (member_id, badge_key)
);

create index if not exists idx_member_badges_member on public.member_badges (member_id, awarded_at desc);
create index if not exists idx_member_badges_tenant on public.member_badges (tenant_id);

comment on table public.member_badges is
  'Achievements awarded automatically: iron_streak_7, beast_mode_30, bench_100kg.';

-- Badge rows describe a member and are only ever read for that member, so they
-- stay behind RPCs exactly like the streak counters.
revoke all on public.member_badges from anon, authenticated;

-- 2a. The evaluator. Idempotent by construction (ON CONFLICT DO NOTHING), so
--     it can run after every qualifying event without counting duplicates.
create or replace function public.fn_badges_evaluate(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_best   integer := 0;
begin
  select m.tenant_id into v_tenant
    from public.members m
   where m.id = p_member_id;
  if v_tenant is null then
    return;
  end if;

  select coalesce(s.best_streak, 0) into v_best
    from public.member_streaks s
   where s.member_id = p_member_id;

  -- 🔥 7-Day Iron Streak
  if v_best >= 7 then
    insert into public.member_badges (tenant_id, member_id, badge_key)
    values (v_tenant, p_member_id, 'iron_streak_7')
    on conflict (member_id, badge_key) do nothing;
  end if;

  -- ⚡ 30-Day Beast Mode
  if v_best >= 30 then
    insert into public.member_badges (tenant_id, member_id, badge_key)
    values (v_tenant, p_member_id, 'beast_mode_30')
    on conflict (member_id, badge_key) do nothing;
  end if;

  -- 🏋️ 100kg Bench Club (any bench variant at 100 kg or above)
  if exists (
    select 1
      from public.workout_logs w
     where w.member_id = p_member_id
       and w.weight_used >= 100
       and w.exercise_name ~* 'bench'
  ) then
    insert into public.member_badges (tenant_id, member_id, badge_key)
    values (v_tenant, p_member_id, 'bench_100kg')
    on conflict (member_id, badge_key) do nothing;
  end if;
end;
$$;

comment on function public.fn_badges_evaluate(uuid) is
  'Awards any badges the member has just qualified for. Safe to call repeatedly.';

-- 2b. Read side for the member app. Keys only — the display catalogue lives in
--     lib/gamification.ts so renaming a label never needs a migration.
create or replace function public.fn_member_badges(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'badge_key',  b.badge_key,
               'awarded_at', b.awarded_at
             )
             order by b.awarded_at desc
           ),
           '[]'::jsonb
         )
    into v_rows
    from public.member_badges b
   where b.member_id = p_member_id;

  return v_rows;
end;
$$;

grant execute on function public.fn_badges_evaluate(uuid), public.fn_member_badges(uuid)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Volume & PR tracking (Module 10.1)
-- -----------------------------------------------------------------------------
-- is_pr is decided at insert time against the member's own history for that
-- exercise. Computing it in the browser would race two phones and would be
-- wrong the moment history changed; here it is one statement beside the insert.
alter table public.workout_logs
  add column if not exists is_pr boolean not null default false;

comment on column public.workout_logs.is_pr is
  'True when this set set a new personal record for the member on this exercise (weight > previous best).';

create index if not exists idx_workout_logs_member_weight
  on public.workout_logs (member_id, weight_used desc);

create or replace function public.fn_workout_mark_pr()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_best numeric;
begin
  if coalesce(new.weight_used, 0) <= 0 then
    new.is_pr := false;
    return new;
  end if;

  select coalesce(max(w.weight_used), 0) into v_best
    from public.workout_logs w
   where w.member_id = new.member_id
     and lower(btrim(w.exercise_name)) = lower(btrim(new.exercise_name));

  new.is_pr := new.weight_used > v_best;
  return new;
end;
$$;

drop trigger if exists trg_workout_pr on public.workout_logs;
create trigger trg_workout_pr
  before insert on public.workout_logs
  for each row
  execute function public.fn_workout_mark_pr();

-- Badge evaluation after the row exists (the bench rule reads workout_logs).
create or replace function public.fn_workout_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_badges_evaluate(new.member_id);
  return new;
end;
$$;

drop trigger if exists trg_workout_badges on public.workout_logs;
create trigger trg_workout_badges
  after insert on public.workout_logs
  for each row
  execute function public.fn_workout_after_insert();

-- 3a. The logger, rebuilt to hand back the PR flag. Everything else — tenant
--     lookup, validation, the split CHECK — is unchanged from Phase 4.
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
  v_pr     boolean;
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
  returning id, is_pr into v_id, v_pr;

  return jsonb_build_object('ok', true, 'id', v_id, 'is_pr', v_pr);
end;
$$;

-- 3b. Volume & PR bundle for the Training tab: sets x reps x weight over the
--     last 7 / 30 days, sessions this month, and one best set per exercise.
create or replace function public.fn_member_stats(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant      uuid;
  v_month_start timestamptz;
  v_volume_7d   numeric := 0;
  v_volume_30d  numeric := 0;
  v_sessions    integer := 0;
  v_prs         jsonb;
begin
  select m.tenant_id into v_tenant from public.members m where m.id = p_member_id;
  if v_tenant is null then
    raise exception 'Member not found';
  end if;

  v_month_start := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';

  select coalesce(sum(case when w.logged_at >= now() - interval '7 days'
                           then w.sets * w.reps * w.weight_used else 0 end), 0),
         coalesce(sum(case when w.logged_at >= now() - interval '30 days'
                           then w.sets * w.reps * w.weight_used else 0 end), 0)
    into v_volume_7d, v_volume_30d
    from public.workout_logs w
   where w.member_id = p_member_id;

  select count(distinct date_trunc('day', w.logged_at))
    into v_sessions
    from public.workout_logs w
   where w.member_id = p_member_id
     and w.logged_at >= v_month_start;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'exercise',  p.exercise,
               'weight',    p.weight,
               'reps',      p.reps,
               'sets',      p.sets,
               'split',     p.split,
               'logged_at', p.logged_at
             )
             order by p.weight desc
           ),
           '[]'::jsonb
         )
    into v_prs
    from (
      select distinct on (lower(btrim(w.exercise_name)))
             trim(w.exercise_name) as exercise,
             w.weight_used         as weight,
             w.reps, w.sets,
             w.workout_split       as split,
             w.logged_at
        from public.workout_logs w
       where w.member_id = p_member_id
         and w.weight_used > 0
       order by lower(btrim(w.exercise_name)), w.weight_used desc, w.logged_at desc
    ) p;

  return jsonb_build_object(
    'volume_7d',            round(v_volume_7d, 1),
    'volume_30d',           round(v_volume_30d, 1),
    'month_volume',         round(coalesce((
                              select sum(w.sets * w.reps * w.weight_used)
                                from public.workout_logs w
                               where w.member_id = p_member_id
                                 and w.logged_at >= v_month_start
                            ), 0), 1),
    'sessions_this_month',  v_sessions,
    'prs',                  v_prs
  );
end;
$$;

comment on function public.fn_member_stats(uuid) is
  'Volume totals (7d / 30d / current IST month), sessions this month and per-exercise PRs.';

grant execute on function public.fn_member_log_workout(uuid, text, text, integer, integer, numeric),
                      public.fn_member_stats(uuid)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. fn_member_streak — rebuilt on the stored counters
-- -----------------------------------------------------------------------------
-- Phase 5 derived the streak from a live scan of attendances every time the
-- dashboard opened. Phase 8 stores it (member_streaks) so the leaderboard and
-- badge rules read the same numbers without re-walking history, and so the
-- streak is defined as gate check-ins only. Same contract as before, plus
-- `last_checkin_date`; a run that has not been extended since yesterday still
-- shows today (grace until midnight), then reads as 0 — identical behaviour to
-- the Phase 5 function, so the Home tab does not change.
create or replace function public.fn_member_streak(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_last    date;
  v_current integer := 0;
  v_best    integer := 0;
  v_total   integer := 0;
begin
  select s.last_checkin_date, s.current_streak, s.best_streak
    into v_last, v_current, v_best
    from public.member_streaks s
   where s.member_id = p_member_id;

  -- Days ever trained (IST, granted gate check-ins) for the "visits" counter.
  select count(distinct (a.punch_time at time zone 'Asia/Kolkata')::date)
    into v_total
    from public.attendances a
   where a.member_id = p_member_id
     and a.status = 'granted'
     and a.punch_time is not null
     and public.is_gate_checkin_method(a.method);

  if v_last is null then
    return jsonb_build_object(
      'streak_count', 0,
      'streak_best', 0,
      'checked_in_today', false,
      'last_visit', null,
      'last_checkin_date', null,
      'visit_days', v_total
    );
  end if;

  -- The run is only "live" through the day after the last check-in.
  if v_last < v_today - 1 then
    v_current := 0;
  end if;

  return jsonb_build_object(
    'streak_count', v_current,
    'streak_best', greatest(coalesce(v_best, 0), v_current),
    'checked_in_today', v_last = v_today,
    'last_visit', to_jsonb(v_last),
    'last_checkin_date', to_jsonb(v_last),
    'visit_days', v_total
  );
end;
$$;

comment on function public.fn_member_streak(uuid) is
  'Stored gate check-in streak (IST days, granted gate methods only). Returns streak_count, streak_best, checked_in_today, last_visit, last_checkin_date and visit_days.';

-- -----------------------------------------------------------------------------
-- 5. Gym challenges (Module 7.4)
-- -----------------------------------------------------------------------------
-- Two kinds ship: 'attendance' (count granted gate check-ins inside the
-- window) and 'weight_loss' (kg shed from the weigh-in at join time). The
-- target is expressed in the kind's own unit — check-ins for attendance, kg
-- for weight loss — so a 30-Day Attendance Challenge is target_value = 30.
create table if not exists public.gym_challenges (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 3 and 120),
  kind         text not null check (kind in ('attendance', 'weight_loss')),
  description  text check (description is null or length(description) <= 500),
  start_date   date not null,
  end_date     date not null,
  target_value numeric(8, 2) not null default 30 check (target_value > 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_gym_challenges_tenant on public.gym_challenges (tenant_id, start_date desc);

comment on table public.gym_challenges is
  'Owner-launched gym challenges (attendance count or weight loss over a window).';

-- Progress rows are member data: revoked from PostgREST, written only through
-- fn_challenge_join and read only through fn_challenge_board / fn_challenge_list.
create table if not exists public.challenge_participants (
  id              uuid primary key default gen_random_uuid(),
  challenge_id    uuid not null references public.gym_challenges(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  baseline_weight numeric(6, 2) null,
  joined_at       timestamptz not null default now(),
  unique (challenge_id, member_id)
);

create index if not exists idx_challenge_participants_challenge
  on public.challenge_participants (challenge_id);
create index if not exists idx_challenge_participants_member
  on public.challenge_participants (member_id);

revoke all on public.challenge_participants from anon, authenticated;

-- 5a. One member's progress in one challenge, in the challenge's own unit.
create or replace function public.fn_challenge_member_progress(
  p_challenge_id uuid,
  p_member_id    uuid
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind      text;
  v_baseline  numeric;
  v_progress  numeric := 0;
begin
  select c.kind, cp.baseline_weight
    into v_kind, v_baseline
    from public.gym_challenges c
    left join public.challenge_participants cp
           on cp.challenge_id = c.id and cp.member_id = p_member_id
   where c.id = p_challenge_id;

  if v_kind is null then
    return 0;
  end if;

  if v_kind = 'attendance' then
    select count(*)::numeric into v_progress
      from public.attendances a
      join public.gym_challenges c on c.id = p_challenge_id
     where a.member_id = p_member_id
       and a.status = 'granted'
       and public.is_gate_checkin_method(a.method)
       and a.punch_time is not null
       and (a.punch_time at time zone 'Asia/Kolkata')::date
             between c.start_date and c.end_date;
    return coalesce(v_progress, 0);
  end if;

  -- weight_loss: kg shed since the weigh-in captured when they joined.
  if v_baseline is null then
    return 0;
  end if;

  select greatest(0, v_baseline - coalesce(w.weight_kg, v_baseline))
    into v_progress
    from public.member_weights w
   where w.member_id = p_member_id
   order by w.logged_at desc
   limit 1;

  -- No weigh-in after joining: the baseline still counts as current weight.
  return coalesce(v_progress, 0);
end;
$$;

comment on function public.fn_challenge_member_progress(uuid, uuid) is
  'Attendance = granted gate check-ins in window; weight_loss = kg below the baseline captured at join.';

-- 5b. Joining. The only writer of challenge_participants: it re-checks the
--     member belongs to the challenge's gym, the window is open, and captures
--     the weight-loss baseline from the member's own weigh-in history.
create or replace function public.fn_challenge_join(
  p_challenge_id uuid,
  p_member_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.gym_challenges%rowtype;
  v_member_tenant uuid;
  v_participant   uuid;
  v_baseline numeric;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_challenge
    from public.gym_challenges c
   where c.id = p_challenge_id
   for update;

  if not found then
    raise exception 'Challenge not found' using errcode = 'P0002';
  end if;

  select m.tenant_id into v_member_tenant
    from public.members m
   where m.id = p_member_id;
  if v_member_tenant is null or v_member_tenant <> v_challenge.tenant_id then
    raise exception 'That challenge does not belong to this member''s gym' using errcode = '22023';
  end if;

  select cp.id into v_participant
    from public.challenge_participants cp
   where cp.challenge_id = p_challenge_id and cp.member_id = p_member_id;

  if v_participant is not null then
    return jsonb_build_object(
      'ok', true, 'already_joined', true,
      'challenge_id', p_challenge_id, 'participant_id', v_participant
    );
  end if;

  if not v_challenge.is_active then
    raise exception 'This challenge is no longer open' using errcode = '45001';
  end if;
  if v_today > v_challenge.end_date then
    raise exception 'This challenge has already ended' using errcode = '45001';
  end if;

  if v_challenge.kind = 'weight_loss' then
    select w.weight_kg into v_baseline
      from public.member_weights w
     where w.member_id = p_member_id
     order by w.logged_at desc
     limit 1;
  end if;

  insert into public.challenge_participants
    (challenge_id, tenant_id, member_id, baseline_weight)
  values (p_challenge_id, v_challenge.tenant_id, p_member_id, v_baseline)
  returning id into v_participant;

  return jsonb_build_object(
    'ok', true, 'already_joined', false,
    'challenge_id', p_challenge_id, 'participant_id', v_participant,
    'baseline_weight', v_baseline
  );
end;
$$;

-- 5c. The leaderboard for one challenge: every participant with progress and
--     a dense competitive rank, best progress first.
create or replace function public.fn_challenge_board(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.gym_challenges%rowtype;
  v_rows jsonb;
begin
  select * into v_challenge from public.gym_challenges c where c.id = p_challenge_id;
  if not found then
    raise exception 'Challenge not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(x order by (x->>'progress')::numeric desc, x->>'joined_at'), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'member_id',      cp.member_id,
               'name',           m.full_name,
               'username',       m.username,
               'progress',       public.fn_challenge_member_progress(cp.challenge_id, cp.member_id),
               'target',         v_challenge.target_value,
               'baseline_weight', cp.baseline_weight,
               'joined_at',      cp.joined_at,
               'rank',           row_number() over (
                                   order by public.fn_challenge_member_progress(cp.challenge_id, cp.member_id) desc,
                                            cp.joined_at asc
                                 )
             ) as x
        from public.challenge_participants cp
        join public.members m on m.id = cp.member_id
       where cp.challenge_id = p_challenge_id
    ) ranked;

  return jsonb_build_object(
    'challenge', jsonb_build_object(
      'id', v_challenge.id,
      'title', v_challenge.title,
      'kind', v_challenge.kind,
      'description', v_challenge.description,
      'start_date', v_challenge.start_date,
      'end_date', v_challenge.end_date,
      'target_value', v_challenge.target_value,
      'is_active', v_challenge.is_active
    ),
    'board', v_rows
  );
end;
$$;

-- 5d. The member's challenge home: every live or recently finished challenge
--     in the gym, with participant counts and — when a member id is supplied —
--     whether they joined, their progress and their rank.
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
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',              c.id,
               'title',           c.title,
               'kind',            c.kind,
               'description',     c.description,
               'start_date',      c.start_date,
               'end_date',        c.end_date,
               'target_value',    c.target_value,
               'is_active',       c.is_active,
               'participants',    p.cnt,
               'joined',          p.joined,
               'my_progress',     p.my_progress,
               'my_rank',         p.my_rank,
               'baseline_weight', p.baseline_weight
             )
             order by c.start_date desc, c.created_at desc
           ),
           '[]'::jsonb
         )
    into v_rows
    from public.gym_challenges c
    cross join lateral (
      select count(*)::int as cnt,
             coalesce(bool_or(cp.member_id = p_member_id), false) as joined,
             max(case when cp.member_id = p_member_id then cp.baseline_weight end) as baseline_weight
        from public.challenge_participants cp
       where cp.challenge_id = c.id
    ) p
    cross join lateral (
      select case
               when p_member_id is null or not coalesce(p.joined, false) then null
               else (
                 select count(*)::int + 1
                   from public.challenge_participants r2
                  where r2.challenge_id = c.id
                    and r2.member_id <> p_member_id
                    and public.fn_challenge_member_progress(c.id, r2.member_id)
                          > public.fn_challenge_member_progress(c.id, p_member_id)
               )
             end as my_rank,
             case
               when p_member_id is null or not coalesce(p.joined, false) then null
               else public.fn_challenge_member_progress(c.id, p_member_id)
             end as my_progress
    ) r
   where c.tenant_id = p_tenant_id
     and c.is_active
     and c.end_date >= (now() at time zone 'Asia/Kolkata')::date - 30
   limit 100;

  return v_rows;
end;
$$;

comment on function public.fn_challenge_list(uuid, uuid) is
  'Challenges for one gym (active or finished within 30 days) with counts and, for a member, joined/progress/rank.';

grant execute on function
  public.fn_challenge_member_progress(uuid, uuid),
  public.fn_challenge_join(uuid, uuid),
  public.fn_challenge_board(uuid),
  public.fn_challenge_list(uuid, uuid)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Monthly leaderboard (Module 7.2)
-- -----------------------------------------------------------------------------
-- Top 10 of the CURRENT IST month, three ways to rank:
--   checkins -> granted gate check-ins this month (consistency)
--   volume   -> sets x reps x weight lifted this month
--   streak   -> the member's current gate streak
-- The optional viewer row is appended with its true rank even when outside the
-- top 10, so "your position" never needs a second round trip.
create or replace function public.fn_monthly_leaderboard(
  p_tenant_id uuid,
  p_mode      text default 'checkins',
  p_limit     integer default 10,
  p_viewer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_rows  jsonb;
  v_sql   text;
begin
  if p_mode not in ('checkins', 'volume', 'streak') then
    raise exception 'mode must be one of: checkins, volume, streak' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    p_limit := 10;
  end if;

  -- Month boundary in the gym's local day (IST), consistent with the streaks.
  v_start := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';

  if p_mode = 'checkins' then
    v_sql := $q$
      with base as (
        select m.id as member_id, m.full_name, m.username,
               count(a.id)::numeric as value
          from public.members m
          join public.attendances a on a.member_id = m.id
         where m.tenant_id = $1
           and m.status <> 'transferred'
           and a.status = 'granted'
           and public.is_gate_checkin_method(a.method)
           and a.punch_time >= $2 and a.punch_time < $2 + interval '1 month'
         group by m.id, m.full_name, m.username
      )
      select coalesce(jsonb_agg(
               jsonb_build_object(
                 'member_id', r.member_id, 'name', r.full_name,
                 'username', r.username, 'value', r.value,
                 'rank', r.rank, 'is_you', r.member_id = $3
               ) order by r.rank
             ), '[]'::jsonb)
        from (
          select b.*, row_number() over (order by b.value desc, b.full_name asc) as rank
            from base b
           where b.value > 0
        ) r
       where r.rank <= $4 or r.member_id = $3
    $q$;
  elsif p_mode = 'volume' then
    v_sql := $q$
      with base as (
        select m.id as member_id, m.full_name, m.username,
               coalesce(sum(w.sets * w.reps * w.weight_used), 0)::numeric as value
          from public.members m
          left join public.workout_logs w
                 on w.member_id = m.id
                and w.logged_at >= $2 and w.logged_at < $2 + interval '1 month'
         where m.tenant_id = $1
           and m.status <> 'transferred'
         group by m.id, m.full_name, m.username
      )
      select coalesce(jsonb_agg(
               jsonb_build_object(
                 'member_id', r.member_id, 'name', r.full_name,
                 'username', r.username, 'value', r.value,
                 'rank', r.rank, 'is_you', r.member_id = $3
               ) order by r.rank
             ), '[]'::jsonb)
        from (
          select b.*, row_number() over (order by b.value desc, b.full_name asc) as rank
            from base b
           where b.value > 0
        ) r
       where r.rank <= $4 or r.member_id = $3
    $q$;
  else
    v_sql := $q$
      with base as (
        select m.id as member_id, m.full_name, m.username,
               coalesce(s.current_streak, 0)::numeric as value
          from public.members m
          left join public.member_streaks s on s.member_id = m.id
         where m.tenant_id = $1
           and m.status <> 'transferred'
      )
      select coalesce(jsonb_agg(
               jsonb_build_object(
                 'member_id', r.member_id, 'name', r.full_name,
                 'username', r.username, 'value', r.value,
                 'rank', r.rank, 'is_you', r.member_id = $3
               ) order by r.rank
             ), '[]'::jsonb)
        from (
          select b.*, row_number() over (order by b.value desc, b.full_name asc) as rank
            from base b
           where b.value > 0
        ) r
       where r.rank <= $4 or r.member_id = $3
    $q$;
  end if;

  execute v_sql into v_rows
    using p_tenant_id, v_start, p_viewer_id, p_limit;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

comment on function public.fn_monthly_leaderboard(uuid, text, integer, uuid) is
  'Current IST month top 10 by checkins | volume | streak, plus the viewer row with its real rank.';

grant execute on function public.fn_monthly_leaderboard(uuid, text, integer, uuid)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Geo-fenced mobile self check-in (Module 8.2)
-- -----------------------------------------------------------------------------
-- The phone sends its GPS fix; the server re-derives the distance from the
-- tenant's saved coordinates and only THEN writes the attendance row. Same
-- fail-closed rule as the Phase 5 pass: enforcement armed + no fix = denied.
-- The attendance insert flows through trg_attendance_streak, so a geo check-in
-- moves the streak exactly like a turnstile punch.
create or replace function public.fn_member_self_checkin(
  p_member_id uuid,
  p_lat       numeric,
  p_lon       numeric,
  p_accuracy  numeric default null,
  p_branch_id uuid   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member   public.members%rowtype;
  v_lat      numeric(10, 7);
  v_lon      numeric(10, 7);
  v_radius   integer;
  v_enforce  boolean;
  v_distance numeric;
  v_status   text;
  v_access   text;
  v_reason   text;
  v_att      uuid;
begin
  if p_member_id is null then
    raise exception 'member_id is required' using errcode = '22023';
  end if;

  select * into v_member from public.members m where m.id = p_member_id for update;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if v_member.tenant_id is null then
    raise exception 'This member is not linked to a gym' using errcode = '22023';
  end if;

  select t.latitude, t.longitude, t.geofence_radius_meters, t.enforce_geofence
    into v_lat, v_lon, v_radius, v_enforce
    from public.tenants t
   where t.id = v_member.tenant_id;

  -- Membership verdict first: frozen beats expired, exactly like the gate.
  if v_member.is_frozen then
    v_access := 'DENIED';
    v_status := 'blocked_frozen';
    v_reason := 'Membership is frozen'
      || case when v_member.freeze_end_date is not null
              then ' until ' || v_member.freeze_end_date::text else '' end || '. See the front desk.';
  elsif v_member.status in ('transferred', 'inactive') then
    v_access := 'DENIED';
    v_status := 'blocked_expired';
    v_reason := 'Membership ' || v_member.status || '. See the front desk.';
  elsif v_member.membership_end is null or v_member.membership_end < current_date then
    v_access := 'DENIED';
    v_status := 'blocked_expired';
    v_reason := 'Membership expired. Renewal required.';
  elsif coalesce(v_enforce, false) and v_lat is not null and v_lon is not null then
    -- Haversine (same arithmetic as lib/geofence.ts) — metres.
    if p_lat is null or p_lon is null then
      v_access  := 'DENIED';
      v_status  := 'blocked_geofence';
      v_reason  := 'Location proof required: enable GPS and stand inside the gym to self check-in.';
      v_distance := null;
    else
      v_distance := 2 * 6371008.8 * asin(least(1.0, sqrt(
          power(sin(radians(p_lat - v_lat) / 2), 2)
          + cos(radians(v_lat)) * cos(radians(p_lat))
          * power(sin(radians(p_lon - v_lon) / 2), 2)
      )));

      if v_distance <= v_radius then
        v_access := 'GRANTED';
        v_status := 'granted';
        v_reason := 'Inside the gym geofence — ' || round(v_distance)::text || ' m from the door.';
      else
        v_access := 'DENIED';
        v_status := 'blocked_geofence';
        v_reason := 'Outside gym radius (' || round(v_distance)::text || ' m, allowed '
                    || v_radius || ' m). Check in at the gate.';
      end if;
    end if;
  else
    -- Geofencing not armed for this gym: the phone is still physically present
    -- by definition of pressing the button, so the check-in stands.
    v_access := 'GRANTED';
    v_status := 'granted';
    v_reason := 'Self check-in recorded. This gym has no geofence configured.';
    v_distance := null;
  end if;

  insert into public.attendances (tenant_id, member_id, method, status, branch_id)
  values (v_member.tenant_id, v_member.id, 'mobile_geo', v_status,
          case when p_branch_id is not null
                 and exists (select 1 from public.branches b
                              where b.id = p_branch_id and b.tenant_id = v_member.tenant_id)
               then p_branch_id else null end)
  returning id into v_att;

  return jsonb_build_object(
    'access',         v_access,
    'reason',         v_reason,
    'status',         v_status,
    'member_id',      v_member.id,
    'member_name',    v_member.full_name,
    'membership_end', v_member.membership_end,
    'attendance_id',  v_att,
    'distance_meters', case when v_distance is null then null else round(v_distance) end,
    'radius_meters',  v_radius,
    'geofence_enforced', coalesce(v_enforce, false),
    'accuracy_meters', p_accuracy,
    'streak',         public.fn_member_streak(v_member.id)
  );
end;
$$;

comment on function public.fn_member_self_checkin(uuid, numeric, numeric, numeric, uuid) is
  'GPS-verified mobile self check-in: validates membership + geofence, logs attendance (method mobile_geo), returns { access, reason, streak }.';

grant execute on function public.fn_member_self_checkin(uuid, numeric, numeric, numeric, uuid)
  to anon, authenticated;

commit;










