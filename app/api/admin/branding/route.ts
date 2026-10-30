import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { badRequest } from '@/lib/sqlstate';
import { isUuid, readTenantCookie } from '@/lib/session';

export interface TenantBrandingResponse {
  id: string;
  name: string;
  subdomain_slug: string | null;
  logo_url: string | null;
  primary_color: string;
  address: string | null;
  phone: string | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id') || readTenantCookie(request) || '';

  if (!isUuid(tenantId)) {
    return badRequest('tenant_id must be a valid UUID');
  }

  try {
    // 1. Fetch tenant row from database
    const { data: tenant, error: tErr } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, logo_url, address, phone')
      .eq('id', tenantId)
      .single();

    if (tErr || !tenant) {
      return NextResponse.json({ ok: false, error: 'Tenant record not found' }, { status: 404 });
    }

    // 2. Fetch custom brand settings from tenant_feature_flags
    const { data: flagRows } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('flag, updated_by')
      .eq('tenant_id', tenantId)
      .in('flag', ['cfg:brand_color', 'cfg:primary_color']);

    let brandColor = '#059669'; // Default Emerald
    if (flagRows && flagRows.length > 0) {
      const match = flagRows.find((r: { flag: string; updated_by?: string }) => r.flag === 'cfg:brand_color' || r.flag === 'cfg:primary_color');
      if (match?.updated_by && match.updated_by.startsWith('#')) {
        brandColor = match.updated_by;
      }
    }

    const branding: TenantBrandingResponse = {
      id: tenant.id,
      name: tenant.name || 'Gym OS',
      subdomain_slug: tenant.slug || null,
      logo_url: tenant.logo_url || null,
      primary_color: brandColor,
      address: tenant.address || null,
      phone: tenant.phone || null,
    };

    return NextResponse.json({
      ok: true,
      tenant_id: tenantId,
      branding,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch tenant branding';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
