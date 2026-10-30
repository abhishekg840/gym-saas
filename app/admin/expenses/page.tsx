'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DollarSign,
  Plus,
  Search,
  RotateCw,
  Dumbbell,
  Receipt,
  Tag,
  CreditCard,
  Banknote,
  HandCoins,
  Calendar,
  Trash2,
  X,
  PieChart,
  ArrowDownRight,
  TrendingDown,
  Building2,
  Wrench,
  ShoppingBag,
  Users,
  Sparkles
} from 'lucide-react';
import { readSession, type GymSession } from '@/lib/session';
import { useFeatureFlags } from '@/lib/use-feature-flags';
import FeatureLockedScreen from '@/components/feature-locked-screen';

interface ExpenseItem {
  id: string;
  tenant_id: string;
  title: string;
  amount: number;
  category: string;
  payment_method: string;
  vendor?: string | null;
  expense_date: string;
  notes?: string | null;
  created_at: string;
}

const CATEGORIES = [
  { id: 'all', label: 'All Expenses' },
  { id: 'utilities', label: 'Electricity & Utilities', icon: Wrench, color: 'text-amber-600 bg-amber-50' },
  { id: 'rent', label: 'Gym Rent / Lease', icon: Building2, color: 'text-indigo-600 bg-indigo-50' },
  { id: 'equipment', label: 'Equipment Repair & Maintenance', icon: Dumbbell, color: 'text-sky-600 bg-sky-50' },
  { id: 'stock', label: 'Supplement & Beverage Inventory', icon: ShoppingBag, color: 'text-emerald-600 bg-emerald-50' },
  { id: 'salary', label: 'Staff Salaries & Wages', icon: Users, color: 'text-purple-600 bg-purple-50' },
  { id: 'other', label: 'General Petty Cash', icon: Receipt, color: 'text-slate-600 bg-slate-50' },
];

export default function AdminExpensesPage() {
  const router = useRouter();
  const [session, setSession] = useState<GymSession | null>(null);
  const { isEnabled, loading: flagsLoading } = useFeatureFlags();

  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [search, setSearch] = useState('');

  // Add Expense Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('utilities');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [vendor, setVendor] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    const s = readSession();
    if (!s) {
      router.push('/login');
      return;
    }
    setSession(s);
  }, [router]);

  const tenantId = session?.tenantId;

  const loadExpenses = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/expenses?tenant_id=${tenantId}`);
      const data = await res.json();
      if (data.ok) {
        setExpenses(data.expenses ?? []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) void loadExpenses();
  }, [tenantId, loadExpenses]);

  // Gate Check
  if (!flagsLoading && !isEnabled('expense_tracker')) {
    return (
      <FeatureLockedScreen
        featureName="Gym Operations Expense Tracker"
        featureKey="expense_tracker"
        description="The Expense & Petty Cash Tracker is currently locked. Upgrade your subscription tier to manage gym operating costs, electricity bills, and inventory expenses."
      />
    );
  }

  // Create Expense
  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !title || Number(amount) <= 0) return;
    setSaveBusy(true);

    try {
      const res = await fetch('/api/admin/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          title,
          amount: Number(amount),
          category,
          payment_method: paymentMethod,
          vendor: vendor || null,
          expense_date: expenseDate,
          notes: notes || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to record expense.');

      setShowAddModal(false);
      setTitle('');
      setAmount('');
      setVendor('');
      setNotes('');
      void loadExpenses();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error recording expense.');
    } finally {
      setSaveBusy(false);
    }
  };

  // Delete Expense
  const handleDeleteExpense = async (id: string) => {
    if (!tenantId || !confirm('Delete this expense record?')) return;
    try {
      const res = await fetch(`/api/admin/expenses?id=${id}&tenant_id=${tenantId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        setExpenses((prev) => prev.filter((item) => item.id !== id));
      }
    } catch {
      alert('Failed to delete expense.');
    }
  };

  // Filter
  const filteredExpenses = expenses.filter((item) => {
    const q = search.toLowerCase().trim();
    const matchSearch =
      item.title.toLowerCase().includes(q) ||
      (item.vendor && item.vendor.toLowerCase().includes(q)) ||
      (item.notes && item.notes.toLowerCase().includes(q));

    if (!matchSearch) return false;
    if (selectedCategory === 'all') return true;
    return item.category === selectedCategory;
  });

  // Aggregates
  const totalAmount = expenses.reduce((sum, item) => sum + item.amount, 0);
  const utilitiesTotal = expenses.filter((e) => e.category === 'utilities').reduce((sum, e) => sum + e.amount, 0);
  const rentTotal = expenses.filter((e) => e.category === 'rent').reduce((sum, e) => sum + e.amount, 0);
  const equipmentTotal = expenses.filter((e) => e.category === 'equipment' || e.category === 'stock').reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm hover:bg-slate-800 transition"
              title="Return to Dashboard"
            >
              <Dumbbell className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900">Gym Expense &amp; Petty Cash Tracker</h1>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                  Expense Module Active
                </span>
              </div>
              <p className="text-[11px] text-slate-500">Record daily utility bills, maintenance costs, and facility expenses</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadExpenses()}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition shadow-xs"
            >
              <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 transition"
            >
              <Plus className="h-4 w-4" />
              Record Expense
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Metric Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Operational Spend</span>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">₹{totalAmount.toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Recorded expenses</p>
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Facility Rent / Lease</span>
            <p className="mt-1 text-2xl font-extrabold text-indigo-600">₹{rentTotal.toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Property lease</p>
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Electricity &amp; Utilities</span>
            <p className="mt-1 text-2xl font-extrabold text-amber-600">₹{utilitiesTotal.toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Power, water, wifi</p>
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Machines &amp; Stock</span>
            <p className="mt-1 text-2xl font-extrabold text-sky-600">₹{equipmentTotal.toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Repairs &amp; supplement restock</p>
          </div>
        </div>

        {/* Filter Bar & Category Pills */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search expenses by title or vendor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto text-xs">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCategory(c.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  selectedCategory === c.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Expenses Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Expense Title &amp; Vendor</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Payment Mode</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <RotateCw className="mx-auto h-6 w-6 animate-spin text-slate-300 mb-2" />
                    Loading expenses...
                  </td>
                </tr>
              ) : filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <Receipt className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No expenses recorded in this category yet.
                  </td>
                </tr>
              ) : (
                filteredExpenses.map((item) => {
                  const catObj = CATEGORIES.find((c) => c.id === item.category) || CATEGORIES[1];
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition">
                      <td className="px-4 py-3.5">
                        <p className="font-bold text-slate-900">{item.title}</p>
                        {item.vendor && (
                          <p className="text-[11px] text-slate-400 mt-0.5">Payee: {item.vendor}</p>
                        )}
                        {item.notes && (
                          <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1 italic">{item.notes}</p>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${catObj.color || 'bg-slate-100 text-slate-700'}`}>
                          {catObj.label}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-slate-600">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          {item.expense_date}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 font-mono uppercase text-slate-600 text-[11px]">
                        {item.payment_method}
                      </td>

                      <td className="px-4 py-3.5 font-bold text-rose-600 text-sm">
                        -₹{item.amount.toLocaleString('en-IN')}
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => void handleDeleteExpense(item.id)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                          title="Delete expense"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-600" />
              Record Gym Operating Expense
            </h3>
            <p className="text-xs text-slate-500 mt-1">Log facility utility bills, equipment fixes, or staff payments.</p>

            <form onSubmit={handleCreateExpense} className="mt-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Expense Title / Item</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. October Commercial Electricity Bill"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Amount Paid (₹)</label>
                  <input
                    type="number"
                    required
                    placeholder="4500"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                  >
                    <option value="utilities">Electricity &amp; Utilities</option>
                    <option value="rent">Gym Facility Rent</option>
                    <option value="equipment">Equipment Repair</option>
                    <option value="stock">Supplement / Drink Stock</option>
                    <option value="salary">Staff / Housekeeping Wage</option>
                    <option value="other">General Petty Cash</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                  >
                    <option value="upi">UPI / GPay</option>
                    <option value="cash">Cash Till</option>
                    <option value="bank">Bank Transfer (NEFT)</option>
                    <option value="card">Card POS</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Date Incurred</label>
                  <input
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Vendor / Payee (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. State Electricity Board or Optimum Nutrition Dist."
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes / Bill Reference #</label>
                <input
                  type="text"
                  placeholder="e.g. Bill #89283 paid via front desk petty cash"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saveBusy}
                  className="w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50"
                >
                  {saveBusy ? 'Recording...' : 'Record Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

