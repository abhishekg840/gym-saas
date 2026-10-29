'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  AlertTriangle,
  Banknote,
  CheckCircle,
  CreditCard,
  Download,
  Dumbbell,
  FileText,
  HandCoins,
  Lock,
  Loader2,
  Plus,
  QrCode,
  Search,
  Send,
  ShoppingBag,
  Unlock,
  UserRound,
  X,
  ChevronDown,
  Bell,
  MoreHorizontal,
  ServerCog,
  Target,
  Trophy,
  Tag,
} from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { readSession, type GymSession } from '@/lib/session';
import { waLink } from '@/lib/whatsapp';

interface GymInvoice {
  id: string;
  member_id: string;
  member_name: string;
  member_phone: string;
  amount: number;
  payment_method: string;
  status: string;
  issued_at: string;
  tenant_id: string | null;
}

interface MemberFee {
  id: string;
  full_name: string;
  phone: string;
  email?: string;
  membership_end: string;
  status: string;
  amount_paid: number;
  invoice_count: number;
  last_invoice: string | null;
  tenant_id?: string | null;
  is_frozen?: boolean;
  freeze_start_date?: string | null;
  freeze_end_date?: string | null;
  total_freeze_days?: number | null;
}

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'upi', label: 'UPI / QR', icon: HandCoins },
  { value: 'card', label: 'Card POS', icon: CreditCard },
];

const STATUS_BADGES: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  cancelled: 'bg-slate-50 text-slate-700 border-slate-200',
};

export default function AdminPaymentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<GymSession | null>(null);
  const [currentRole, setCurrentRole] = useState<'owner' | 'reception'>('owner');
  const [tab, setTab] = useState<'active' | 'pending'>('active');
  const [invoices, setInvoices] = useState<GymInvoice[]>([]);
  const [dueMembers, setDueMembers] = useState<MemberFee[]>([]);
  const [search, setSearch] = useState('');
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectMember, setCollectMember] = useState<MemberFee | null>(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectMode, setCollectMode] = useState<string>('cash');
  const [collectNotice, setCollectNotice] = useState<{ message: string; kind: 'ok' | 'bad' } | null>(null);
  const [collectBusy, setCollectBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
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
    setCurrentRole((s.role === 'super_admin' || s.role === 'owner') ? 'owner' : 'reception');
  }, [router]);

  const loadPayments = useCallback(async (tenantId: string) => {
    setLoading(true);
    try {
      const now = new Date().toISOString().split('T')[0];

      // Fetch membership fee invoices — STRICTLY exclude store/POS transactions.
      // Store POS invoices (fn_store_checkout) do NOT set member_name/member_phone.
      // Only include invoices where the member_id matches an existing member in the
      // members table for this tenant — this guarantees "Unknown Member" never appears.
      const [invRes, memRes] = await Promise.all([
        supabase
          .from('invoices')
          .select('*')
          .eq('tenant_id', tenantId)
          .not('member_id', 'is', null)
          .not('member_name', 'is', null)
          .order('issued_at', { ascending: false }),
        supabase
          .from('members')
          .select('id, full_name, phone, email, membership_end, status, amount_paid, invoice_count, last_invoice, is_frozen, freeze_start_date, freeze_end_date, total_freeze_days')
          .eq('tenant_id', tenantId),
      ]);

      // Build a set of valid member IDs for this tenant — any invoice whose
      // member_id is not in this set is a stale/orphaned record (e.g. a deleted
      // member's old POS sale) and must be excluded from the fees page.
      const validMemberIds = new Set<string>();
      (memRes.data ?? []).forEach((m: any) => validMemberIds.add(m.id));

      let fetchedInvoices = (invRes.data ?? []) as GymInvoice[];
      const memberMap = new Map<string, { full_name: string; phone: string }>();
      (memRes.data ?? []).forEach((m: any) => {
        memberMap.set(m.id, { full_name: m.full_name, phone: m.phone });
      });

      // Enrich invoices with member name/phone — only for valid members.
      // Invoices whose member is not in the members table are dropped entirely.
      const enriched = fetchedInvoices
        .filter((inv) => validMemberIds.has(inv.member_id))
        .map((inv) => {
          const member = memberMap.get(inv.member_id);
          return {
            ...inv,
            member_name: member?.full_name ?? 'Unknown Member',
            member_phone: member?.phone ?? '',
          };
        });

      setInvoices(enriched);
      setDueMembers((memRes.data ?? []) as MemberFee[]);
    } catch {
      setInvoices([]);
      setDueMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSwitchRole = () => {
    setCurrentRole((prev) => (prev === 'owner' ? 'reception' : 'owner'));
  };

  const issueReceipt = async () => {
    if (!collectMember || !session) return;
    setCollectBusy(true);
    try {
      const { error } = await supabase.from('invoices').insert({
        tenant_id: session.tenantId ?? '',
        member_id: collectMember.id,
        member_name: collectMember.full_name,
        member_phone: collectMember.phone,
        amount: Number(collectAmount) || 0,
        payment_method: collectMode,
        status: 'paid',
        issued_at: new Date().toISOString(),
      });
      if (error) throw error;

      setCollectNotice({ message: 'Fee collected & receipt issued.', kind: 'ok' });
      setTimeout(() => {
        setCollectOpen(false);
        setCollectNotice(null);
        void loadPayments(session.tenantId ?? '');
      }, 1200);
    } catch {
      setCollectNotice({ message: 'Failed to collect fee. Please try again.', kind: 'bad' });
    } finally {
      setCollectBusy(false);
    }
  };

  const downloadLedger = () => {
    const rows = invoices.map((inv) => ({
      id: inv.id,
      member: inv.member_name,
      phone: inv.member_phone,
      amount: inv.amount,
      method: inv.payment_method,
      status: inv.status,
      date: inv.issued_at,
    }));
    const csv = [
      ['ID', 'Member', 'Phone', 'Amount (₹)', 'Method', 'Status', 'Date'],
      ...rows.map((r) => [r.id, r.member, r.phone, r.amount, r.method, r.status, r.date]),
    ]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `membership-fees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const whatsappReminder = (member: MemberFee) => {
    const url = waLink(member.phone, `Hi ${member.full_name}, your gym membership dues are pending. Please clear them at the front desk.`);
    window.open(url, '_blank');
  };

  const formatMoney = (val: number) => `₹${val.toLocaleString('en-IN')}`;
  const formatDate = (val: string | null) => (val ? new Date(val).toLocaleDateString('en-IN') : '—');
  const statusLabel = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'paid') return 'Paid';
    if (s === 'pending' || s === 'due' || s === 'expired') return 'Due';
    if (s === 'failed') return 'Failed';
    return 'Cancelled';
  };
  const statusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'paid') return STATUS_BADGES.paid;
    if (s === 'pending' || s === 'due' || s === 'expired') return STATUS_BADGES.pending;
    if (s === 'failed') return STATUS_BADGES.failed;
    return STATUS_BADGES.cancelled;
  };

  useEffect(() => {
    if (session?.tenantId) void loadPayments(session.tenantId);
  }, [session, loadPayments]);

  const activeInvoices = invoices.filter((inv) => {
    const s = search.toLowerCase();
    return (
      inv.member_name.toLowerCase().includes(s) ||
      inv.member_phone.includes(s) ||
      inv.status.toLowerCase().includes(s)
    );
  });

  const pendingMembers = dueMembers.filter((m) => {
    const s = search.toLowerCase();
    return m.full_name.toLowerCase().includes(s) || m.phone.includes(s);
  });

  const totalCollected = activeInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalPending = pendingMembers.reduce((sum, m) => sum + (m.amount_paid || 0), 0);

  const isActive = (route: string) => pathname === route;

  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased">
      {/* ---- Admin Header (shared with /admin) ---------------------------------- */}
      <header className="vy-topbar sticky top-0 z-40">
        <div className="vy-topbar-inner">
          <div className="flex min-w-0 items-center gap-3">
            <div className="vy-brand-mark">
              <Dumbbell className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[14px] font-semibold tracking-tight text-ink">
                {session?.tenantName || 'Gym'}
              </p>
              <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-faint">
                Vyroniq
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={handleSwitchRole}
                  title="Switch desk role (Owner / Reception)"
                  className="inline-flex items-center gap-1 text-muted transition hover:text-ink"
                >
                  {currentRole === 'owner' ? <Unlock className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                  {currentRole === 'owner' ? 'Owner' : 'Reception'}
                </button>
              </p>
            </div>
          </div>

          <nav aria-label="Dashboard sections" className="hidden flex-1 items-center justify-center gap-1 lg:flex">
            <Link
              href="/admin"
              title="Dashboard overview"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${isActive('/admin') ? 'bg-wash text-ink' : 'text-muted hover:bg-wash hover:text-ink'}`}
            >
              Overview
            </Link>
            <Link
              href="/admin#members"
              title="Member roster"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${pathname === '/admin#members' ? 'bg-wash text-ink' : 'text-muted hover:bg-wash hover:text-ink'}`}
            >
              Members
            </Link>
            <Link
              href="/attendance"
              title="Live attendance board"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${isActive('/attendance') ? 'bg-wash text-ink' : 'text-muted hover:bg-wash hover:text-ink'}`}
            >
              Attendance
            </Link>
            <Link
              href="/admin/payments"
              title="Member dues, invoices and fee collection"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${isActive('/admin/payments') ? 'bg-wash text-ink' : 'text-muted hover:bg-wash hover:text-ink'}`}
            >
              <CreditCard className="h-3.5 w-3.5 shrink-0" />
              Fees & Dues
            </Link>
            <Link
              href="/store"
              title="Supplement store and counter POS"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${isActive('/store') ? 'bg-wash text-ink' : 'text-muted hover:bg-wash hover:text-ink'}`}
            >
              <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
              Store / POS
            </Link>
            <Link
              href="/trainers"
              title="Personal trainers and sessions"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${isActive('/trainers') ? 'bg-wash text-ink' : 'text-muted hover:bg-wash hover:text-ink'}`}
            >
              Trainers
            </Link>
            {currentRole === 'owner' && (
              <Link
                href="/analytics"
                title="Business analytics"
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${isActive('/analytics') ? 'bg-wash text-ink' : 'text-muted hover:bg-wash hover:text-ink'}`}
              >
                Analytics
              </Link>
            )}
            <div className="relative" data-menu-root>
              <button
                type="button"
                aria-haspopup="menu"
                onClick={() => setOpenDropdown(openDropdown === 'more' ? null : 'more')}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] transition ${openDropdown === 'more' ? 'bg-white text-ink' : 'text-muted hover:bg-wash hover:text-ink'}`}
              >
                More
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openDropdown === 'more' ? 'rotate-180' : ''}`} />
              </button>
              {openDropdown === 'more' && (
                <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-line bg-white py-1 shadow-xl shadow-[#0F172A]/10">
                  <Link href="/leads" className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-wash hover:text-ink">
                    <Target className="h-3.5 w-3.5 text-muted" />
                    Leads CRM
                  </Link>
                  <Link href="/admin/challenges" className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-wash hover:text-ink">
                    <Trophy className="h-3.5 w-3.5 text-muted" />
                    Challenges
                  </Link>
                  <Link href="/plans" className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-wash hover:text-ink">
                    <Tag className="h-3.5 w-3.5 text-muted" />
                    Packages
                  </Link>
                  {currentRole === 'owner' && (
                    <Link href="/admin/billing" className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-wash hover:text-ink">
                      <CreditCard className="h-3.5 w-3.5 text-muted" />
                      Billing & Plan
                    </Link>
                  )}
                  {(currentRole === 'owner' || session?.role === 'super_admin') && (
                    <Link href="/hardware" className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-wash hover:text-ink">
                      <ServerCog className="h-3.5 w-3.5 text-muted" />
                      Hardware
                    </Link>
                  )}
                </div>
              )}
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <Link
              href="/scan"
              target="_blank"
              title="Open the QR scanner"
              className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition hover:border-line-strong hover:bg-wash sm:inline-flex"
            >
              <QrCode className="h-3.5 w-3.5" />
              Scan
            </Link>
            <div className="relative hidden sm:block" data-menu-root>
              <button
                type="button"
                aria-label="Notifications"
                aria-haspopup="menu"
                onClick={() => setOpenDropdown(openDropdown === 'notif' ? null : 'notif')}
                className="relative rounded-lg p-2 text-muted transition hover:bg-wash hover:text-ink"
              >
                <Bell className="h-4 w-4" />
              </button>
              {openDropdown === 'notif' && (
                <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-line bg-white shadow-xl shadow-[#0F172A]/10">
                  <div className="border-b border-line px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Needs attention</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <p className="px-3 py-4 text-xs leading-relaxed text-muted">Nothing needs attention — no membership expires in the next seven days.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Total Collected</p>
            <p className="text-2xl font-bold text-slate-900">{formatMoney(totalCollected)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Invoices Issued</p>
            <p className="text-2xl font-bold text-slate-900">{activeInvoices.length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Members Due</p>
            <p className="text-2xl font-bold text-slate-900">{pendingMembers.length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Pending Amount</p>
            <p className="text-2xl font-bold text-slate-900">{formatMoney(totalPending)}</p>
          </div>
        </div>
        {/* Search + Tabs */}
        <div className="flex flex-col gap-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search member name, phone or status…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-lg px-3 py-2 pl-9 focus:outline-none focus:border-emerald-500 text-sm"
            />
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setTab('active')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${tab === 'active' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Active Payments
            </button>
            <button
              type="button"
              onClick={() => setTab('pending')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${tab === 'pending' ? 'bg-amber-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Members with Dues
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {tab === 'active' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider">
                    <th scope="col" className="px-4 py-3">Member</th>
                    <th scope="col" className="px-3 py-3">Phone</th>
                    <th scope="col" className="px-3 py-3 text-right">Amount</th>
                    <th scope="col" className="px-3 py-3 text-right">Method</th>
                    <th scope="col" className="px-3 py-3">Status</th>
                    <th scope="col" className="px-4 py-3 text-right">Issued</th>
                    <th scope="col" className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <FileText className="h-8 w-8 text-slate-300" />
                          <p className="text-sm text-slate-500">No membership fee invoices found</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    activeInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-4 py-3 text-slate-800">
                          <div className="font-medium">{inv.member_name}</div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600 font-mono">{inv.member_phone}</td>
                        <td className="px-3 py-3 text-right font-medium text-slate-900">{formatMoney(inv.amount)}</td>
                        <td className="px-3 py-3 text-right text-xs text-slate-500 font-mono">{inv.payment_method}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${statusBadge(inv.status)}`}>
                            {statusLabel(inv.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">{formatDate(inv.issued_at)}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => whatsappReminder({ full_name: inv.member_name, phone: inv.member_phone } as MemberFee)}
                            className="px-2.5 py-1.5 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-emerald-600 transition"
                            title="Send WhatsApp reminder"
                          >
                            <Send className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider">
                    <th scope="col" className="px-4 py-3">Member Name</th>
                    <th scope="col" className="px-3 py-3">Phone</th>
                    <th scope="col" className="px-3 py-3 text-right">Expires</th>
                    <th scope="col" className="px-3 py-3 text-right">Plan Status</th>
                    <th scope="col" className="px-4 py-3 text-right">Amount Paid</th>
                    <th scope="col" className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingMembers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <CheckCircle className="h-8 w-8 text-emerald-400" />
                          <p className="text-sm text-slate-500">No members with dues — all caught up!</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pendingMembers.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-4 py-3 text-slate-800">
                          <div className="font-medium">{m.full_name}</div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600 font-mono">{m.phone}</td>
                        <td className="px-3 py-3 text-right text-xs text-slate-500 font-mono">{formatDate(m.membership_end)}</td>
                        <td className="px-3 py-3 text-right text-xs">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${m.status.toLowerCase() === 'expired' ? STATUS_BADGES.pending : STATUS_BADGES.cancelled}`}>
                            {m.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900">{formatMoney(m.amount_paid || 0)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setCollectMember(m);
                                setCollectAmount(String(m.amount_paid || 1500));
                                setCollectMode('cash');
                                setCollectNotice(null);
                                setCollectOpen(true);
                              }}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-500 text-emerald-700 text-xs font-semibold transition hover:bg-emerald-50"
                            >
                              <Plus className="h-3.5 w-3.5" /> Collect
                            </button>
                            <button
                              type="button"
                              onClick={() => whatsappReminder(m)}
                              className="px-2.5 py-2 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-emerald-600 transition"
                              title="WhatsApp reminder"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {/* Collect Fee Modal */}
        <div
          className={`fixed inset-0 z-50 ${collectOpen ? 'flex' : 'hidden'} items-center justify-center`}
          aria-modal="true"
          role="dialog"
        >
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={() => setCollectOpen(false)} />
          <div className="relative bg-white border border-slate-200 shadow-2xl rounded-2xl w-full max-w-md mx-4 my-8 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Collect Member Fee</h2>
              <button
                type="button"
                onClick={() => setCollectOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              {collectNotice && (
                <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  collectNotice.kind === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}>
                  {collectNotice.message}
                </div>
              )}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Member</label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900">
                  <UserRound className="h-4 w-4 text-slate-400 shrink-0" />
                  <span>{collectMember?.full_name}</span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Phone</label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900 font-mono">
                  <PhoneIcon className="h-4 w-4 text-slate-400 shrink-0" />
                  <span>{collectMember?.phone}</span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Amount to Collect (₹)</label>
                <input
                  type="number"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-900 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Payment Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_MODES.map((mode) => {
                    const Icon = mode.icon;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => setCollectMode(mode.value)}
                        className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg border text-xs font-medium transition ${
                          collectMode === mode.value
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 text-emerald-600" />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCollectOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={collectBusy}
                  onClick={issueReceipt}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-sm transition disabled:opacity-50 flex items-center gap-2"
                >
                  {collectBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm & Save
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className="fixed inset-0 z-50 bg-white/90 backdrop-blur-sm flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-slate-600 animate-spin" />
          </div>
        )}
      </div>
    </main>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className ?? ''}`}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 1 .72 2.11 20 20 0 0 0 4.5 4.5A20 20 0 0 0 12.48 17a2 2 0 0 1-1.72 2h3a2 2 0 0 1 2-2z" />
    </svg>
  );
}

