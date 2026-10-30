'use client';

import { useEffect, useState, useCallback } from 'react';
import { readSession, isUuid } from '@/lib/session';

export type EnterpriseFeatureFlag =
  | 'qr_gate'
  | 'rfid_access'
  | 'biometric_fingerprint'
  | 'pos_store'
  | 'whatsapp_reminders'
  | 'lead_crm'
  | 'expense_tracker'
  | 'diet_planner'
  | 'workout_builder'
  | 'trainer_payouts'
  | 'multi_branch'
  | 'custom_reports'
  | 'online_payments'
  | 'member_app_pwa'
  | 'auto_sms'
  // Legacy aliases
  | 'rfid'
  | 'biometric'
  | 'whatsapp'
  | 'crm';

export function useFeatureFlags() {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    const s = readSession();
    if (s && isUuid(s.tenantId)) {
      setTenantId(s.tenantId);

      // Check localStorage cache first for immediate zero-flicker render
      try {
        const cached = localStorage.getItem(`vy_flags_${s.tenantId}`);
        if (cached) {
          setFlags(JSON.parse(cached));
          setLoading(false);
        }
      } catch {
        // Cache read ignored
      }
    } else {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/admin/features?tenant_id=${tenantId}`);
      const data = await res.json();
      if (data.ok && data.flags) {
        setFlags(data.flags);
        try {
          localStorage.setItem(`vy_flags_${tenantId}`, JSON.stringify(data.flags));
        } catch {
          // Cache write ignored
        }
      }
    } catch (err) {
      console.warn('Failed to fetch feature flags:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      void refresh();
    }
  }, [tenantId, refresh]);

  const isEnabled = useCallback(
    (flagKey: EnterpriseFeatureFlag | string): boolean => {
      // Default to true if not loaded yet or not explicitly false
      if (flags[flagKey] === undefined) return true;
      return Boolean(flags[flagKey]);
    },
    [flags]
  );

  return {
    flags,
    loading,
    isEnabled,
    refresh,
  };
}

