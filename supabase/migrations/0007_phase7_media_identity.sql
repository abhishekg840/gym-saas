-- =============================================================================
-- Phase 7 — Supabase Storage for product photos & avatars, plus a profiles table
-- =============================================================================
-- Until now the app had no image column anywhere: the catalogue is emoji tiles
-- and the header avatars are initials. This migration adds the server side of
-- media support:
--
--   1. two public storage buckets  -> product-images (<=5MB) and avatars (<=2MB),
--      with policies scoped to just those buckets,
--   2. public.products.image_url   -> where the till stores a product photo,
--   3. public.profiles             -> one avatar row per signed-in identity.
--
-- Everything here is idempotent so it can be re-run from the SQL editor.
--
-- Trust model matches the rest of the schema: the app signs in with the anon
-- key plus a client-held session, so the policies below admit `anon`. The
-- buckets only ever hold pictures; nothing sensitive lives behind them.
--
-- Run order: after 0006_phase5_identity_streak_pos.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Storage buckets
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 5242880,
     array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']),
  ('avatars', 'avatars', true, 2097152,
     array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do nothing;

comment on column storage.buckets.file_size_limit is
  'Product photos up to 5MB, avatars up to 2MB — the client mirrors these limits.';

-- Policies on storage.objects are additive; name them uniquely and make each
-- one a no-op on re-run.
drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('product-images', 'avatars'));

drop policy if exists "media insert" on storage.objects;
create policy "media insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id in ('product-images', 'avatars'));

drop policy if exists "media update" on storage.objects;
create policy "media update" on storage.objects
  for update to anon, authenticated
  using (bucket_id in ('product-images', 'avatars'))
  with check (bucket_id in ('product-images', 'avatars'));

drop policy if exists "media delete" on storage.objects;
create policy "media delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id in ('product-images', 'avatars'));


-- -----------------------------------------------------------------------------
-- 2. Product photo on the catalogue
-- -----------------------------------------------------------------------------
-- Holds the public URL returned by storage. null = emoji tile, which stays the
-- fallback for gyms that never upload photos.
alter table public.products
  add column if not exists image_url text;

comment on column public.products.image_url is
  'Public Supabase Storage URL of the product photo, or null for no photo.';


-- -----------------------------------------------------------------------------
-- 3. profiles — one row per identity, holding the avatar
-- -----------------------------------------------------------------------------
-- Deliberately NOT keyed off a single table: user_id is the gym_users id for
-- staff and the members id for members (the polymorphic id already carried in
-- GymSession.userId), so one row serves both kinds of sign-in.
create table if not exists public.profiles (
  user_id    uuid primary key,
  tenant_id  uuid,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_tenant_fk
    foreign key (tenant_id) references public.tenants (id) on delete set null,
  constraint profiles_avatar_len
    check (avatar_url is null or char_length(avatar_url) <= 1000)
);

comment on table public.profiles is
  'Avatar (and later prefs) for a signed-in identity. user_id is members.id for members and gym_users.id for staff.';

-- The client reads its own row and uploads its own avatar, the same way it
-- already touches members/products through the anon key. Delete stays with the
-- desk: nothing in the app removes a profile.
grant select, insert, update on public.profiles to anon, authenticated;
