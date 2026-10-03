begin;

-- =============================================================================
-- 1. Credential Columns
-- =============================================================================
alter table if exists public.gym_users
  add column if not exists password_hash         text        null,
  add column if not exists password_changed_at   timestamptz null,
  add column if not exists password_must_change  boolean     not null default false;

alter table if exists public.members
  add column if not exists password_hash         text        null,
  add column if not exists password_changed_at   timestamptz null,
  add column if not exists password_must_change  boolean     not null default false;

-- =============================================================================
-- 2. Privileges & RLS (Fix P0001 Assertion)
-- =============================================================================
-- Revoke entire table SELECT first, then grant only non-sensitive columns
revoke select on public.gym_users from anon, authenticated;
grant select (id, tenant_id, full_name, phone, email, role)
  on public.gym_users to anon, authenticated;

revoke select on public.members from anon, authenticated;
grant select (
  id, tenant_id, full_name, phone, email, username, 
  rfid_card, rfid_uid, biometric_id, status, membership_end, 
  is_frozen, freeze_end_date, password_setup_completed, created_at
) on public.members to anon, authenticated;

alter table public.gym_users enable row level security;
alter table public.members enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'gym_users'
       and policyname = 'gym_users_directory_read'
  ) then
    create policy gym_users_directory_read
      on public.gym_users for select
      to anon, authenticated
      using (true);
  end if;
end $$;

-- =============================================================================
-- 3. Backfill Legacy PINs to bcrypt
-- =============================================================================
update public.gym_users
   set password_hash = crypt(pin_code, gen_salt('bf')),
       password_changed_at = coalesce(password_changed_at, now()),
       password_must_change = true
 where pin_code is not null
   and trim(pin_code) <> ''
   and password_hash is null;

-- =============================================================================
-- 4. Authentication Functions
-- =============================================================================
create or replace function public.fn_staff_verify_password(
  p_identifier text,
  p_password   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pw   text := coalesce(p_password, '');
  v_hash text;
  v_row  public.gym_users%rowtype;
begin
  if nullif(trim(coalesce(p_identifier, '')), '') is null or v_pw = '' then
    return null;
  end if;

  select * into v_row
    from public.gym_users u
   where u.phone = trim(p_identifier)
      or lower(trim(u.email)) = lower(trim(p_identifier))
      or u.id::text = trim(p_identifier)
   limit 1;

  if v_row.id is null then return null; end if;

  v_hash := v_row.password_hash;
  if v_hash is null or (crypt(v_pw, v_hash) = v_hash) is not true then
    return null;
  end if;

  return jsonb_build_object(
    'user_id',               v_row.id,
    'full_name',             v_row.full_name,
    'phone',                 v_row.phone,
    'email',                 v_row.email,
    'role',                  v_row.role,
    'tenant_id',             v_row.tenant_id,
    'password_must_change',  coalesce(v_row.password_must_change, false)
  );
end;
$$;

create or replace function public.fn_member_verify_password(
  p_identifier text,
  p_password   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pw   text := coalesce(p_password, '');
  v_hash text;
  v_row  public.members%rowtype;
begin
  if nullif(trim(coalesce(p_identifier, '')), '') is null or v_pw = '' then
    return null;
  end if;

  select * into v_row
    from public.members m
   where m.phone = trim(p_identifier)
      or lower(trim(m.username)) = lower(replace(trim(p_identifier), '@', ''))
      or lower(trim(coalesce(m.email, ''))) = lower(trim(p_identifier))
   limit 1;

  if v_row.id is null then return null; end if;

  v_hash := v_row.password_hash;
  if v_hash is null or (crypt(v_pw, v_hash) = v_hash) is not true then
    return null;
  end if;

  return jsonb_build_object(
    'member_id',                v_row.id,
    'full_name',                v_row.full_name,
    'phone',                    v_row.phone,
    'email',                    v_row.email,
    'username',                 v_row.username,
    'tenant_id',                v_row.tenant_id,
    'password_must_change',     coalesce(v_row.password_must_change, false),
    'password_setup_completed', coalesce(v_row.password_setup_completed, false)
  );
end;
$$;

create or replace function public.fn_member_set_password(
  p_member_id        uuid,
  p_current_password text,
  p_new_password     text,
  p_confirm          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     public.members%rowtype;
  v_current text;
  v_new     text := coalesce(p_new_password, '');
begin
  if p_member_id is null then raise exception 'member_id is required' using errcode = '22023'; end if;
  select * into v_row from public.members m where m.id = p_member_id;
  if v_row.id is null then raise exception 'Member not found' using errcode = 'P0002'; end if;

  if octet_length(v_new) < 8 or octet_length(v_new) > 72 then
    raise exception 'Password must be 8-72 characters.' using errcode = '22023';
  end if;
  if v_new !~ '[A-Za-z]' or v_new !~ '[0-9]' then
    raise exception 'Include at least one letter and one number.' using errcode = '22023';
  end if;
  if p_confirm is not null and v_new <> p_confirm then
    raise exception 'Passwords do not match.' using errcode = '22023';
  end if;

  v_current := coalesce(p_current_password, '');
  if v_row.password_hash is not null then
    if v_current = '' or (crypt(v_current, v_row.password_hash) = v_row.password_hash) is not true then
      raise exception 'Current password incorrect.' using errcode = '45009';
    end if;
  end if;

  update public.members
     set password_hash            = crypt(v_new, gen_salt('bf')),
         password_changed_at      = now(),
         password_must_change     = false,
         password_setup_completed = true
   where id = p_member_id;

  return jsonb_build_object('ok', true, 'member_id', v_row.id);
end;
$$;

create or replace function public.fn_staff_set_password(
  p_user_id          uuid,
  p_current_password text,
  p_new_password     text,
  p_confirm          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     public.gym_users%rowtype;
  v_current text;
  v_new     text := coalesce(p_new_password, '');
begin
  if p_user_id is null then raise exception 'user_id is required' using errcode = '22023'; end if;
  select * into v_row from public.gym_users u where u.id = p_user_id;
  if v_row.id is null then raise exception 'Account not found' using errcode = 'P0002'; end if;

  if octet_length(v_new) < 8 or octet_length(v_new) > 72 then
    raise exception 'Password must be 8-72 characters.' using errcode = '22023';
  end if;
  if v_new !~ '[A-Za-z]' or v_new !~ '[0-9]' then
    raise exception 'Include at least one letter and one number.' using errcode = '22023';
  end if;
  if p_confirm is not null and v_new <> p_confirm then
    raise exception 'Passwords do not match.' using errcode = '22023';
  end if;

  v_current := coalesce(p_current_password, '');
  if v_row.password_hash is not null then
    if v_current = '' or (crypt(v_current, v_row.password_hash) = v_row.password_hash) is not true then
      raise exception 'Current password incorrect.' using errcode = '45009';
    end if;
  end if;

  update public.gym_users
     set password_hash        = crypt(v_new, gen_salt('bf')),
         password_changed_at  = now(),
         password_must_change = false
   where id = p_user_id;

  return jsonb_build_object('ok', true, 'user_id', v_row.id);
end;
$$;

create or replace function public.fn_member_issue_temp_password(
  p_owner_identifier text,
  p_owner_password   text,
  p_member_id        uuid,
  p_temp_password    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner jsonb;
  v_row   public.members%rowtype;
  v_temp  text := coalesce(p_temp_password, '');
begin
  if p_member_id is null then raise exception 'member_id is required' using errcode = '22023'; end if;
  v_owner := public.fn_staff_verify_password(p_owner_identifier, p_owner_password);
  if v_owner is null or coalesce(v_owner->>'role', '') not in ('owner', 'super_admin') then
    raise exception 'Unauthorized' using errcode = '45005';
  end if;

  select * into v_row from public.members m where m.id = p_member_id;
  if v_row.id is null or v_row.tenant_id is distinct from nullif(v_owner->>'tenant_id', '')::uuid then
    raise exception 'Member not found in your gym' using errcode = 'P0002';
  end if;

  if v_temp = '' or octet_length(v_temp) > 72 then
    raise exception 'Invalid temp password' using errcode = '22023';
  end if;

  update public.members
     set password_hash            = crypt(v_temp, gen_salt('bf')),
         password_changed_at      = now(),
         password_must_change     = true,
         password_setup_completed = false
   where id = p_member_id;

  return jsonb_build_object('ok', true, 'member_id', v_row.id);
end;
$$;

grant execute on function 
  public.fn_staff_verify_password(text, text),
  public.fn_member_verify_password(text, text),
  public.fn_member_set_password(uuid, text, text, text),
  public.fn_staff_set_password(uuid, text, text, text),
  public.fn_member_issue_temp_password(text, text, uuid, text)
to anon, authenticated;

-- =============================================================================
-- 5. Strict Verification
-- =============================================================================
do $$
declare
  v_bad text[] := array[]::text[];
begin
  if has_column_privilege('anon', 'public.members', 'password_hash', 'SELECT') then
    v_bad := array_append(v_bad, 'anon can STILL select members.password_hash');
  end if;
  if has_column_privilege('anon', 'public.gym_users', 'password_hash', 'SELECT') then
    v_bad := array_append(v_bad, 'anon can STILL select gym_users.password_hash');
  end if;

  if cardinality(v_bad) > 0 then
    raise exception 'Phase 13 verification failed: %', array_to_string(v_bad, '; ');
  end if;
  raise notice 'Phase 13 applied cleanly.';
end $$;

commit;