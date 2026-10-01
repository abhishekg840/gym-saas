import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Explicit auth config so the Google flow behaves the same everywhere:
 *  - `persistSession` keeps the access/refresh tokens where the browser (and the
 *    Capacitor WebView, whose localStorage survives relaunches) can find them,
 *  - `autoRefreshToken` swaps the refresh token in the background,
 *  - `detectSessionInUrl` picks up the OAuth redirect back on /login.
 *
 * Passives sessions here are the *Google* identity only — the gym session itself
 * lives in lib/session.ts (localStorage + tenant cookie), set by the API routes.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
  },
});