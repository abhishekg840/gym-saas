'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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

  async function fetchTenants() {
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) setTenants(data);
    if (error) console.error('Error fetching tenants:', error.message);
  }

  useEffect(() => {
    // Load-on-mount, not render-derived state: the setStates land after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTenants();
  }, []);

  async function toggleStatus(tenant: Tenant) {
    const newStatus = tenant.subscription_status === 'active' ? 'suspended' : 'active';
    const { error } = await supabase
      .from('tenants')
      .update({ subscription_status: newStatus })
      .eq('id', tenant.id);

    if (!error) fetchTenants();
    else alert('Error: ' + error.message);
  }

  async function changeTier(tenantId: string, newTier: string) {
    const { error } = await supabase
      .from('tenants')
      .update({ subscription_tier: newTier })
      .eq('id', tenantId);

    if (!error) fetchTenants();
    else alert('Error: ' + error.message);
  }

  async function createGymTenant(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const { data: tenant, error } = await supabase
      .from('tenants')
      .insert([
        {
          name: gymName.trim(),
          slug: cleanSlug,
          owner_name: ownerName.trim(),
          phone: ownerPhone.trim(),
          subscription_tier: tier,
          subscription_status: 'active',
        },
      ])
      .select()
      .single();

    if (tenant && !error) {
      // Create default owner user with 1234 PIN
      await supabase.from('gym_users').insert([
        {
          tenant_id: tenant.id,
          phone: ownerPhone.trim(),
          full_name: ownerName.trim(),
          role: 'owner',
          pin_code: '1234',
        },
      ]);

      setShowAddModal(false);
      setGymName('');
      setSlug('');
      setOwnerName('');
      setOwnerPhone('');
      fetchTenants();
    } else {
      alert(error?.message || 'Failed to create gym');
    }
    setLoading(false);
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
            Global Gym OS License Controller · GlitchFiesta Master Access
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/"
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
    </main>
  );
}