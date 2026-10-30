'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { writeSession } from '@/lib/session';
import { 
  Building2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Plus, 
  Search, 
  DollarSign, 
  Cpu, 
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
  RotateCw, 
  X, 
  Smartphone, 
  Check, 
  AlertTriangle,
  ShieldCheck,
  Download,
  Sliders,
  Send,
  QrCode,
  CreditCard,
  ShoppingBag,
  ShieldAlert,
  Radio,
  Eye,
  LogOut,
  Layers
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
  memberCount?: number;
  activeMemberCount?: number;
  totalRevenue?: number;
  featureFlags?: Record<string, boolean>;
}

interface HardwareDeviceRow {
  id: string;
  tenant_id: string;
  device_name: string;
  device_type: string;
  ip_address?: string | null;
  status: string;
  last_heartbeat: string | null;
  last_scanned_uid?: string | null;
  last_scanned_at?: string | null;
}

interface PlatformMetrics {
  totalRevenue: number;
  onlineDevicesCount: number;
  totalActiveMembers: number;
  totalTenants: number;
  activeTenantsCount: number;
  suspendedTenantsCount: number;
}

const TIER_BADGES: Record<string, { label: string; color: string }> = {
  starter: { label: 'STARTER', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  standard: { label: 'STANDARD', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  pro: { label: 'PRO GYM', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  enterprise: { label: 'ENTERPRISE', color: 'bg-purple-50 text-purple-700 border-purple-200' },
};

function formatSafeDate(dateVal: string | null | undefined): string {
  if (!dateVal) return '—';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function getDaysRemaining(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    return Math.ceil((d.getTime() - now.getTime()) / 86400000);
  } catch {
    return null;
  }
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
    activeTenantsCount: 0,
    suspendedTenantsCount: 0,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTierFilter, setSelectedTierFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended' | 'expiring'>('all');
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
  const [initialPassword, setInitialPassword] = useState('1234');
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

  // Feature Flags Modal
  const [flagsModalTenant, setFlagsModalTenant] = useState<Tenant | null>(null);
  const [flagToggling, setFlagToggling] = useState<string | null>(null);

  // Reset Owner Password Modal
  const [resetModalTenant, setResetModalTenant] = useState<Tenant | null>(null);
  const [newPassword, setNewPassword] = useState('1234');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  // Broadcast Announcement Modal
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastBusy, setBroadcastBusy] = useState(false);

  // Active Dropdown Action ID
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Load Master Platform Telemetry
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMasterData(adminPassword);
  }, [adminPassword, loadMasterData]);

  // Auth unlock
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await fetch(`/api/super-admin/tenants?password=${encodeURIComponent(adminPassword)}`);
      const result = await res.json();
      if (!res.ok || !result.ok) {
        setAuthError(result.error || 'Invalid password. Try Vyroniq@2026');
        return;
      }
      setTenants((result.tenants ?? []) as Tenant[]);
      setDevices((result.devices ?? []) as HardwareDeviceRow[]);
      if (result.metrics) setMetrics(result.metrics as PlatformMetrics);
      setAuthRequired(false);
    } catch {
      setAuthError('Connection failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  // Deploy New Gym
  const handleDeployGym = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gymName) return;
    setDeployBusy(true);

    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_tenant',
          password: adminPassword,
          name: gymName,
          slug,
          owner_name: ownerName,
          owner_phone: ownerPhone,
          tier,
          owner_password: initialPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Deployment failed.');

      setShowAddModal(false);
      setGymName('');
      setSlug('');
      setOwnerName('');
      setOwnerPhone('');
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error creating gym.');
    } finally {
      setDeployBusy(false);
    }
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

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Update failed.');

      setBrandingModalTenant(null);
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update branding.');
    } finally {
      setBrandBusy(false);
    }
  };

  // Extend SaaS Expiry
  const handleExtendSaas = async (days: number) => {
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

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Extension failed.');

      setLicenseModalTenant(null);
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to extend license.');
    } finally {
      setLicenseBusy(false);
    }
  };

  // Toggle SaaS Hold / Suspend
  const handleToggleHold = async (tenantId: string) => {
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

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Action failed.');

      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to toggle status.');
    }
  };

  // Remote Unlock Pulse
  const handleRemoteUnlock = async (tenantId: string, deviceId?: string) => {
    setUnlockPulseBusy(deviceId || tenantId);
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

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Unlock command failed.');

      setUnlockSuccess('Unlock pulse received by turnstile!');
      setTimeout(() => setUnlockSuccess(null), 3000);
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error pulsing device.');
    } finally {
      setUnlockPulseBusy(null);
    }
  };

  // Toggle Feature Flag
  const handleToggleFlag = async (tenantId: string, flag: string, currentVal: boolean) => {
    setFlagToggling(flag);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_flag',
          password: adminPassword,
          tenant_id: tenantId,
          flag,
          enabled: !currentVal,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Toggle failed.');

      if (flagsModalTenant) {
        setFlagsModalTenant((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            featureFlags: {
              ...(prev.featureFlags ?? {}),
              [flag]: !currentVal,
            },
          };
        });
      }

      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to toggle flag.');
    } finally {
      setFlagToggling(null);
    }
  };

  // Reset Owner Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalTenant) return;
    setResetBusy(true);
    setResetMessage(null);

    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_owner_password',
          password: adminPassword,
          tenant_id: resetModalTenant.id,
          new_password: newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Password reset failed.');

      setResetMessage(`Success! Owner credentials reset to "${newPassword}".`);
      setTimeout(() => {
        setResetModalTenant(null);
        setResetMessage(null);
      }, 1800);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to reset credentials.');
    } finally {
      setResetBusy(false);
    }
  };

  // Emergency Quarantine / Kill Switch
  const handleEmergencyQuarantine = async (tenant: Tenant) => {
    const confirmed = window.confirm(
      `DANGER: Are you sure you want to quarantine "${tenant.name}"?\n\nThis will immediately suspend the account, disconnect all turnstile gates, and revoke all feature flags.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quarantine_tenant',
          password: adminPassword,
          tenant_id: tenant.id,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Quarantine failed.');

      alert(`Tenant "${tenant.name}" is now quarantined.`);
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to quarantine tenant.');
    }
  };

  // Impersonate Tenant
  const handleImpersonate = async (tenantId: string) => {
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'impersonate',
          password: adminPassword,
          tenant_id: tenantId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Impersonation failed.');

      if (data.session) {
        writeSession(data.session);
        window.open('/admin', '_blank');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to impersonate tenant.');
    }
  };

  // Broadcast Alert
  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle || !broadcastMessage) return;
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

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Broadcast failed.');

      alert(`Announcement broadcast to ${data.count || 'all'} gym dashboards!`);
      setShowBroadcastModal(false);
      setBroadcastTitle('');
      setBroadcastMessage('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to broadcast announcement.');
    } finally {
      setBroadcastBusy(false);
    }
  };

  // Export Platform CSV Telemetry
  const handleExportCSV = () => {
    const headers = ['Gym Name', 'Slug', 'Owner Name', 'Phone', 'Tier', 'Status', 'Expiry Date', 'Total Members', 'Revenue'];
    const rows = tenants.map((t) => [
      `"${t.name || ''}"`,
      `"${t.slug || ''}"`,
      `"${t.owner_name || ''}"`,
      `"${t.phone || ''}"`,
      `"${t.subscription_tier || 'pro'}"`,
      `"${t.subscription_status || 'active'}"`,
      `"${formatSafeDate(t.subscription_expires_at)}"`,
      t.memberCount ?? 0,
      t.totalRevenue ?? 0,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `vyroniq-platform-telemetry-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter Tenants
  const filteredTenants = tenants.filter((t) => {
    const q = searchTerm.toLowerCase().trim();
    const matchesSearch = 
      (t.name || '').toLowerCase().includes(q) ||
      (t.slug || '').toLowerCase().includes(q) ||
      (t.owner_name || '').toLowerCase().includes(q) ||
      (t.phone || '').includes(q);

    if (!matchesSearch) return false;

    if (selectedTierFilter !== 'all') {
      if ((t.subscription_tier || 'pro').toLowerCase() !== selectedTierFilter) return false;
    }

    if (statusFilter === 'active') return t.subscription_status === 'active';
    if (statusFilter === 'suspended') return t.subscription_status === 'suspended';
    if (statusFilter === 'expiring') {
      const days = getDaysRemaining(t.subscription_expires_at);
      return days !== null && days <= 7;
    }

    return true;
  });

  // Calculate live devices per tenant
  const getTenantDevices = (tenantId: string) => devices.filter((d) => d.tenant_id === tenantId);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased">
      {/* Frosted Sticky Enterprise Navigation Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm transition hover:bg-slate-800"
              title="Return to Gym Dashboard"
            >
              <Building2 className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
                  Vyroniq Super Admin
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Fleet Operational
                </span>
              </div>
              <p className="text-[11px] text-slate-500">Platform Multi-Tenant Master Control Center</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setShowBroadcastModal(true)}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
            >
              <Megaphone className="h-3.5 w-3.5 text-amber-600" />
              Broadcast Alert
            </button>

            <button
              onClick={handleExportCSV}
              className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              Export CSV
            </button>

            <button
              onClick={() => void loadMasterData(adminPassword)}
              disabled={loading}
              title="Refresh Telemetry"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              Deploy New Gym
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* Top 5 Platform Telemetry Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* Card 1: Total Revenue */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold uppercase text-[10px] tracking-wider">Fleet MRR / Volume</span>
              <DollarSign className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-2 text-xl font-extrabold text-slate-900 tracking-tight">
              ₹{metrics.totalRevenue.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-[10px] text-slate-500">Platform-wide paid receipts</p>
          </div>

          {/* Card 2: Active Tenants */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold uppercase text-[10px] tracking-wider">Commercial Gyms</span>
              <Building2 className="h-4 w-4 text-blue-600" />
            </div>
            <p className="mt-2 text-xl font-extrabold text-slate-900 tracking-tight">
              {metrics.activeTenantsCount}{' '}
              <span className="text-xs font-normal text-slate-500">/ {metrics.totalTenants} Total</span>
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              {metrics.suspendedTenantsCount > 0 ? `${metrics.suspendedTenantsCount} suspended on hold` : 'All licenses active'}
            </p>
          </div>

          {/* Card 3: Online IoT Gateways */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold uppercase text-[10px] tracking-wider">Online Turnstiles</span>
              <Cpu className="h-4 w-4 text-sky-600" />
            </div>
            <p className="mt-2 text-xl font-extrabold text-sky-700 tracking-tight">
              {metrics.onlineDevicesCount}{' '}
              <span className="text-xs font-normal text-slate-500">/ {devices.length} Readers</span>
            </p>
            <p className="mt-1 text-[10px] text-slate-500">ESP32, RFID &amp; Biometrics online</p>
          </div>

          {/* Card 4: Platform Active Members */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold uppercase text-[10px] tracking-wider">Active Members</span>
              <Users className="h-4 w-4 text-indigo-600" />
            </div>
            <p className="mt-2 text-xl font-extrabold text-indigo-700 tracking-tight">
              {metrics.totalActiveMembers.toLocaleString('en-IN')}
            </p>
            <p className="mt-1 text-[10px] text-slate-500">Valid turnstile credentials</p>
          </div>

          {/* Card 5: Fleet Entitlements */}
          <div className="col-span-2 sm:col-span-1 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold uppercase text-[10px] tracking-wider">Fleet SLA &amp; Uptime</span>
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-2 text-xl font-extrabold text-emerald-700 tracking-tight">99.98%</p>
            <p className="mt-1 text-[10px] text-slate-500">0 critical incidents reported</p>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by gym name, subdomain slug, owner name, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder-slate-400 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status Tabs */}
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  statusFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({tenants.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  statusFilter === 'active' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active ({metrics.activeTenantsCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('suspended')}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  statusFilter === 'suspended' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Suspended ({metrics.suspendedTenantsCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('expiring')}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  statusFilter === 'expiring' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Expiring
              </button>
            </div>

            {/* Tier Filter */}
            <select
              value={selectedTierFilter}
              onChange={(e) => setSelectedTierFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All Plan Tiers</option>
              <option value="starter">Starter</option>
              <option value="standard">Standard</option>
              <option value="pro">Pro Gym</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>

        {/* Master Multi-Tenant Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Tenant / Gym Brand</th>
                  <th className="px-4 py-3">Owner Profile</th>
                  <th className="px-4 py-3">SaaS Tier &amp; Expiry</th>
                  <th className="px-4 py-3">IoT Hardware</th>
                  <th className="px-4 py-3">Entitlements</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      <RotateCw className="mx-auto h-6 w-6 animate-spin text-slate-400 mb-2" />
                      Loading platform tenant directory...
                    </td>
                  </tr>
                ) : filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500">
                      <Building2 className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                      No gym tenants found matching current filters.
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((t) => {
                    const daysLeft = getDaysRemaining(t.subscription_expires_at);
                    const tenantTier = (t.subscription_tier || 'pro').toLowerCase();
                    const tierBadge = TIER_BADGES[tenantTier] || TIER_BADGES.pro;
                    const tenantDevices = getTenantDevices(t.id);
                    const isDropdownOpen = openDropdownId === t.id;

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/60 transition">
                        {/* 1. Tenant / Gym Brand */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shadow-xs overflow-hidden">
                              {t.logo_url ? (
                                <img src={t.logo_url} alt={t.name} className="h-full w-full object-cover" />
                              ) : (
                                <span>{t.name.slice(0, 2).toUpperCase()}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 truncate">{t.name}</p>
                              <a
                                href={`https://${t.slug}.gym.glitchfiesta.in`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700"
                              >
                                {t.slug}.gym.glitchfiesta.in
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                              {t.address && (
                                <p className="text-[10px] text-slate-400 truncate max-w-xs">{t.address}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 2. Owner Profile */}
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-slate-800">{t.owner_name || 'Owner Not Set'}</p>
                          <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono">
                            <Smartphone className="h-3 w-3 text-slate-400" />
                            {t.phone || '—'}
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {t.activeMemberCount ?? 0} active / {t.memberCount ?? 0} members
                          </p>
                        </td>

                        {/* 3. SaaS Tier & Expiry */}
                        <td className="px-4 py-3.5">
                          <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold ${tierBadge.color}`}>
                            {tierBadge.label}
                          </span>
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-600">
                            <Clock className="h-3 w-3 text-slate-400" />
                            {formatSafeDate(t.subscription_expires_at)}
                          </div>
                          {daysLeft !== null && (
                            <span
                              className={`inline-block text-[10px] font-semibold mt-0.5 ${
                                daysLeft > 15
                                  ? 'text-emerald-600'
                                  : daysLeft > 0
                                  ? 'text-amber-600'
                                  : 'text-rose-600'
                              }`}
                            >
                              {daysLeft > 0 ? `${daysLeft} days remaining` : 'Expired'}
                            </span>
                          )}
                        </td>

                        {/* 4. IoT Hardware */}
                        <td className="px-4 py-3.5">
                          <button
                            type="button"
                            onClick={() => setHardwareModalTenant(t)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                          >
                            <Cpu className="h-3.5 w-3.5 text-sky-600" />
                            {tenantDevices.length} {tenantDevices.length === 1 ? 'Device' : 'Devices'}
                          </button>
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                            <Radio className="h-2.5 w-2.5 text-emerald-500" />
                            {tenantDevices.filter((d) => d.status === 'online').length} online
                          </div>
                        </td>

                        {/* 5. Entitlements Feature Flags */}
                        <td className="px-4 py-3.5">
                          <button
                            type="button"
                            onClick={() => setFlagsModalTenant(t)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                          >
                            <Sliders className="h-3 w-3 text-indigo-600" />
                            Entitlements
                          </button>
                          <div className="mt-1 flex flex-wrap gap-1 max-w-[140px]">
                            <span className="rounded bg-slate-100 px-1 text-[9px] font-mono text-slate-600">QR</span>
                            <span className="rounded bg-slate-100 px-1 text-[9px] font-mono text-slate-600">RFID</span>
                            <span className="rounded bg-slate-100 px-1 text-[9px] font-mono text-slate-600">POS</span>
                          </div>
                        </td>

                        {/* 6. Status */}
                        <td className="px-4 py-3.5">
                          {t.subscription_status === 'active' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              ACTIVE
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 border border-rose-200">
                              <XCircle className="h-3 w-3 text-rose-600" />
                              SUSPENDED
                            </span>
                          )}
                        </td>

                        {/* 7. Unified Actions Dropdown */}
                        <td className="px-4 py-3.5 text-right relative">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Quick Impersonate */}
                            <button
                              type="button"
                              onClick={() => void handleImpersonate(t.id)}
                              title="Login as Gym Owner"
                              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-xs hover:bg-slate-800 transition"
                            >
                              <Eye className="h-3 w-3" />
                              Impersonate
                            </button>

                            {/* Dropdown Toggle */}
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setOpenDropdownId(isDropdownOpen ? null : t.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                              >
                                Manage <ChevronDown className="h-3 w-3" />
                              </button>

                              {/* Dropdown Popover */}
                              {isDropdownOpen && (
                                <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100 text-left">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBrandingModalTenant(t);
                                      setBrandName(t.name);
                                      setBrandSlug(t.slug);
                                      setBrandOwnerName(t.owner_name || '');
                                      setBrandPhone(t.phone || '');
                                      setBrandLogoUrl(t.logo_url || '');
                                      setBrandAddress(t.address || '');
                                      setOpenDropdownId(null);
                                    }}
                                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                                  >
                                    <Edit3 className="h-3.5 w-3.5 text-slate-500" />
                                    Branding &amp; Domain
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setLicenseModalTenant(t);
                                      setSelectedTier(t.subscription_tier || 'pro');
                                      setOpenDropdownId(null);
                                    }}
                                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                                  >
                                    <Calendar className="h-3.5 w-3.5 text-blue-600" />
                                    SaaS License &amp; Expiry
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setHardwareModalTenant(t);
                                      setOpenDropdownId(null);
                                    }}
                                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                                  >
                                    <Cpu className="h-3.5 w-3.5 text-sky-600" />
                                    Hardware &amp; Turnstiles
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFlagsModalTenant(t);
                                      setOpenDropdownId(null);
                                    }}
                                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                                  >
                                    <Sliders className="h-3.5 w-3.5 text-indigo-600" />
                                    Feature Entitlements
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setResetModalTenant(t);
                                      setNewPassword('1234');
                                      setOpenDropdownId(null);
                                    }}
                                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                                  >
                                    <KeyRound className="h-3.5 w-3.5 text-amber-600" />
                                    Reset Owner Password
                                  </button>

                                  <div className="my-1 border-t border-slate-100" />

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenDropdownId(null);
                                      void handleToggleHold(t.id);
                                    }}
                                    className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold transition ${
                                      t.subscription_status === 'active'
                                        ? 'text-amber-700 hover:bg-amber-50'
                                        : 'text-emerald-700 hover:bg-emerald-50'
                                    }`}
                                  >
                                    {t.subscription_status === 'active' ? (
                                      <>
                                        <Lock className="h-3.5 w-3.5" />
                                        Hold / Suspend SaaS
                                      </>
                                    ) : (
                                      <>
                                        <Unlock className="h-3.5 w-3.5" />
                                        Reactivate SaaS Access
                                      </>
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenDropdownId(null);
                                      void handleEmergencyQuarantine(t);
                                    }}
                                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition"
                                  >
                                    <ShieldAlert className="h-3.5 w-3.5 text-rose-600" />
                                    Emergency Quarantine
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* MODAL 1: Deploy New Gym */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-600" /> Deploy New Gym Tenant
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Creates isolated tenant environment, provisions owner account, and initializes turnstiles.
            </p>

            <form onSubmit={handleDeployGym} className="mt-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Gym Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Iron Forge Fitness Club"
                  value={gymName}
                  onChange={(e) => {
                    setGymName(e.target.value);
                    if (!slug) {
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Subdomain Slug</label>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  <input
                    type="text"
                    required
                    placeholder="iron-forge"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="flex-1 px-3 py-2 text-slate-900 focus:outline-none"
                  />
                  <span className="bg-slate-50 px-3 py-2 text-slate-500 border-l border-slate-200 text-[11px] font-mono">
                    .gym.glitchfiesta.in
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Owner Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Asad Khan"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Owner Phone (10 digits)</label>
                  <input
                    type="tel"
                    required
                    placeholder="9876543210"
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Initial Plan Tier</label>
                  <select
                    value={tier}
                    onChange={(e) => setTier(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="starter">Starter</option>
                    <option value="standard">Standard</option>
                    <option value="pro">Pro Gym</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Initial Owner PIN</label>
                  <input
                    type="text"
                    required
                    value={initialPassword}
                    onChange={(e) => setInitialPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={deployBusy}
                  className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50"
                >
                  {deployBusy ? 'Deploying Tenant...' : 'Deploy Gym Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Manage Branding & Domain */}
      {brandingModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setBrandingModalTenant(null)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Edit3 className="h-5 w-5 text-emerald-600" /> White-Label &amp; Branding Config
            </h3>
            <p className="text-xs text-slate-500 mt-1">Configure gym name, custom subdomain, logo URL, and address.</p>

            <form onSubmit={handleSaveBranding} className="mt-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Gym Name</label>
                <input
                  type="text"
                  required
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Subdomain Slug</label>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  <input
                    type="text"
                    required
                    value={brandSlug}
                    onChange={(e) => setBrandSlug(e.target.value)}
                    className="flex-1 px-3 py-2 text-slate-900 focus:outline-none"
                  />
                  <span className="bg-slate-50 px-3 py-2 text-slate-500 border-l border-slate-200 text-[11px] font-mono">
                    .gym.glitchfiesta.in
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Owner Name</label>
                  <input
                    type="text"
                    value={brandOwnerName}
                    onChange={(e) => setBrandOwnerName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Owner Phone</label>
                  <input
                    type="tel"
                    value={brandPhone}
                    onChange={(e) => setBrandPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Gym Logo URL (HTTPS)</label>
                <input
                  type="url"
                  placeholder="https://example.com/logo.png"
                  value={brandLogoUrl}
                  onChange={(e) => setBrandLogoUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Gym Physical Address</label>
                <input
                  type="text"
                  placeholder="City, State, Country"
                  value={brandAddress}
                  onChange={(e) => setBrandAddress(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={brandBusy}
                  className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50"
                >
                  {brandBusy ? 'Saving Changes...' : 'Save Branding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: SaaS License & Billing Control */}
      {licenseModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setLicenseModalTenant(null)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" /> SaaS License &amp; Plan Control
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Manage subscription tier for <span className="font-bold text-slate-800">{licenseModalTenant.name}</span>.
            </p>

            <div className="mt-5 space-y-4 text-xs">
              <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Current Expiry:</span>
                  <span className="font-bold text-slate-900">
                    {formatSafeDate(licenseModalTenant.subscription_expires_at)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Current Status:</span>
                  <span className="font-bold uppercase text-emerald-700">
                    {licenseModalTenant.subscription_status || 'ACTIVE'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Subscription Tier</label>
                <div className="grid grid-cols-2 gap-2">
                  {['starter', 'standard', 'pro', 'enterprise'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedTier(t)}
                      className={`rounded-lg p-2.5 text-center font-bold uppercase transition border ${
                        selectedTier === t
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-2">Extend License Expiry</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={licenseBusy}
                    onClick={() => void handleExtendSaas(7)}
                    className="rounded-lg border border-slate-200 bg-white p-2 font-bold text-slate-700 hover:bg-slate-50 hover:border-emerald-500 transition"
                  >
                    +7 Days
                  </button>
                  <button
                    type="button"
                    disabled={licenseBusy}
                    onClick={() => void handleExtendSaas(15)}
                    className="rounded-lg border border-slate-200 bg-white p-2 font-bold text-slate-700 hover:bg-slate-50 hover:border-emerald-500 transition"
                  >
                    +15 Days
                  </button>
                  <button
                    type="button"
                    disabled={licenseBusy}
                    onClick={() => void handleExtendSaas(30)}
                    className="rounded-lg border border-emerald-600 bg-emerald-50 p-2 font-bold text-emerald-800 hover:bg-emerald-100 transition"
                  >
                    +30 Days
                  </button>
                  <button
                    type="button"
                    disabled={licenseBusy}
                    onClick={() => void handleExtendSaas(90)}
                    className="rounded-lg border border-slate-200 bg-white p-2 font-bold text-slate-700 hover:bg-slate-50 hover:border-emerald-500 transition"
                  >
                    +90 Days
                  </button>
                  <button
                    type="button"
                    disabled={licenseBusy}
                    onClick={() => void handleExtendSaas(180)}
                    className="rounded-lg border border-slate-200 bg-white p-2 font-bold text-slate-700 hover:bg-slate-50 hover:border-emerald-500 transition"
                  >
                    +6 Months
                  </button>
                  <button
                    type="button"
                    disabled={licenseBusy}
                    onClick={() => void handleExtendSaas(365)}
                    className="rounded-lg border border-purple-600 bg-purple-50 p-2 font-bold text-purple-800 hover:bg-purple-100 transition"
                  >
                    +1 Year
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Hardware IoT Gateway Status & Remote Unlock */}
      {hardwareModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setHardwareModalTenant(null)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Cpu className="h-5 w-5 text-sky-600" /> IoT Gateways &amp; Turnstiles
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Live status for <span className="font-bold text-slate-800">{hardwareModalTenant.name}</span> turnstiles.
            </p>

            {unlockSuccess && (
              <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs font-semibold text-emerald-800 flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                {unlockSuccess}
              </div>
            )}

            <div className="mt-4 space-y-3">
              {getTenantDevices(hardwareModalTenant.id).length === 0 ? (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-8 text-center text-xs text-slate-500">
                  <Radio className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                  No hardware devices registered for this gym yet. Turnstiles auto-register on first ESP32 heartbeat ping.
                </div>
              ) : (
                getTenantDevices(hardwareModalTenant.id).map((dev) => (
                  <div
                    key={dev.id}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-xs">{dev.device_name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-600">
                          {dev.device_type}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Heartbeat: {dev.last_heartbeat ? formatSafeDate(dev.last_heartbeat) : 'No ping yet'}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={unlockPulseBusy === dev.id}
                      onClick={() => void handleRemoteUnlock(hardwareModalTenant.id, dev.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 transition disabled:opacity-50"
                    >
                      <Unlock className="h-3.5 w-3.5" />
                      {unlockPulseBusy === dev.id ? 'Pulsing...' : 'Remote Unlock'}
                    </button>
                  </div>
                ))
              )}

              {/* Master Remote Unlock for all gates */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={unlockPulseBusy === hardwareModalTenant.id}
                  onClick={() => void handleRemoteUnlock(hardwareModalTenant.id)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition flex items-center justify-center gap-2"
                >
                  <Unlock className="h-4 w-4 text-emerald-600" />
                  Pulse All Turnstiles in Gym
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: Feature Flags & Add-on Entitlements */}
      {flagsModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setFlagsModalTenant(null)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Sliders className="h-5 w-5 text-indigo-600" /> Feature Entitlements &amp; Flags
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Toggle modular features for <span className="font-bold text-slate-800">{flagsModalTenant.name}</span>.
            </p>

            <div className="mt-5 space-y-3 text-xs">
              {[
                { key: 'qr_gate', label: 'QR Turnstile Scanner (Kiosk & Mobile)', icon: QrCode },
                { key: 'rfid', label: 'RFID Smart Card Access (Mifare)', icon: CreditCard },
                { key: 'biometric', label: 'Biometric Turnstile Gateway (Fingerprint)', icon: Cpu },
                { key: 'pos_store', label: 'POS Retail Store (Supplements & Merch)', icon: ShoppingBag },
                { key: 'whatsapp', label: 'Automated WhatsApp Notifications', icon: Send },
                { key: 'crm', label: 'CRM & Member Lead Pipeline', icon: Users },
              ].map((item) => {
                const Icon = item.icon;
                const isEnabled = flagsModalTenant.featureFlags?.[item.key] ?? true;
                const isBusy = flagToggling === item.key;

                return (
                  <div
                    key={item.key}
                    className="flex items-center justify-between rounded-xl border border-slate-200 p-3 bg-white hover:bg-slate-50/50 transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="font-semibold text-slate-800">{item.label}</span>
                    </div>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleToggleFlag(flagsModalTenant.id, item.key, isEnabled)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isEnabled ? 'bg-emerald-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                          isEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: Reset Owner Password */}
      {resetModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setResetModalTenant(null)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-600" /> Reset Owner Password
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Rescue locked-out owner of <span className="font-bold text-slate-800">{resetModalTenant.name}</span>.
            </p>

            <form onSubmit={handleResetPassword} className="mt-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">New Initial Password / PIN</label>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Owner will be required to update their PIN on their next login.
                </p>
              </div>

              {resetMessage && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-emerald-800 font-semibold text-xs">
                  {resetMessage}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={resetBusy}
                  className="w-full rounded-xl bg-amber-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-amber-500 transition disabled:opacity-50"
                >
                  {resetBusy ? 'Updating Credentials...' : 'Set Owner Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: Broadcast Platform Announcement */}
      {showBroadcastModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setShowBroadcastModal(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-amber-600" /> Platform-Wide Broadcast
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Broadcasts a persistent banner notification to all gym owners and receptionists simultaneously.
            </p>

            <form onSubmit={handleBroadcast} className="mt-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Announcement Title</label>
                <input
                  type="text"
                  required
                  placeholder="Scheduled Platform Maintenance / Cloud Upgrade"
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Message Body</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Details of the announcement, downtime schedule, or new features available..."
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={broadcastBusy}
                  className="w-full rounded-xl bg-amber-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-amber-500 transition disabled:opacity-50"
                >
                  {broadcastBusy ? 'Broadcasting Alert...' : 'Broadcast to All Gyms'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUTH GATE MODAL: Platform Password Required */}
      {authRequired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 sm:p-8 text-center animate-in fade-in zoom-in-95 duration-150">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md">
              <ShieldAlert className="h-7 w-7 text-emerald-400" />
            </div>

            <h2 className="text-xl font-bold tracking-tight text-slate-900 mb-1">
              Super Admin Authentication
            </h2>
            <p className="text-xs text-slate-500 mb-5">
              Enter master platform password to access Vyroniq Enterprise Control Center.
            </p>

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div className="text-left">
                <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Platform Password
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  placeholder="Master platform password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none"
                />
              </div>

              {authError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs font-semibold text-rose-700">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authBusy}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {authBusy ? (
                  <>
                    <RotateCw className="h-4 w-4 animate-spin" /> Verifying...
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" /> Unlock Super Admin
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
