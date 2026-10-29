'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Banknote,
  CheckCircle,
  CreditCard,
  Download,
  FileText,
  HandCoins,
  Loader2,
  Plus,
  Search,
  Send,
  X
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
  const [session, setSession] = useState<GymSession | null>(null);
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
  }, [router]);

  const loadPayments = useCallback(async (tenantId: string) => {
    setLoading(true);
    try {
      const [invRes, memRes] = await Promise.all([
        supabase
          .from('invoices')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('issued_at', { ascending: false }),
        supabase
          .from('members')
          .select('id, full_name, phone, email, membership_end, status, amount_paid, invoice_count, last_invoice, is_frozen, freeze_start_date, freeze_end_date, total_freeze_days')
          .eq('tenant_id', tenantId),
      ]);

      let fetchedInvoices = (invRes.data ?? []) as GymInvoice[];
      const memberMap = new Map<string, { full_name: string; phone: string }>();

      if (!memRes.error && memRes.data) {
        const members = memRes.data as MemberFee[];
        setDueMembers(members);
        for (const m of members) {
          memberMap.set(m.id, { full_name: m.full_name, phone: m.phone });
        }
      }

      // Resolve missing member_name from the members table so the ledger always shows a name.
      if (!invRes.error) {
        for (const inv of fetchedInvoices) {
          if ((!inv.member_name || inv.member_name.trim() === '') && inv.member_id) {
            const known = memberMap.get(inv.member_id);
            if (known) {
              inv.member_name = known.full_name;
              inv.member_phone = known.phone;
            } else {
              inv.member_name = 'Direct Walk-in / Store POS';
            }
          }
        }
        setInvoices(fetchedInvoices);
      }
    } catch {
      // safe fallback on read errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.tenantId) {
      void loadPayments(session.tenantId);
    }
  }, [session?.tenantId, loadPayments]);

  useEffect(() => {
    if (collectOpen && collectMember) {
      setCollectAmount(String(collectMember.amount_paid || 1500));
      setCollectMode('cash');
      setCollectNotice(null);
    }
  }, [collectOpen, collectMember]);

  const issueReceipt = useCallback(async () => {
    if (!session?.tenantId) return;
    setCollectBusy(true);
    setCollectNotice(null);
    try {
      const memberName = collectMember?.full_name || 'Walk-in Member';
      const memberPhone = collectMember?.phone || '';
      const amountVal = Number(collectAmount) || 0;

      const res = await fetch('/api/admin/payments/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          member_id: collectMember?.id || null,
          member_name: memberName,
          member_phone: memberPhone,
          amount: amountVal,
          payment_method: collectMode,
          tenant_id: session.tenantId,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Could not collect fee.');

      await loadPayments(session.tenantId);
      setCollectNotice({ message: 'Fee collected and invoice recorded.', kind: 'ok' });
      setCollectOpen(false);
      setCollectAmount('');
      setCollectMember(null);
    } catch (err) {
      setCollectNotice({
        message: err instanceof Error ? err.message : 'Could not collect fee.',
        kind: 'bad',
      });
    } finally {
      setCollectBusy(false);
    }
  }, [collectMember, collectAmount, collectMode, session?.tenantId, loadPayments]);

  const downloadLedger = useCallback(() => {
    const rows = invoices.map((inv) => ({
      date: new Date(inv.issued_at).toLocaleDateString('en-IN'),
      member: inv.member_name,
      phone: inv.member_phone,
      amount: inv.amount,
      method: inv.payment_method,
      status: inv.status,
    }));
    const headers = ['Date', 'Member', 'Phone', 'Amount (INR)', 'Method', 'Status'];
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        headers.join(','),
        ...rows.map((r) =>
          [r.date, `"${r.member}"`, `"${r.phone}"`, `"${r.amount}"`, `"${r.method}"`, `"${r.status}"`].join(',')
        ),
      ].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `vyroniq-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  }, [invoices]);

  const sendWhatsApp = (name: string, phone: string, amount: number, invId?: string) => {
    const text = `Hi ${name}, your gym fee of Rs.${amount}${invId ? ` (Invoice: ${invId})` : ''} has been received successfully. Thank you for choosing us!`;
    window.open(waLink(phone, text), '_blank');
  };

  const sendDuesReminder = (name: string, phone: string, amount: number) => {
    const text = `Hi ${name}, your gym fee of Rs.${amount} is due. Please clear it at the front desk to keep your access active.`;
    window.open(waLink(phone, text), '_blank');
  };

  if (!session) return null;

  const q = search.trim().toLowerCase();
  const filteredInvoices = invoices.filter(
    (inv) => (inv.member_name || '').toLowerCase().includes(q) || (inv.id || '').toLowerCase().includes(q)
  );
  const dueFiltered = dueMembers.filter(
    (m) => (m.full_name || '').toLowerCase().includes(q) || (m.phone || '').includes(q)
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-12 gap-6">
        {/* Navigation & Actions Sidebar */}
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Fee Ledger</h1>
              <p className="text-xs text-neutral-400">Manage member dues & receipts</p>
            </div>
          </div>

          <nav className="flex flex-col gap-1.5">
            <button
              onClick={() => setTab('active')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition ${
                tab === 'active'
                  ? 'bg-neutral-800 text-white border border-neutral-700'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-white'
              }`}
            >
              <FileText className="h-4 w-4 text-emerald-400" />
              Paid Invoices ({invoices.length})
            </button>
            <button
              onClick={() => setTab('pending')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition ${
                tab === 'pending'
                  ? 'bg-neutral-800 text-white border border-neutral-700'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-white'
              }`}
            >
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Members with Dues ({dueMembers.length})
            </button>
          </nav>

          <div className="pt-2 border-t border-neutral-800/80">
            <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-400 mb-3">Quick Actions</h2>
            <button
              type="button"
              onClick={() => {
                setCollectMember(null);
                setCollectAmount('1500');
                setCollectOpen(true);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow-lg shadow-emerald-950/40"
            >
              <Plus className="h-4 w-4" />
              Collect Member Fee
            </button>
          </div>

          <div className="pt-2 border-t border-neutral-800/80">
            <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-400 mb-3">Reports & POS</h2>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={downloadLedger}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-xs font-medium text-neutral-300 hover:bg-neutral-800 hover:text-white transition"
              >
                <Download className="h-3.5 w-3.5" />
                Export Ledger CSV
              </button>
              <Link
                href="/store"
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-neutral-800/60 text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 transition"
              >
                Go to Supplement Store POS &rarr;
              </Link>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="col-span-12 lg:col-span-9 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden flex flex-col min-h-[500px]">
          {/* Top Search Toolbar */}
          <div className="p-4 border-b border-neutral-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">
              {tab === 'active' ? 'Payment History & Receipts' : 'Pending Member Accounts'}
            </h2>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search member name, phone or ID..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-neutral-800 bg-neutral-950 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
              />
            </div>
          </div>

          {/* Table View */}
          <div className="overflow-x-auto flex-1">
            {loading ? (
              <div className="flex items-center justify-center h-64 text-neutral-500 text-xs gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-500" /> Loading payment records...
              </div>
            ) : tab === 'active' ? (
              <table className="w-full text-left text-xs text-neutral-300">
                <thead className="bg-neutral-950/60 text-neutral-400 uppercase tracking-wider text-[11px] border-b border-neutral-800">
                  <tr>
                    <th className="py-3 px-4">Invoice ID</th>
                    <th className="py-3 px-4">Member</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-neutral-500">
                        No invoice records found.
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-neutral-800/40 transition">
                        <td className="py-3 px-4 font-mono text-[11px] text-neutral-400">
                          {inv.id.slice(0, 8)}...
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{inv.member_name}</div>
                          <div className="text-[11px] text-neutral-500">{inv.member_phone}</div>
                        </td>
                        <td className="py-3 px-4 font-bold text-white">₹{inv.amount}</td>
                        <td className="py-3 px-4 uppercase text-[11px] text-neutral-400">
                          {inv.payment_method}
                        </td>
                        <td className="py-3 px-4 text-neutral-400 font-mono text-[11px]">
                          {new Date(inv.issued_at).toLocaleDateString('en-IN')}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${
                              STATUS_BADGES[inv.status] || STATUS_BADGES.paid
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              sendWhatsApp(inv.member_name, inv.member_phone, inv.amount, inv.id)
                            }
                            className="p-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 border border-emerald-800/40 rounded transition inline-flex items-center gap-1"
                            title="Send WhatsApp receipt"
                          >
                            <Send className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left text-xs text-neutral-300">
                <thead className="bg-neutral-950/60 text-neutral-400 uppercase tracking-wider text-[11px] border-b border-neutral-800">
                  <tr>
                    <th className="py-3 px-4">Member Name</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">Membership End</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60">
                  {dueFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-neutral-500">
                        No members with outstanding dues.
                      </td>
                    </tr>
                  ) : (
                    dueFiltered.map((mem) => (
                      <tr key={mem.id} className="hover:bg-neutral-800/40 transition">
                        <td className="py-3 px-4 font-semibold text-white">{mem.full_name}</td>
                        <td className="py-3 px-4 text-neutral-400">{mem.phone}</td>
                        <td className="py-3 px-4 text-neutral-400 font-mono text-[11px]">
                          {mem.membership_end || 'Expired'}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/60 text-amber-400 border border-amber-800/40">
                            {mem.status || 'Due'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                sendDuesReminder(mem.full_name, mem.phone, mem.amount_paid || 0);
                              }}
                              className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition inline-flex items-center gap-1"
                              title="Send WhatsApp dues reminder"
                            >
                              <Send className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCollectMember(mem);
                                setCollectOpen(true);
                              }}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold transition"
                            >
                              Collect Fee
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>

      {/* Collect Fee Modal */}
      {collectOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full p-6 relative">
            <button
              onClick={() => setCollectOpen(false)}
              className="absolute right-4 top-4 text-neutral-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold text-white mb-1">
              Collect Gym Fee {collectMember ? `· ${collectMember.full_name}` : ''}
            </h3>
            <p className="text-xs text-neutral-400 mb-4">
              Enter fee details to record this invoice in the ledger.
            </p>

            {collectNotice && (
              <div
                className={`p-3 rounded-lg text-xs mb-4 ${
                  collectNotice.kind === 'ok'
                    ? 'bg-emerald-950/70 border border-emerald-800/60 text-emerald-300'
                    : 'bg-rose-950/70 border border-rose-800/60 text-rose-300'
                }`}
              >
                {collectNotice.message}
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-neutral-300 mb-1 font-medium">Select Member</label>
                <select
                  value={collectMember?.id || ''}
                  onChange={(e) => {
                    const sel = dueMembers.find((m) => m.id === e.target.value);
                    if (sel) {
                      setCollectMember(sel);
                      setCollectAmount(String(sel.amount_paid || 1500));
                      setCollectMode('cash');
                      setCollectNotice(null);
                    } else {
                      setCollectMember(null);
                      setCollectAmount('');
                    }
                  }}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-neutral-600"
                >
                  <option value="">Walk-in / Store POS (no member)</option>
                  {dueMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name} · {m.phone}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-neutral-500 mt-1">
                  Pick a member with dues, or leave as walk-in for a direct collection.
                </p>
              </div>

              <div>
                <label className="block text-neutral-300 mb-1 font-medium">Amount to Collect (₹)</label>
                <input
                  type="number"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-neutral-600"
                />
              </div>

              <div>
                <label className="block text-neutral-300 mb-1 font-medium">Payment Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_MODES.map((mode) => {
                    const Icon = mode.icon;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => setCollectMode(mode.value)}
                        className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-lg border text-xs font-medium transition ${
                          collectMode === mode.value
                            ? 'bg-neutral-800 border-emerald-500 text-white'
                            : 'border-neutral-800 text-neutral-400 hover:bg-neutral-950'
                        }`}
                      >
                        <Icon className="w-4 h-4 text-emerald-400" />
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
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={collectBusy}
                  onClick={issueReceipt}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium flex items-center gap-2"
                >
                  {collectBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm & Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}