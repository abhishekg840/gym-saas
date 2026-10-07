-- ============================================================================
-- Phase 19 — consume the capture: clear last_scanned_uid after a successful tap
-- ============================================================================
--
-- THE DEFECT
-- fn_hardware_capture_enrollment (0012) stores the tapped UID on
-- hardware_devices and leaves it there after the desk's modal has read it.
-- A leftover value can refill the input on a LATER modal opening while it is
-- still fresh (<60s), so the owner could "tap" a card that was never presented
-- this session. Clear-on-arm only covers the row the NEXT session arms: with
-- two terminals (the RFID reader and the R307 fingerprint unit are separate
-- devices with separate API keys) the capture can sit on the row that the next
-- window does not arm. So the consumer clears the exact row it just read.
--
-- WHY AN RPC AND NOT A DIRECT UPDATE
-- hardware_devices is revoked from anon/authenticated (0003) because api_key
-- lives there, and lib/supabase.ts is built on the ANON key — a direct
-- .from('hardware_devices').update(...) answers "permission denied for table
-- hardware_devices" (the failure app/api/hardware/fingerprint documents).
-- SECURITY DEFINER plus the tenant match inside the UPDATE is the same shape
-- as every other writer in this schema.
--
-- The call is best-effort by design: if it never lands, the 60s freshness gate
-- on the poll and fn_hardware_begin_enrollment's clear-on-arm still prevent a
-- stale refill, so a dropped clear degrades to "slightly stale" and never to
-- "wrong card".

begin;

create or replace function public.fn_hardware_clear_enrollment_capture(
  p_tenant_id uuid,
  p_device_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null or p_device_id is null then
    raise exception 'tenant_id and device_id are required' using errcode = '22023';
  end if;

  -- Tenant is matched in the UPDATE itself, so a device belonging to another
  -- gym can never be cleared from here. `found` reports whether anything was
  -- actually consumed; clearing an already-clean row is a no-op, not an error.
  update public.hardware_devices
     set last_scanned_uid = null,
         last_scanned_at  = null
   where id = p_device_id
     and tenant_id = p_tenant_id;

  return jsonb_build_object('ok', true, 'cleared', found);
end;
$$;

comment on function public.fn_hardware_clear_enrollment_capture(uuid, uuid) is
  'Nulls a consumed enrollment capture on one of this gym''s terminals so a stale tap cannot refill a later modal. No-op when nothing was captured.';

grant execute on function public.fn_hardware_clear_enrollment_capture(uuid, uuid)
to anon, authenticated;

commit;