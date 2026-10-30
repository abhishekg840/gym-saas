'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  Banknote,
  Bell,
  CheckCircle,
  Clock,
  CreditCard,
  Download,
  Dumbbell,
  FileText,
  HandCoins,
  Lock,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  Plus,
  Printer,
  QrCode,
  RotateCw,
  Search,
  Send,
  ShoppingBag,
  Unlock,
  UserRound,
  X,
  ChevronDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { readSession, type GymSession } from '@/lib/session';
import { useTenantBranding } from '@/lib/use-tenant-branding';
import { waLink } from '@/lib/whatsapp';

const PLAN_PRESETS = [
  { name: 'Monthly', days: 30, price: 1000 },
  { name: 'Quarterly', days: 90, price: 2700 },
  { name: 'Half-Yearly', days: 180, price: 5000 },
  { name: 'Yearly', days: 365, price: 9000 },
];

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'upi', label: 'UPI / QR', icon: HandCoins },
  { value: 'card', label: 'Card POS', icon: CreditCard },
  { value: 'split', label: 'Split (Cash + UPI)', icon: CreditCard },
];

type TabKind = 'overdue' | 'expiring' | 'frozen' | 'ledger';

interface MemberRow {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  membership_end?: string | null;
  status?: string | null;
  amount_paid?: number | null;
  invoice_count?: number | null;
  last_invoice?: string | null;
  is_frozen?: boolean | null;
  freeze_start_date?: string | null;
  freeze_end_date?: string | null;
  total_freeze_days?: number | null;
  plan_name?: string | null;
  plan_id?: string | null;
  tenant_id?: string | null;
}

interface InvoiceRow {
  id: string;
  member_id?: string | null;
  member_name?: string | null;
  member_phone?: string | null;
  amount?: number | null;
  payment_method?: string | null;
  status?: string | null;
  issued_at?: string | null;
  tenant_id?: string | null;
  notes?: string | null;
}

/** Safe Date Formatter: never throws an invalid date exception */
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

/** Safe Overdue Days calculation */
function getOverdueDays(dateStr: string | null | undefined): number {
  if (!dateStr) return 1;
  try {
    const end = new Date(dateStr);
    if (isNaN(end.getTime())) return 1;
    const now = new Date();
    return Math.max(1, Math.floor((now.getTime() - end.getTime()) / 86400000));
  } catch {
    return 1;
  }
}

/** Safe Expiring Days calculation */
function getDaysLeft(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  try {
    const end = new Date(dateStr);
    if (isNaN(end.getTime())) return 0;
    const now = new Date();
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
  } catch {
    return 0;
  }
}

export default function AdminPaymentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<GymSession | null>(null);
  const { branding: tenantBranding } = useTenantBranding();
  const [currentRole, setCurrentRole] = useState<'owner' | 'reception'>('owner');
  const [tab, setTab] = useState<TabKind>('overdue');
  const [search, setSearch] = useState('');

  const [overdueMembers, setOverdueMembers] = useState<MemberRow[]>([]);
  const [expiringMembers, setExpiringMembers] = useState<MemberRow[]>([]);
  const [frozenMembers, setFrozenMembers] = useState<MemberRow[]>([]);
  const [ledgerInvoices, setLedgerInvoices] = useState<InvoiceRow[]>([]);

  // Collect Fee Modal State
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectMember, setCollectMember] = useState<MemberRow | null>(null);
  const [allMembers, setAllMembers] = useState<MemberRow[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedPlanPreset, setSelectedPlanPreset] = useState<string>('Monthly');
  const [planFee, setPlanFee] = useState<string>('1000');
  const [planDays, setPlanDays] = useState<number>(30);
  const [discount, setDiscount] = useState<string>('0');
  const [amountPaying, setAmountPaying] = useState<string>('1000');
  const [paymentMode, setPaymentMode] = useState<string>('upi');
  const [notes, setNotes] = useState<string>('');
  const [collectNotice, setCollectNotice] = useState<{ message: string; kind: 'ok' | 'bad' } | null>(null);
  const [collectBusy, setCollectBusy] = useState(false);

  // Receipt Modal State
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptInvoice, setReceiptInvoice] = useState<InvoiceRow | null>(null);
  const [receiptPlanName, setReceiptPlanName] = useState<string>('Gym Membership');
  const [receiptExpiry, setReceiptExpiry] = useState<string>('—');

  const [tenantLogo, setTenantLogo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // ---- Session & role ----
  useEffect(() => {
    try {
      const s = readSession();
      if (!s) {
        router.push('/login');
        return;
      }
      if (s.role === 'member') {
        router.replace('/member/dashboard');
        return;
      }
      setSession(s);
      setCurrentRole(s.role === 'super_admin' || s.role === 'owner' ? 'owner' : 'reception');
    } catch {
      // Fallback
    }
  }, [router]);

  const tenantId = session?.tenantId ?? null;

  // ---- Data loading ----
  const loadTabData = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Check tenant suspension and logo
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('subscription_status, logo_url')
        .eq('id', tenantId)
        .maybeSingle();

      if (tenantRow?.subscription_status === 'suspended') {
        router.replace('/admin');
        return;
      }
      if (tenantRow?.logo_url) {
        setTenantLogo(tenantRow.logo_url);
      }

      const now = new Date();
      const nowStr = now.toISOString().split('T')[0];
      const sevenDaysLater = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

      const { data: members, error: mErr } = await supabase
        .from('members')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('full_name', { ascending: true });

      if (mErr) console.error('Error fetching members:', mErr);

      const all = ((members ?? []) as MemberRow[]).filter((m) => m && m.id);
      setAllMembers(all);

      const overdue = all.filter((m) => {
        const status = String(m.status ?? '').toLowerCase();
        if (status === 'frozen' || m.is_frozen) return false;
        const end = m.membership_end ? new Date(m.membership_end) : null;
        const isExpired = end && !isNaN(end.getTime()) ? end < now : true;
        const isBlocked = status === 'expired' || status === 'blocked';
        return isExpired || isBlocked;
      });
      setOverdueMembers(overdue);

      const expiring = all
        .filter((m) => {
          const status = String(m.status ?? '').toLowerCase();
          if (status === 'frozen' || m.is_frozen) return false;
          const end = m.membership_end ? new Date(m.membership_end) : null;
          if (!end || isNaN(end.getTime()) || end < now) return false;
          const endStr = end.toISOString().split('T')[0];
          return endStr >= nowStr && endStr <= sevenDaysLater;
        })
        .sort((a, b) => {
          const ea = a.membership_end ? new Date(a.membership_end).getTime() : 0;
          const eb = b.membership_end ? new Date(b.membership_end).getTime() : 0;
          return ea - eb;
        });
      setExpiringMembers(expiring);

      const frozen = all.filter((m) => {
        const status = String(m.status ?? '').toLowerCase();
        return status === 'frozen' || m.is_frozen === true;
      });
      setFrozenMembers(frozen);

      const { data: invoices, error: invErr } = await supabase
        .from('invoices')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('issued_at', { ascending: false })
        .limit(200);

      if (invErr) console.error('Error fetching invoices:', invErr);
      setLedgerInvoices(((invoices ?? []) as InvoiceRow[]).filter((i) => i && i.id));
    } catch (err) {
      console.error('loadTabData unexpected error:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadTabData();
  }, [loadTabData]);

  // Handle plan preset change
  const handlePlanPresetSelect = (presetName: string) => {
    setSelectedPlanPreset(presetName);
    const preset = PLAN_PRESETS.find((p) => p.name === presetName);
    if (preset) {
      setPlanFee(String(preset.price));
      setPlanDays(preset.days);
      const disc = Number(discount) || 0;
      setAmountPaying(String(Math.max(0, preset.price - disc)));
    } else {
      setPlanFee('0');
      setPlanDays(0);
      setAmountPaying('0');
    }
  };

  // Calculations for collect modal
  const numFee = Number(planFee) || 0;
  const numDisc = Number(discount) || 0;
  const numPaid = Number(amountPaying) || 0;
  const calculatedBalance = Math.max(0, numFee - numDisc - numPaid);

  let previewNewExpiry = '—';
  if (collectMember) {
    const now = new Date();
    const currentEnd = collectMember.membership_end ? new Date(collectMember.membership_end) : null;
    const isValidDate = currentEnd && !isNaN(currentEnd.getTime());
    if (planDays > 0) {
      const baseDate = isValidDate && currentEnd > now ? currentEnd : now;
      const futureDate = new Date(baseDate.getTime() + planDays * 86400000);
      previewNewExpiry = formatSafeDate(futureDate.toISOString());
    } else if (isValidDate) {
      previewNewExpiry = formatSafeDate(collectMember.membership_end);
    }
  }

  // Open Collect Modal for a specific member
  const openCollectForMember = (m: MemberRow) => {
    setCollectMember(m);
    setSelectedPlanPreset('Monthly');
    setPlanFee('1000');
    setPlanDays(30);
    setDiscount('0');
    setAmountPaying('1000');
    setPaymentMode('upi');
    setNotes('');
    setCollectNotice(null);
    setCollectOpen(true);
  };

  // Lifecycle status actions (Hold, Freeze, Unfreeze)
  async function updateMemberStatus(memberId: string, action: 'hold_unpaid' | 'freeze' | 'unfreeze', days: number = 0) {
    if (!tenantId) return;
    setActionBusyId(memberId);
    try {
      const res = await fetch('/api/admin/payments/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, action, tenant_id: tenantId, days }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || 'Action failed');
        return;
      }
      void loadTabData();
    } catch {
      alert('Network error while updating status.');
    } finally {
      setActionBusyId(null);
    }
  }

  // Collect Fee submit
  async function confirmCollect() {
    if (!collectMember) {
      setCollectNotice({ message: 'Please select a member.', kind: 'bad' });
      return;
    }
    if (numPaid <= 0) {
      setCollectNotice({ message: 'Amount paying now must be greater than zero.', kind: 'bad' });
      return;
    }
    setCollectBusy(true);
    setCollectNotice(null);
    try {
      const planNameToSend = selectedPlanPreset === 'Custom' ? 'Custom / Balance Clearance' : `${selectedPlanPreset} (${planDays} Days)`;
      const res = await fetch('/api/admin/payments/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: collectMember.id,
          tenant_id: tenantId,
          plan_name: planNameToSend,
          duration_days: planDays,
          total_fee: numFee,
          amount_paid: numPaid,
          discount: numDisc,
          payment_method: paymentMode,
          notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setCollectNotice({ message: data.error || 'Payment failed.', kind: 'bad' });
        return;
      }

      setCollectNotice({
        message: `Success! Paid ₹${Number(numPaid || 0).toLocaleString('en-IN')}. New expiry: ${data.membership_end || '—'}. Remaining dues: ₹${Number(data.pending_balance || 0).toLocaleString('en-IN')}`,
        kind: 'ok',
      });

      void loadTabData();
      setTimeout(() => {
        setCollectOpen(false);
      }, 1400);
    } catch {
      setCollectNotice({ message: 'Network error. Please try again.', kind: 'bad' });
    } finally {
      setCollectBusy(false);
    }
  }

  // Open Receipt Modal
  const openReceiptModal = (invoice: InvoiceRow) => {
    setReceiptInvoice(invoice);
    const matchedMember = allMembers.find((m) => m.id === invoice.member_id);
    setReceiptPlanName(matchedMember?.plan_name || 'Gym Membership');
    setReceiptExpiry(formatSafeDate(matchedMember?.membership_end));
    setReceiptOpen(true);
  };

  // WhatsApp Actions with safety guards
  const sendWhatsAppUpi = (m: MemberRow) => {
    const gymName = session?.tenantName || 'Gym';
    const memberName = m.full_name || 'Member';
    const phone = m.phone || '';
    if (!phone) {
      alert('This member does not have a phone number on file.');
      return;
    }
    const msg = `Hi ${memberName}, your membership at ${gymName} is overdue. Gate access is currently paused. Please pay online via UPI or visit the desk to renew immediately:`;
    window.open(waLink(phone, msg), '_blank');
  };

  const sendWhatsAppReminder = (m: MemberRow) => {
    const gymName = session?.tenantName || 'Gym';
    const memberName = m.full_name || 'Member';
    const phone = m.phone || '';
    if (!phone) {
      alert('This member does not have a phone number on file.');
      return;
    }
    const daysLeft = getDaysLeft(m.membership_end);
    const expiryDisplay = formatSafeDate(m.membership_end);
    const msg = `Hi ${memberName}, friendly reminder that your gym membership at ${gymName} expires in ${daysLeft} days (${expiryDisplay}). Renew early at the desk to avoid entry interruptions!`;
    window.open(waLink(phone, msg), '_blank');
  };

  const sendWhatsAppReceipt = (inv: InvoiceRow) => {
    const gymName = session?.tenantName || 'Gym';
    const memberName = inv.member_name || 'Member';
    const phone = inv.member_phone || '';
    if (!phone) {
      alert('This invoice does not have a member phone number.');
      return;
    }
    const invIdDisplay = inv.id ? String(inv.id).slice(0, 8).toUpperCase() : 'RECEIPT';
    const amountDisplay = Number(inv.amount || 0).toLocaleString('en-IN');
    const paymentMethodDisplay = String(inv.payment_method || 'CASH').toUpperCase();
    const dateDisplay = formatSafeDate(inv.issued_at);
    const statusDisplay = String(inv.status || 'PAID').toUpperCase();

    const msg = `*PAYMENT RECEIPT — ${gymName.toUpperCase()}*\n\nHello ${memberName},\nWe have received your payment of *₹${amountDisplay}* via ${paymentMethodDisplay}.\nReceipt ID: #${invIdDisplay}\nDate: ${dateDisplay}\nStatus: ${statusDisplay}\n\nThank you for training with us!`;
    window.open(waLink(phone, msg), '_blank');
  };

  // Filtering safely
  const s = String(search || '').toLowerCase().trim();
  const filteredOverdue = overdueMembers.filter((m) => {
    const name = String(m?.full_name ?? '').toLowerCase();
    const phone = String(m?.phone ?? '');
    return name.includes(s) || phone.includes(s);
  });

  const filteredExpiring = expiringMembers.filter((m) => {
    const name = String(m?.full_name ?? '').toLowerCase();
    const phone = String(m?.phone ?? '');
    return name.includes(s) || phone.includes(s);
  });

  const filteredFrozen = frozenMembers.filter((m) => {
    const name = String(m?.full_name ?? '').toLowerCase();
    const phone = String(m?.phone ?? '');
    return name.includes(s) || phone.includes(s);
  });

  const filteredLedger = ledgerInvoices.filter((i) => {
    const name = String(i?.member_name ?? '').toLowerCase();
    const phone = String(i?.member_phone ?? '');
    const id = String(i?.id ?? '').toLowerCase();
    return name.includes(s) || phone.includes(s) || id.includes(s);
  });

  const ms = String(memberSearch || '').toLowerCase().trim();
  const searchEligibleMembers = allMembers.filter((m) => {
    const name = String(m?.full_name ?? '').toLowerCase();
    const phone = String(m?.phone ?? '');
    return name.includes(ms) || phone.includes(ms);
  });

  const isActive = (route: string) => pathname === route;

  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased">
      {/* Shared Header */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="h-9 w-9 shrink-0 items-center justify-center rounded-lg flex overflow-hidden shadow-xs"
              style={{ backgroundColor: tenantBranding.primary_color || '#059669' }}
            >
              {tenantBranding.logo_url || tenantLogo ? (
                <img src={tenantBranding.logo_url || tenantLogo || ""} alt="Logo" className="h-full w-full object-cover" />
              ) : (
                <Dumbbell className="h-4 w-4 text-white" />
              )}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[14px] font-bold tracking-tight text-slate-900">
                {tenantBranding.name || session?.tenantName || 'Gym'}
              </p>
              <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {tenantBranding.name} |{' '}
                <button
                  type="button"
                  onClick={() => setCurrentRole((p) => (p === 'owner' ? 'reception' : 'owner'))}
                  className="inline-flex items-center gap-1 text-slate-400 transition hover:text-slate-900"
                >
                  {currentRole === 'owner' ? <Unlock className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                  {currentRole === 'owner' ? ' Owner' : ' Reception'}
                </button>
              </p>
            </div>
          </div>

          <nav aria-label="Dashboard sections" className="hidden flex-1 items-center justify-center gap-1 lg:flex">
            <Link
              href="/admin"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                isActive('/admin') ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              Overview
            </Link>
            <Link
              href="/attendance"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                isActive('/attendance') ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              Attendance
            </Link>
            <Link
              href="/admin/payments"
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium transition bg-emerald-600 text-white flex items-center gap-1.5"
            >
              <CreditCard className="h-3.5 w-3.5 shrink-0" /> Fees &amp; Dues
            </Link>
            <Link
              href="/store"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                isActive('/store') ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <ShoppingBag className="h-3.5 w-3.5 shrink-0" /> Store
            </Link>
            <Link
              href="/trainers"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                isActive('/trainers') ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              Trainers
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/scan"
              target="_blank"
              title="Open the QR scanner"
              className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 hover:border-slate-300 sm:inline-flex"
            >
              <QrCode className="h-3.5 w-3.5" /> Scan Gate
            </Link>
            <button
              type="button"
              onClick={() => {
                setCollectMember(allMembers[0] || null);
                setSelectedPlanPreset('Monthly');
                setPlanFee('1000');
                setPlanDays(30);
                setDiscount('0');
                setAmountPaying('1000');
                setPaymentMode('upi');
                setNotes('');
                setCollectNotice(null);
                setCollectOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" /> Collect Fee
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header stats bar */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Commercial Gym Fee Engine</h1>
            <p className="text-sm text-slate-500 mt-1">
              Manage fee renewals, auto-gate blocks, membership freezes, and invoice receipts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search member or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <button
              onClick={() => void loadTabData()}
              disabled={loading}
              title="Refresh"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition"
            >
              <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 4 Real Operational Tabs */}
        <div className="border-b border-slate-200 mb-6 flex gap-2">
          <button
            type="button"
            onClick={() => setTab('overdue')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              tab === 'overdue'
                ? 'border-rose-600 text-rose-600 bg-rose-50/50'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            Overdue / Blocked
            <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
              {overdueMembers.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab('expiring')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              tab === 'expiring'
                ? 'border-amber-600 text-amber-600 bg-amber-50/50'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <Clock className="h-4 w-4 text-amber-600" />
            Expiring Soon (Next 7 Days)
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
              {expiringMembers.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab('frozen')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              tab === 'frozen'
                ? 'border-sky-600 text-sky-600 bg-sky-50/50'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <PauseCircle className="h-4 w-4 text-sky-600" />
            Frozen / On Hold
            <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">
              {frozenMembers.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab('ledger')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              tab === 'ledger'
                ? 'border-emerald-600 text-emerald-600 bg-emerald-50/50'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <FileText className="h-4 w-4 text-emerald-600" />
            Paid Receipts Ledger
            <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              {ledgerInvoices.length}
            </span>
          </button>
        </div>

        {/* Tab 1: Overdue / Blocked */}
        {tab === 'overdue' && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3">Overdue &amp; Gate Access</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-400">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400 mb-2" />
                      Loading overdue records...
                    </td>
                  </tr>
                ) : filteredOverdue.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500">
                      <CheckCircle className="mx-auto h-8 w-8 text-emerald-500 mb-2" />
                      No members are currently overdue or gate-blocked!
                    </td>
                  </tr>
                ) : (
                  filteredOverdue.map((m) => {
                    const daysOver = getOverdueDays(m.membership_end);
                    const isBusy = actionBusyId === m.id;
                    const memberName = m.full_name || 'Member';
                    const memberPhone = m.phone || 'No phone';
                    const expiryDisplay = formatSafeDate(m.membership_end);

                    return (
                      <tr key={m.id} className="hover:bg-slate-50/60 transition">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <div>{memberName}</div>
                          <div className="text-[11px] text-slate-400">{memberPhone}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {expiryDisplay}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
                            <Lock className="h-3 w-3" />
                            Overdue by {daysOver} day{daysOver > 1 ? 's' : ''} — Gate Blocked
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openCollectForMember(m)}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-500 transition"
                            >
                              <Unlock className="h-3 w-3" /> Collect Fee &amp; Unblock
                            </button>
                            <button
                              type="button"
                              onClick={() => sendWhatsAppUpi(m)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition"
                            >
                              <Send className="h-3 w-3 text-emerald-600" /> WhatsApp UPI Link
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void updateMemberStatus(m.id, 'freeze', 15)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition"
                            >
                              <PauseCircle className="h-3 w-3 text-sky-600" /> Freeze
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
        )}

        {/* Tab 2: Expiring Soon (Next 7 Days) */}
        {tab === 'expiring' && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3">Days Remaining</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-400">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400 mb-2" />
                      Loading expiring records...
                    </td>
                  </tr>
                ) : filteredExpiring.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500">
                      <CheckCircle className="mx-auto h-8 w-8 text-emerald-500 mb-2" />
                      No memberships expiring in the next 7 days.
                    </td>
                  </tr>
                ) : (
                  filteredExpiring.map((m) => {
                    const daysLeft = getDaysLeft(m.membership_end);
                    const memberName = m.full_name || 'Member';
                    const memberPhone = m.phone || 'No phone';
                    const expiryDisplay = formatSafeDate(m.membership_end);

                    return (
                      <tr key={m.id} className="hover:bg-slate-50/60 transition">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <div>{memberName}</div>
                          <div className="text-[11px] text-slate-400">{memberPhone}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {expiryDisplay}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                            <Clock className="h-3 w-3" />
                            Expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openCollectForMember(m)}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-500 transition"
                            >
                              <RotateCw className="h-3 w-3" /> Renew Early
                            </button>
                            <button
                              type="button"
                              onClick={() => sendWhatsAppReminder(m)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition"
                            >
                              <Send className="h-3 w-3 text-emerald-600" /> Send Advance Reminder
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
        )}

        {/* Tab 3: Frozen / On Hold */}
        {tab === 'frozen' && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Current Expiry</th>
                  <th className="px-4 py-3">Freeze Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-400">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400 mb-2" />
                      Loading frozen memberships...
                    </td>
                  </tr>
                ) : filteredFrozen.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500">
                      <PauseCircle className="mx-auto h-8 w-8 text-sky-500 mb-2" />
                      No members are currently paused or frozen.
                    </td>
                  </tr>
                ) : (
                  filteredFrozen.map((m) => {
                    const isBusy = actionBusyId === m.id;
                    const memberName = m.full_name || 'Member';
                    const memberPhone = m.phone || 'No phone';
                    const expiryDisplay = formatSafeDate(m.membership_end);
                    const freezeStartDisplay = formatSafeDate(m.freeze_start_date);

                    return (
                      <tr key={m.id} className="hover:bg-slate-50/60 transition">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <div>{memberName}</div>
                          <div className="text-[11px] text-slate-400">{memberPhone}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {expiryDisplay}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 border border-sky-200 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">
                            <PauseCircle className="h-3 w-3" />
                            Paused / Frozen {m.freeze_start_date ? `since ${freezeStartDisplay}` : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void updateMemberStatus(m.id, 'unfreeze', 0)}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-500 transition"
                          >
                            <Unlock className="h-3 w-3" /> Resume / Unfreeze
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 4: Paid Receipts Ledger */}
        {tab === 'ledger' && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Invoice ID / Date</th>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Amount Paid</th>
                  <th className="px-4 py-3">Payment Mode</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Receipt Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400 mb-2" />
                      Loading invoice ledger...
                    </td>
                  </tr>
                ) : filteredLedger.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500">
                      <FileText className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                      No invoices recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredLedger.map((inv) => {
                    const invIdDisplay = inv.id ? String(inv.id).slice(0, 8).toUpperCase() : '—';
                    const issuedDateDisplay = formatSafeDate(inv.issued_at);
                    const memberName = inv.member_name || 'Member';
                    const memberPhone = inv.member_phone || 'No phone';
                    const amountDisplay = Number(inv.amount || 0).toLocaleString('en-IN');
                    const paymentMethodDisplay = String(inv.payment_method || 'CASH').toUpperCase();
                    const statusVal = String(inv.status || 'paid').toLowerCase();

                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/60 transition">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <div className="font-mono text-[11px]">#{invIdDisplay}</div>
                          <div className="text-[11px] text-slate-400">
                            {issuedDateDisplay}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <div>{memberName}</div>
                          <div className="text-[11px] text-slate-400">{memberPhone}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          ₹{amountDisplay}
                        </td>
                        <td className="px-4 py-3 uppercase text-slate-600 font-mono text-[11px]">
                          {paymentMethodDisplay}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              statusVal === 'paid'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {statusVal}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => sendWhatsAppReceipt(inv)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition"
                            >
                              <Send className="h-3 w-3 text-emerald-600" /> WhatsApp Receipt
                            </button>
                            <button
                              type="button"
                              onClick={() => openReceiptModal(inv)}
                              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-slate-800 transition"
                            >
                              <Printer className="h-3 w-3" /> View Receipt
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
        )}
      </div>

      {/* MODAL 1: Upgraded "Collect Gym Fee" Modal */}
      {collectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 my-8 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setCollectOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-emerald-600" /> Collect Gym Fee &amp; Renew
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Extend membership period, record balance dues, and unblock gate turnstile.
            </p>

            <div className="mt-5 space-y-4 text-xs">
              {/* Member Selector */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Gym Member</label>
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search member name or phone..."
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <select
                  value={collectMember?.id || ''}
                  onChange={(e) => {
                    const found = allMembers.find((m) => m.id === e.target.value);
                    if (found) setCollectMember(found);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">-- Choose Member --</option>
                  {searchEligibleMembers.map((m) => {
                    const memberName = m.full_name || 'Member';
                    const memberPhone = m.phone || 'No phone';
                    const memberStatus = String(m.status || 'ACTIVE').toUpperCase();
                    const expiryDisplay = formatSafeDate(m.membership_end);

                    return (
                      <option key={m.id} value={m.id}>
                        {memberName} ({memberPhone}) — {memberStatus} | Exp: {expiryDisplay}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Current Status Preview */}
              {collectMember && (
                <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200 text-slate-600 flex justify-between items-center text-[11px]">
                  <div>
                    <span className="font-semibold text-slate-900">{collectMember.full_name || 'Member'}</span>
                    <span className="text-slate-400 ml-1.5">({collectMember.phone || 'No phone'})</span>
                  </div>
                  <div>
                    Current Expiry:{' '}
                    <span className="font-medium text-slate-800">
                      {formatSafeDate(collectMember.membership_end)}
                    </span>
                  </div>
                </div>
              )}

              {/* Plan Preset Selector */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Membership Plan Preset</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PLAN_PRESETS.map((p) => {
                    const isSelected = selectedPlanPreset === p.name;
                    return (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => handlePlanPresetSelect(p.name)}
                        className={`rounded-lg p-2.5 text-left border transition ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <div className="font-medium">{p.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {p.days} Days — ₹{Number(p.price || 0).toLocaleString('en-IN')}
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => handlePlanPresetSelect('Custom')}
                    className={`rounded-lg p-2.5 text-left border transition ${
                      selectedPlanPreset === 'Custom'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-medium">Custom Plan</div>
                    <div className="text-[11px] text-slate-500">Clear Balance / Custom</div>
                  </button>
                </div>
              </div>

              {/* Fee Breakdown Inputs */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Plan Fee (₹)</label>
                  <input
                    type="number"
                    value={planFee}
                    onChange={(e) => setPlanFee(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Discount (₹)</label>
                  <input
                    type="number"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Duration (Days)</label>
                  <input
                    type="number"
                    value={planDays}
                    onChange={(e) => setPlanDays(Number(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Amount Paying Now (₹)</label>
                <input
                  type="number"
                  value={amountPaying}
                  onChange={(e) => setAmountPaying(e.target.value)}
                  className="w-full rounded-lg border border-emerald-500 bg-emerald-50/30 px-3 py-2 text-sm font-bold text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              {/* Live Auto-Calculated Summary */}
              <div className="rounded-xl bg-slate-900 text-white p-3.5 space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300">Balance Remaining:</span>
                  <span
                    className={`font-mono font-bold text-sm ${
                      calculatedBalance > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    ₹{Number(calculatedBalance || 0).toLocaleString('en-IN')} {calculatedBalance > 0 ? '(PARTIAL DUE)' : '(PAID)'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300">New Expiry Date:</span>
                  <span className="font-semibold text-white">{previewNewExpiry}</span>
                </div>
              </div>

              {/* Payment Mode */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Mode</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {PAYMENT_MODES.map((mode) => {
                    const Icon = mode.icon;
                    const isSelected = paymentMode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => setPaymentMode(mode.value)}
                        className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes / Transaction Reference (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. UPI ref #123456 or discount reason"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {/* Notice */}
              {collectNotice && (
                <div
                  className={`rounded-lg p-2.5 text-xs font-medium ${
                    collectNotice.kind === 'ok'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {collectNotice.message}
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={collectBusy || !collectMember}
                  onClick={() => void confirmCollect()}
                  className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {collectBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Recording Fee...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4" /> Collect Fee &amp; Unblock Gate
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Printable / Shareable Digital Receipt Modal */}
      {receiptOpen && receiptInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 my-8 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setReceiptOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Receipt Card Content */}
            <div id="thermal-receipt" className="text-slate-900 text-xs">
              <div className="text-center pb-4 border-b border-dashed border-slate-300">
                <div className="flex justify-center mb-1">
                  <div className="h-10 w-10 rounded-full bg-emerald-600 flex items-center justify-center text-white">
                    <Dumbbell className="h-5 w-5" />
                  </div>
                </div>
                <h4 className="text-base font-extrabold tracking-tight uppercase">
                  {session?.tenantName || 'Commercial Gym'}
                </h4>
                <p className="text-[11px] text-slate-500">Official Membership Receipt</p>
                <p className="text-[10px] font-mono text-slate-400 mt-1">
                  Invoice #{receiptInvoice.id ? String(receiptInvoice.id).slice(0, 8).toUpperCase() : 'RECEIPT'}
                </p>
              </div>

              <div className="py-4 space-y-2 border-b border-dashed border-slate-300 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Member Name:</span>
                  <span className="font-semibold text-slate-800">{receiptInvoice.member_name || 'Member'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Phone:</span>
                  <span className="font-mono text-slate-800">{receiptInvoice.member_phone || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Plan Description:</span>
                  <span className="font-medium text-slate-800">{receiptPlanName || 'Gym Membership'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Membership Valid Till:</span>
                  <span className="font-semibold text-emerald-700">{receiptExpiry || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date Issued:</span>
                  <span className="text-slate-800">
                    {formatSafeDate(receiptInvoice.issued_at)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment Mode:</span>
                  <span className="font-mono uppercase text-slate-800">{receiptInvoice.payment_method || 'CASH'}</span>
                </div>
              </div>

              <div className="py-4 border-b border-dashed border-slate-300 flex justify-between items-center">
                <span className="text-xs font-bold text-slate-900 uppercase">Amount Paid:</span>
                <span className="text-lg font-extrabold text-emerald-600">
                  ₹{Number(receiptInvoice.amount || 0).toLocaleString('en-IN')}
                </span>
              </div>

              <div className="pt-4 text-center text-[10px] text-slate-400">
                Gate Turnstile QR &amp; RFID active. Keep training hard!
              </div>
            </div>

            {/* Receipt Modal Actions */}
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition"
              >
                <Printer className="h-4 w-4" /> Print Receipt
              </button>
              <button
                type="button"
                onClick={() => sendWhatsAppReceipt(receiptInvoice)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <Send className="h-4 w-4 text-emerald-600" /> Send on WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
