import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { badRequest } from '@/lib/sqlstate';
import { isUuid } from '@/lib/session';

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id') || '';

  if (!isUuid(tenantId)) {
    return badRequest('tenant_id must be a valid UUID');
  }

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('flag, enabled')
      .eq('tenant_id', tenantId);

    if (error) {
      console.warn('Could not fetch tenant feature flags:', error);
    }

    // Default all 15 flags to true unless explicitly disabled (enabled === false)
    const flags: Record<string, boolean> = {};
    ALL_15_FLAGS.forEach((fl) => {
      flags[fl] = true;
    });

    // Also include legacy aliases
    (rows ?? []).forEach((r: { flag: string; enabled: boolean }) => {
      flags[r.flag] = Boolean(r.enabled);

      if (r.flag === 'rfid') flags['rfid_access'] = Boolean(r.enabled);
      if (r.flag === 'biometric') flags['biometric_fingerprint'] = Boolean(r.enabled);
      if (r.flag === 'whatsapp') flags['whatsapp_reminders'] = Boolean(r.enabled);
      if (r.flag === 'crm') flags['lead_crm'] = Boolean(r.enabled);

      if (r.flag === 'rfid_access') flags['rfid'] = Boolean(r.enabled);
      if (r.flag === 'biometric_fingerprint') flags['biometric'] = Boolean(r.enabled);
      if (r.flag === 'whatsapp_reminders') flags['whatsapp'] = Boolean(r.enabled);
      if (r.flag === 'lead_crm') flags['crm'] = Boolean(r.enabled);
    });

    // Also fetch tenant branding
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, logo_url, address, phone')
      .eq('id', tenantId)
      .single();

    let brandColor = '#059669';
    const brandRow = (rows ?? []).find((r: { flag: string; updated_by?: string }) => r.flag === 'cfg:brand_color' || r.flag === 'cfg:primary_color');
    if (brandRow && 'updated_by' in brandRow && typeof brandRow.updated_by === 'string' && brandRow.updated_by.startsWith('#')) {
      brandColor = brandRow.updated_by;
    }

    const branding = {
      name: tenant?.name || 'Gym OS',
      subdomain_slug: tenant?.slug || null,
      logo_url: tenant?.logo_url || null,
      primary_color: brandColor,
      address: tenant?.address || null,
      phone: tenant?.phone || null,
    };

    return NextResponse.json({
      ok: true,
      tenant_id: tenantId,
      flags,
      branding,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch feature flags';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

