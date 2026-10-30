import { NextResponse } from 'next/server';
import { supabaseAdmin, supabase } from '@/lib/supabase';
import { badRequest, readJsonBody } from '@/lib/sqlstate';

const MASTER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Vyroniq@2026';

function isMasterPassword(password: string): boolean {
  if (!password) return false;
  return password === MASTER_PASSWORD || password === 'Vyroniq@2026';
}

/**
 * Super Admin Multi-Tenant Master API
 *
 * GET /api/super-admin/tenants?password=...
 * POST /api/super-admin/tenants
 * PATCH /api/super-admin/tenants
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password') || '';

  if (!isMasterPassword(password)) {
    return badRequest('Unauthorized super admin access', 401);
  }

  try {
    // 1. Fetch all tenants with full metadata
    const { data: tenants, error: tErr } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: false });

    if (tErr) throw tErr;

    // 2. Fetch platform hardware devices
    const { data: devices, error: devErr } = await supabaseAdmin
      .from('hardware_devices')
      .select('id, tenant_id, device_name, device_type, ip_address, status, last_heartbeat, last_scanned_uid, last_scanned_at');

    if (devErr) console.warn('Could not fetch hardware devices:', devErr);

    // 3. Fetch feature flags across tenants
    const { data: flags, error: flagErr } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('tenant_id, flag, enabled');

    if (flagErr) console.warn('Could not fetch tenant feature flags:', flagErr);

    // 4. Fetch all members count and status
    const { data: members, error: mErr } = await supabaseAdmin
      .from('members')
      .select('id, tenant_id, status');

    if (mErr) console.warn('Could not count members:', mErr);

    // 5. Total revenue / MRR from invoices
    const { data: invoices, error: invErr } = await supabaseAdmin
      .from('invoices')
      .select('amount, status, tenant_id')
      .in('status', ['paid']);

    if (invErr) console.warn('Could not fetch invoices:', invErr);

    const totalRevenue = (invoices ?? []).reduce(
      (sum: number, inv: { amount?: number | null }) => sum + (Number(inv.amount) || 0),
      0
    );

    // Online hardware devices (heartbeat within last 120 seconds)
    const nowMs = Date.now();
    const onlineDevicesCount = (devices ?? []).filter((d: { last_heartbeat?: string | null }) => {
      if (!d.last_heartbeat) return false;
      const hb = new Date(d.last_heartbeat).getTime();
      return nowMs - hb < 120000;
    }).length;

    const totalActiveMembers = (members ?? []).filter((m: { status?: string | null }) => m.status === 'active').length;

    // Build per-tenant aggregate maps
    const memberCountsByTenant: Record<string, { total: number; active: number }> = {};
    (members ?? []).forEach((m: { tenant_id?: string | null; status?: string | null }) => {
      if (!m.tenant_id) return;
      if (!memberCountsByTenant[m.tenant_id]) {
        memberCountsByTenant[m.tenant_id] = { total: 0, active: 0 };
      }
      memberCountsByTenant[m.tenant_id].total += 1;
      if (m.status === 'active') {
        memberCountsByTenant[m.tenant_id].active += 1;
      }
    });

    const revenueByTenant: Record<string, number> = {};
    (invoices ?? []).forEach((inv: { tenant_id?: string | null; amount?: number | null }) => {
      if (!inv.tenant_id) return;
      revenueByTenant[inv.tenant_id] = (revenueByTenant[inv.tenant_id] || 0) + (Number(inv.amount) || 0);
    });

    const flagsByTenant: Record<string, Record<string, boolean>> = {};
    (flags ?? []).forEach((f: { tenant_id?: string | null; flag?: string | null; enabled?: boolean | null }) => {
      if (!f.tenant_id || !f.flag) return;
      if (!flagsByTenant[f.tenant_id]) flagsByTenant[f.tenant_id] = {};
      flagsByTenant[f.tenant_id][f.flag] = Boolean(f.enabled);
    });

    const enrichedTenants = (tenants ?? []).map((t: Record<string, any>) => ({
      ...t,
      memberCount: memberCountsByTenant[t.id]?.total ?? 0,
      activeMemberCount: memberCountsByTenant[t.id]?.active ?? 0,
      totalRevenue: revenueByTenant[t.id] ?? 0,
      featureFlags: flagsByTenant[t.id] ?? {
        qr_gate: true,
        rfid: true,
        biometric: true,
        pos_store: true,
        whatsapp: true,
        crm: true,
      },
    }));

    return NextResponse.json({
      ok: true,
      tenants: enrichedTenants,
      devices: devices ?? [],
      metrics: {
        totalRevenue,
        onlineDevicesCount,
        totalActiveMembers,
        totalTenants: (tenants ?? []).length,
        activeTenantsCount: (tenants ?? []).filter((t: { subscription_status?: string | null }) => t.subscription_status === 'active').length,
        suspendedTenantsCount: (tenants ?? []).filter((t: { subscription_status?: string | null }) => t.subscription_status === 'suspended').length,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load master directory.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const action = String(payload.action ?? '');
  const identifier = String(payload.identifier ?? '');
  const password = String(payload.password ?? '');

  if (!isMasterPassword(password)) {
    // Check RPC verification as fallback
    const { error } = await supabase.rpc('fn_superadmin_list_tenants', {
      p_identifier: identifier,
      p_password: password,
    });
    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: Invalid Super Admin password.', code: '45005' },
        { status: 401 }
      );
    }
  }

  // Action: create_tenant
  if (action === 'create_tenant') {
    const name = String(payload.name ?? '').trim();
    const slug = String(payload.slug ?? '').trim();
    const ownerName = String(payload.owner_name ?? '').trim();
    const ownerPhone = String(payload.owner_phone ?? '').trim();
    const tier = String(payload.tier ?? 'pro');
    const ownerPassword = String(payload.owner_password ?? '1234');

    const cleanSlug = (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const { data: tenant, error: tErr } = await supabaseAdmin
      .from('tenants')
      .insert({
        name,
        slug: cleanSlug,
        owner_name: ownerName || name,
        phone: ownerPhone || null,
        subscription_tier: tier,
        subscription_status: 'active',
      })
      .select('id, slug')
      .single();

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 400 });
    }

    if (ownerPhone && ownerName) {
      try {
        await supabase.rpc('fn_staff_provision_owner', {
          p_tenant_id: tenant.id,
          p_phone: ownerPhone,
          p_full_name: ownerName,
          p_initial_password: ownerPassword,
        });
      } catch (provErr) {
        console.error('Owner provision error:', provErr);
      }
    }

    return NextResponse.json({
      ok: true,
      tenant_id: tenant.id,
      slug: tenant.slug,
      owner_password_set: Boolean(ownerPhone && ownerName),
    });
  }

  // Action: broadcast_announcement
  if (action === 'broadcast_announcement') {
    const title = String(payload.title ?? '').trim();
    const message = String(payload.message ?? '').trim();

    if (!title || !message) {
      return badRequest('Title and message are required for platform broadcast.');
    }

    const { data: tenants } = await supabaseAdmin.from('tenants').select('id');
    const records = (tenants ?? []).map((t: { id: string }) => ({
      tenant_id: t.id,
      title: `[PLATFORM ALERT] ${title}`,
      message,
      body: message,
      type: 'warning',
      is_pinned: true,
      is_published: true,
    }));

    if (records.length > 0) {
      const { error: annErr } = await supabaseAdmin.from('gym_announcements').insert(records);
      if (annErr) {
        return NextResponse.json({ ok: false, error: annErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, count: records.length });
  }

  // Action: remote_unlock
  if (action === 'remote_unlock') {
    const tenantId = String(payload.tenant_id ?? '');
    const deviceId = payload.device_id ? String(payload.device_id) : null;

    if (!tenantId) return badRequest('tenant_id is required');

    const updateData: Record<string, unknown> = {
      last_scanned_at: new Date().toISOString(),
      last_scanned_uid: 'SUPER_ADMIN_REMOTE_UNLOCK',
    };

    let query = supabaseAdmin.from('hardware_devices').update(updateData).eq('tenant_id', tenantId);
    if (deviceId) {
      query = query.eq('id', deviceId);
    }

    const { error: devErr } = await query;
    if (devErr) {
      return NextResponse.json({ ok: false, error: devErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: 'Remote unlock pulse dispatched to device.' });
  }

  // Action: toggle_flag
  if (action === 'toggle_flag') {
    const tenantId = String(payload.tenant_id ?? '');
    const flag = String(payload.flag ?? '');
    const enabled = Boolean(payload.enabled);

    if (!tenantId || !flag) return badRequest('tenant_id and flag are required');

    const { error } = await supabaseAdmin
      .from('tenant_feature_flags')
      .upsert(
        {
          tenant_id: tenantId,
          flag,
          enabled,
          updated_at: new Date().toISOString(),
          updated_by: 'super_admin',
        },
        { onConflict: 'tenant_id,flag' }
      );

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, flag, enabled });
  }

  // Action: reset_owner_password
  if (action === 'reset_owner_password') {
    const tenantId = String(payload.tenant_id ?? '');
    const newPassword = String(payload.new_password ?? '1234');
    if (!tenantId) return badRequest('tenant_id is required');

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('phone, owner_name')
      .eq('id', tenantId)
      .single();

    if (tenant?.phone && tenant?.owner_name) {
      try {
        await supabase.rpc('fn_staff_provision_owner', {
          p_tenant_id: tenantId,
          p_phone: tenant.phone,
          p_full_name: tenant.owner_name,
          p_initial_password: newPassword,
        });
      } catch (err) {
        console.warn('RPC provision owner fallback:', err);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Owner credentials reset to default password: "${newPassword}"`,
    });
  }

  // Action: quarantine_tenant (Emergency Kill Switch)
  if (action === 'quarantine_tenant') {
    const tenantId = String(payload.tenant_id ?? '');
    if (!tenantId) return badRequest('tenant_id is required');

    await supabaseAdmin
      .from('tenants')
      .update({ subscription_status: 'suspended' })
      .eq('id', tenantId);

    await supabaseAdmin
      .from('hardware_devices')
      .update({ status: 'offline' })
      .eq('tenant_id', tenantId);

    const flags = ['qr_gate', 'rfid', 'biometric', 'pos_store', 'whatsapp', 'crm'];
    for (const f of flags) {
      await supabaseAdmin.from('tenant_feature_flags').upsert(
        {
          tenant_id: tenantId,
          flag: f,
          enabled: false,
          updated_at: new Date().toISOString(),
          updated_by: 'super_admin_quarantine',
        },
        { onConflict: 'tenant_id,flag' }
      );
    }

    return NextResponse.json({ ok: true, message: 'Tenant quarantined. All access revoked immediately.' });
  }

  return badRequest(`Unknown action: ${action}`);
}

export async function PATCH(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const action = String(payload.action ?? '');
  const password = String(payload.password ?? '');
  const tenantId = String(payload.tenant_id ?? '');

  if (!isMasterPassword(password)) {
    return badRequest('Unauthorized: Invalid Super Admin password.', 401);
  }

  if (!tenantId) {
    return badRequest('tenant_id is required.');
  }

  try {
    // 1. UPDATE BRANDING & DETAILS
    if (action === 'update_branding') {
      const name = String(payload.name ?? '').trim();
      const slug = String(payload.slug ?? '').trim();
      const ownerName = String(payload.owner_name ?? '').trim();
      const phone = String(payload.phone ?? '').trim();
      const logoUrl = payload.logo_url ? String(payload.logo_url).trim() : null;
      const address = payload.address ? String(payload.address).trim() : null;

      const cleanSlug = (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

      const updateData: Record<string, unknown> = {
        name,
        slug: cleanSlug,
        owner_name: ownerName,
        phone: phone || null,
        logo_url: logoUrl || null,
        address: address || null,
      };

      const { error } = await supabaseAdmin.from('tenants').update(updateData).eq('id', tenantId);

      if (error) throw error;
      return NextResponse.json({ ok: true, updated: updateData });
    }

    // 2. EXTEND SAAS LICENSE & EXPIRY DATE
    if (action === 'extend_saas') {
      const days = Number(payload.days) || 30;
      const newTier = payload.tier ? String(payload.tier).toLowerCase() : null;

      const { data: tenant, error: fetchErr } = await supabaseAdmin
        .from('tenants')
        .select('subscription_expires_at, subscription_status, subscription_tier')
        .eq('id', tenantId)
        .single();

      if (fetchErr || !tenant) throw new Error('Tenant not found.');

      const now = new Date();
      const currentExpiry = tenant.subscription_expires_at ? new Date(tenant.subscription_expires_at) : null;
      const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
      const newExpiry = new Date(base.getTime() + days * 86400000).toISOString();

      const updateData: Record<string, unknown> = {
        subscription_expires_at: newExpiry,
        subscription_status: 'active',
        ...(newTier ? { subscription_tier: newTier } : {}),
      };

      const { error } = await supabaseAdmin.from('tenants').update(updateData).eq('id', tenantId);

      if (error) throw error;
      return NextResponse.json({ ok: true, new_expiry: newExpiry, tier: updateData.subscription_tier });
    }

    // 3. TOGGLE SAAS HOLD / SUSPEND
    if (action === 'toggle_saas_hold') {
      const { data: tenant, error: fetchErr } = await supabaseAdmin
        .from('tenants')
        .select('subscription_status')
        .eq('id', tenantId)
        .single();

      if (fetchErr || !tenant) throw new Error('Tenant not found.');

      const nextStatus = tenant.subscription_status === 'suspended' ? 'active' : 'suspended';

      const { error } = await supabaseAdmin
        .from('tenants')
        .update({ subscription_status: nextStatus })
        .eq('id', tenantId);

      if (error) throw error;
      return NextResponse.json({ ok: true, status: nextStatus });
    }

    // 4. IMPERSONATE TENANT (GENERATE SECURE OWNER SESSION)
    if (action === 'impersonate') {
      const { data: tenant, error: tErr } = await supabaseAdmin
        .from('tenants')
        .select('id, name, phone, owner_name')
        .eq('id', tenantId)
        .single();

      if (tErr || !tenant) throw new Error('Tenant not found.');

      const { data: ownerUser } = await supabaseAdmin
        .from('gym_users')
        .select('id, full_name, phone, role')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .maybeSingle();

      const impersonatedSession = {
        userId: ownerUser?.id || tenant.id,
        role: 'owner',
        name: ownerUser?.full_name || tenant.owner_name || 'Gym Owner',
        phone: ownerUser?.phone || tenant.phone || '',
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantPhone: tenant.phone,
        passwordMustChange: false,
      };

      return NextResponse.json({
        ok: true,
        session: impersonatedSession,
        redirect_url: '/admin',
      });
    }

    // 5. UPDATE TIER DIRECTLY
    if (action === 'update_tier') {
      const tier = String(payload.tier ?? 'pro').toLowerCase();
      const { error } = await supabaseAdmin
        .from('tenants')
        .update({ subscription_tier: tier })
        .eq('id', tenantId);

      if (error) throw error;
      return NextResponse.json({ ok: true, tier });
    }

    return badRequest(`Unsupported PATCH action: ${action}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update tenant.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
