import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { badRequest, readJsonBody } from '@/lib/sqlstate';
import { isUuid } from '@/lib/session';

interface ExpenseItem {
  id: string;
  tenant_id: string;
  title: string;
  amount: number;
  category: string;
  payment_method: string;
  vendor?: string | null;
  expense_date: string;
  notes?: string | null;
  created_at: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id') || '';

  if (!isUuid(tenantId)) {
    return badRequest('tenant_id must be a valid UUID');
  }

  try {
    // Attempt to read from expenses table if exists, otherwise fallback to cfg:expenses ledger
    const { data: dbRows, error: dbErr } = await supabaseAdmin
      .from('expenses')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('expense_date', { ascending: false });

    if (!dbErr && dbRows) {
      return NextResponse.json({ ok: true, expenses: dbRows });
    }

    // Fallback storage in tenant_feature_flags
    const { data: flagRow } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('updated_by')
      .eq('tenant_id', tenantId)
      .eq('flag', 'cfg:expenses_ledger')
      .maybeSingle();

    let items: ExpenseItem[] = [];
    if (flagRow?.updated_by) {
      try {
        items = JSON.parse(flagRow.updated_by);
      } catch {
        items = [];
      }
    }

    return NextResponse.json({ ok: true, expenses: items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch expenses';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const tenantId = String(payload.tenant_id ?? '');
  const title = String(payload.title ?? '').trim();
  const amount = Number(payload.amount) || 0;
  const category = String(payload.category ?? 'utilities');
  const paymentMethod = String(payload.payment_method ?? 'upi');
  const vendor = payload.vendor ? String(payload.vendor).trim() : null;
  const expenseDate = String(payload.expense_date || new Date().toISOString().slice(0, 10));
  const notes = payload.notes ? String(payload.notes).trim() : null;

  if (!isUuid(tenantId) || !title || amount <= 0) {
    return badRequest('tenant_id, title, and valid amount are required');
  }

  const newExpense: ExpenseItem = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    title,
    amount,
    category,
    payment_method: paymentMethod,
    vendor,
    expense_date: expenseDate,
    notes,
    created_at: new Date().toISOString(),
  };

  try {
    // Try insert into expenses table
    const { error: insErr } = await supabaseAdmin.from('expenses').insert(newExpense);

    if (!insErr) {
      return NextResponse.json({ ok: true, expense: newExpense });
    }

    // Fallback storage in cfg:expenses_ledger
    const { data: flagRow } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('updated_by')
      .eq('tenant_id', tenantId)
      .eq('flag', 'cfg:expenses_ledger')
      .maybeSingle();

    let existing: ExpenseItem[] = [];
    if (flagRow?.updated_by) {
      try {
        existing = JSON.parse(flagRow.updated_by);
      } catch {
        existing = [];
      }
    }

    const updated = [newExpense, ...existing].slice(0, 500);

    await supabaseAdmin.from('tenant_feature_flags').upsert(
      {
        tenant_id: tenantId,
        flag: 'cfg:expenses_ledger',
        enabled: true,
        updated_at: new Date().toISOString(),
        updated_by: JSON.stringify(updated),
      },
      { onConflict: 'tenant_id,flag' }
    );

    return NextResponse.json({ ok: true, expense: newExpense });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to record expense';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const tenantId = searchParams.get('tenant_id') || '';

  if (!id || !isUuid(tenantId)) {
    return badRequest('id and valid tenant_id are required');
  }

  try {
    // Try delete from expenses table
    await supabaseAdmin.from('expenses').delete().eq('id', id).eq('tenant_id', tenantId);

    // Also remove from cfg:expenses_ledger fallback
    const { data: flagRow } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('updated_by')
      .eq('tenant_id', tenantId)
      .eq('flag', 'cfg:expenses_ledger')
      .maybeSingle();

    if (flagRow?.updated_by) {
      try {
        const existing: ExpenseItem[] = JSON.parse(flagRow.updated_by);
        const filtered = existing.filter((item) => item.id !== id);
        await supabaseAdmin.from('tenant_feature_flags').upsert(
          {
            tenant_id: tenantId,
            flag: 'cfg:expenses_ledger',
            enabled: true,
            updated_at: new Date().toISOString(),
            updated_by: JSON.stringify(filtered),
          },
          { onConflict: 'tenant_id,flag' }
        );
      } catch {
        // Ignored
      }
    }

    return NextResponse.json({ ok: true, deleted: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to delete expense';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
