import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/admin/payments/collect — record a membership fee payment and issue a receipt.
 *
 * Body:
 *   { member_id, tenant_id, plan_name, duration_days, total_fee, amount_paid, discount, payment_method, notes }
 *
 * Plan Duration Logic:
 *   - Extends membership_end by duration_days (30 Monthly, 90 Quarterly, 180 Half-Yearly, 365 Annual, 0 = balance clear only).
 *   - If membership_end is in the future, adds duration_days to the existing end date.
 *   - If expired, starts the new period from now().
 *
 * Partial Payment / Balance Due Logic:
 *   - pending_balance = Math.max(0, (total_fee - discount) - amount_paid)
 *   - Member status is set to 'active' (unblocking gate/RFID/QR access).
 *   - plan_name (or plan) and amount_paid are updated on the member record.
 *
 * Invoice Insertion:
 *   - status = 'partial' when pending_balance > 0, otherwise 'paid'.
 *
 * Tenant scope is enforced on every write.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const memberId = payload.member_id ? String(payload.member_id) : null;
  const tenantId =
    String(payload.tenant_id ?? payload.tenantId ?? '') ||
    readTenantCookie(request);
  const planName = String(payload.plan_name ?? '').trim() || null;
  const durationDays = Number(payload.duration_days) || 0;
  const totalFee = Number(payload.total_fee) || 0;
  const amountPaid = Number(payload.amount_paid) || 0;
  const discount = Number(payload.discount) || 0;
  const paymentMethod = String(payload.payment_method ?? 'cash').trim();
  const notes = String(payload.notes ?? '').trim() || null;

  if (!tenantId || !isUuid(tenantId)) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  if (!memberId || !isUuid(memberId)) {
    return badRequest('member_id is required.');
  }

  if (!amountPaid || amountPaid <= 0) {
    return badRequest('amount_paid must be greater than zero.');
  }

  try {
    // Verify the member exists and pull authoritative details.
    const { data: member, error: memberError } = await supabaseAdmin
      .from('members')
      .select('id, full_name, phone, membership_end, status, plan_id, tenant_id')
      .eq('id', memberId)
      .eq('tenant_id', tenantId)
      .single();

    if (memberError || !member) {
      return badRequest('Member not found in this gym.');
    }

    // --- Plan duration logic ---
    const now = new Date();
    const currentEnd = member.membership_end ? new Date(member.membership_end) : null;
    let newMembershipEnd: string;

    if (durationDays === 0) {
      // Balance clearance only — keep existing end date (or now if none).
      newMembershipEnd = currentEnd ? currentEnd.toISOString().split('T')[0] : now.toISOString().split('T')[0];
    } else if (currentEnd && currentEnd > now) {
      // Extend from the existing end date (renewal before expiry).
      newMembershipEnd = new Date(
        currentEnd.getTime() + durationDays * 86_400_000
      ).toISOString().split('T')[0];
    } else {
      // Expired or no end date — start from now.
      newMembershipEnd = new Date(
        now.getTime() + durationDays * 86_400_000
      ).toISOString().split('T')[0];
    }

    // --- Partial payment / balance due logic ---
    const pendingBalance = Math.max(0, (totalFee - discount) - amountPaid);

    // Build the member update with graceful fallback for schema columns
    const baseMemberUpdate: Record<string, unknown> = {
      status: 'active',
      membership_end: newMembershipEnd,
    };

    const fullMemberUpdate: Record<string, unknown> = {
      ...baseMemberUpdate,
      amount_paid: amountPaid,
      ...(planName ? { plan_name: planName } : {}),
    };

    let { error: updateError } = await supabaseAdmin
      .from('members')
      .update(fullMemberUpdate)
      .eq('id', memberId)
      .eq('tenant_id', tenantId);

    if (updateError) {
      // Fallback 1: try without plan_name but with amount_paid
      const updateWithoutPlanName = {
        ...baseMemberUpdate,
        amount_paid: amountPaid,
      };
      const resFallback1 = await supabaseAdmin
        .from('members')
        .update(updateWithoutPlanName)
        .eq('id', memberId)
        .eq('tenant_id', tenantId);

      if (resFallback1.error) {
        // Fallback 2: minimal base updates
        const resFallback2 = await supabaseAdmin
          .from('members')
          .update(baseMemberUpdate)
          .eq('id', memberId)
          .eq('tenant_id', tenantId);

        if (resFallback2.error) {
          return databaseError(resFallback2.error, 'Could not update membership.');
        }
      }
    }

    // --- Invoice insertion ---
    const invoiceStatus = pendingBalance > 0 ? 'partial' : 'paid';
    const invoiceData: Record<string, unknown> = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      member_id: memberId,
      member_name: member.full_name,
      member_phone: member.phone,
      amount: amountPaid,
      payment_method: paymentMethod,
      status: invoiceStatus,
      notes,
      issued_at: new Date().toISOString(),
    };

    let { error: insertError } = await supabaseAdmin
      .from('invoices')
      .insert(invoiceData);

    if (insertError) {
      // Retry without optional notes column
      delete invoiceData.notes;
      const res2 = await supabaseAdmin.from('invoices').insert(invoiceData);
      if (res2.error) {
        // Retry with minimal columns
        const minimalInvoice = {
          tenant_id: tenantId,
          member_id: memberId,
          amount: amountPaid,
          payment_method: paymentMethod,
          status: invoiceStatus,
        };
        const res3 = await supabaseAdmin.from('invoices').insert(minimalInvoice);
        if (res3.error) {
          return databaseError(res3.error, 'Could not record invoice.');
        }
      }
    }

    return NextResponse.json({
      ok: true,
      member_id: memberId,
      member_name: member.full_name,
      membership_end: newMembershipEnd,
      pending_balance: pendingBalance,
      amount_paid: amountPaid,
      status: invoiceStatus,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not collect fee.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
