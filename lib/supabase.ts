import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Creates a Supabase client, falling back to a noop client if the required
 * environment variables are missing or invalid. This prevents module load (and
 * therefore SSR / page renders) from crashing when Supabase is not configured.
 * Every method on the noop client safely returns empty / neutral values so the
 * render tree never comes down due to an auth misconfiguration.
 */
function makeSupabaseClient(url: string, key: string, options: any): any {
  try {
    return createClient(url, key, options);
  } catch {
    return {
      auth: {
        signInWithOAuth: () =>
          Promise.resolve({ error: new Error('Supabase not configured') }),
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
        signOut: () => Promise.resolve({ error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: null,
                error: new Error('Supabase not configured'),
              }),
          }),
        }),
      }),
    };
  }
}

/**
 * Public (anon) Supabase client — safe on both server and client.
 * Never throws at module load even if env vars are missing.
 */
export const supabase = makeSupabaseClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
  },
});

/**
 * Service-role (admin) Supabase client — bypasses RLS.
 * Only use in server-side API routes; never expose to the browser.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Never throws at module load even if the service role key is missing.
 */
export const supabaseAdmin = makeSupabaseClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);