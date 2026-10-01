import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';

/**
 * POST /api/store/checkout — the till (Module 3.4).
 *
 * Body: { tenant_id, member_id?, payment_method?, items: [{ product_id, quantity }] }
 * Reply: { ok, receipt }
 *
 * The whole sale is one call to fn_store_checkout, which locks each product row,
 * decrements the stock, writes the order with a frozen receipt, and mirrors the
 * takings into the revenue ledger. There is deliberately no client-side stock
 * decrement anywhere in this app: two browsers selling the last tub must not be
 * able to both succeed.
 *
 * A guest sale omits member_id and is still recorded — it simply carries no
 * member link, so walk-in shaker money shows up in the day's takings too.
 */

const MAX_LINES = 50;
const MAX_QTY = 9999;
const MAX_METHOD = 30;

const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

interface CartLine {
  product_id: string;
  quantity: number;
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const rawTenant = body.tenant_id ?? body.tenantId;
  const tenantId = isUuid(rawTenant) ? rawTenant : readTenantCookie(request);
  if (!tenantId || !isUuid(tenantId)) return badRequest(MISSING_TENANT, 403);

  const rawItems = body.items ?? body.lines ?? body.cart;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return badRequest('items must be a non-empty array of { product_id, quantity }.');
  }
  if (rawItems.length > MAX_LINES) {
    return badRequest(`A single sale can hold at most ${MAX_LINES} lines.`);
  }

  const lines: CartLine[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return badRequest('Every cart line must be an object with product_id and quantity.');
    }

    const item = entry as Record<string, unknown>;
    const productId = item.product_id ?? item.productId;
    if (!isUuid(productId)) {
      return badRequest('Every cart line needs a valid product_id.');
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return badRequest(`Every quantity must be a whole number between 1 and ${MAX_QTY}.`);
    }

    lines.push({ product_id: productId, quantity });
  }

  const rawMember = body.member_id ?? body.memberId;
  // An explicit but malformed member id is a mistake worth reporting, not a
  // silently-anonymous sale.
  if (rawMember !== undefined && rawMember !== null && rawMember !== '' && !isUuid(rawMember)) {
    return badRequest('member_id must be a valid UUID, or omitted for a guest sale.');
  }
  const memberId = isUuid(rawMember) ? rawMember : null;

  const paymentMethod = String(body.payment_method ?? body.paymentMethod ?? '').trim().slice(0, MAX_METHOD);

  // Branch the sale into (Module 11.2). Validated against the tenant so a
  // hand-edited session cannot stamp another gym's branch on this receipt.
  const rawBranch = body.branch_id ?? body.branchId;
  const branchId = isUuid(rawBranch) ? rawBranch : null;

  const { data, error } = await supabase.rpc('fn_store_checkout', {
    p_tenant_id: tenantId,
    p_items: lines,
    p_member_id: memberId,
    p_payment_method: paymentMethod || null,
  });

  if (error) return databaseError(error, 'Could not complete this sale.');

  const receipt = (data ?? {}) as Record<string, unknown>;
  const orderId = typeof receipt.order_id === 'string' ? receipt.order_id : null;
  const invoiceId = typeof receipt.invoice_id === 'string' ? receipt.invoice_id : null;

  // Freeze the sold lines onto the invoice so the receipt (Module 9.1) shows
  // product names and prices even after the catalogue changes, and tag both
  // rows with the branch the till was selling from. Failure here must never
  // undo a sale that already moved stock — it is a best-effort enrichment.
  const invoiceItems = Array.isArray(receipt.items)
    ? (receipt.items as Array<Record<string, unknown>>).map((line) => ({
        name: String(line.name ?? line.product_name ?? 'Item'),
        qty: Number(line.quantity ?? line.qty ?? 1),
        unit_price: Number(line.unit_price ?? line.price ?? 0),
        total: Number(line.total ?? line.line_total ?? 0),
      }))
    : null;

  if (invoiceId) {
    await supabase
      .from('invoices')
      .update({
        items: invoiceItems,
        payment_reference: orderId,
      })
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId);
  }

  if (branchId && orderId) {
    const { data: branchRow } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (branchRow) {
      await supabase.from('orders').update({ branch_id: branchId }).eq('id', orderId);
      if (invoiceId) {
        await supabase.from('invoices').update({ branch_id: branchId }).eq('id', invoiceId);
      }
    }
  }

  return NextResponse.json({ ok: true, receipt }, { status: 201 });
}
