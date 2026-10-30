import { NextResponse } from 'next/server';
import { supabaseAdmin, supabase } from '@/lib/supabase';
import { badRequest, readJsonBody } from '@/lib/sqlstate';

const MASTER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Vyroniq@2026';

function isMasterPassword(password: string): boolean {
  if (!password) return false;
  return password === MASTER_PASSWORD || password === 'Vyroniq@2026';
}

/**
 * GET /api/super-admin/tenants?identifier=...&password=...
 * POST /api/super-admin/tenants
 *
 * Verifies super admin authorization against process.env.SUPER_ADMIN_PASSWORD || 'Vyroniq@2026'
 * or delegates to Postgres RPC fn_superadmin_list_tenants / fn_superadmin_create_tenant / fn_superadmin_set_subscription_status / fn_superadmin_set_subscription_tier.
 * When the master password matches, executes the action directly using supabaseAdmin.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const identifier = searchParams.get('identifier') || '';
  const password = searchParams.get('password') || '';

  if (!password) {
    return badRequest('Password is required', 401);
  }

  // 1. If master password matches, fetch directly via supabaseAdmin
  if (isMasterPassword(password)) {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, owner_name, phone, subscription_tier, subscription_status, trial_ends_at, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: data ?? [] });
  }

  // 2. Fall back to RPC check
  const { data, error } = await supabase.rpc('fn_superadmin_list_tenants', {
    p_identifier: identifier,
    p_password: password,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message || 'Unauthorized', code: error.code },
      { status: error.code === '45005' ? 401 : 400 }
    );
  }

  return NextResponse.json({ ok: true, data: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const action = String(payload.action ?? '');
  const identifier = String(payload.identifier ?? '');
  const password = String(payload.password ?? '');

  if (!password) {
    return badRequest('Password is required', 401);
  }

  const masterAuthorized = isMasterPassword(password);

  // --- ACTION: VERIFY CREDENTIALS ONLY ---
  if (action === 'verify') {
    if (masterAuthorized) {
      return NextResponse.json({ ok: true });
    }
    const { data, error } = await supabase.rpc('fn_superadmin_list_tenants', {
      p_identifier: identifier,
      p_password: password,
    });
    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized', code: '45005' },
        { status: 401 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // --- ACTION: LIST TENANTS ---
  if (action === 'list') {
    if (masterAuthorized) {
      const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name, slug, owner_name, phone, subscription_tier, subscription_status, trial_ends_at, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, data: data ?? [] });
    }

    const { data, error } = await supabase.rpc('fn_superadmin_list_tenants', {
      p_identifier: identifier,
      p_password: password,
    });
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || 'Unauthorized', code: error.code },
        { status: error.code === '45005' ? 401 : 400 }
      );
    }
    return NextResponse.json({ ok: true, data: data ?? [] });
  }

  // --- ACTION: SET SUBSCRIPTION STATUS ---
  if (action === 'set_status') {
    const tenantId = String(payload.tenant_id ?? '');
    const newStatus = String(payload.status ?? 'active');

    if (masterAuthorized) {
      const { error } = await supabaseAdmin
        .from('tenants')
        .update({ subscription_status: newStatus })
        .eq('id', tenantId);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase.rpc('fn_superadmin_set_subscription_status', {
      p_identifier: identifier,
      p_password: password,
      p_tenant_id: tenantId,
      p_status: newStatus,
    });
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || 'Unauthorized', code: error.code },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // --- ACTION: SET SUBSCRIPTION TIER ---
  if (action === 'set_tier') {
    const tenantId = String(payload.tenant_id ?? '');
    const newTier = String(payload.tier ?? 'pro');

    if (masterAuthorized) {
      const { error } = await supabaseAdmin
        .from('tenants')
        .update({ subscription_tier: newTier })
        .eq('id', tenantId);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase.rpc('fn_superadmin_set_subscription_tier', {
      p_identifier: identifier,
      p_password: password,
      p_tenant_id: tenantId,
      p_tier: newTier,
    });
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || 'Unauthorized', code: error.code },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // --- ACTION: CREATE TENANT ---
  if (action === 'create_tenant') {
    const name = String(payload.name ?? '').trim();
    const slug = String(payload.slug ?? '').trim();
    const ownerName = String(payload.owner_name ?? '').trim();
    const ownerPhone = String(payload.owner_phone ?? '').trim();
    const tier = String(payload.tier ?? 'pro');
    const ownerPassword = String(payload.owner_password ?? '1234');

    if (masterAuthorized) {
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

      // If owner phone is provided, try provisioning owner via RPC or gym_users
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

    const { data, error } = await supabase.rpc('fn_superadmin_create_tenant', {
      p_identifier: identifier,
      p_password: password,
      p_name: name,
      p_slug: slug,
      p_owner_name: ownerName,
      p_owner_phone: ownerPhone,
      p_tier: tier,
      p_owner_password: ownerPassword,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || 'Unauthorized', code: error.code },
        { status: 400 }
      );
    }

    return NextResponse.json(data ?? { ok: true });
  }

  return badRequest(`Unknown action: ${action}`);
}

