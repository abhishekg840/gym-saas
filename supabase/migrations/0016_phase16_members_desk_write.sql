begin;

-- =============================================================================
-- Phase 16 -- desk writes to `members` (INSERT/UPDATE RLS) and default member
-- credentials.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Phase 14 section 5 enabled RLS on public.members and created ONLY a SELECT
-- policy -- deliberately, because permissive write policies on an anon-readable
-- table were exactly the leak it was fixing. What that stance left behind:
--
--   1. The /admin "New Member Enrollment" form writes through the anon-key
--      PostgREST client. Every INSERT is refused by Postgres with:
--
--          new row violates row-level security policy for table 'members'
--
--      The same wall blocks the desk's direct renew UPDATE (renewMember).
--      No application change can fix this: the policies do not exist, so they
--      are created here.
--
--   2. Enrolment only ever inserted into public.members. Credentials live in
--      private.member_credentials (Phase 14), which the anon key cannot reach,
--      so a freshly enrolled member had NO password_hash -- and the verifiers
--      deliberately answer NULL for a missing hash, indistinguishable from a
--      wrong password. The member existed but could not sign in until somebody
--      re-ran the Phase 15 backfill by hand.
--
-- THE FIX
-- -------
--   * Explicit table grants plus two permissive policies, members_insert_all
--     and members_update_all, so the desk's direct writes pass RLS.
--   * fn_member_seed_default_password plus an AFTER INSERT trigger, so EVERY
--     provisioning path (the desk form, fn_lead_convert_to_member, the transfer
--     function in Phase 1, a raw INSERT in the SQL editor) gives the new member
--     the desk default '1234' flagged password_must_change, without each path
--     remembering to mint one -- the same rule Phase 5's username trigger
--     (fn_members_assign_username in 0006) established. Seeding inside the
--     insert also makes enrolment atomic: either the member exists AND can sign
--     in, or the INSERT fails and the desk sees the error.
--   * A blank-only backfill for members enrolled before now. Same statement
--     shape as Phase 15 section 4, except the conflict clause fills a credential
--     row that exists with a NULL hash instead of skipping it (`do nothing`
--     could leave such a member unreachable forever).
--
-- SECURITY NOTES
-- --------------
--   * The seed function NEVER overwrites a credential that already exists.
--     That invariant is what makes it safe to grant to the anon key: the most
--     a caller can do is give a member who cannot sign in at all the same
--     shared default the Phase 15 backfill already handed out, and the very
--     next sign-in forces a replacement (password_must_change = true).
--   * Deliberately NO DELETE policy. The desk's delete button is guarded only
--     by a client-side role check, which is not a security boundary; owner
--     verification must happen server-side -- the way
--     fn_member_issue_temp_password proves the owner's own password inside
--     Postgres -- before a permissive delete policy can even be considered.
--     A failed delete still surfaces in the UI as an error, which is correct.
--   * Residual risk, accepted deliberately: with `with check (true)` any holder
--     of the anon key can insert or update ANY member row, including another
--     tenant's. Every desk write already works this way (client-side tenant
--     scoping only). Closing that properly means moving enrolment behind a
--     tenant-checked server route -- a larger refactor than this fix, noted
--     here so the trade-off is on the record rather than accidental.
--
-- Run once. Safe to re-run: every step is guarded or idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table-level grants. A GRANT and an RLS policy are two separate gates and
--    BOTH must be open. 0013/0014 only ever touched SELECT on this table, so
--    this makes the write grants explicit instead of relying on Supabase's
--    default privileges being intact.
-- -----------------------------------------------------------------------------
grant insert, update on public.members to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. RLS policies. Supersedes the "Deliberately SELECT-only" stance of 0014
--    section 5: the desk now writes from the browser, so SELECT-only was
--    bricking enrolment with 42501. Guarded by pg_policies -- a re-run is a
--    no-op rather than a duplicate-policy error.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'members' and policyname = 'members_insert_all'
  ) then
    create policy members_insert_all on public.members
      for insert to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'members' and policyname = 'members_update_all'
  ) then
    create policy members_update_all on public.members
      for update to anon, authenticated
      using (true) with check (true);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Default credential seeding for every new member.
--
--    fn_member_set_password deliberately CANNOT do this job: it enforces 8-72
--    characters with a letter and a number (so '1234' is rejected) and it
--    clears password_must_change (correct for a password the member chose,
--    wrong for a shared desk default). And fn_member_issue_temp_password
--    requires the owner to prove their own password, which the desk session
--    does not carry. So this phase adds the one function that expresses
--    "shared default, must be replaced at first sign-in".
-- -----------------------------------------------------------------------------
create or replace function public.fn_member_seed_default_password(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_member_id is null then
    raise exception 'member_id is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.members m where m.id = p_member_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  -- THE INVARIANT: never overwrite a credential that already exists. A caller
  -- (this function is granted to the anon key) must not be able to reset a
  -- known member's password to the shared default -- that would be account
  -- takeover. Only a member who cannot sign in AT ALL is seeded.
  if exists (
    select 1 from private.member_credentials c
     where c.member_id = p_member_id
       and c.password_hash is not null
  ) then
    return jsonb_build_object('ok', true, 'seeded', false, 'member_id', p_member_id);
  end if;

  insert into private.member_credentials (member_id, password_hash, password_changed_at, password_must_change)
  values (p_member_id, crypt('1234', gen_salt('bf')), now(), true)
  on conflict (member_id) do update
     -- coalesce(existing, excluded): a re-run can never blank a hash that is
     -- already stored -- the same rule as the 0014 section 2a move.
     set password_hash        = coalesce(private.member_credentials.password_hash, excluded.password_hash),
         password_changed_at  = coalesce(private.member_credentials.password_changed_at, excluded.password_changed_at),
         password_must_change = true;

  -- The UI flag has to agree with the credential, or the member is shown a
  -- "password already set" screen for a credential they have never seen.
  update public.members set password_setup_completed = false where id = p_member_id;

  return jsonb_build_object('ok', true, 'seeded', true, 'member_id', p_member_id, 'password_must_change', true);
end;
$$;

comment on function public.fn_member_seed_default_password(uuid) is
  'Seeds the desk default password (1234, must change at first sign-in) for a member who has NO credential yet. Never overwrites an existing hash.';

grant execute on function public.fn_member_seed_default_password(uuid) to anon, authenticated;

-- The trigger arm: fires on EVERY insert into public.members, so no future
-- provisioning path can create an unreachable member by forgetting to seed.
-- Mirrors the structure of Phase 5's fn_members_assign_username (0006).
create or replace function public.fn_members_seed_password()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.fn_member_seed_default_password(new.id);
  return new;
end;
$$;

comment on function public.fn_members_seed_password() is
  'AFTER INSERT trigger: seeds the default member credential for every new member row.';

drop trigger if exists trg_members_seed_password on public.members;
create trigger trg_members_seed_password
  after insert on public.members
  for each row execute function public.fn_members_seed_password();

-- -----------------------------------------------------------------------------
-- 4. One-time backfill: members enrolled BEFORE this migration with no usable
--    credential (the desk form has been failing since Phase 13, but lead
--    conversion and the transfer function kept inserting members with no way
--    to sign in). `on conflict do update` with coalesce(existing, excluded)
--    fills a NULL-hash row without ever blanking one that exists.
-- -----------------------------------------------------------------------------
insert into private.member_credentials (member_id, password_hash, password_changed_at, password_must_change)
select m.id, crypt('1234', gen_salt('bf')), now(), true
  from public.members m
 where not exists (
   select 1 from private.member_credentials c
    where c.member_id = m.id
      and c.password_hash is not null
 )
on conflict (member_id) do update
   set password_hash        = coalesce(private.member_credentials.password_hash, excluded.password_hash),
       password_changed_at  = coalesce(private.member_credentials.password_changed_at, excluded.password_changed_at),
       password_must_change = true;

-- The UI flag has to agree with the credential (same rule as Phase 15 4b).
update public.members m
   set password_setup_completed = false
 where coalesce(m.password_setup_completed, false) is not false
   and exists (
     select 1 from private.member_credentials c
      where c.member_id = m.id
        and c.password_must_change
   );

-- =============================================================================
-- 5. Verification -- fail the migration loudly (and roll the whole thing back)
--    rather than leaving a half-repaired database behind. Each check names the
--    symptom it prevents.
-- =============================================================================
do $$
declare
  v_bad text[] := array[]::text[];
  v_credentialless bigint;
begin
  -- (a) Both gates must be open: GRANT and policy.
  if not has_table_privilege('anon', 'public.members', 'INSERT')
     or not has_table_privilege('anon', 'public.members', 'UPDATE') then
    v_bad := array_append(v_bad, 'anon lacks INSERT/UPDATE on public.members (table grants missing)');
  end if;
  if not has_table_privilege('authenticated', 'public.members', 'INSERT')
     or not has_table_privilege('authenticated', 'public.members', 'UPDATE') then
    v_bad := array_append(v_bad, 'authenticated lacks INSERT/UPDATE on public.members (table grants missing)');
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'members'
                    and policyname = 'members_insert_all' and cmd = 'INSERT') then
    v_bad := array_append(v_bad, 'policy members_insert_all is missing (desk enrolment would still fail with 42501)');
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'members'
                    and policyname = 'members_update_all' and cmd = 'UPDATE') then
    v_bad := array_append(v_bad, 'policy members_update_all is missing (desk renew would still fail with 42501)');
  end if;

  -- (b) The seeding path: function, trigger function, and the trigger itself.
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_member_seed_default_password'
  ) then
    v_bad := array_append(v_bad, 'fn_member_seed_default_password is missing');
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_members_seed_password'
  ) then
    v_bad := array_append(v_bad, 'fn_members_seed_password trigger function is missing');
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c     on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'members'
       and t.tgname = 'trg_members_seed_password' and not t.tgisinternal
  ) then
    v_bad := array_append(v_bad, 'trg_members_seed_password is missing (new members would enrol without a credential)');
  end if;

  -- (c) crypt() must resolve inside the seeder: proconfig is the authoritative
  --     record of the SET clause, so this fails if a future edit drops
  --     extensions from the search_path (the 0014 42883 bug all over again).
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join unnest(coalesce(p.proconfig, array[]::text[])) as cfg(cfg) on true
     where n.nspname = 'public' and p.proname = 'fn_member_seed_default_password'
       and cfg like 'search_path=%extensions%'
  ) then
    v_bad := array_append(v_bad, 'fn_member_seed_default_password search_path does not include extensions (crypt() would 42883)');
  end if;

  -- (d) The point of section 4: no member may remain without a usable
  --     credential, or that member cannot sign in at all.
  select count(*) into v_credentialless
    from public.members m
   where not exists (
     select 1 from private.member_credentials c
      where c.member_id = m.id
        and c.password_hash is not null
   );
  if v_credentialless > 0 then
    v_bad := array_append(v_bad, v_credentialless || ' member(s) still have no usable credential after the backfill');
  end if;

  if cardinality(v_bad) > 0 then
    raise exception 'Phase 16 verification failed: %', array_to_string(v_bad, '; ');
  end if;

  raise notice 'Phase 16 applied cleanly: members INSERT/UPDATE policies in place, default credentials seeded for every member.';
end $$;

commit;

