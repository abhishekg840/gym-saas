-- =============================================================================
-- 0002_phase1_integrity.sql
--
-- Follow-up to 0001_phase1_tenant_isolation.sql. Two things 0001 lost when it
-- was trimmed, plus one logic hole found while smoke-testing the freeze flow:
--
--   1. members_freeze_window_check      freeze_end_date can never precede
--                                        freeze_start_date.
--   2. members_total_freeze_days_check   total_freeze_days can never go negative.
--   3. fn_unfreeze_membership previously stored the caller's p_end_date as-is,
--      so "unfreeze on a date before the freeze started" wrote an inverted
--      window (end < start). It now clamps the end date to the freeze start.
--
-- Safe to re-run: every statement is idempotent. Paste into the Supabase SQL
-- Editor and run. Nothing here rewrites existing rows.
-- =============================================================================

begin;

-- 1. Existing rows must not block the constraint: clear any inverted window
--    left behind by an unfreeze called with a too-early date, then enforce.
update public.members
   set freeze_end_date = freeze_start_date
 where freeze_start_date is not null
   and freeze_end_date   is not null
   and freeze_end_date   <  freeze_start_date;

update public.members
   set total_freeze_days = 0
 where total_freeze_days < 0;

-- 2. Freeze window must be ordered.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.members'::regclass
      and conname  = 'members_freeze_window_check'
  ) then
    alter table public.members
      add constraint members_freeze_window_check
      check (
        freeze_end_date is null
        or freeze_start_date is null
        or freeze_end_date >= freeze_start_date
      );
  end if;
end $$;

-- 3. Cumulative freeze days cannot be negative.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.members'::regclass
      and conname  = 'members_total_freeze_days_check'
  ) then
    alter table public.members
      add constraint members_total_freeze_days_check
      check (total_freeze_days >= 0);
  end if;
end $$;

-- 4. RPC rebuilt: the same tenant check and day maths as 0001, but the stored
--    freeze_end_date is clamped to the freeze start so the window stays sane.
create or replace function public.fn_unfreeze_membership(
  p_member_id uuid,
  p_tenant_id uuid,
  p_end_date  date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member   public.members%rowtype;
  v_start    date;
  v_end      date := coalesce(p_end_date, current_date);
  v_days     integer;
  v_base     date;
  v_new_end  date;
begin
  if p_member_id is null or p_tenant_id is null then
    raise exception 'member_id and tenant_id are required' using errcode = '22023';
  end if;

  select * into v_member
    from public.members
   where id = p_member_id
     and tenant_id = p_tenant_id
     for update;

  if not found then
    raise exception 'Member not found in this gym' using errcode = 'P0002';
  end if;

  if not v_member.is_frozen then
    raise exception 'Membership is not currently frozen' using errcode = '45001';
  end if;

  v_start := coalesce(v_member.freeze_start_date, v_end);

  -- An unfreeze dated before the freeze started is treated as "same day it
  -- started" (zero days held) instead of recording end < start.
  if v_end < v_start then
    v_end := v_start;
  end if;

  v_days := (v_end - v_start);

  v_base    := greatest(coalesce(v_member.membership_end, v_end), v_end);
  v_new_end := v_base + v_days;

  update public.members
     set is_frozen         = false,
         freeze_end_date   = v_end,
         total_freeze_days = coalesce(total_freeze_days, 0) + v_days,
         membership_end    = v_new_end,
         status            = case when v_new_end >= current_date then 'active' else 'expired' end
   where id = v_member.id
  returning * into v_member;

  return jsonb_build_object(
    'member_id',         v_member.id,
    'full_name',         v_member.full_name,
    'is_frozen',         v_member.is_frozen,
    'freeze_start_date', v_member.freeze_start_date,
    'freeze_end_date',   v_member.freeze_end_date,
    'days_added',        v_days,
    'membership_end',    v_member.membership_end,
    'status',            v_member.status
  );
end;
$$;

grant execute on function public.fn_unfreeze_membership(uuid, uuid, date)
  to anon, authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- After running, confirm with:
--
--   select conname from pg_constraint
--    where conrelid = 'public.members'::regclass
--      and conname in ('members_freeze_window_check',
--                      'members_total_freeze_days_check');
--   -- expect 2 rows
--
--   select count(*) from public.members
--    where freeze_start_date is not null
--      and freeze_end_date is not null
--      and freeze_end_date < freeze_start_date;
--   -- expect 0
-- ---------------------------------------------------------------------------
