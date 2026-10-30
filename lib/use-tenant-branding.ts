'use client';

import { useEffect, useState, useCallback } from 'react';
import { readSession, isUuid, SESSION_KEY } from '@/lib/session';

export interface TenantBranding {
  name: string;
  subdomain_slug: string | null;
  logo_url: string | null;
  primary_color: string;
  address: string | null;
  phone: string | null;
}

const DEFAULT_BRANDING: TenantBranding = {
  name: 'Gym',
  subdomain_slug: null,
  logo_url: null,
  primary_color: '#059669', // Emerald 600
  address: null,
  phone: null,
};

export function useTenantBranding() {
  const [branding, setBranding] = useState<TenantBranding>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // 1. Initial hydration & zero-flicker cached read
  useEffect(() => {
    const s = readSession();
    const tId = s?.tenantId && isUuid(s.tenantId) ? s.tenantId : null;
    if (tId) {
      setTenantId(tId);

      // Try reading instant cache from localStorage
      try {
        const cached = localStorage.getItem(`vy_branding_${tId}`);
        if (cached) {
          const parsed = JSON.parse(cached) as TenantBranding;
          setBranding(parsed);
          applyBrandColor(parsed.primary_color);
          setLoading(false);
        } else if (s && s.tenantName) {
          setBranding((prev) => ({ ...prev, name: s.tenantName || 'Gym' }));
        }
      } catch {
        // Cache error ignored
      }
    } else {
      setLoading(false);
    }
  }, []);

  // Helper to dynamically apply CSS custom properties to root
  const applyBrandColor = (color: string) => {
    if (typeof document !== 'undefined' && color) {
      document.documentElement.style.setProperty('--color-brand', color);
      document.documentElement.style.setProperty('--tenant-brand', color);
    }
  };

  // 2. Fetch authoritative branding from API
  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/admin/branding?tenant_id=${tenantId}`);
      const data = await res.json();
      if (data.ok && data.branding) {
        const brand = data.branding as TenantBranding;
        setBranding(brand);
        applyBrandColor(brand.primary_color);

        // Update localStorage branding cache
        try {
          localStorage.setItem(`vy_branding_${tenantId}`, JSON.stringify(brand));
        } catch {
          // ignore
        }

        // Sync with gym_session so tenantName is updated across all session readers
        try {
          const sessionRaw = localStorage.getItem(SESSION_KEY);
          if (sessionRaw) {
            const currentSession = JSON.parse(sessionRaw);
            if (currentSession.tenantName !== brand.name) {
              currentSession.tenantName = brand.name;
              localStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
            }
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.warn('Failed to load tenant branding:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      refresh();
    }
  }, [tenantId, refresh]);

  return {
    branding,
    loading,
    refresh,
  };
}
