import { supabase } from '@/lib/supabase';

/**
 * Single source of truth for the logged-in gym operator and, most importantly,
 * for the tenant (gym) they are allowed to touch.
 *
 * Every data-layer call in this app MUST take its tenant id from here instead
 * of trusting a value that came back from a form or a URL.
 */

export const SESSION_KEY = 'gym_session';

/** Cookie mirror of the tenant id so server-side route handlers can scope reads. */
export const TENANT_COOKIE = 'forgeos_tenant';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GymRole = 'super_admin' | 'owner' | 'receptionist' | 'member';

export interface GymSession {
  userId: string;
  role: GymRole | string;
  name: string;
  phone: string;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantPhone?: string | null;
  /** Member's public @handle, when they signed in as a member. */
  username?: string | null;
  /**
   * Phase 13: TRUE when this account still holds a desk-issued or legacy PIN and
   * must choose a real password before continuing.
   *
   * Carried IN the session (not looked up again per page) because the forced
   * change is a one-way door: the client routes to /setup-password on it, and
   * every other page needs to know the value without another round trip.
   */
  passwordMustChange?: boolean;
  /**
   * Phase 13: the id to present when CHANGING this password.
   *
   * Equals `userId` for both roles, but named separately so a future split
   * between the auth identity and the gym identity cannot silently change which
   * id gets sent to the credential endpoint.
   */
  userIdForPassword?: string;
}

/** True only for a well-formed UUID. Used to reject junk before hitting Postgres. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Reads the session from localStorage. Safe on the server (returns null) so it
 * can be called during the initial render of a client component.
 */
export function readSession(): GymSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as GymSession;
    if (!parsed || typeof parsed !== 'object' || !parsed.userId) return null;

    // A non-UUID tenant id would silently widen every query to "no filter".
    if (parsed.tenantId !== null && !isUuid(parsed.tenantId)) {
      parsed.tenantId = null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Persists the session and mirrors the tenant id into a readable cookie. */
export function writeSession(session: GymSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  setTenantCookie(session.tenantId ?? null);
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_KEY);
  setTenantCookie(null);
}

export function setTenantCookie(tenantId: string | null): void {
  if (typeof window === 'undefined') return;
  const value = tenantId && isUuid(tenantId) ? tenantId : '';
  document.cookie = `${TENANT_COOKIE}=${value}; path=/; max-age=${
    value ? 60 * 60 * 24 * 30 : 0
  }; samesite=lax`;
}

/** Reads the tenant id cookie from inside a route handler. */
export function readTenantCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === TENANT_COOKIE) {
      const value = rest.join('=').trim();
      return isUuid(value) ? value : null;
    }
  }
  return null;
}

/**
 * Resolves the tenant's display identity (gym name + contact number).
 *
 * Older stored sessions only carry tenantId, so the gym name is fetched once
 * and written back. This is what powers the "{tenantName} Command Center"
 * header and the printed invoice letterhead.
 */
export async function resolveTenantIdentity(
  session: GymSession
): Promise<GymSession> {
  if (!session.tenantId || !isUuid(session.tenantId)) {
    return { ...session, tenantId: null };
  }

  if (session.tenantName && session.tenantPhone) return session;

  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, phone, slug')
    .eq('id', session.tenantId)
    .maybeSingle();

  if (error || !data) return session;

  const hydrated: GymSession = {
    ...session,
    tenantId: data.id as string,
    tenantName: (data.name as string) ?? session.tenantName ?? null,
    tenantPhone: (data.phone as string) ?? session.tenantPhone ?? null,
  };

  writeSession(hydrated);
  return hydrated;
}

/** Strips everything but digits and keeps the trailing 10 (India local format). */
export function normalizePhone10(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** Formats an ISO date (or timestamp) as an en-IND dd MMM yyyy string. */
export function formatIndianDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Whole days from today until the given date (negative once expired). */
export function daysUntil(value: string | null | undefined): number {
  if (!value) return 0;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
