'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  Layers,
  Upload,
  Image as ImageIcon,
  Trash2,
  RefreshCw,
  Palette,
  MessageSquare,
  FileText,
  LifeBuoy,
  AlertOctagon,
  Sparkles
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
  gstin?: string | null;
  gst_enabled?: boolean | null;
  gst_rate_percent?: number | null;
  upi_id?: string | null;
  enforce_geofence?: boolean | null;
  geofence_radius_meters?: number | null;
  custom_domain?: string | null;
  brand_color?: string | null;
  account_manager?: string | null;
  internal_notes?: string | null;
  commission_rate?: number | null;
  sms_credits?: number | null;
  whatsapp_quota?: number | null;
  vip_status?: boolean | null;
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

const COLOR_PRESETS = [
  { name: 'Emerald', hex: '#059669' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Sky', hex: '#0284c7' },
  { name: 'Rose', hex: '#e11d48' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Slate', hex: '#1e293b' },
];

const ALL_15_FEATURE_FLAGS = [
  { key: 'qr_gate', label: 'QR Turnstile Kiosk & Mobile Scan', icon: QrCode, desc: 'Self-service turnstile tablet kiosk & attendee scanning' },
  { key: 'rfid_access', label: 'RFID 13.56MHz Smart Card Access', icon: CreditCard, desc: 'Mifare / NFC access turnstiles and key fobs' },
  { key: 'biometric_fingerprint', label: 'Biometric Turnstile Gateway', icon: Cpu, desc: 'R307 optical / capacitive fingerprint sensors' },
  { key: 'pos_store', label: 'Supplement POS Store & Inventory', icon: ShoppingBag, desc: 'Front-desk retail till for whey, merch & beverages' },
  { key: 'whatsapp_reminders', label: 'Automated WhatsApp Notifications', icon: Send, desc: 'Automatic fee reminders & attendance welcome pings' },
  { key: 'lead_crm', label: 'CRM & Member Lead Pipeline', icon: Users, desc: 'Walk-in inquiries, trial tracking & conversion funnel' },
  { key: 'expense_tracker', label: 'Gym Operations Expense Tracker', icon: DollarSign, desc: 'Rent, equipment repair & petty cash ledger' },
  { key: 'diet_planner', label: 'Diet & Nutrition Planner Engine', icon: Sparkles, desc: 'Custom meal plans, macros & calorie calculators' },
  { key: 'workout_builder', label: 'Workout Routine & Exercise Plans', icon: Activity, desc: 'Split routines, sets, reps & exercise video logs' },
  { key: 'trainer_payouts', label: 'Personal Trainer Commission Ledger', icon: DollarSign, desc: 'PT session tracking & automated salary cuts' },
  { key: 'multi_branch', label: 'Multi-Branch Roaming Access', icon: Building2, desc: 'Cross-gym check-ins across enterprise franchises' },
  { key: 'custom_reports', label: 'Advanced Financial & Attendance BI', icon: FileText, desc: 'Executive cohort retention & revenue charts' },
  { key: 'online_payments', label: 'Member Direct UPI Online Renewal', icon: CreditCard, desc: 'Members pay dues online via UPI QR code' },
  { key: 'member_app_pwa', label: 'Member Mobile App (PWA)', icon: Smartphone, desc: 'Branded member companion web app & digital pass' },
  { key: 'auto_sms', label: 'SMS Gateway Auto-Pushes (DLT)', icon: MessageSquare, desc: 'DLT-compliant SMS fallbacks for non-WhatsApp users' },
];

type TenantModalTab = 
  | 'general'
  | 'security'
  | 'billing'
  | 'hardware'
  | 'flags'
  | 'finance'
  | 'comms'
  | 'audit'
  | 'support'
  | 'emergency';

/** Converts Google Drive sharing URL to direct image stream */
function convertDriveOrMediaUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  const fileDMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileDMatch && fileDMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${fileDMatch[1]}`;
  }
  const idParamMatch = trimmed.match(/drive\.google\.com\/(?:open|uc)\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch && idParamMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${idParamMatch[1]}`;
  }
  return trimmed;
}

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // Broadcast Announcement Modal
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastBusy, setBroadcastBusy] = useState(false);

  // Active Dropdown Action ID
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // MASTER 10-TAB ENTERPRISE TENANT MODAL STATE
  const [activeModalTenant, setActiveModalTenant] = useState<Tenant | null>(null);
  const [modalTab, setModalTab] = useState<TenantModalTab>('general');
  const [modalBusy, setModalBusy] = useState(false);
  const [modalNotice, setModalNotice] = useState<{ message: string; kind: 'ok' | 'bad' } | null>(null);

  // Tab 1: General & Branding Fields
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editCustomDomain, setEditCustomDomain] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editBrandColor, setEditBrandColor] = useState('#059669');
  const [editAddress, setEditAddress] = useState('');
  const [editGstin, setEditGstin] = useState('');
  const [editGstEnabled, setEditGstEnabled] = useState(false);
  const [editGstRate, setEditGstRate] = useState(18);
  const [editUpiId, setEditUpiId] = useState('');

  // Tab 2: Owner & Security Fields
  const [editOwnerName, setEditOwnerName] = useState('');
  const [editOwnerPhone, setEditOwnerPhone] = useState('');
  const [newOwnerPassword, setNewOwnerPassword] = useState('1234');

  // Tab 3: SaaS Billing & Tiers Fields
  const [editTier, setEditTier] = useState('pro');
  const [exactExpiryDate, setExactExpiryDate] = useState('');

  // Tab 4: Hardware Fields
  const [newDevName, setNewDevName] = useState('');
  const [newDevType, setNewDevType] = useState('esp32_turnstile');
  const [newDevIp, setNewDevIp] = useState('');
  const [unlockPulseBusy, setUnlockPulseBusy] = useState<string | null>(null);

  // Tab 5: Feature Flags State (15 toggles)
  const [editFlags, setEditFlags] = useState<Record<string, boolean>>({});

  // Tab 6: Financial Ledger Fields
  const [editCommissionRate, setEditCommissionRate] = useState(2.5);

  // Tab 7: Communication Quotas
  const [creditAdding, setCreditAdding] = useState(false);

  // Tab 9: Support & CRM
  const [editAccountManager, setEditAccountManager] = useState('Alex - Senior CSM');
  const [editInternalNotes, setEditInternalNotes] = useState('');
  const [editVipStatus, setEditVipStatus] = useState(false);

  // Tab 10: Kill Switch Confirmation
  const [killSwitchConfirmed, setKillSwitchConfirmed] = useState(false);

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

  // Open 10-Tab Enterprise Modal for Tenant
  const openTenantModal = (t: Tenant, defaultTab: TenantModalTab = 'general') => {
    setActiveModalTenant(t);
    setModalTab(defaultTab);
    setModalNotice(null);
    setKillSwitchConfirmed(false);

    // Initialize all form fields from tenant
    setEditName(t.name || '');
    setEditSlug(t.slug || '');
    setEditCustomDomain(t.custom_domain || '');
    setEditLogoUrl(t.logo_url || '');
    setEditBrandColor(t.brand_color || '#059669');
    setEditAddress(t.address || '');
    setEditGstin(t.gstin || '');
    setEditGstEnabled(Boolean(t.gst_enabled));
    setEditGstRate(t.gst_rate_percent ?? 18);
    setEditUpiId(t.upi_id || '');

    setEditOwnerName(t.owner_name || '');
    setEditOwnerPhone(t.phone || '');
    setNewOwnerPassword('1234');

    setEditTier((t.subscription_tier || 'pro').toLowerCase());
    setExactExpiryDate(t.subscription_expires_at ? t.subscription_expires_at.slice(0, 10) : '');

    setEditCommissionRate(t.commission_rate ?? 2.5);
    setEditAccountManager(t.account_manager || 'Alex - Senior CSM');
    setEditInternalNotes(t.internal_notes || '');
    setEditVipStatus(Boolean(t.vip_status));

    // Initialize 15 flags
    const initFlags: Record<string, boolean> = {};
    ALL_15_FEATURE_FLAGS.forEach((f) => {
      initFlags[f.key] = t.featureFlags?.[f.key] ?? true;
    });
    setEditFlags(initFlags);
  };

  // Handle local gallery logo upload
  const handleLocalLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Logo image must be smaller than 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setEditLogoUrl(dataUrl);
        setModalNotice({ message: 'Logo loaded from gallery file.', kind: 'ok' });
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle Drive / Image URL input with auto-converter
  const handleLogoUrlChange = (val: string) => {
    const converted = convertDriveOrMediaUrl(val);
    setEditLogoUrl(converted);
    if (converted !== val) {
      setModalNotice({ message: 'Google Drive URL auto-converted to direct image stream!', kind: 'ok' });
    }
  };

  // Save Comprehensive Tenant Updates (Tabs 1, 2, 6, 9)
  const saveTenantDetails = async (overrides?: Record<string, any>) => {
    if (!activeModalTenant) return;
    setModalBusy(true);
    setModalNotice(null);

    try {
      const payload = {
        action: 'update_tenant_comprehensive',
        password: adminPassword,
        tenant_id: activeModalTenant.id,
        name: editName,
        slug: editSlug,
        owner_name: editOwnerName,
        phone: editOwnerPhone,
        logo_url: editLogoUrl,
        address: editAddress,
        gstin: editGstin,
        gst_enabled: editGstEnabled,
        gst_rate_percent: editGstRate,
        upi_id: editUpiId,
        custom_domain: editCustomDomain,
        brand_color: editBrandColor,
        account_manager: editAccountManager,
        internal_notes: editInternalNotes,
        commission_rate: editCommissionRate,
        vip_status: editVipStatus,
        ...overrides,
      };

      const res = await fetch('/api/super-admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Update failed.');

      setModalNotice({ message: 'Settings saved successfully!', kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Update failed.', kind: 'bad' });
    } finally {
      setModalBusy(false);
    }
  };

  // Reset Owner Password
  const handleResetPassword = async () => {
    if (!activeModalTenant) return;
    setModalBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_owner_password',
          password: adminPassword,
          tenant_id: activeModalTenant.id,
          new_password: newOwnerPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Password reset failed.');

      setModalNotice({ message: `Success! Owner password reset to: ${newOwnerPassword}`, kind: 'ok' });
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Error resetting PIN.', kind: 'bad' });
    } finally {
      setModalBusy(false);
    }
  };

  // Extend SaaS Expiry
  const handleExtendSaas = async (days: number) => {
    if (!activeModalTenant) return;
    setModalBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend_saas',
          password: adminPassword,
          tenant_id: activeModalTenant.id,
          days,
          tier: editTier,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Extension failed.');

      setModalNotice({ message: `License extended by ${days} days! New Expiry: ${formatSafeDate(data.new_expiry)}`, kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Failed to extend license.', kind: 'bad' });
    } finally {
      setModalBusy(false);
    }
  };

  // Save Custom Expiry Date
  const handleSaveExactExpiry = async () => {
    if (!activeModalTenant || !exactExpiryDate) return;
    setModalBusy(true);
    try {
      const newIso = new Date(exactExpiryDate).toISOString();
      const res = await fetch('/api/super-admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend_saas',
          password: adminPassword,
          tenant_id: activeModalTenant.id,
          exact_expiry: newIso,
          tier: editTier,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to set expiry.');

      setModalNotice({ message: `SaaS Expiry updated to: ${formatSafeDate(newIso)}`, kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Error setting expiry.', kind: 'bad' });
    } finally {
      setModalBusy(false);
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

      setModalNotice({ message: `SaaS status toggled to: ${data.status.toUpperCase()}`, kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to toggle status.');
    }
  };

  // Remote Unlock Pulse
  const handleRemoteUnlock = async (tenantId: string, deviceId?: string) => {
    setUnlockPulseBusy(deviceId || tenantId);
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

      setModalNotice({ message: 'Unlock pulse received by turnstile gateway!', kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Error pulsing device.', kind: 'bad' });
    } finally {
      setUnlockPulseBusy(null);
    }
  };

  // Add Device
  const handleAddDevice = async () => {
    if (!activeModalTenant || !newDevName) return;
    setModalBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_device',
          password: adminPassword,
          tenant_id: activeModalTenant.id,
          device_name: newDevName,
          device_type: newDevType,
          ip_address: newDevIp,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to add device.');

      setNewDevName('');
      setNewDevIp('');
      setModalNotice({ message: 'Hardware gateway registered!', kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Error adding device.', kind: 'bad' });
    } finally {
      setModalBusy(false);
    }
  };

  // Delete Device
  const handleDeleteDevice = async (deviceId: string) => {
    if (!activeModalTenant) return;
    const confirmed = window.confirm('Delete this hardware gateway reader?');
    if (!confirmed) return;

    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_device',
          password: adminPassword,
          tenant_id: activeModalTenant.id,
          device_id: deviceId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to delete device.');

      setModalNotice({ message: 'Hardware device unlinked.', kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Error removing device.', kind: 'bad' });
    }
  };

  // Save All 15 Feature Flags
  const handleSaveFlags = async () => {
    if (!activeModalTenant) return;
    setModalBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_flags_bulk',
          password: adminPassword,
          tenant_id: activeModalTenant.id,
          flags: editFlags,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to update flags.');

      setModalNotice({ message: 'All 15 feature flags synced to Gym Owner dashboard!', kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Error saving flags.', kind: 'bad' });
    } finally {
      setModalBusy(false);
    }
  };

  // Add Notification Credits
  const handleAddCredits = async (type: 'sms' | 'whatsapp', amount: number) => {
    if (!activeModalTenant) return;
    setCreditAdding(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_credits',
          password: adminPassword,
          tenant_id: activeModalTenant.id,
          type,
          amount,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to add credits.');

      setModalNotice({ message: `Added ${amount} ${type.toUpperCase()} credits. New Balance: ${data.new_balance}`, kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Error adding credits.', kind: 'bad' });
    } finally {
      setCreditAdding(false);
    }
  };

  // Emergency Quarantine Execution
  const handleEmergencyQuarantine = async () => {
    if (!activeModalTenant) return;
    if (!killSwitchConfirmed) {
      alert('Please check the confirmation box before executing Emergency Quarantine.');
      return;
    }

    setModalBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quarantine_tenant',
          password: adminPassword,
          tenant_id: activeModalTenant.id,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Quarantine execution failed.');

      alert(`EMERGENCY LOCKDOWN COMPLETE: Tenant "${activeModalTenant.name}" has been quarantined.`);
      setModalNotice({ message: 'Tenant quarantined. All 15 flags revoked and gates offline.', kind: 'bad' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Quarantine failed.');
    } finally {
      setModalBusy(false);
    }
  };

  // Restore From Quarantine
  const handleRestoreQuarantine = async () => {
    if (!activeModalTenant) return;
    setModalBusy(true);
    try {
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore_quarantine',
          password: adminPassword,
          tenant_id: activeModalTenant.id,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Restoration failed.');

      setModalNotice({ message: 'Tenant restored from quarantine! All access restored.', kind: 'ok' });
      void loadMasterData(adminPassword);
    } catch (err: unknown) {
      setModalNotice({ message: err instanceof Error ? err.message : 'Restoration failed.', kind: 'bad' });
    } finally {
      setModalBusy(false);
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

  const getTenantDevices = (tenantId: string) => devices.filter((d) => d.tenant_id === tenantId);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased">
      {/* Sticky Enterprise Navigation Header */}
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
                  <th className="px-4 py-3">Feature Flags</th>
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
                            <div 
                              onClick={() => openTenantModal(t, 'general')}
                              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shadow-xs overflow-hidden hover:opacity-90 transition"
                            >
                              {t.logo_url ? (
                                <img src={t.logo_url} alt={t.name} className="h-full w-full object-cover" />
                              ) : (
                                <span>{t.name.slice(0, 2).toUpperCase()}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p 
                                onClick={() => openTenantModal(t, 'general')}
                                className="font-bold text-slate-900 truncate cursor-pointer hover:text-emerald-600 transition"
                              >
                                {t.name}
                              </p>
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
                            onClick={() => openTenantModal(t, 'hardware')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                          >
                            <Cpu className="h-3.5 w-3.5 text-sky-600" />
                            {tenantDevices.length} {tenantDevices.length === 1 ? 'Reader' : 'Readers'}
                          </button>
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                            <Radio className="h-2.5 w-2.5 text-emerald-500" />
                            {tenantDevices.filter((d) => d.status === 'online').length} online
                          </div>
                        </td>

                        {/* 5. Feature Flags */}
                        <td className="px-4 py-3.5">
                          <button
                            type="button"
                            onClick={() => openTenantModal(t, 'flags')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                          >
                            <Sliders className="h-3 w-3 text-indigo-600" />
                            15 Flags
                          </button>
                          <div className="mt-1 flex flex-wrap gap-1 max-w-[130px]">
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
                            <button
                              type="button"
                              onClick={() => void handleImpersonate(t.id)}
                              title="Login as Gym Owner"
                              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-xs hover:bg-slate-800 transition"
                            >
                              <Eye className="h-3 w-3" />
                              Impersonate
                            </button>

                            <button
                              type="button"
                              onClick={() => openTenantModal(t, 'general')}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-500 transition"
                            >
                              <Sliders className="h-3 w-3" />
                              Manage (10 Tabs)
                            </button>
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

      {/* MASTER 10-TAB ENTERPRISE TENANT CONTROL MODAL */}
      {activeModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/75 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm overflow-hidden shrink-0">
                  {editLogoUrl ? (
                    <img src={editLogoUrl} alt={activeModalTenant.name} className="h-full w-full object-cover" />
                  ) : (
                    <span>{activeModalTenant.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">{activeModalTenant.name}</h2>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      activeModalTenant.subscription_status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}>
                      {activeModalTenant.subscription_status || 'ACTIVE'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    {activeModalTenant.slug}.gym.glitchfiesta.in · Tier: {editTier.toUpperCase()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleImpersonate(activeModalTenant.id)}
                  className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Impersonate
                </button>
                <button
                  onClick={() => setActiveModalTenant(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Notification Banner */}
            {modalNotice && (
              <div className={`px-6 py-2.5 text-xs font-semibold shrink-0 flex items-center justify-between ${
                modalNotice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border-b border-emerald-100' : 'bg-rose-50 text-rose-800 border-b border-rose-100'
              }`}>
                <span>{modalNotice.message}</span>
                <button onClick={() => setModalNotice(null)} className="text-slate-400 hover:text-slate-600">×</button>
              </div>
            )}

            {/* Modal Body: Left Tab Sidebar + Right Tab View */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* 10 Tab Navigation Sidebar */}
              <div className="w-48 sm:w-56 border-r border-slate-200 bg-slate-50/50 p-2 overflow-y-auto space-y-1 shrink-0 text-xs">
                {[
                  { id: 'general', label: '1. General & Branding', icon: Building2 },
                  { id: 'security', label: '2. Owner & Security', icon: KeyRound },
                  { id: 'billing', label: '3. SaaS Billing & Tiers', icon: Calendar },
                  { id: 'hardware', label: '4. Hardware & IoT Fleet', icon: Cpu },
                  { id: 'flags', label: '5. Feature Flags (15)', icon: Sliders },
                  { id: 'finance', label: '6. Financial Ledger', icon: DollarSign },
                  { id: 'comms', label: '7. SMS & WhatsApp', icon: Send },
                  { id: 'audit', label: '8. Compliance & Audit', icon: Download },
                  { id: 'support', label: '9. Support & CRM Notes', icon: LifeBuoy },
                  { id: 'emergency', label: '10. Emergency Kill Switch', icon: AlertOctagon, danger: true },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = modalTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setModalTab(item.id as TenantModalTab);
                        setModalNotice(null);
                      }}
                      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left font-medium transition ${
                        isActive
                          ? item.danger
                            ? 'bg-rose-600 text-white font-bold shadow-xs'
                            : 'bg-emerald-600 text-white font-bold shadow-xs'
                          : item.danger
                          ? 'text-rose-600 hover:bg-rose-50'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Tab Content Display Area */}
              <div className="flex-1 p-6 overflow-y-auto text-xs space-y-5">
                {/* TAB 1: General & Branding */}
                {modalTab === 'general' && (
                  <div className="space-y-4 max-w-xl">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-emerald-600" />
                      General Identity &amp; Branding Config
                    </h3>

                    {/* Logo Upload Section */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                      <label className="block font-semibold text-slate-800">Gym Logo (Gallery File / Google Drive / URL)</label>
                      <div className="flex items-center gap-4">
                        <div className="h-16 w-16 rounded-xl border border-slate-300 bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                          {editLogoUrl ? (
                            <img src={editLogoUrl} alt="Logo Preview" className="h-full w-full object-cover" />
                          ) : (
                            <ImageIcon className="h-6 w-6 text-slate-300" />
                          )}
                        </div>

                        <div className="flex-1 space-y-2">
                          <div className="flex gap-2">
                            <input
                              type="file"
                              ref={fileInputRef}
                              accept="image/*"
                              onChange={handleLocalLogoFile}
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                            >
                              <Upload className="h-3.5 w-3.5 text-emerald-600" />
                              Upload From Gallery
                            </button>

                            {editLogoUrl && (
                              <button
                                type="button"
                                onClick={() => setEditLogoUrl('')}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition"
                              >
                                <Trash2 className="h-3 w-3" />
                                Remove
                              </button>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500">Supports PNG, JPG, WebP up to 5MB.</p>
                        </div>
                      </div>

                      {/* Google Drive / Direct URL Input */}
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Or Paste Google Drive Shared Link / Direct Image URL:
                        </label>
                        <input
                          type="text"
                          placeholder="https://drive.google.com/file/d/.../view or https://example.com/logo.png"
                          value={editLogoUrl}
                          onChange={(e) => handleLogoUrlChange(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Basic Info */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Gym Name</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Subdomain Slug</label>
                        <input
                          type="text"
                          value={editSlug}
                          onChange={(e) => setEditSlug(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Custom Domain (CNAME)</label>
                        <input
                          type="text"
                          placeholder="e.g. gym.myfitclub.com"
                          value={editCustomDomain}
                          onChange={(e) => setEditCustomDomain(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Primary Brand Color</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editBrandColor}
                            onChange={(e) => setEditBrandColor(e.target.value)}
                            className="h-8 w-8 rounded-lg cursor-pointer border border-slate-200"
                          />
                          <div className="flex gap-1">
                            {COLOR_PRESETS.map((c) => (
                              <button
                                key={c.hex}
                                type="button"
                                onClick={() => setEditBrandColor(c.hex)}
                                className="h-6 w-6 rounded-md border border-white shadow-xs"
                                style={{ backgroundColor: c.hex }}
                                title={c.name}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Physical Address</label>
                      <input
                        type="text"
                        placeholder="Street, City, State, PIN"
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">GSTIN Number</label>
                        <input
                          type="text"
                          placeholder="22AAAAA0000A1Z5"
                          value={editGstin}
                          onChange={(e) => setEditGstin(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">GST Rate %</label>
                        <select
                          value={editGstRate}
                          onChange={(e) => setEditGstRate(Number(e.target.value))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                        >
                          <option value={0}>0% (Exempt)</option>
                          <option value={5}>5%</option>
                          <option value={12}>12%</option>
                          <option value={18}>18% (Standard)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">UPI VPA</label>
                        <input
                          type="text"
                          placeholder="gym@upi"
                          value={editUpiId}
                          onChange={(e) => setEditUpiId(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={modalBusy}
                        onClick={() => void saveTenantDetails()}
                        className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50"
                      >
                        {modalBusy ? 'Saving...' : 'Save General & Branding Settings'}
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 2: Owner & Security */}
                {modalTab === 'security' && (
                  <div className="space-y-4 max-w-xl">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-amber-600" />
                      Owner Profile &amp; Authentication Control
                    </h3>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Owner Full Name</label>
                        <input
                          type="text"
                          value={editOwnerName}
                          onChange={(e) => setEditOwnerName(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Registered Phone (10 digits)</label>
                        <input
                          type="tel"
                          value={editOwnerPhone}
                          onChange={(e) => setEditOwnerPhone(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Reset Owner Password Box */}
                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                      <label className="block font-bold text-amber-900">Reset Owner Login Password / PIN</label>
                      <p className="text-[11px] text-amber-700">
                        Use this to rescue locked-out gym owners. They will be prompted to set a new password on login.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newOwnerPassword}
                          onChange={(e) => setNewOwnerPassword(e.target.value)}
                          className="w-48 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-amber-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={modalBusy}
                          onClick={() => void handleResetPassword()}
                          className="rounded-lg bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-500 transition shadow-xs disabled:opacity-50"
                        >
                          Reset Credentials
                        </button>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={modalBusy}
                        onClick={() => void saveTenantDetails()}
                        className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50"
                      >
                        Save Owner Contact Info
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 3: SaaS Billing & Tiers */}
                {modalTab === 'billing' && (
                  <div className="space-y-4 max-w-xl">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-blue-600" />
                      SaaS License Tier &amp; Billing Cycles
                    </h3>

                    {/* Current Expiry Preview */}
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 flex items-center justify-between">
                      <div>
                        <span className="text-slate-500">Current Valid Till:</span>
                        <p className="text-base font-bold text-slate-900">
                          {formatSafeDate(activeModalTenant.subscription_expires_at)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Status: <span className="font-bold uppercase text-emerald-700">{activeModalTenant.subscription_status || 'ACTIVE'}</span>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleToggleHold(activeModalTenant.id)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition shadow-xs ${
                          activeModalTenant.subscription_status === 'active'
                            ? 'bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100'
                            : 'bg-emerald-600 text-white hover:bg-emerald-500'
                        }`}
                      >
                        {activeModalTenant.subscription_status === 'active' ? 'Hold SaaS Access' : 'Reactivate SaaS'}
                      </button>
                    </div>

                    {/* Tier Selection */}
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1.5">Change Subscription Tier</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {['starter', 'standard', 'pro', 'enterprise'].map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setEditTier(t)}
                            className={`rounded-lg p-2.5 text-center font-bold uppercase transition border ${
                              editTier === t
                                ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Quick Extend Buttons */}
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1.5">Quick License Extension</label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={modalBusy}
                          onClick={() => void handleExtendSaas(30)}
                          className="rounded-lg border border-emerald-600 bg-emerald-50/50 p-2 font-bold text-emerald-800 hover:bg-emerald-100 transition"
                        >
                          +30 Days
                        </button>
                        <button
                          type="button"
                          disabled={modalBusy}
                          onClick={() => void handleExtendSaas(90)}
                          className="rounded-lg border border-slate-200 bg-white p-2 font-bold text-slate-700 hover:bg-slate-50 transition"
                        >
                          +90 Days
                        </button>
                        <button
                          type="button"
                          disabled={modalBusy}
                          onClick={() => void handleExtendSaas(365)}
                          className="rounded-lg border border-purple-600 bg-purple-50 p-2 font-bold text-purple-800 hover:bg-purple-100 transition"
                        >
                          +1 Year
                        </button>
                      </div>
                    </div>

                    {/* Custom Exact Expiry Date */}
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Or Set Exact Expiry Date</label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={exactExpiryDate}
                          onChange={(e) => setExactExpiryDate(e.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={modalBusy || !exactExpiryDate}
                          onClick={() => void handleSaveExactExpiry()}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 font-bold text-white hover:bg-slate-800 transition shadow-xs disabled:opacity-50"
                        >
                          Set Expiry
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 4: Hardware & IoT Fleet */}
                {modalTab === 'hardware' && (
                  <div className="space-y-4 max-w-xl">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-sky-600" />
                      Hardware Turnstile Gateways &amp; IoT Readers
                    </h3>

                    {/* Device List */}
                    <div className="space-y-2">
                      {getTenantDevices(activeModalTenant.id).length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-slate-500">
                          <Radio className="mx-auto h-6 w-6 text-slate-300 mb-1" />
                          No hardware devices registered yet for this gym.
                        </div>
                      ) : (
                        getTenantDevices(activeModalTenant.id).map((dev) => (
                          <div
                            key={dev.id}
                            className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs flex items-center justify-between"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900">{dev.device_name}</span>
                                <span className="rounded bg-slate-100 px-1 text-[9px] font-mono uppercase text-slate-600">
                                  {dev.device_type}
                                </span>
                                {dev.ip_address && (
                                  <span className="text-[10px] text-slate-400 font-mono">({dev.ip_address})</span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                Heartbeat: {dev.last_heartbeat ? formatSafeDate(dev.last_heartbeat) : 'No ping'}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={unlockPulseBusy === dev.id}
                                onClick={() => void handleRemoteUnlock(activeModalTenant.id, dev.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-500 transition disabled:opacity-50"
                              >
                                <Unlock className="h-3 w-3" />
                                Pulse Unlock
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteDevice(dev.id)}
                                className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Master Remote Unlock for All Devices */}
                    <button
                      type="button"
                      disabled={unlockPulseBusy === activeModalTenant.id}
                      onClick={() => void handleRemoteUnlock(activeModalTenant.id)}
                      className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2 font-bold text-slate-700 hover:bg-slate-100 transition flex items-center justify-center gap-2 shadow-xs"
                    >
                      <Unlock className="h-3.5 w-3.5 text-emerald-600" />
                      Pulse Remote Unlock to ALL Gym Gates
                    </button>

                    {/* Add New Hardware Device */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                      <label className="block font-bold text-slate-800">Register New Hardware Reader</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Device Name (e.g. Front Turnstile)"
                          value={newDevName}
                          onChange={(e) => setNewDevName(e.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none"
                        />
                        <select
                          value={newDevType}
                          onChange={(e) => setNewDevType(e.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none"
                        >
                          <option value="esp32_turnstile">ESP32 Turnstile Controller</option>
                          <option value="mifare_rfid">13.56MHz Mifare RFID Reader</option>
                          <option value="r307_fingerprint">R307 Biometric Fingerprint</option>
                          <option value="qr_kiosk">Tablet QR Kiosk</option>
                        </select>
                      </div>
                      <input
                        type="text"
                        placeholder="IP Address (Optional, e.g. 192.168.1.105)"
                        value={newDevIp}
                        onChange={(e) => setNewDevIp(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={modalBusy || !newDevName}
                        onClick={() => void handleAddDevice()}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500 transition shadow-xs disabled:opacity-50"
                      >
                        Register Hardware Gateway
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 5: Feature Flags (15 Toggles) */}
                {modalTab === 'flags' && (
                  <div className="space-y-4 max-w-2xl">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <Sliders className="h-4 w-4 text-indigo-600" />
                          Granular Feature Flags (15 Controls)
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Disabling a feature hides the tab/kiosk and shows an upgrade prompt in the Gym Owner dashboard.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={modalBusy}
                        onClick={() => void handleSaveFlags()}
                        className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white shadow-md hover:bg-indigo-500 transition disabled:opacity-50"
                      >
                        {modalBusy ? 'Saving...' : 'Save All 15 Flags'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {ALL_15_FEATURE_FLAGS.map((f) => {
                        const Icon = f.icon;
                        const isEnabled = editFlags[f.key] ?? true;

                        return (
                          <div
                            key={f.key}
                            className={`rounded-xl border p-3 flex items-start justify-between transition ${
                              isEnabled ? 'border-indigo-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'
                            }`}
                          >
                            <div className="flex items-start gap-2.5 min-w-0 pr-2">
                              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                                isEnabled ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-500'
                              }`}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-slate-900 truncate">{f.label}</p>
                                <p className="text-[10px] text-slate-500 line-clamp-1">{f.desc}</p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setEditFlags((prev) => ({
                                  ...prev,
                                  [f.key]: !isEnabled,
                                }));
                              }}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                isEnabled ? 'bg-indigo-600' : 'bg-slate-300'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                                  isEnabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* TAB 6: Financial Ledger */}
                {modalTab === 'finance' && (
                  <div className="space-y-4 max-w-xl">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-emerald-600" />
                      Platform Financial Ledger &amp; Commissions
                    </h3>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                        <span className="text-slate-500">Total Volume Collected</span>
                        <p className="text-lg font-bold text-slate-900 mt-1">
                          ₹{(activeModalTenant.totalRevenue ?? 0).toLocaleString('en-IN')}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                        <span className="text-slate-500">Platform Commission Rate</span>
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="number"
                            step="0.1"
                            value={editCommissionRate}
                            onChange={(e) => setEditCommissionRate(Number(e.target.value))}
                            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold"
                          />
                          <span className="font-bold text-slate-700">%</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={modalBusy}
                        onClick={() => void saveTenantDetails()}
                        className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50"
                      >
                        Save Financial Terms
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 7: Communication & Quotas */}
                {modalTab === 'comms' && (
                  <div className="space-y-4 max-w-xl">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Send className="h-4 w-4 text-emerald-600" />
                      Communication Gateway Quotas &amp; Top-ups
                    </h3>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                      <div className="flex justify-between">
                        <span className="font-semibold text-slate-700">WhatsApp Notification Pack</span>
                        <span className="font-mono font-bold text-emerald-700">
                          {activeModalTenant.whatsapp_quota ?? 2000} Messages
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={creditAdding}
                          onClick={() => void handleAddCredits('whatsapp', 1000)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-bold text-slate-700 hover:bg-slate-100"
                        >
                          +1,000 Messages
                        </button>
                        <button
                          type="button"
                          disabled={creditAdding}
                          onClick={() => void handleAddCredits('whatsapp', 5000)}
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 font-bold text-emerald-800 hover:bg-emerald-100"
                        >
                          +5,000 Messages
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                      <div className="flex justify-between">
                        <span className="font-semibold text-slate-700">SMS Gateway Credits (DLT)</span>
                        <span className="font-mono font-bold text-indigo-700">
                          {activeModalTenant.sms_credits ?? 850} Credits
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={creditAdding}
                          onClick={() => void handleAddCredits('sms', 500)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-bold text-slate-700 hover:bg-slate-100"
                        >
                          +500 SMS Credits
                        </button>
                        <button
                          type="button"
                          disabled={creditAdding}
                          onClick={() => void handleAddCredits('sms', 2000)}
                          className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1 font-bold text-indigo-800 hover:bg-indigo-100"
                        >
                          +2,000 SMS Credits
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 8: Compliance & Audit */}
                {modalTab === 'audit' && (
                  <div className="space-y-4 max-w-xl">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Download className="h-4 w-4 text-slate-600" />
                      Compliance &amp; Data Audit Exports
                    </h3>

                    <p className="text-slate-500">
                      Download full data dumps for regulatory compliance, member data portability, and backups.
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => alert(`Exporting member roster for ${activeModalTenant.name}...`)}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-left font-bold text-slate-800 hover:bg-slate-50 transition shadow-xs flex items-center gap-2"
                      >
                        <Users className="h-4 w-4 text-indigo-600" />
                        Export Member Roster (CSV)
                      </button>

                      <button
                        type="button"
                        onClick={() => alert(`Exporting turnstile logs for ${activeModalTenant.name}...`)}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-left font-bold text-slate-800 hover:bg-slate-50 transition shadow-xs flex items-center gap-2"
                      >
                        <Cpu className="h-4 w-4 text-sky-600" />
                        Export Turnstile Logs (CSV)
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 9: Support & CRM Notes */}
                {modalTab === 'support' && (
                  <div className="space-y-4 max-w-xl">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <LifeBuoy className="h-4 w-4 text-teal-600" />
                      Account Management &amp; Internal CRM Notes
                    </h3>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Dedicated Account Manager</label>
                        <input
                          type="text"
                          value={editAccountManager}
                          onChange={(e) => setEditAccountManager(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">VIP Priority Status</label>
                        <button
                          type="button"
                          onClick={() => setEditVipStatus(!editVipStatus)}
                          className={`w-full rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                            editVipStatus
                              ? 'border-purple-300 bg-purple-50 text-purple-900'
                              : 'border-slate-200 bg-white text-slate-600'
                          }`}
                        >
                          {editVipStatus ? '★ VIP Customer (24/7 SLA)' : 'Standard Customer SLA'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Private Internal Notes (Staff Only)</label>
                      <textarea
                        rows={5}
                        placeholder="Private notes about contract agreements, owner discussions, special requirements..."
                        value={editInternalNotes}
                        onChange={(e) => setEditInternalNotes(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-900 focus:outline-none"
                      />
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={modalBusy}
                        onClick={() => void saveTenantDetails()}
                        className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50"
                      >
                        Save CRM Notes
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB 10: Emergency Kill Switch */}
                {modalTab === 'emergency' && (
                  <div className="space-y-4 max-w-xl">
                    <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 space-y-3">
                      <h3 className="text-sm font-bold text-rose-900 flex items-center gap-2">
                        <AlertOctagon className="h-5 w-5 text-rose-600" />
                        Emergency Quarantine / Kill Switch
                      </h3>
                      <p className="text-xs text-rose-700 leading-relaxed">
                        Executing quarantine will immediately suspend SaaS access for <span className="font-bold">{activeModalTenant.name}</span>,
                        disconnect all connected ESP32 turnstiles, revoke all 15 feature flags, and lock all staff and owner consoles.
                      </p>

                      <label className="flex items-center gap-2 text-xs font-semibold text-rose-900 cursor-pointer pt-2">
                        <input
                          type="checkbox"
                          checked={killSwitchConfirmed}
                          onChange={(e) => setKillSwitchConfirmed(e.target.checked)}
                          className="h-4 w-4 rounded border-rose-300 text-rose-600"
                        />
                        I understand this immediately shuts down this gym deployment.
                      </label>

                      <div className="pt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={modalBusy || !killSwitchConfirmed}
                          onClick={() => void handleEmergencyQuarantine()}
                          className="rounded-xl bg-rose-600 px-4 py-2 font-bold text-white shadow-md hover:bg-rose-700 transition disabled:opacity-50 flex items-center gap-2"
                        >
                          <ShieldAlert className="h-4 w-4" />
                          EXECUTE EMERGENCY KILL SWITCH
                        </button>

                        {activeModalTenant.subscription_status === 'suspended' && (
                          <button
                            type="button"
                            disabled={modalBusy}
                            onClick={() => void handleRestoreQuarantine()}
                            className="rounded-xl border border-emerald-600 bg-emerald-50 px-4 py-2 font-bold text-emerald-800 hover:bg-emerald-100 transition"
                          >
                            Restore From Quarantine
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Deploy New Gym */}
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

            <form
              onSubmit={async (e) => {
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
              }}
              className="mt-5 space-y-4 text-xs"
            >
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

      {/* MODAL: Platform Broadcast */}
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
              Broadcasts a banner notification to all gym owners and receptionists simultaneously.
            </p>

            <form
              onSubmit={async (e) => {
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
              }}
              className="mt-5 space-y-4 text-xs"
            >
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

      {/* AUTH GATE MODAL */}
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

            <form
              onSubmit={async (e) => {
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
              }}
              className="space-y-4"
            >
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
