'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { readSession, writeSession } from '@/lib/session';
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
  DollarSign,
  Cpu,
  Radio,
  ExternalLink,
  Edit3,
  Calendar,
  Megaphone,
  KeyRound,
  Lock,
  Unlock,
  ChevronDown,
  Activity,
  Users,
  Image,
  RefreshCw,
  X,
  Smartphone,
  Check,
  AlertTriangle
} from 'lucide-react';
import Link from 'next/link';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  owner_name: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  subscription_expires_at?: string | null;
  trial_ends_at?: string | null;
  created_at?: string | null;
  logo_url?: string | null;
  address?: string | null;
}

interface HardwareDeviceRow {
  id: string;
  tenant_id: string;
  device_name: string;
  device_type: string;
  status: string;
  last_heartbeat: string | null;
}

interface PlatformMetrics {
  totalRevenue: number;
  onlineDevicesCount: number;
  totalActiveMembers: number;
  totalTenants: number;
}

export default function SuperAdminPortal() {
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [devices, setDevices] = useState<HardwareDeviceRow[]>([]);
  const [metrics, setMetrics] = useState<PlatformMetrics>({
    totalRevenue: 0,
    onlineDevicesCount: 0,
    totalActiveMembers: 0,
    totalTenants: 0,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  // Super Admin Password in memory for this session
  const [adminPassword, setAdminPassword] = useState('Vyroniq@2026');
  const [authRequired, setAuthRequired] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Deploy New Gym Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [gymName, setGymName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [tier, setTier] = useState('pro');
  const [deployBusy, setDeployBusy] = useState(false);

  // Manage Branding Modal
  const [brandingModalTenant, setBrandingModalTenant] = useState<Tenant | null>(null);
  const [brandName, setBrandName] = useState('');
  const [brandSlug, setBrandSlug] = useState('');
  const [brandOwnerName, setBrandOwnerName] = useState('');
  const [brandPhone, setBrandPhone] = useState('');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandAddress, setBrandAddress] = useState('');
  const [brandBusy, setBrandBusy] = useState(false);

  // SaaS License Modal
  const [licenseModalTenant, setLicenseModalTenant] = useState<Tenant | null>(null);
  const [selectedTier, setSelectedTier] = useState('pro');
  const [licenseBusy, setLicenseBusy] = useState(false);

  // Hardware Status Modal
  const [hardwareModalTenant, setHardwareModalTenant] = useState<Tenant | null>(null);
  const [unlockPulseBusy, setUnlockPulseBusy] = useState<string | null>(null);
  const [unlockSuccess, setUnlockSuccess] = useState<string | null>(null);

  // Broadcast Announcement Modal
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastBusy, setBroadcastBusy] = useState(false);

  // Action Dropdown open ID
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // ---- Fetch Directory & Platform Telemetry ----
  const loadMasterData = useCallback(async (pwd: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/super-admin/tenants?password=${encodeURIComponent(pwd)}`);
      const result = await res.json();

      if (!res.ok || !result.ok) {
        if (res.status === 401) {
          setAuthRequired(true);
          return;
        }
        throw new Error(result.error || 'Failed to load master directory.');
      }

      setTenants((result.tenants ?? []) as Tenant[]);
      setDevices((result.devices ?? []) as HardwareDeviceRow[]);
      if (result.metrics) {
        setMetrics(result.metrics as PlatformMetrics);
      }
      setAuthRequired(false);
    } catch (err: unknown) {
      console.error(err);
      setAuthRequired(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const session = readSession();
    if (!session || session.role !== 'super_admin') {
      router.replace('/login');
      return;
    }
    void loadMasterData(adminPassword);
  }, [router, loadMasterData, adminPassword]);

  // Authorization Submit
  const handleAuthorize = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      await loadMasterData(adminPassword);
    } catch {
      setAuthError('Invalid password. Default is Vyroniq@2026.');
    } finally {
      setAuthBusy(false);
    }
  };

  // ---- Tenant Deployment ----
  const handleDeployTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeployBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_tenant',
          password: adminPassword,
          name: gymName.trim(),
          slug: slug.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          owner_name: ownerName.trim(),
          owner_phone: ownerPhone.trim(),
          tier,
          owner_password: '1234',
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Deployment failed.');

      alert(`Tenant Deployed Successfully!\nBrand: ${gymName}\nSlug: ${result.slug}\nOwner: ${ownerName} (${ownerPhone})`);
      setShowAddModal(false);
      setGymName('');
      setSlug('');
      setOwnerName('');
      setOwnerPhone('');
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Deployment failed');
    } finally {
      setDeployBusy(false);
    }
  };

  // ---- Open Branding Modal ----
  const openBrandingModal = (t: Tenant) => {
    setBrandingModalTenant(t);
    setBrandName(t.name);
    setBrandSlug(t.slug);
    setBrandOwnerName(t.owner_name || '');
    setBrandPhone(t.phone || '');
    setBrandLogoUrl(t.logo_url || '');
    setBrandAddress(t.address || '');
    setOpenDropdownId(null);
  };

  // Save Branding
  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandingModalTenant) return;
    setBrandBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_branding',
          password: adminPassword,
          tenant_id: brandingModalTenant.id,
          name: brandName,
          slug: brandSlug,
          owner_name: brandOwnerName,
          phone: brandPhone,
          logo_url: brandLogoUrl,
          address: brandAddress,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Failed to update branding.');

      alert('Branding and tenant profile saved.');
      setBrandingModalTenant(null);
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBrandBusy(false);
    }
  };

  // ---- Open SaaS License Modal ----
  const openLicenseModal = (t: Tenant) => {
    setLicenseModalTenant(t);
    setSelectedTier(t.subscription_tier || 'pro');
    setOpenDropdownId(null);
  };

  // Extend SaaS Expiry
  const handleExtendSaaS = async (days: number) => {
    if (!licenseModalTenant) return;
    setLicenseBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend_saas',
          password: adminPassword,
          tenant_id: licenseModalTenant.id,
          days,
          tier: selectedTier,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Failed to extend license.');

      alert(`License extended by ${days} days! New Expiry: ${new Date(result.new_expiry).toLocaleDateString('en-IN')}`);
      setLicenseModalTenant(null);
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLicenseBusy(false);
    }
  };

  // Toggle SaaS Hold
  const handleToggleSaaSHold = async (tenantId: string) => {
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_saas_hold',
          password: adminPassword,
          tenant_id: tenantId,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Failed to toggle status.');

      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  // ---- Open Hardware Status Modal ----
  const openHardwareModal = (t: Tenant) => {
    setHardwareModalTenant(t);
    setUnlockSuccess(null);
    setOpenDropdownId(null);
  };

  // Remote Unlock Pulse
  const handleRemoteUnlock = async (tenantId: string, deviceId?: string) => {
    setUnlockPulseBusy(deviceId || 'all');
    setUnlockSuccess(null);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remote_unlock',
          password: adminPassword,
          tenant_id: tenantId,
          device_id: deviceId || null,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Unlock command failed');

      setUnlockSuccess('Unlock pulse dispatched to IoT controller successfully.');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Remote unlock failed.');
    } finally {
      setUnlockPulseBusy(null);
    }
  };

  // ---- Impersonate Tenant ----
  const handleImpersonate = async (t: Tenant) => {
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'impersonate',
          password: adminPassword,
          tenant_id: t.id,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Impersonation failed.');

      // Write session and forward directly to that gym's /admin
      writeSession(result.session);
      window.open('/admin', '_blank');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not generate session.');
    }
  };

  // ---- Broadcast Announcement ----
  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    setBroadcastBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'broadcast_announcement',
          password: adminPassword,
          title: broadcastTitle,
          message: broadcastMessage,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Broadcast failed.');

      alert(`Broadcast sent to ${result.count} gym tenant dashboards.`);
      setShowBroadcastModal(false);
      setBroadcastTitle('');
      setBroadcastMessage('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Broadcast failed');
    } finally {
      setBroadcastBusy(false);
    }
  };

  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.owner_name && t.owner_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (t.phone && t.phone.includes(searchTerm))
  );

  return (
    <main className="min-h-screen bg-[#090d16] text-slate-100 p-6 md:p-10 font-sans antialiased">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Top Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800/80 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <Link href="/admin" className="p-2 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition">
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <Building2 className="w-6 h-6 text-emerald-400" />
                Vyroniq Super Admin
              </h1>
              <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-mono font-bold text-emerald-400">
                ENTERPRISE CONTROL CENTER
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">Multi-Tenant Fleet Telemetry, IoT Hardware &amp; SaaS Governance</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowBroadcastModal(true)}
              className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 font-bold px-3.5 py-2 rounded-xl text-xs transition"
            >
              <Megaphone className="w-4 h-4" />
              Broadcast Alert
            </button>
            <button 
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs transition shadow-lg shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" />
              Deploy New Gym
            </button>
            <button
              onClick={() => void loadMasterData(adminPassword)}
              disabled={loading}
              title="Refresh Telemetry"
              className="p-2 border border-slate-800 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Platform Telemetry Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-mono uppercase text-[10px]">Total Fleet Revenue</span>
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-black text-white mt-2">
              ₹{metrics.totalRevenue.toLocaleString('en-IN')}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">Aggregated across all gym billing invoices</p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-mono uppercase text-[10px]">Active IoT Gateways</span>
              <Cpu className="w-4 h-4 text-sky-400" />
            </div>
            <p className="text-2xl font-black text-sky-400 mt-2">
              {metrics.onlineDevicesCount} <span className="text-xs text-slate-500 font-normal">/ {devices.length} Total</span>
            </p>
            <p className="text-[10px] text-slate-500 mt-1">Biometric &amp; RFID turnstiles heartbeat &lt; 2m</p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-mono uppercase text-[10px]">Active Members Fleetwide</span>
              <Users className="w-4 h-4 text-indigo-400" />
            </div>
            <p className="text-2xl font-black text-indigo-400 mt-2">
              {metrics.totalActiveMembers.toLocaleString('en-IN')}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">Enrolled members with active turnstile access</p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-mono uppercase text-[10px]">Deployments &amp; Licenses</span>
              <Building2 className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-black text-white mt-2">
              {tenants.filter(t => t.subscription_status === 'active').length}{' '}
              <span className="text-xs text-slate-500 font-normal">/ {tenants.length} Total</span>
            </p>
            <p className="text-[10px] text-slate-500 mt-1">
              {tenants.filter(t => t.subscription_status === 'suspended').length} suspended on hold
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by gym brand, subdomain slug, owner name, or phone..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Master Fleet Table */}
        <div className="border border-slate-800/80 bg-slate-900/90 rounded-3xl overflow-hidden shadow-2xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                <th className="px-5 py-4">Gym Tenant &amp; Subdomain</th>
                <th className="px-4 py-4">Owner Profile</th>
                <th className="px-4 py-4">Plan Tier</th>
                <th className="px-4 py-4">License Status</th>
                <th className="px-4 py-4">Hardware Devices</th>
                <th className="px-5 py-4 text-right">Enterprise Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500 text-xs">
                    {loading ? 'Polling fleet telemetry...' : 'No gym deployments matching your search.'}
                  </td>
                </tr>
              ) : filteredTenants.map((t) => {
                const tenantDevices = devices.filter(d => d.tenant_id === t.id);
                const hasOnlineDevice = tenantDevices.some(d => {
                  if (!d.last_heartbeat) return false;
                  return Date.now() - new Date(d.last_heartbeat).getTime() < 120000;
                });
                const isSuspended = t.subscription_status === 'suspended';
                const isDropdownOpen = openDropdownId === t.id;

                return (
                  <tr key={t.id} className="hover:bg-slate-800/30 transition">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {t.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover bg-slate-800 border border-slate-700" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center font-bold text-emerald-400">
                            {t.name.charAt(0)}
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-white text-sm">{t.name}</p>
                          <a 
                            href={`https://${t.slug}.gym.glitchfiesta.in`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-[11px] font-mono text-emerald-400 hover:underline flex items-center gap-1"
                          >
                            {t.slug}.gym.glitchfiesta.in <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <p className="font-medium text-white">{t.owner_name || 'Owner'}</p>
                      <p className="font-mono text-slate-400">{t.phone || 'No phone'}</p>
                    </td>

                    <td className="px-4 py-4">
                      <span className="font-mono uppercase font-bold text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                        {t.subscription_tier || 'PRO'}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                            !isSuspended
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          }`}
                        >
                          {!isSuspended ? <Check className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
                          {isSuspended ? 'SUSPENDED' : 'ACTIVE'}
                        </span>
                        {t.subscription_expires_at && (
                          <p className="text-[10px] text-slate-400 font-mono">
                            Exp: {new Date(t.subscription_expires_at).toLocaleDateString('en-IN')}
                          </p>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <button
                        onClick={() => openHardwareModal(t)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs transition"
                      >
                        <Radio className={`w-3.5 h-3.5 ${hasOnlineDevice ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
                        <span>{tenantDevices.length} Hardware</span>
                      </button>
                    </td>

                    <td className="px-5 py-4 text-right relative">
                      <div className="inline-block text-left">
                        <button
                          onClick={() => setOpenDropdownId(isDropdownOpen ? null : t.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold border border-slate-700 transition"
                        >
                          Actions <ChevronDown className="w-3.5 h-3.5" />
                        </button>

                        {isDropdownOpen && (
                          <div className="absolute right-5 mt-2 w-56 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl z-30 py-2 text-left font-sans text-xs">
                            <button
                              onClick={() => openBrandingModal(t)}
                              className="w-full px-4 py-2 hover:bg-slate-800 text-slate-200 flex items-center gap-2.5 text-left"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-indigo-400" /> Manage Branding &amp; Details
                            </button>
                            <button
                              onClick={() => openLicenseModal(t)}
                              className="w-full px-4 py-2 hover:bg-slate-800 text-slate-200 flex items-center gap-2.5 text-left"
                            >
                              <Calendar className="w-3.5 h-3.5 text-amber-400" /> SaaS License &amp; Plan
                            </button>
                            <button
                              onClick={() => openHardwareModal(t)}
                              className="w-full px-4 py-2 hover:bg-slate-800 text-slate-200 flex items-center gap-2.5 text-left"
                            >
                              <Cpu className="w-3.5 h-3.5 text-sky-400" /> IoT Gateways &amp; Unlock
                            </button>
                            <button
                              onClick={() => {
                                handleImpersonate(t);
                                setOpenDropdownId(null);
                              }}
                              className="w-full px-4 py-2 hover:bg-slate-800 text-emerald-400 flex items-center gap-2.5 text-left font-semibold"
                            >
                              <KeyRound className="w-3.5 h-3.5" /> Impersonate Owner Portal
                            </button>
                            <div className="my-1 border-t border-slate-800"></div>
                            <button
                              onClick={() => {
                                handleToggleSaaSHold(t.id);
                                setOpenDropdownId(null);
                              }}
                              className={`w-full px-4 py-2 hover:bg-slate-800 flex items-center gap-2.5 text-left ${
                                isSuspended ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" /> {isSuspended ? 'Unfreeze SaaS Account' : 'Hold / Suspend Account'}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: Manage Branding & Details */}
      {brandingModalTenant && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-indigo-400" />
                Edit Branding &amp; Details
              </h3>
              <button onClick={() => setBrandingModalTenant(null)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBranding} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Gym Name</label>
                <input
                  type="text"
                  required
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Subdomain Slug</label>
                <div className="flex items-center">
                  <input
                    type="text"
                    required
                    value={brandSlug}
                    onChange={(e) => setBrandSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'))}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-l-xl px-3 py-2 text-white"
                  />
                  <span className="bg-slate-800 text-slate-400 px-3 py-2 border-y border-r border-slate-800 rounded-r-xl text-[10px]">
                    .gym.glitchfiesta.in
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Owner Name</label>
                  <input
                    type="text"
                    required
                    value={brandOwnerName}
                    onChange={(e) => setBrandOwnerName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Owner Phone</label>
                  <input
                    type="text"
                    value={brandPhone}
                    onChange={(e) => setBrandPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Custom Gym Logo URL</label>
                <input
                  type="url"
                  placeholder="https://.../logo.png"
                  value={brandLogoUrl}
                  onChange={(e) => setBrandLogoUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Gym Physical Address</label>
                <input
                  type="text"
                  placeholder="Floor 2, City Center..."
                  value={brandAddress}
                  onChange={(e) => setBrandAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBrandingModalTenant(null)}
                  className="px-4 py-2 border border-slate-800 rounded-xl text-slate-400 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={brandBusy}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition"
                >
                  {brandBusy ? 'Saving...' : 'Save Branding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: SaaS License & Plan Control */}
      {licenseModalTenant && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-amber-400" />
                SaaS License &amp; Plan Control
              </h3>
              <button onClick={() => setLicenseModalTenant(null)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Manage subscription tier, grant license duration extensions, or toggle hold status for <strong className="text-white">{licenseModalTenant.name}</strong>.
            </p>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1.5 font-semibold">Select Platform Tier Plan</label>
                <div className="grid grid-cols-2 gap-2">
                  {['starter', 'standard', 'pro', 'enterprise'].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSelectedTier(p)}
                      className={`p-2.5 rounded-xl border text-left uppercase font-mono text-[11px] font-bold transition ${
                        selectedTier === p
                          ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1.5 font-semibold">Extend License Expiry</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={licenseBusy}
                    onClick={() => handleExtendSaaS(30)}
                    className="p-2.5 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800 text-white font-mono font-bold text-center transition"
                  >
                    +30 Days
                  </button>
                  <button
                    type="button"
                    disabled={licenseBusy}
                    onClick={() => handleExtendSaaS(90)}
                    className="p-2.5 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800 text-white font-mono font-bold text-center transition"
                  >
                    +90 Days
                  </button>
                  <button
                    type="button"
                    disabled={licenseBusy}
                    onClick={() => handleExtendSaaS(365)}
                    className="p-2.5 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800 text-white font-mono font-bold text-center transition"
                  >
                    +1 Year
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => {
                    handleToggleSaaSHold(licenseModalTenant.id);
                    setLicenseModalTenant(null);
                  }}
                  className="px-4 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold transition"
                >
                  {licenseModalTenant.subscription_status === 'suspended' ? 'Unfreeze Account' : 'Toggle SaaS Hold'}
                </button>
                <button
                  type="button"
                  onClick={() => setLicenseModalTenant(null)}
                  className="px-4 py-2 rounded-xl border border-slate-800 text-slate-400 hover:bg-slate-800"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Hardware / IoT Status & Remote Unlock */}
      {hardwareModalTenant && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Cpu className="w-5 h-5 text-sky-400" />
                IoT Turnstiles: {hardwareModalTenant.name}
              </h3>
              <button onClick={() => setHardwareModalTenant(null)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            {unlockSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {unlockSuccess}
              </div>
            )}

            <div className="space-y-3">
              {devices.filter(d => d.tenant_id === hardwareModalTenant.id).length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl">
                  No turnstiles or biometric terminals registered yet for this gym.
                </div>
              ) : (
                devices.filter(d => d.tenant_id === hardwareModalTenant.id).map(dev => {
                  const isOnline = dev.last_heartbeat && (Date.now() - new Date(dev.last_heartbeat).getTime() < 120000);
                  const isUnlocking = unlockPulseBusy === dev.id;

                  return (
                    <div key={dev.id} className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-between text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{dev.device_name}</span>
                          <span className="font-mono text-[10px] uppercase text-slate-400">({dev.device_type})</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                          <span className={`text-[10px] font-mono ${isOnline ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                            {isOnline ? 'ONLINE' : 'OFFLINE'}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {dev.last_heartbeat ? `Last beat: ${new Date(dev.last_heartbeat).toLocaleTimeString('en-IN')}` : 'Never'}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isUnlocking}
                        onClick={() => handleRemoteUnlock(hardwareModalTenant.id, dev.id)}
                        className="px-3 py-1.5 bg-sky-500/10 border border-sky-500/30 hover:bg-sky-500/20 text-sky-400 font-bold rounded-xl transition text-[11px] flex items-center gap-1.5"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        {isUnlocking ? 'Unlocking...' : 'Remote Unlock'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-2 flex justify-between items-center border-t border-slate-800">
              <button
                type="button"
                onClick={() => handleRemoteUnlock(hardwareModalTenant.id)}
                className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold rounded-xl text-xs hover:bg-emerald-500/20 transition flex items-center gap-1.5"
              >
                <Unlock className="w-3.5 h-3.5" /> Pulse Unlock All Gates
              </button>
              <button
                type="button"
                onClick={() => setHardwareModalTenant(null)}
                className="px-4 py-2 border border-slate-800 rounded-xl text-slate-400 text-xs hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Broadcast Announcement to All Gyms */}
      {showBroadcastModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-amber-400" />
                Broadcast Platform Announcement
              </h3>
              <button onClick={() => setShowBroadcastModal(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              This message will appear immediately on the dashboard of every gym owner across the platform.
            </p>

            <form onSubmit={handleBroadcast} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Announcement Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Scheduled System Maintenance at 2 AM"
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Message Body</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Details for all gym owners and front desks..."
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowBroadcastModal(false)}
                  className="px-4 py-2 border border-slate-800 rounded-xl text-slate-400 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={broadcastBusy}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl transition"
                >
                  {broadcastBusy ? 'Dispatching...' : 'Broadcast to All Gyms'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Deploy New Gym Tenant */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400" /> Deploy New Gym Tenant
              </h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleDeployTenant} className="space-y-3.5 text-xs font-mono">
              <div>
                <label className="block text-slate-400 mb-1">Gym Commercial Brand Name</label>
                <input 
                  type="text" 
                  required 
                  value={gymName}
                  onChange={(e) => {
                    setGymName(e.target.value);
                    if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                  }}
                  placeholder="e.g. Iron Forge Fitness"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Subdomain Slug</label>
                <div className="flex items-center">
                  <input 
                    type="text" 
                    required 
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'))}
                    placeholder="iron-forge"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-l-xl px-3 py-2 text-white"
                  />
                  <span className="bg-slate-800 text-slate-400 px-3 py-2 border-y border-r border-slate-800 rounded-r-xl text-[10px]">
                    .gym.glitchfiesta.in
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Owner Full Name</label>
                  <input 
                    type="text" 
                    required 
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Owner Mobile Phone</label>
                  <input 
                    type="text" 
                    required 
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    placeholder="+91..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Initial Subscription Tier</label>
                <select 
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white uppercase"
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
                  className="px-4 py-2 border border-slate-800 rounded-xl hover:bg-slate-800 text-slate-400 transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={deployBusy}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl transition"
                >
                  {deployBusy ? 'Provisioning...' : 'Deploy Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUTH PROMPT MODAL */}
      {authRequired && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-black text-white">Platform password required</h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-5">
              Enter the Super Admin platform password to authenticate access to the multi-tenant control center.
            </p>

            <form onSubmit={handleAuthorize}>
              <input
                type="password"
                autoFocus
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Super admin password"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-amber-500"
              />
              {authError && (
                <p className="mt-3 text-xs text-rose-400">{authError}</p>
              )}
              <div className="mt-6 flex gap-3">
                <button
                  type="submit"
                  disabled={authBusy || adminPassword === ''}
                  className="w-full bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 text-xs font-mono font-bold text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition"
                >
                  {authBusy ? 'Authorising…' : 'Authorise Super Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
