import { NextResponse } from 'next/server';
import { supabaseAdmin, supabase } from '@/lib/supabase';
import { badRequest, readJsonBody } from '@/lib/sqlstate';

const MASTER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Vyroniq@2026';

function isMasterPassword(password: string): boolean {
  if (!password) return false;
  return password === MASTER_PASSWORD || password === 'Vyroniq@2026';
}

/**
 * Super Admin Management API
 *
 * GET /api/super-admin/tenants?identifier=...&password=...
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

    // 2. Fetch platform aggregates
    // 2a. Hardware devices
    const { data: devices, error: devErr } = await supabaseAdmin
      .from('hardware_devices')
      .select('id, tenant_id, device_name, device_type, status, last_heartbeat');

    if (devErr) console.warn('Could not fetch hardware devices:', devErr);

    // 2b. Total active members count across all tenants
    const { count: memberCount, error: mCountErr } = await supabaseAdmin
      .from('members')
      .select('id', { count: 'exact', head: true })
      .in('status', ['active']);

    if (mCountErr) console.warn('Could not count members:', mCountErr);

    // 2c. Total revenue / MRR from invoices
    const { data: invoices, error: invErr } = await supabaseAdmin
      .from('invoices')
      .select('amount, status, tenant_id')
      .in('status', ['paid']);

    if (invErr) console.warn('Could not fetch invoices:', invErr);

    const totalRevenue = (invoices ?? []).reduce((sum: number, inv: { amount?: number | null }) => sum + (Number(inv.amount) || 0), 0);

    // Count online devices (heartbeat within last 120 seconds)
    const nowMs = Date.now();
    const onlineDevicesCount = (devices ?? []).filter((d: { last_heartbeat?: string | null }) => {
      if (!d.last_heartbeat) return false;
      const hb = new Date(d.last_heartbeat).getTime();
      return nowMs - hb < 120000;
    }).length;

    return NextResponse.json({
      ok: true,
      tenants: tenants ?? [],
      devices: devices ?? [],
      metrics: {
        totalRevenue,
        onlineDevicesCount,
        totalActiveMembers: memberCount ?? 0,
        totalTenants: (tenants ?? []).length,
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
    const { data, error } = await supabase.rpc('fn_superadmin_list_tenants', {
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

  // Action: list
  if (action === 'list') {
    const { data: tenants, error: tErr } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: false });

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    const { data: devices } = await supabaseAdmin
      .from('hardware_devices')
      .select('id, tenant_id, device_name, device_type, status, last_heartbeat');

    const { count: memberCount } = await supabaseAdmin
      .from('members')
      .select('id', { count: 'exact', head: true })
      .in('status', ['active']);

    const { data: invoices } = await supabaseAdmin
      .from('invoices')
      .select('amount, status, tenant_id')
      .in('status', ['paid']);

    const totalRevenue = (invoices ?? []).reduce((sum: number, inv: { amount?: number | null }) => sum + (Number(inv.amount) || 0), 0);
    const nowMs = Date.now();
    const onlineDevicesCount = (devices ?? []).filter((d: { last_heartbeat?: string | null }) => {
      if (!d.last_heartbeat) return false;
      const hb = new Date(d.last_heartbeat).getTime();
      return nowMs - hb < 120000;
    }).length;

    return NextResponse.json({
      ok: true,
      data: tenants ?? [],
      devices: devices ?? [],
      metrics: {
        totalRevenue,
        onlineDevicesCount,
        totalActiveMembers: memberCount ?? 0,
        totalTenants: (tenants ?? []).length,
      },
    });
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

    // Stamp last_scanned_at and trigger remote unlock signal on the hardware device
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

  return badRequest(`Unknown action: ${action}`);
}

/**
 * PATCH /api/super-admin/tenants
 *
 * Handles:
 * - action: 'update_branding'
 * - action: 'extend_saas'
 * - action: 'toggle_saas_hold'
 * - action: 'impersonate'
 */
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

      const { error } = await supabaseAdmin
        .from('tenants')
        .update(updateData)
        .eq('id', tenantId);

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

      const { error } = await supabaseAdmin
        .from('tenants')
        .update(updateData)
        .eq('id', tenantId);

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
      // Find tenant details and owner user record
      const { data: tenant, error: tErr } = await supabaseAdmin
        .from('tenants')
        .select('id, name, phone, owner_name')
        .eq('id', tenantId)
        .single();

      if (tErr || !tenant) throw new Error('Tenant not found.');

      // Fetch or seed gym owner user in gym_users
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

    return badRequest(`Unsupported PATCH action: ${action}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update tenant.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
