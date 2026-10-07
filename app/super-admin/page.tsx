'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { readSession } from '@/lib/session';
import { 
  ShieldAlert, 
  Building2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Plus, 
  Power, 
  Search, 
  ArrowLeft,
  DollarSign
} from 'lucide-react';
import Link from 'next/link';

/**
 * Temporary password handed to a newly provisioned owner.
 *
 * '1234' is the desk default the Phase 15 backfill standardised on and the same
 * value fn_superadmin_create_tenant itself defaults to. It is bcrypt-hashed
 * inside fn_staff_provision_owner and flagged password_must_change, so it is a
 * FIRST password for an account that cannot be used until it is replaced — not
 * a secret that persists. It is still shown once, for hand-off.
 */
const TEMP_OWNER_PASSWORD = '1234';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  phone: string;
  owner_name: string;
  subscription_tier: string;
  subscription_status: string;
  trial_ends_at: string;
  created_at: string;
}

/** A mutation that must be authorised with the super admin's own password. */
type AuthorizedAction = (creds: { identifier: string; password: string }) => Promise<void>;

/**
 * Normalises a supabase.rpc() failure into something safe to show.
 *
 * `code` is kept because SQLSTATE 45005 ("Unauthorized", raised by every
 * fn_superadmin_* BEFORE it touches anything, when the supplied password does
 * not verify) decides whether a cached credential should be dropped and the
 * prompt shown again — a password that stopped working must not fail
 * identically forever.
 */
function describeRpcError(err: unknown): { message: string; code: string } {
  const failure = err as { message?: unknown; code?: unknown } | null;
  const message =
    typeof failure?.message === 'string' && failure.message
      ? failure.message
      : 'The database refused the request.';
  const code = typeof failure?.code === 'string' ? failure.code : '';
  return { message, code };
}

export default function SuperAdminPortal() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  // New Gym Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [gymName, setGymName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [tier, setTier] = useState('pro');

  // Credentials for the password-gated fn_superadmin_* RPCs. HELD IN MEMORY
  // ONLY: never localStorage, never a cookie, never the URL — a reload asks
  // again, which is the price of not writing a platform credential to disk.
  // `pendingAction` is the mutation currently waiting on the prompt.
  const [adminCreds, setAdminCreds] = useState<{ identifier: string; password: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<AuthorizedAction | null>(null);
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  /**
   * Reads the directory through fn_superadmin_list_tenants (0020 §3), which now
   * verifies the super admin's password INSIDE Postgres exactly like every
   * mutation — the old no-credential overload is dropped, so "readable with the
   * anon key anyway" no longer describes owner names and phone numbers.
   *
   * With nothing cached it opens the same prompt a mutation uses and resumes
   * from submitAuthorization() the moment the password arrives. A rejected
   * password (SQLSTATE 45005) surfaces as the prompt's own error, and the
   * caller clears the cache so the next attempt re-prompts.
   */
  async function fetchTenants(creds?: { identifier: string; password: string }) {
    const effective = creds ?? adminCreds;
    if (!effective) {
      setPendingAction(() => (c: { identifier: string; password: string }) => fetchTenants(c));
      return;
    }

    const { data, error } = await supabase.rpc('fn_superadmin_list_tenants', {
      p_identifier: effective.identifier,
      p_password: effective.password,
    });
    if (error) throw error;
    setTenants((data ?? []) as Tenant[]);
  }

  const router = useRouter();

  useEffect(() => {
    // A platform console has no business rendering for a gym session. The
    // directory read below needs the super admin password too (0020), and
    // neither it nor any mutation should be offered to a member or owner who
    // wandered here from a stale tab.
    const session = readSession();
    if (!session || session.role !== 'super_admin') {
      router.replace('/login');
      return;
    }

    // Load-on-mount, not render-derived state: the setStates land after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTenants();
  }, [router]);

  /**
   * Runs a password-gated mutation. With a credential cached from earlier in
   * this tab it goes straight through; otherwise the prompt opens and the
   * action resumes from submitAuthorization(). A rejected password (SQLSTATE
   * 45005) clears the cache so the next attempt prompts instead of re-failing
   * identically forever.
   */
  async function runAuthorized(action: AuthorizedAction) {
    if (adminCreds) {
      try {
        await action(adminCreds);
        return;
      } catch (err) {
        const failure = describeRpcError(err);
        if (failure.code !== '45005') {
          alert('Error: ' + failure.message);
          return;
        }
        setAdminCreds(null);
      }
    }

    setAuthPassword('');
    setAuthError(null);
    setPendingAction(() => action);
  }

  async function submitAuthorization(e: React.FormEvent) {
    e.preventDefault();
    const action = pendingAction;
    if (!action) return;

    // The identifier is the signed-in super admin's own phone (or user id):
    // fn_superadmin_verify_password only ever accepts a row whose role is
    // super_admin, so reusing the session identity keeps this to one field.
    const session = readSession();
    const identifier = (session?.phone || session?.userId || '').trim();
    if (!identifier) {
      setAuthError('Your session has no identifier. Sign in again.');
      return;
    }
    if (authPassword === '') return;

    setAuthBusy(true);
    setAuthError(null);
    try {
      const creds = { identifier, password: authPassword };
      await action(creds);
      setAdminCreds(creds); // memory only — see the state declarations above
      setPendingAction(null);
    } catch (err) {
      setAuthError(describeRpcError(err).message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function toggleStatus(tenant: Tenant) {
    const newStatus = tenant.subscription_status === 'active' ? 'suspended' : 'active';
    await runAuthorized(async (creds) => {
      const { error } = await supabase.rpc('fn_superadmin_set_subscription_status', {
        p_identifier: creds.identifier,
        p_password: creds.password,
        p_tenant_id: tenant.id,
        p_status: newStatus,
      });
      if (error) throw error;
      await fetchTenants(creds);
    });
  }

  async function changeTier(tenantId: string, newTier: string) {
    await runAuthorized(async (creds) => {
      const { error } = await supabase.rpc('fn_superadmin_set_subscription_tier', {
        p_identifier: creds.identifier,
        p_password: creds.password,
        p_tenant_id: tenantId,
        p_tier: newTier,
      });
      if (error) throw error;
      await fetchTenants(creds);
    });
  }

  async function createGymTenant(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      await runAuthorized(async (creds) => {
        // One RPC creates the gym AND its owner credential: the tenant INSERT
        // and the bcrypt hash never travel through the anon key any more, and
        // "how an owner credential is created" stays in exactly one place.
        const { data, error } = await supabase.rpc('fn_superadmin_create_tenant', {
          p_identifier: creds.identifier,
          p_password: creds.password,
          p_name: gymName.trim(),
          p_slug: slug.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          p_owner_name: ownerName.trim(),
          p_owner_phone: ownerPhone.trim(),
          p_tier: tier,
          p_owner_password: TEMP_OWNER_PASSWORD,
        });
        if (error) throw error;

        const created = (data ?? {}) as { owner_password_set?: boolean };

        setShowAddModal(false);
        setGymName('');
        setSlug('');
        setOwnerName('');
        setOwnerPhone('');
        setTier('pro');
        await fetchTenants(creds);

        // The owner row only exists when BOTH owner fields were supplied — the
        // provisioner refuses to invent half an identity — so say which
        // happened rather than promising a password for a login that was
        // never created.
        alert(
          created.owner_password_set
            ? `Owner created. Temporary password: ${TEMP_OWNER_PASSWORD}\n\nShare it with the owner — they will be asked to change it at first sign-in.`
            : 'Gym created, but no owner login was provisioned — owner name and phone are both required to create one.'
        );
      });
    } finally {
      setLoading(false);
    }
  }

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.owner_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.phone.includes(searchTerm)
  );

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-6 sm:p-12 font-sans">
      {/* Create Gym Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl w-full max-w-md">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-400" /> Onboard New Gym Client
            </h2>
            <form onSubmit={createGymTenant} className="space-y-3.5">
              <div>
                <label className="text-[10px] font-mono uppercase text-neutral-400 block mb-1">Gym Name</label>
                <input
                  required
                  value={gymName}
                  onChange={(e) => {
                    setGymName(e.target.value);
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                  }}
                  placeholder="Iron Pulse Fitness"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono uppercase text-neutral-400 block mb-1">Gym Slug / Domain</label>
                <input
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="iron-pulse"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm font-mono text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase text-neutral-400 block mb-1">Owner Name</label>
                  <input
                    required
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Suresh Kumar"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase text-neutral-400 block mb-1">Owner Phone</label>
                  <input
                    required
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    placeholder="9876543210"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono uppercase text-neutral-400 block mb-1">Subscription Tier</label>
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none"
                >
                  <option value="starter">Starter Plan (₹799/mo)</option>
                  <option value="pro">Pro Fitness OS (₹1,499/mo)</option>
                  <option value="franchise">Franchise Multi-Gym (₹3,499/mo)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="w-1/2 py-2.5 rounded-xl bg-neutral-800 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-1/2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs"
                >
                  {loading ? 'Creating...' : 'Onboard Gym'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Top Header */}
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldAlert className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-black tracking-tight">Super Admin Platform Hub</h1>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Global Gym OS License Controller · Vyroniq Master Access
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="text-xs font-mono text-neutral-400 hover:text-white px-3.5 py-2 rounded-xl border border-neutral-800 bg-neutral-900"
          >
            ← Open Local Gym
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs px-4 py-2 rounded-xl transition"
          >
            <Plus className="w-4 h-4" /> Add New Gym
          </button>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl">
          <span className="text-[10px] font-mono uppercase text-neutral-400">Total Gyms Onboarded</span>
          <p className="text-3xl font-black mt-1">{tenants.length}</p>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl">
          <span className="text-[10px] font-mono uppercase text-emerald-400">Active Licenses</span>
          <p className="text-3xl font-black text-emerald-400 mt-1">
            {tenants.filter((t) => t.subscription_status === 'active').length}
          </p>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl">
          <span className="text-[10px] font-mono uppercase text-rose-400">Suspended / Frozen</span>
          <p className="text-3xl font-black text-rose-400 mt-1">
            {tenants.filter((t) => t.subscription_status === 'suspended').length}
          </p>
        </div>
      </div>

      {/* Gym Tenants Table */}
      <div className="max-w-6xl mx-auto bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-base font-bold">Client Gym Subscriptions</h2>
          <div className="relative w-64">
            <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search gym, owner, phone..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-300">
            <thead className="bg-neutral-950 text-neutral-400 uppercase font-mono">
              <tr>
                <th className="px-5 py-4">Gym Facility</th>
                <th className="px-4 py-4">Owner & Phone</th>
                <th className="px-4 py-4">Tier</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-5 py-4 text-right">Master Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filteredTenants.map((t) => (
                <tr key={t.id} className="hover:bg-neutral-800/40 transition">
                  <td className="px-5 py-4">
                    <p className="font-bold text-white text-sm">{t.name}</p>
                    <span className="text-[10px] font-mono text-neutral-400">{t.slug}.gym.glitchfiesta.in</span>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-white">{t.owner_name}</p>
                    <p className="font-mono text-neutral-400">{t.phone}</p>
                  </td>
                  <td className="px-4 py-4">
                    <select
                      value={t.subscription_tier}
                      onChange={(e) => changeTier(t.id, e.target.value)}
                      className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs font-mono uppercase"
                    >
                      <option value="starter">Starter</option>
                      <option value="pro">Pro</option>
                      <option value="franchise">Franchise</option>
                    </select>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                        t.subscription_status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      }`}
                    >
                      {t.subscription_status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={() => toggleStatus(t)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs transition ${
                        t.subscription_status === 'active'
                          ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {t.subscription_status === 'active' ? 'Suspend Gym' : 'Activate Gym'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Authorisation prompt for the password-gated fn_superadmin_* RPCs.
          Renders above every other modal: the mutation resumes the moment the
          password verifies, and Cancel simply drops it. */}
      {pendingAction && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 w-full max-w-md">
            <div className="flex items-center gap-3 mb-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-black text-white">Platform password required</h2>
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed mb-5">
              Reading the gym directory and creating, suspending or re-tiering a gym
              each verify the super admin password inside Postgres before anything
              happens — the same reason sign-in stopped comparing passwords in
              JavaScript. It is kept in memory for this tab only and never written
              to storage.
            </p>

            <form onSubmit={submitAuthorization}>
              <input
                type="password"
                autoFocus
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Super admin password"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-amber-500"
              />
              {authError && (
                <p className="mt-3 text-xs text-rose-400">{authError}</p>
              )}
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setPendingAction(null)}
                  className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-xs font-mono text-neutral-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={authBusy || authPassword === ''}
                  className="flex-1 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 text-xs font-mono font-bold text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition"
                >
                  {authBusy ? 'Authorising…' : 'Authorise'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}