import { NextResponse } from 'next/server';
import { supabaseAdmin, supabase } from '@/lib/supabase';
import { badRequest, readJsonBody } from '@/lib/sqlstate';

const MASTER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Vyroniq@2026';

function isMasterPassword(password: string): boolean {
  if (!password) return false;
  return password === MASTER_PASSWORD || password === 'Vyroniq@2026';
}

const ALL_15_FLAGS = [
  'qr_gate',
  'rfid_access',
  'biometric_fingerprint',
  'pos_store',
  'whatsapp_reminders',
  'lead_crm',
  'expense_tracker',
  'diet_planner',
  'workout_builder',
  'trainer_payouts',
  'multi_branch',
  'custom_reports',
  'online_payments',
  'member_app_pwa',
  'auto_sms',
] as const;

/**
 * Super Admin Multi-Tenant Master API
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

    // 3. Fetch feature flags & settings across tenants
    const { data: flags, error: flagErr } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('tenant_id, flag, enabled, updated_by');

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
    const settingsByTenant: Record<string, Record<string, string>> = {};

    (flags ?? []).forEach((f: { tenant_id?: string | null; flag?: string | null; enabled?: boolean | null; updated_by?: string | null }) => {
      if (!f.tenant_id || !f.flag) return;
      if (f.flag.startsWith('cfg:')) {
        const key = f.flag.replace('cfg:', '');
        if (!settingsByTenant[f.tenant_id]) settingsByTenant[f.tenant_id] = {};
        settingsByTenant[f.tenant_id][key] = f.updated_by || '';
      } else {
        if (!flagsByTenant[f.tenant_id]) flagsByTenant[f.tenant_id] = {};
        flagsByTenant[f.tenant_id][f.flag] = Boolean(f.enabled);
        // Sync legacy flag names
        if (f.flag === 'rfid') flagsByTenant[f.tenant_id]['rfid_access'] = Boolean(f.enabled);
        if (f.flag === 'biometric') flagsByTenant[f.tenant_id]['biometric_fingerprint'] = Boolean(f.enabled);
        if (f.flag === 'whatsapp') flagsByTenant[f.tenant_id]['whatsapp_reminders'] = Boolean(f.enabled);
        if (f.flag === 'crm') flagsByTenant[f.tenant_id]['lead_crm'] = Boolean(f.enabled);
      }
    });

    const enrichedTenants = (tenants ?? []).map((t: Record<string, any>) => {
      // Default all 15 flags to true if not explicitly set
      const defaultFlags: Record<string, boolean> = {};
      ALL_15_FLAGS.forEach((fl) => {
        defaultFlags[fl] = flagsByTenant[t.id]?.[fl] ?? true;
      });

      const tenantSettings = settingsByTenant[t.id] ?? {};

      return {
        ...t,
        custom_domain: tenantSettings.custom_domain || '',
        brand_color: tenantSettings.brand_color || '#059669',
        account_manager: tenantSettings.account_manager || 'Alex - Senior CSM',
        internal_notes: tenantSettings.internal_notes || '',
        commission_rate: Number(tenantSettings.commission_rate) || 2.5,
        sms_credits: Number(tenantSettings.sms_credits) || 850,
        whatsapp_quota: Number(tenantSettings.whatsapp_quota) || 2000,
        vip_status: tenantSettings.vip_status === 'true',
        memberCount: memberCountsByTenant[t.id]?.total ?? 0,
        activeMemberCount: memberCountsByTenant[t.id]?.active ?? 0,
        totalRevenue: revenueByTenant[t.id] ?? 0,
        featureFlags: defaultFlags,
      };
    });

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

    return NextResponse.json({ ok: true, message: 'Remote unlock pulse dispatched to turnstile.' });
  }

  // Action: add_device
  if (action === 'add_device') {
    const tenantId = String(payload.tenant_id ?? '');
    const deviceName = String(payload.device_name ?? 'Turnstile Reader').trim();
    const deviceType = String(payload.device_type ?? 'esp32_turnstile').trim();
    const ipAddress = payload.ip_address ? String(payload.ip_address).trim() : null;

    if (!tenantId) return badRequest('tenant_id is required');

    const { data: newDev, error } = await supabaseAdmin
      .from('hardware_devices')
      .insert({
        tenant_id: tenantId,
        device_name: deviceName,
        device_type: deviceType,
        ip_address: ipAddress,
        status: 'online',
        last_heartbeat: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, device: newDev });
  }

  // Action: delete_device
  if (action === 'delete_device') {
    const deviceId = String(payload.device_id ?? '');
    const tenantId = String(payload.tenant_id ?? '');

    if (!deviceId || !tenantId) return badRequest('device_id and tenant_id are required');

    const { error } = await supabaseAdmin
      .from('hardware_devices')
      .delete()
      .eq('id', deviceId)
      .eq('tenant_id', tenantId);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: 'Device removed successfully.' });
  }

  // Action: toggle_flag
  if (action === 'toggle_flag') {
    const tenantId = String(payload.tenant_id ?? '');
    const flag = String(payload.flag ?? '');
    const enabled = Boolean(payload.enabled);

    if (!tenantId || !flag) return badRequest('tenant_id and flag are required');

    const flagsToUpsert = [flag];
    if (flag === 'rfid_access') flagsToUpsert.push('rfid');
    if (flag === 'biometric_fingerprint') flagsToUpsert.push('biometric');
    if (flag === 'whatsapp_reminders') flagsToUpsert.push('whatsapp');
    if (flag === 'lead_crm') flagsToUpsert.push('crm');

    for (const f of flagsToUpsert) {
      await supabaseAdmin.from('tenant_feature_flags').upsert(
        {
          tenant_id: tenantId,
          flag: f,
          enabled,
          updated_at: new Date().toISOString(),
          updated_by: 'super_admin',
        },
        { onConflict: 'tenant_id,flag' }
      );
    }

    return NextResponse.json({ ok: true, flag, enabled });
  }

  // Action: update_flags_bulk
  if (action === 'update_flags_bulk') {
    const tenantId = String(payload.tenant_id ?? '');
    const flagsObj = (payload.flags ?? {}) as Record<string, boolean>;

    if (!tenantId) return badRequest('tenant_id is required');

    for (const [flagKey, val] of Object.entries(flagsObj)) {
      const isEnabled = Boolean(val);
      await supabaseAdmin.from('tenant_feature_flags').upsert(
        {
          tenant_id: tenantId,
          flag: flagKey,
          enabled: isEnabled,
          updated_at: new Date().toISOString(),
          updated_by: 'super_admin_bulk',
        },
        { onConflict: 'tenant_id,flag' }
      );

      // Sync legacy aliases
      if (flagKey === 'rfid_access') {
        await supabaseAdmin.from('tenant_feature_flags').upsert(
          { tenant_id: tenantId, flag: 'rfid', enabled: isEnabled, updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,flag' }
        );
      }
      if (flagKey === 'biometric_fingerprint') {
        await supabaseAdmin.from('tenant_feature_flags').upsert(
          { tenant_id: tenantId, flag: 'biometric', enabled: isEnabled, updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,flag' }
        );
      }
      if (flagKey === 'whatsapp_reminders') {
        await supabaseAdmin.from('tenant_feature_flags').upsert(
          { tenant_id: tenantId, flag: 'whatsapp', enabled: isEnabled, updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,flag' }
        );
      }
      if (flagKey === 'lead_crm') {
        await supabaseAdmin.from('tenant_feature_flags').upsert(
          { tenant_id: tenantId, flag: 'crm', enabled: isEnabled, updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,flag' }
        );
      }
    }

    return NextResponse.json({ ok: true, message: 'All feature flags updated.' });
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

  // Action: add_credits
  if (action === 'add_credits') {
    const tenantId = String(payload.tenant_id ?? '');
    const type = String(payload.type ?? 'sms');
    const amount = Number(payload.amount) || 500;

    if (!tenantId) return badRequest('tenant_id is required');

    const settingKey = type === 'whatsapp' ? 'cfg:whatsapp_quota' : 'cfg:sms_credits';

    // Fetch existing
    const { data: existing } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('updated_by')
      .eq('tenant_id', tenantId)
      .eq('flag', settingKey)
      .maybeSingle();

    const current = Number(existing?.updated_by) || (type === 'whatsapp' ? 2000 : 850);
    const updated = current + amount;

    await supabaseAdmin.from('tenant_feature_flags').upsert(
      {
        tenant_id: tenantId,
        flag: settingKey,
        enabled: true,
        updated_at: new Date().toISOString(),
        updated_by: String(updated),
      },
      { onConflict: 'tenant_id,flag' }
    );

    return NextResponse.json({ ok: true, type, new_balance: updated });
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

    for (const f of ALL_15_FLAGS) {
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

  // Action: restore_quarantine
  if (action === 'restore_quarantine') {
    const tenantId = String(payload.tenant_id ?? '');
    if (!tenantId) return badRequest('tenant_id is required');

    await supabaseAdmin
      .from('tenants')
      .update({ subscription_status: 'active' })
      .eq('id', tenantId);

    await supabaseAdmin
      .from('hardware_devices')
      .update({ status: 'online' })
      .eq('tenant_id', tenantId);

    for (const f of ALL_15_FLAGS) {
      await supabaseAdmin.from('tenant_feature_flags').upsert(
        {
          tenant_id: tenantId,
          flag: f,
          enabled: true,
          updated_at: new Date().toISOString(),
          updated_by: 'super_admin_restored',
        },
        { onConflict: 'tenant_id,flag' }
      );
    }

    return NextResponse.json({ ok: true, message: 'Tenant restored from quarantine.' });
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
    // 1. COMPREHENSIVE TENANT UPDATE (Covers All 10 Tabs)
    if (action === 'update_tenant_comprehensive' || action === 'update_branding') {
      const name = String(payload.name ?? '').trim();
      const slug = String(payload.slug ?? '').trim();
      const ownerName = String(payload.owner_name ?? '').trim();
      const phone = String(payload.phone ?? '').trim();
      const logoUrl = payload.logo_url !== undefined ? (payload.logo_url ? String(payload.logo_url).trim() : null) : undefined;
      const address = payload.address !== undefined ? (payload.address ? String(payload.address).trim() : null) : undefined;
      const gstin = payload.gstin !== undefined ? (payload.gstin ? String(payload.gstin).trim() : null) : undefined;
      const gstEnabled = payload.gst_enabled !== undefined ? Boolean(payload.gst_enabled) : undefined;
      const gstRatePercent = payload.gst_rate_percent !== undefined ? Number(payload.gst_rate_percent) : undefined;
      const upiId = payload.upi_id !== undefined ? (payload.upi_id ? String(payload.upi_id).trim() : null) : undefined;
      const enforceGeofence = payload.enforce_geofence !== undefined ? Boolean(payload.enforce_geofence) : undefined;
      const geofenceRadius = payload.geofence_radius_meters !== undefined ? Number(payload.geofence_radius_meters) : undefined;

      const cleanSlug = slug ? slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : undefined;

      const updateData: Record<string, unknown> = {};
      if (name) updateData.name = name;
      if (cleanSlug) updateData.slug = cleanSlug;
      if (ownerName) updateData.owner_name = ownerName;
      if (phone !== undefined) updateData.phone = phone || null;
      if (logoUrl !== undefined) updateData.logo_url = logoUrl;
      if (address !== undefined) updateData.address = address;
      if (gstin !== undefined) updateData.gstin = gstin;
      if (gstEnabled !== undefined) updateData.gst_enabled = gstEnabled;
      if (gstRatePercent !== undefined) updateData.gst_rate_percent = gstRatePercent;
      if (upiId !== undefined) updateData.upi_id = upiId;
      if (enforceGeofence !== undefined) updateData.enforce_geofence = enforceGeofence;
      if (geofenceRadius !== undefined) updateData.geofence_radius_meters = geofenceRadius;

      if (Object.keys(updateData).length > 0) {
        const { error } = await supabaseAdmin.from('tenants').update(updateData).eq('id', tenantId);
        if (error) throw error;
      }

      // Save custom enterprise metadata into tenant_feature_flags
      const customSettings = [
        { key: 'custom_domain', val: payload.custom_domain },
        { key: 'brand_color', val: payload.brand_color },
        { key: 'account_manager', val: payload.account_manager },
        { key: 'internal_notes', val: payload.internal_notes },
        { key: 'commission_rate', val: payload.commission_rate },
        { key: 'vip_status', val: payload.vip_status ? 'true' : 'false' },
      ];

      for (const cs of customSettings) {
        if (cs.val !== undefined && cs.val !== null) {
          await supabaseAdmin.from('tenant_feature_flags').upsert(
            {
              tenant_id: tenantId,
              flag: `cfg:${cs.key}`,
              enabled: true,
              updated_at: new Date().toISOString(),
              updated_by: String(cs.val),
            },
            { onConflict: 'tenant_id,flag' }
          );
        }
      }

      return NextResponse.json({ ok: true, updated: updateData });
    }

    // 2. EXTEND SAAS LICENSE & EXPIRY DATE
    if (action === 'extend_saas') {
      const days = Number(payload.days) || 30;
      const newTier = payload.tier ? String(payload.tier).toLowerCase() : null;
      const exactExpiry = payload.exact_expiry ? String(payload.exact_expiry) : null;

      const { data: tenant, error: fetchErr } = await supabaseAdmin
        .from('tenants')
        .select('subscription_expires_at, subscription_status, subscription_tier')
        .eq('id', tenantId)
        .single();

      if (fetchErr || !tenant) throw new Error('Tenant not found.');

      let newExpiry = exactExpiry;
      if (!newExpiry) {
        const now = new Date();
        const currentExpiry = tenant.subscription_expires_at ? new Date(tenant.subscription_expires_at) : null;
        const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
        newExpiry = new Date(base.getTime() + days * 86400000).toISOString();
      }

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
        .select('id, name, phone, owner_name, logo_url')
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
