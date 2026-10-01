import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/session';

/**
 * Branch switching (Module 11.2).
 *
 * The owner picks a branch from the console top bar; the choice is stored in
 * localStorage (the same place the gym session lives) and mirrored nowhere
 * else — every screen that filters reads it back through readBranchId().
 * `null` means "All branches".
 *
 * Scoping rule (documented in migration 0008): rows with a null branch_id are
 * unassigned and therefore shown under every filter, so switching branch never
 * makes a gym's own records vanish.
 */

export const BRANCH_KEY = 'gym_branch';

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
}

/** The stored branch id, or null for "All branches". Corrupt values read as null. */
export function readBranchId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BRANCH_KEY);
    return raw && isUuid(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeBranchId(branchId: string | null): void {
  if (typeof window === 'undefined') return;
  if (!branchId) {
    window.localStorage.removeItem(BRANCH_KEY);
    return;
  }
  if (!isUuid(branchId)) return;
  window.localStorage.setItem(BRANCH_KEY, branchId);
}

/** Active branches for one gym, seeded "Main Branch" first. */
export async function listBranches(tenantId: string | null | undefined): Promise<Branch[]> {
  if (!isUuid(tenantId)) return [];
  const { data, error } = await supabase
    .from('branches')
    .select('id, name, address, phone, is_active')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error || !Array.isArray(data)) return [];
  return data as Branch[];
}

/**
 * True when a row should appear under the currently selected branch.
 * Unassigned rows (null branch_id) are visible everywhere by design.
 */
export function rowMatchesBranch(rowBranchId: string | null | undefined, selected: string | null): boolean {
  if (!selected) return true;
  if (!rowBranchId) return true;
  return rowBranchId === selected;
}
