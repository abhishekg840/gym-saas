import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isUuid, readTenantCookie } from '@/lib/session';
import { badRequest, databaseError, readJsonBody } from '@/lib/sqlstate';
import { isProductCategory, type Order, type OrderLine } from '@/lib/crm';

/**
 * /api/store — inventory and sales history (Module 3.4).
 *
 *   GET    ?tenant_id=...&orders=25      -> { ok, products[], orders[] }
 *   POST   { tenant_id, name, ... }      -> { ok, product }
 *   PATCH  { tenant_id, product_id, ...}  -> { ok, product }   (edit or restock)
 *   DELETE { tenant_id, product_id }     -> { ok, deleted }
 *
 * Selling is NOT here: a sale must move stock and write the order in one
 * transaction, so it lives in /api/store/checkout (fn_store_checkout).
 *
 * PATCH accepts either stock_quantity (absolute correction after a stocktake) or
 * add_stock (a delivery arriving). A delta is applied in SQL so two people
 * receiving stock at once do not overwrite one another.
 */

const MAX_NAME = 80;
const MAX_SKU = 40;
const MAX_MONEY = 10_000_000;
const MAX_UNITS = 1_000_000;

const MISSING_TENANT =
  'Missing or malformed tenant_id. Sign in again to refresh your gym scope.';

const PRODUCT_COLUMNS =
  'id, name, category, cost_price, selling_price, stock_quantity, low_stock_threshold, sku, created_at';

function resolveTenant(candidates: Array<unknown>, request: Request): string | null {
  for (const candidate of candidates) {
    if (isUuid(candidate)) return candidate;
  }
  return readTenantCookie(request);
}

/** Money as a number, rounded to paise. null = unusable input. */
function parseMoney(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONEY) return null;
  return Math.round(value * 100) / 100;
}

/** A whole, non-negative unit count. null = unusable input. */
function parseUnits(raw: unknown, max = MAX_UNITS): number | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isInteger(value) || value < 0 || value > max) return null;
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = resolveTenant([url.searchParams.get('tenant_id')], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  // The till sees the last few sales; the parameter is clamped so a hand-written
  // ?orders=100000 cannot turn this endpoint into a full-table dump.
  const requested = Number(url.searchParams.get('orders') ?? 25);
  const orderLimit = Number.isInteger(requested) ? Math.min(Math.max(requested, 0), 100) : 25;

  const productsPromise = supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
    .limit(500);

  const ordersPromise =
    orderLimit > 0
      ? supabase
          .from('orders')
          .select('id, member_id, total_amount, payment_method, items, created_at, members(full_name)')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(orderLimit)
      : Promise.resolve({ data: [], error: null });

  const [productsResult, ordersResult] = await Promise.all([productsPromise, ordersPromise]);

  if (productsResult.error) {
    return databaseError(productsResult.error, 'Could not load the store inventory.');
  }
  if (ordersResult.error) {
    return databaseError(ordersResult.error, 'Could not load recent sales.');
  }

  const orders: Order[] = ((ordersResult.data ?? []) as unknown[]).map((row) => {
    const item = row as {
      id: string;
      member_id: string | null;
      total_amount: number;
      payment_method: string;
      items: OrderLine[];
      created_at: string;
      members?: { full_name: string } | { full_name: string }[] | null;
    };
    const member = Array.isArray(item.members) ? (item.members[0] ?? null) : (item.members ?? null);
    return {
      id: item.id,
      member_id: item.member_id,
      total_amount: Number(item.total_amount),
      payment_method: item.payment_method,
      items: Array.isArray(item.items) ? item.items : [],
      created_at: item.created_at,
      member_name: member?.full_name ?? null,
    };
  });

  return NextResponse.json({ ok: true, products: productsResult.data ?? [], orders });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const name = String(body.name ?? '').trim();
  if (!name) return badRequest('name is required.');
  if (name.length > MAX_NAME) return badRequest(`name must be ${MAX_NAME} characters or fewer.`);

  const category = body.category;
  if (!isProductCategory(category)) {
    return badRequest(
      'category must be one of: protein, supplements, merchandise, beverages, gear.'
    );
  }

  const costPrice = parseMoney(body.cost_price ?? body.costPrice ?? 0);
  if (costPrice === null) return badRequest('cost_price must be a number of 0 or more.');

  const sellingPrice = parseMoney(body.selling_price ?? body.sellingPrice);
  if (sellingPrice === null) return badRequest('selling_price must be a number of 0 or more.');

  const stockQuantity = parseUnits(body.stock_quantity ?? body.stockQuantity ?? 0);
  if (stockQuantity === null) {
    return badRequest(`stock_quantity must be a whole number between 0 and ${MAX_UNITS}.`);
  }

  const thresholdRaw = body.low_stock_threshold ?? body.lowStockThreshold ?? 5;
  const threshold = parseUnits(thresholdRaw, 100_000);
  if (threshold === null) {
    return badRequest('low_stock_threshold must be a whole number of 0 or more.');
  }

  const sku = String(body.sku ?? '').trim().slice(0, MAX_SKU) || null;

  const { data, error } = await supabase
    .from('products')
    .insert({
      tenant_id: tenantId,
      name,
      category,
      cost_price: costPrice,
      selling_price: sellingPrice,
      stock_quantity: stockQuantity,
      low_stock_threshold: threshold,
      sku,
    })
    .select(PRODUCT_COLUMNS)
    .single();

  if (error) return databaseError(error, 'Could not add this product.');
  return NextResponse.json({ ok: true, product: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const productId = body.product_id ?? body.productId;
  if (!isUuid(productId)) return badRequest('product_id must be a valid UUID.');

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) return badRequest('name cannot be empty.');
    if (name.length > MAX_NAME) return badRequest(`name must be ${MAX_NAME} characters or fewer.`);
    patch.name = name;
  }

  if (body.category !== undefined) {
    if (!isProductCategory(body.category)) {
      return badRequest(
        'category must be one of: protein, supplements, merchandise, beverages, gear.'
      );
    }
    patch.category = body.category;
  }

  if (body.cost_price !== undefined || body.costPrice !== undefined) {
    const costPrice = parseMoney(body.cost_price ?? body.costPrice);
    if (costPrice === null) return badRequest('cost_price must be a number of 0 or more.');
    patch.cost_price = costPrice;
  }

  if (body.selling_price !== undefined || body.sellingPrice !== undefined) {
    const sellingPrice = parseMoney(body.selling_price ?? body.sellingPrice);
    if (sellingPrice === null) return badRequest('selling_price must be a number of 0 or more.');
    patch.selling_price = sellingPrice;
  }

  if (body.stock_quantity !== undefined || body.stockQuantity !== undefined) {
    const stockQuantity = parseUnits(body.stock_quantity ?? body.stockQuantity);
    if (stockQuantity === null) {
      return badRequest(`stock_quantity must be a whole number between 0 and ${MAX_UNITS}.`);
    }
    patch.stock_quantity = stockQuantity;
  }

  if (body.low_stock_threshold !== undefined || body.lowStockThreshold !== undefined) {
    const threshold = parseUnits(body.low_stock_threshold ?? body.lowStockThreshold, 100_000);
    if (threshold === null) {
      return badRequest('low_stock_threshold must be a whole number of 0 or more.');
    }
    patch.low_stock_threshold = threshold;
  }

  if (body.sku !== undefined) {
    patch.sku = String(body.sku ?? '').trim().slice(0, MAX_SKU) || null;
  }

  const deltaRaw = body.add_stock ?? body.addStock;
  const hasDelta = deltaRaw !== undefined && deltaRaw !== null && deltaRaw !== '';
  const delta = hasDelta ? Number(deltaRaw) : 0;

  if (hasDelta && (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_UNITS)) {
    return badRequest(`add_stock must be a non-zero whole number within ±${MAX_UNITS}.`);
  }

  if (Object.keys(patch).length === 0 && !hasDelta) {
    return badRequest(
      'Nothing to update. Send name, category, cost_price, selling_price, stock_quantity, low_stock_threshold, sku or add_stock.'
    );
  }

  if (hasDelta) {
    const { data: row, error: readError } = await supabase
      .from('products')
      .select('stock_quantity')
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (readError) return databaseError(readError, 'Could not read the current stock.');
    if (!row) {
      return NextResponse.json({ ok: false, error: 'Product not found in this gym.' }, { status: 404 });
    }

    // A correction that would drive the shelf negative is refused with a
    // sentence here instead of surfacing as a raw CHECK violation.
    const next = Number(row.stock_quantity) + delta;
    if (next < 0) {
      return badRequest(`Cannot remove ${Math.abs(delta)}: only ${row.stock_quantity} in stock.`);
    }
    patch.stock_quantity = next;
  }

  const { data, error } = await supabase
    .from('products')
    .update(patch)
    .eq('id', productId)
    .eq('tenant_id', tenantId)
    .select(PRODUCT_COLUMNS)
    .maybeSingle();

  if (error) return databaseError(error, 'Could not update this product.');
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Product not found in this gym.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, product: data });
}

export async function DELETE(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenantId = resolveTenant([body.tenant_id, body.tenantId], request);
  if (!tenantId) return badRequest(MISSING_TENANT, 403);

  const productId = body.product_id ?? body.productId;
  if (!isUuid(productId)) return badRequest('product_id must be a valid UUID.');

  // Safe to remove: a past sale keeps its own name/price snapshot inside
  // orders.items, so deleting a catalogue entry cannot rewrite a receipt.
  const { data, error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)
    .eq('tenant_id', tenantId)
    .select('id')
    .maybeSingle();

  if (error) return databaseError(error, 'Could not remove this product.');
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Product not found in this gym.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: true, product_id: data.id });
}


