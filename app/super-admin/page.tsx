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

/** A mutation that must be authorised with the super admin's password. */
type AuthorizedAction = (creds: { identifier: string; password: string }) => Promise<void>;

function describeRpcError(err: unknown): { message: string; code: string } {
  const failure = err as { message?: unknown; code?: unknown } | null;
  const message =
    typeof failure?.message === 'string' && failure.message
      ? failure.message
      : 'The server refused the request.';
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

  // Credentials for password-gated operations
  const [adminCreds, setAdminCreds] = useState<{ identifier: string; password: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<AuthorizedAction | null>(null);
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  /**
   * Reads directory via /api/super-admin/tenants (which checks SUPER_ADMIN_PASSWORD / Vyroniq@2026 or RPC)
   */
  async function fetchTenants(creds?: { identifier: string; password: string }) {
    const effective = creds ?? adminCreds;
    if (!effective) {
      setPendingAction(() => (c: { identifier: string; password: string }) => fetchTenants(c));
      return;
    }

    const res = await fetch('/api/super-admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'list',
        identifier: effective.identifier,
        password: effective.password,
      }),
    });

    const result = await res.json();
    if (!res.ok || !result.ok) {
      throw { message: result.error || 'Unauthorized', code: result.code || '45005' };
    }

    setTenants((result.data ?? []) as Tenant[]);
  }

  const router = useRouter();

  useEffect(() => {
    const session = readSession();
    if (!session || session.role !== 'super_admin') {
      router.replace('/login');
      return;
    }

    fetchTenants();
  }, [router]);

  /**
   * Runs a password-gated mutation.
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

    const session = readSession();
    const identifier = (session?.phone || session?.userId || '9569272339').trim();
    if (authPassword === '') return;

    setAuthBusy(true);
    setAuthError(null);
    try {
      const creds = { identifier, password: authPassword };
      await action(creds);
      setAdminCreds(creds);
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
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_status',
          identifier: creds.identifier,
          password: creds.password,
          tenant_id: tenant.id,
          status: newStatus,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        throw { message: result.error || 'Failed to update status', code: result.code };
      }
      await fetchTenants(creds);
    });
  }

  async function changeTier(tenantId: string, newTier: string) {
    await runAuthorized(async (creds) => {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_tier',
          identifier: creds.identifier,
          password: creds.password,
          tenant_id: tenantId,
          tier: newTier,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        throw { message: result.error || 'Failed to update tier', code: result.code };
      }
      await fetchTenants(creds);
    });
  }

  async function createGymTenant(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      await runAuthorized(async (creds) => {
        const res = await fetch('/api/super-admin/tenants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_tenant',
            identifier: creds.identifier,
            password: creds.password,
            name: gymName.trim(),
            slug: slug.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            owner_name: ownerName.trim(),
            owner_phone: ownerPhone.trim(),
            tier: tier,
            owner_password: TEMP_OWNER_PASSWORD,
          }),
        });
        const result = await res.json();
        if (!res.ok || !result.ok) {
          throw { message: result.error || 'Failed to create gym', code: result.code };
        }

        setShowAddModal(false);
        setGymName('');
        setSlug('');
        setOwnerName('');
        setOwnerPhone('');
        setTier('pro');
        await fetchTenants(creds);

        if (result.owner_password_set) {
          alert(`Gym created! Owner login:\nPhone: ${ownerPhone.trim()}\nTemp Password: ${TEMP_OWNER_PASSWORD}`);
        } else {
          alert(`Gym created! To provision an owner, add their name and phone from the gym dashboard.`);
        }
      });
    } catch (err: unknown) {
      alert('Error creating gym: ' + (err instanceof Error ? err.message : describeRpcError(err).message));
    } finally {
      setLoading(false);
    }
  }

  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.owner_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.phone.includes(searchTerm)
  );

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-12 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-neutral-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <Link href="/admin" className="p-2 bg-neutral-900 border border-neutral-800 rounded-xl hover:bg-neutral-800 text-neutral-400 hover:text-white transition">
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <Building2 className="w-6 h-6 text-emerald-400" />
                Vyroniq Super Admin
              </h1>
            </div>
            <p className="text-xs text-neutral-400 mt-1">Platform Multi-Tenant Master Control Center</p>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold px-4 py-2.5 rounded-xl text-xs transition"
            >
              <Plus className="w-4 h-4" />
              Deploy New Gym Tenant
            </button>
          </div>
        </div>

        {/* Global Directory Overview Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <span className="text-[10px] font-mono uppercase text-neutral-400">Total Gym Deployments</span>
            <p className="text-2xl font-black text-white mt-1">{tenants.length}</p>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <span className="text-[10px] font-mono uppercase text-emerald-400">Active Licenses</span>
            <p className="text-2xl font-black text-emerald-400 mt-1">
              {tenants.filter(t => t.subscription_status === 'active').length}
            </p>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
            <span className="text-[10px] font-mono uppercase text-rose-400">Suspended Deployments</span>
            <p className="text-2xl font-black text-rose-400 mt-1">
              {tenants.filter(t => t.subscription_status !== 'active').length}
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-neutral-400" />
            <input 
              type="text" 
              placeholder="Search by gym name, subdomain slug, owner name, or phone..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-neutral-400 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Deployment Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 w-full max-w-lg space-y-4">
              <h2 className="text-lg font-black text-white">Deploy New Gym Tenant</h2>
              
              <form onSubmit={createGymTenant} className="space-y-4 text-xs font-mono">
                <div>
                  <label className="block text-neutral-400 mb-1">Gym Commercial Brand Name</label>
                  <input 
                    type="text" 
                    required 
                    value={gymName}
                    onChange={(e) => {
                      setGymName(e.target.value);
                      if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                    }}
                    placeholder="e.g. Iron Forge Fitness"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-neutral-400 mb-1">Subdomain Slug</label>
                  <div className="flex items-center">
                    <input 
                      type="text" 
                      required 
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'))}
                      placeholder="iron-forge"
                      className="flex-1 bg-neutral-950 border border-neutral-800 rounded-l-xl px-3 py-2 text-white"
                    />
                    <span className="bg-neutral-800 text-neutral-400 px-3 py-2 border-y border-r border-neutral-800 rounded-r-xl text-[10px]">
                      .gym.glitchfiesta.in
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-neutral-400 mb-1">Owner Full Name</label>
                    <input 
                      type="text" 
                      required 
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-neutral-400 mb-1">Owner Mobile Phone</label>
                    <input 
                      type="text" 
                      required 
                      value={ownerPhone}
                      onChange={(e) => setOwnerPhone(e.target.value)}
                      placeholder="+91..."
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-neutral-400 mb-1">Initial Subscription Tier</label>
                  <select 
                    value={tier}
                    onChange={(e) => setTier(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white uppercase"
                  >
                    <option value="starter">Starter — ₹1,999/mo (Up to 150 members)</option>
                    <option value="pro">Pro — ₹3,999/mo (Unlimited + WhatsApp Bot)</option>
                    <option value="franchise">Franchise — ₹7,999/mo (Multi-Branch + Custom Domain)</option>
                  </select>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button 
                    type="button" 
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 border border-neutral-800 rounded-xl hover:bg-neutral-800 text-neutral-400 transition"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold px-4 py-2 rounded-xl transition"
                  >
                    {loading ? 'Provisioning Tenant…' : 'Deploy Tenant'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tenant Table */}
        <div className="border border-neutral-800 bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-950/50 text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                <th className="px-5 py-4">Tenant / Brand</th>
                <th className="px-4 py-4">Owner Profile</th>
                <th className="px-4 py-4">Tier Plan</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-5 py-4 text-right">Emergency Kill Switch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60 font-sans">
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-neutral-400 text-xs">
                    No gym tenants matching criteria.
                  </td>
                </tr>
              ) : filteredTenants.map((t) => (
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

      {/* Authorisation prompt for the password-gated operations */}
      {pendingAction && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 w-full max-w-md">
            <div className="flex items-center gap-3 mb-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-black text-white">Platform password required</h2>
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed mb-5">
              Reading the gym directory and creating, suspending or re-tiering a gym
              each verify the super admin password before anything
              happens. It is kept in memory for this tab only and never written
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
