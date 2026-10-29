import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/admin/payments/collect — record a fee payment and issue a receipt.
 *
 * Body:
 *   { member_id?, member_name, member_phone, amount, payment_method, tenant_id }
 *
 * If member_id is supplied, the member record is fetched to guarantee an
 * accurate member_name and member_phone before inserting the invoice.
 *
 * When member_id is present, the member's membership is extended by 30 days
 * and their status is set to 'active'.
 *
 * Tenant scope is enforced on every write.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const memberId = payload.member_id ? String(payload.member_id) : null;
  const memberName = String(payload.member_name ?? '').trim();
  const memberPhone = String(payload.member_phone ?? '').trim();
  const amount = Number(payload.amount);
  const paymentMethod = String(payload.payment_method ?? 'cash').trim();
  const tenantId =
    String(payload.tenant_id ?? payload.tenantId ?? '') ||
    readTenantCookie(request);

  if (!tenantId || !isUuid(tenantId)) {
    return badRequest(
      'Missing or malformed tenant_id. Sign in again to refresh your gym scope.',
      403
    );
  }

  if (!memberName) return badRequest('member_name is required.');
  if (!amount || amount <= 0) return badRequest('amount must be greater than zero.');

  try {
    // If member_id supplied, verify the member exists and pull authoritative name/phone.
    let resolvedName = memberName;
    let resolvedPhone = memberPhone;

    if (memberId && isUuid(memberId)) {
      const { data: member, error: memberError } = await supabaseAdmin
        .from('members')
        .select('full_name, phone, membership_end, status')
        .eq('id', memberId)
        .eq('tenant_id', tenantId)
        .single();

      if (memberError || !member) {
        return badRequest('Member not found in this gym.');
      }

      resolvedName = member.full_name ?? memberName;
      resolvedPhone = member.phone ?? memberPhone;

      // Extend membership by 30 days and mark active.
      const { error: extendError } = await supabaseAdmin
        .from('members')
        .update({
          membership_end: `(
            CASE
              WHEN membership_end > now() THEN membership_end + interval '30 days'
              ELSE now() + interval '30 days'
            END
          )`,
          status: 'active',
        })
        .eq('id', memberId)
        .eq('tenant_id', tenantId);

      if (extendError) return databaseError(extendError, 'Could not extend membership.');
    }

    // Insert the invoice / receipt.
    const { error: insertError } = await supabaseAdmin
      .from('invoices')
      .insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        member_id: memberId ?? null,
        member_name: resolvedName,
        member_phone: resolvedPhone,
        amount,
        payment_method: paymentMethod,
        status: 'paid',
        issued_at: new Date().toISOString(),
      });

    if (insertError) return databaseError(insertError, 'Could not record invoice.');

    return NextResponse.json({
      ok: true,
      member_name: resolvedName,
      member_phone: resolvedPhone,
      amount,
      payment_method: paymentMethod,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not collect fee.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}