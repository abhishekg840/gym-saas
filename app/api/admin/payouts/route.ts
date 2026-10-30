import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { badRequest, readJsonBody } from '@/lib/sqlstate';
import { isUuid } from '@/lib/session';

interface PayoutLog {
  id: string;
  trainer_id: string;
  trainer_name: string;
  amount: number;
  payment_method: string;
  period: string;
  notes?: string | null;
  paid_at: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id') || '';

  if (!isUuid(tenantId)) {
    return badRequest('tenant_id must be a valid UUID');
  }

  try {
    // 1. Fetch trainers
    const { data: trainers, error: trErr } = await supabaseAdmin
      .from('trainers')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (trErr) {
      console.error('Error fetching trainers:', trErr);
    }

    // 2. Fetch PT Subscriptions with member details
    const { data: subs, error: subErr } = await supabaseAdmin
      .from('pt_subscriptions')
      .select('*, members:member_id (full_name, phone)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (subErr) {
      console.error('Error fetching pt subscriptions:', subErr);
    }

    // 3. Fetch Payout history logs from cfg:payout_logs
    const { data: logRow } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('updated_by')
      .eq('tenant_id', tenantId)
      .eq('flag', 'cfg:payout_logs')
      .maybeSingle();

    let logs: PayoutLog[] = [];
    if (logRow?.updated_by) {
      try {
        logs = JSON.parse(logRow.updated_by);
      } catch {
        logs = [];
      }
    }

    return NextResponse.json({
      ok: true,
      trainers: trainers || [],
      subscriptions: subs || [],
      logs: logs || []
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch payouts data';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const tenant_id = String(body.tenant_id ?? '');
  const action = String(body.action ?? '');
  if (!isUuid(tenant_id)) {
    return badRequest('tenant_id must be a valid UUID');
  }

  try {
    if (action === 'create_trainer') {
      const { name, phone, specialization, commission_rate_percent } = body;
      if (!name || !phone) {
        return badRequest('Trainer name and phone are required');
      }

      const { data, error } = await supabaseAdmin
        .from('trainers')
        .insert({
          tenant_id,
          name: String(name).trim(),
          phone: String(phone).trim(),
          specialization: specialization ? String(specialization).trim() : null,
          commission_rate_percent: Number(commission_rate_percent) || 20.0,
          is_active: true
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true, trainer: data });
    }

    if (action === 'update_trainer') {
      const { id, name, phone, specialization, commission_rate_percent, is_active } = body;
      if (!isUuid(id)) return badRequest('id must be a valid UUID');

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = String(name).trim();
      if (phone !== undefined) updates.phone = String(phone).trim();
      if (specialization !== undefined) updates.specialization = specialization ? String(specialization).trim() : null;
      if (commission_rate_percent !== undefined) updates.commission_rate_percent = Number(commission_rate_percent);
      if (is_active !== undefined) updates.is_active = Boolean(is_active);

      const { data, error } = await supabaseAdmin
        .from('trainers')
        .update(updates)
        .eq('id', id)
        .eq('tenant_id', tenant_id)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true, trainer: data });
    }

    if (action === 'record_payout') {
      const trainer_id = String(body.trainer_id ?? '');
      const trainer_name = body.trainer_name ? String(body.trainer_name) : 'Trainer';
      const amount = Number(body.amount) || 0;
      const payment_method = body.payment_method ? String(body.payment_method) : 'upi';
      const period = body.period ? String(body.period) : new Date().toLocaleString('default', { month: 'short', year: 'numeric' });
      const notes = body.notes ? String(body.notes) : null;

      if (!trainer_id || !amount) {
        return badRequest('trainer_id and amount are required');
      }

      // Read current logs
      const { data: logRow } = await supabaseAdmin
        .from('tenant_feature_flags')
        .select('updated_by')
        .eq('tenant_id', tenant_id)
        .eq('flag', 'cfg:payout_logs')
        .maybeSingle();

      let logs: PayoutLog[] = [];
      if (logRow?.updated_by) {
        try {
          logs = JSON.parse(logRow.updated_by);
        } catch {
          logs = [];
        }
      }

      const newLog: PayoutLog = {
        id: crypto.randomUUID(),
        trainer_id,
        trainer_name,
        amount,
        payment_method,
        period,
        notes,
        paid_at: new Date().toISOString()
      };

      const updated = [newLog, ...logs];

      await supabaseAdmin.from('tenant_feature_flags').upsert(
        {
          tenant_id,
          flag: 'cfg:payout_logs',
          enabled: true,
          updated_by: JSON.stringify(updated)
        },
        { onConflict: 'tenant_id,flag' }
      );

      return NextResponse.json({ ok: true, payout: newLog });
    }

    if (action === 'create_pt') {
      const member_id = String(body.member_id ?? '');
      const trainer_id = String(body.trainer_id ?? '');
      const total_sessions = Number(body.total_sessions) || 12;
      const amount_paid = Number(body.amount_paid) || 0;
      const start_date = body.start_date ? String(body.start_date) : new Date().toISOString().slice(0, 10);
      const end_date = body.end_date ? String(body.end_date) : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      if (!isUuid(member_id) || !isUuid(trainer_id)) {
        return badRequest('member_id and trainer_id must be valid UUIDs');
      }

      const { data, error } = await supabaseAdmin
        .from('pt_subscriptions')
        .insert({
          tenant_id,
          member_id,
          trainer_id,
          total_sessions,
          completed_sessions: 0,
          amount_paid,
          start_date,
          end_date,
          status: 'active'
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true, subscription: data });
    }

    return badRequest('Unknown action');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to process payout action';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
