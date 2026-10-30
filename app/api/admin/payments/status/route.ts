import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/admin/payments/status — handle membership lifecycle actions.
 *
 * Body:
 *   { member_id, tenant_id, action, days? }
 *
 * Actions:
 *   - hold_unpaid: Sets status = 'expired' (or 'blocked'), immediately revoking QR / RFID / Biometric turnstile entry.
 *   - freeze:      Sets status = 'frozen' (pauses membership days).
 *   - unfreeze:    Sets status = 'active', extends membership_end by the frozen days (or +7/+15 days).
 *
 * Uses supabaseAdmin (service role) to bypass RLS for administrative actions.
 * Tenant scope is enforced on every write.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const memberId = String(payload.member_id ?? '');
  const action = String(payload.action ?? '');
  const tenantId =
    String(payload.tenant_id ?? payload.tenantId ?? '') ||
    readTenantCookie(request);
  const days = Number(payload.days) || 0;

  if (!tenantId || !isUuid(tenantId)) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  if (!memberId || !isUuid(memberId)) {
    return badRequest('member_id is required.');
  }

  if (!action || !['hold_unpaid', 'freeze', 'unfreeze'].includes(action)) {
    return badRequest('action must be one of: hold_unpaid, freeze, unfreeze.');
  }

  try {
    // Verify the member exists in this tenant.
    const { data: member, error: memberError } = await supabaseAdmin
      .from('members')
      .select(
        'id, full_name, status, membership_end, is_frozen, freeze_start_date, freeze_end_date, total_freeze_days'
      )
      .eq('id', memberId)
      .eq('tenant_id', tenantId)
      .single();

    if (memberError || !member) {
      return badRequest('Member not found in this gym.');
    }

    const now = new Date();
    const nowStr = now.toISOString().split('T')[0];

    switch (action) {
      case 'hold_unpaid': {
        // Block gate access — mark membership as expired / blocked.
        const { error } = await supabaseAdmin
          .from('members')
          .update({ status: 'expired' })
          .eq('id', memberId)
          .eq('tenant_id', tenantId);

        if (error) return databaseError(error, 'Could not block membership.');
        break;
      }

      case 'freeze': {
        // Pause membership — freeze until freeze_end_date (or indefinitely if days === 0).
        const freezeEnd =
          days > 0
            ? new Date(now.getTime() + days * 86_400_000).toISOString().split('T')[0]
            : null;

        // Try comprehensive freeze update
        const freezeUpdate: Record<string, unknown> = {
          status: 'frozen',
          is_frozen: true,
          freeze_start_date: nowStr,
          freeze_end_date: freezeEnd,
        };

        const { error } = await supabaseAdmin
          .from('members')
          .update(freezeUpdate)
          .eq('id', memberId)
          .eq('tenant_id', tenantId);

        if (error) {
          // Fallback if freeze columns don't exist
          const { error: simpleError } = await supabaseAdmin
            .from('members')
            .update({ status: 'frozen' })
            .eq('id', memberId)
            .eq('tenant_id', tenantId);

          if (simpleError) return databaseError(simpleError, 'Could not freeze membership.');
        }
        break;
      }

      case 'unfreeze': {
        // Resume membership — extend end date by frozen days (or specified days / 7 days default if frozen), clear freeze flags.
        let extensionDays = days;
        if (extensionDays <= 0 && member.freeze_start_date) {
          const startDate = new Date(member.freeze_start_date);
          const diffMs = Math.max(0, now.getTime() - startDate.getTime());
          extensionDays = Math.ceil(diffMs / 86_400_000);
        }
        if (extensionDays <= 0) {
          extensionDays = 7; // Default grace extension
        }

        const currentEnd = member.membership_end ? new Date(member.membership_end) : now;
        const baseEnd = currentEnd > now ? currentEnd : now;
        const newEnd = new Date(baseEnd.getTime() + extensionDays * 86_400_000).toISOString().split('T')[0];

        const unfreezeUpdate: Record<string, unknown> = {
          status: 'active',
          is_frozen: false,
          freeze_end_date: null,
          membership_end: newEnd,
        };

        const { error } = await supabaseAdmin
          .from('members')
          .update(unfreezeUpdate)
          .eq('id', memberId)
          .eq('tenant_id', tenantId);

        if (error) {
          // Fallback to basic update
          const { error: simpleError } = await supabaseAdmin
            .from('members')
            .update({
              status: 'active',
              membership_end: newEnd,
            })
            .eq('id', memberId)
            .eq('tenant_id', tenantId);

          if (simpleError) return databaseError(simpleError, 'Could not unfreeze membership.');
        }
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      action,
      member_id: memberId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not update membership status.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
