'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DollarSign,
  Users,
  Award,
  Calendar,
  CheckCircle,
  Clock,
  Plus,
  Search,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  Receipt,
  Edit,
  X,
  RotateCw,
  Dumbbell,
  Phone,
  Briefcase
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { readSession, type GymSession } from '@/lib/session';
import { waLink } from '@/lib/whatsapp';
import { useFeatureFlags } from '@/lib/use-feature-flags';
import FeatureLockedScreen from '@/components/feature-locked-screen';

interface Trainer {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  specialization: string | null;
  commission_rate_percent: number;
  is_active: boolean;
  created_at: string;
}

interface PTSubscription {
  id: string;
  tenant_id: string;
  member_id: string;
  trainer_id: string;
  total_sessions: number;
  completed_sessions: number;
  amount_paid: number;
  start_date: string;
  end_date: string;
  status: string;
  members?: { full_name: string; phone: string } | null;
}

interface PayoutLog {
  id: string;
  trainer_id: string;
  trainer_name: string;
  amount: number;
  payment_method: string;
  period: string;
  notes?: string | null;
  paid_at: string;
}

interface MemberOption {
  id: string;
  full_name: string;
  phone: string;
}

export default function AdminPayoutsPage() {
  const router = useRouter();
  const [session, setSession] = useState<GymSession | null>(null);
  const { isEnabled, loading: flagsLoading } = useFeatureFlags();

  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [subscriptions, setSubscriptions] = useState<PTSubscription[]>([]);
  const [logs, setLogs] = useState<PayoutLog[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'roster' | 'clients' | 'history'>('roster');
  const [search, setSearch] = useState('');

  // Trainer Modal
  const [showTrainerModal, setShowTrainerModal] = useState(false);
  const [editingTrainer, setEditingTrainer] = useState<Trainer | null>(null);
  const [trName, setTrName] = useState('');
  const [trPhone, setTrPhone] = useState('');
  const [trSpecialization, setTrSpecialization] = useState('Strength & Conditioning');
  const [trCommission, setTrCommission] = useState('20');
  const [trActive, setTrActive] = useState(true);
  const [trSaving, setTrSaving] = useState(false);

  // Record Payout Modal
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('upi');
  const [payoutPeriod, setPayoutPeriod] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [payoutSaving, setPayoutSaving] = useState(false);

  // New PT Client Modal
  const [showNewPTModal, setShowNewPTModal] = useState(false);
  const [ptMemberId, setPtMemberId] = useState('');
  const [ptTrainerId, setPtTrainerId] = useState('');
  const [ptSessions, setPtSessions] = useState('12');
  const [ptAmount, setPtAmount] = useState('6000');
  const [ptStartDate, setPtStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [ptEndDate, setPtEndDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [ptSaving, setPtSaving] = useState(false);

  useEffect(() => {
    const s = readSession();
    if (!s) {
      router.push('/login');
      return;
    }
    setSession(s);
  }, [router]);

  const loadData = useCallback(async (tenantId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/payouts?tenant_id=${tenantId}`);
      const data = await res.json();
      if (data.ok) {
        setTrainers(data.trainers || []);
        setSubscriptions(data.subscriptions || []);
        setLogs(data.logs || []);
      }

      // Fetch members for client assignment
      const { data: memberList } = await supabase
        .from('members')
        .select('id, full_name, phone')
        .eq('tenant_id', tenantId)
        .order('full_name', { ascending: true })
        .limit(200);

      if (memberList) {
        setMembers(memberList);
      }
    } catch (err) {
      console.error('Failed to load payouts data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.tenantId) {
      loadData(session.tenantId);
    }
  }, [session, loadData]);

  // Aggregate Calculations
  const totalRevenue = subscriptions.reduce((sum, s) => sum + (Number(s.amount_paid) || 0), 0);
  
  // Calculate earnings per trainer
  const trainerStats = trainers.map((tr) => {
    const trainerSubs = subscriptions.filter((s) => s.trainer_id === tr.id);
    const activeSubs = trainerSubs.filter((s) => s.status === 'active');
    const totalVolume = trainerSubs.reduce((acc, s) => acc + (Number(s.amount_paid) || 0), 0);
    const commRate = Number(tr.commission_rate_percent) || 0;
    const earnedCommission = Math.round((totalVolume * commRate) / 100);
    const totalSessions = trainerSubs.reduce((acc, s) => acc + (s.total_sessions || 0), 0);
    const completedSessions = trainerSubs.reduce((acc, s) => acc + (s.completed_sessions || 0), 0);

    const paidOut = logs
      .filter((l) => l.trainer_id === tr.id)
      .reduce((acc, l) => acc + (Number(l.amount) || 0), 0);

    const pendingPayout = Math.max(0, earnedCommission - paidOut);

    return {
      ...tr,
      activeClients: activeSubs.length,
      totalSubs: trainerSubs.length,
      totalVolume,
      earnedCommission,
      paidOut,
      pendingPayout,
      totalSessions,
      completedSessions,
    };
  });

  const totalCommissionsPayable = trainerStats.reduce((sum, t) => sum + t.pendingPayout, 0);
  const totalDisbursed = logs.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const activeTrainersCount = trainers.filter((t) => t.is_active).length;

  // Handlers
  const handleOpenAddTrainer = () => {
    setEditingTrainer(null);
    setTrName('');
    setTrPhone('');
    setTrSpecialization('Strength & Conditioning');
    setTrCommission('20');
    setTrActive(true);
    setShowTrainerModal(true);
  };

  const handleOpenEditTrainer = (tr: Trainer) => {
    setEditingTrainer(tr);
    setTrName(tr.name);
    setTrPhone(tr.phone);
    setTrSpecialization(tr.specialization || 'Fitness Trainer');
    setTrCommission(String(tr.commission_rate_percent));
    setTrActive(tr.is_active);
    setShowTrainerModal(true);
  };

  const handleSaveTrainer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.tenantId || !trName || !trPhone) return;
    setTrSaving(true);
    try {
      const payload = {
        tenant_id: session.tenantId,
        action: editingTrainer ? 'update_trainer' : 'create_trainer',
        id: editingTrainer?.id,
        name: trName,
        phone: trPhone,
        specialization: trSpecialization,
        commission_rate_percent: Number(trCommission),
        is_active: trActive,
      };

      const res = await fetch('/api/admin/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setShowTrainerModal(false);
        loadData(session.tenantId);
      } else {
        alert(data.error || 'Failed to save trainer');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error saving trainer');
    } finally {
      setTrSaving(false);
    }
  };

  const handleOpenPayout = (trainer: typeof trainerStats[0]) => {
    setSelectedTrainer(trainer);
    setPayoutAmount(String(trainer.pendingPayout || trainer.earnedCommission || ''));
    setPayoutMethod('upi');
    setPayoutPeriod(new Date().toLocaleString('default', { month: 'short', year: 'numeric' }));
    setPayoutNotes('');
    setShowPayoutModal(true);
  };

  const handleSavePayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.tenantId || !selectedTrainer || !payoutAmount) return;
    setPayoutSaving(true);
    try {
      const payload = {
        tenant_id: session.tenantId,
        action: 'record_payout',
        trainer_id: selectedTrainer.id,
        trainer_name: selectedTrainer.name,
        amount: Number(payoutAmount),
        payment_method: payoutMethod,
        period: payoutPeriod,
        notes: payoutNotes,
      };

      const res = await fetch('/api/admin/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setShowPayoutModal(false);
        loadData(session.tenantId);
      } else {
        alert(data.error || 'Failed to record payout');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error recording payout');
    } finally {
      setPayoutSaving(false);
    }
  };

  const handleSaveNewPT = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.tenantId || !ptMemberId || !ptTrainerId) return;
    setPtSaving(true);
    try {
      const payload = {
        tenant_id: session.tenantId,
        action: 'create_pt',
        member_id: ptMemberId,
        trainer_id: ptTrainerId,
        total_sessions: Number(ptSessions),
        amount_paid: Number(ptAmount),
        start_date: ptStartDate,
        end_date: ptEndDate,
      };

      const res = await fetch('/api/admin/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setShowNewPTModal(false);
        loadData(session.tenantId);
      } else {
        alert(data.error || 'Failed to assign PT package');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error assigning PT package');
    } finally {
      setPtSaving(false);
    }
  };

  // WhatsApp Statement Generator
  const sendWhatsAppStatement = (tr: typeof trainerStats[0]) => {
    const gymName = session?.tenantName || 'Vyroniq Gym';
    const msg = `Hello ${tr.name}!\n\nHere is your PT Commission & Payout Summary from ${gymName}:\n\n` +
      `- Active PT Clients: ${tr.activeClients}\n` +
      `- Total Sessions Completed: ${tr.completedSessions}/${tr.totalSessions}\n` +
      `- Commission Rate: ${tr.commission_rate_percent}%\n` +
      `- Total Earned: ₹${tr.earnedCommission.toLocaleString('en-IN')}\n` +
      `- Paid Out to Date: ₹${tr.paidOut.toLocaleString('en-IN')}\n` +
      `- Current Payable Balance: ₹${tr.pendingPayout.toLocaleString('en-IN')}\n\n` +
      `Thank you for your coaching and dedication!`;

    window.open(waLink(tr.phone, msg), '_blank');
  };

  // Check Feature Flag gate
  if (!flagsLoading && !isEnabled('trainer_payouts')) {
    return (
      <FeatureLockedScreen
        featureName="Personal Trainer Commission & Salary Payouts"
        featureKey="trainer_payouts"
      />
    );
  }

  const filteredTrainers = trainerStats.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.phone.includes(search) ||
      (t.specialization && t.specialization.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans pb-16">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur shadow-xs">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
            >
              <span>← Back to Dashboard</span>
            </Link>
            <span className="text-slate-300">/</span>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-600" />
              <h1 className="text-sm font-bold tracking-tight text-slate-900">
                Trainer Commission & Payouts Engine
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => session?.tenantId && loadData(session.tenantId)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-xs"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              onClick={() => setShowNewPTModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600/20 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition shadow-xs"
            >
              <Briefcase className="h-3.5 w-3.5" />
              Assign PT Package
            </button>
            <button
              onClick={handleOpenAddTrainer}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Trainer
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 pt-6">
        {/* KPI Strip */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Total PT Volume</span>
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">
              ₹{totalRevenue.toLocaleString('en-IN')}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Across {subscriptions.length} booked personal training packages
            </p>
          </div>

          <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-5 shadow-xs">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-700">
              <span>Pending Commission</span>
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-2 text-2xl font-black text-amber-900">
              ₹{totalCommissionsPayable.toLocaleString('en-IN')}
            </div>
            <p className="mt-1 text-[11px] text-amber-700/80">
              Calculated earned split awaiting disbursement
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Total Disbursed</span>
              <Receipt className="h-4 w-4 text-blue-600" />
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">
              ₹{totalDisbursed.toLocaleString('en-IN')}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Across {logs.length} logged payouts to staff
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Active Coaches</span>
              <Users className="h-4 w-4 text-purple-600" />
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">
              {activeTrainersCount} <span className="text-xs font-normal text-slate-400">/ {trainers.length}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              On gym floor roster
            </p>
          </div>
        </div>

        {/* Tab Navigation & Search */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('roster')}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === 'roster'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Trainers & Commission Roster ({trainers.length})
            </button>
            <button
              onClick={() => setActiveTab('clients')}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === 'clients'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              PT Client Subscriptions ({subscriptions.length})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === 'history'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Disbursement Ledger ({logs.length})
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search trainer, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Content Tabs */}
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white">
            <RotateCw className="h-6 w-6 animate-spin text-slate-400" />
            <p className="mt-2 text-xs text-slate-500">Loading commission engine...</p>
          </div>
        ) : activeTab === 'roster' ? (
          /* Tab 1: Trainers & Commission Roster */
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 pl-6 pr-4">Trainer / Coach</th>
                  <th className="px-4 py-3">Specialization</th>
                  <th className="px-4 py-3">Split Rate</th>
                  <th className="px-4 py-3">Active Clients</th>
                  <th className="px-4 py-3">PT Revenue</th>
                  <th className="px-4 py-3">Earned Commission</th>
                  <th className="px-4 py-3">Pending Balance</th>
                  <th className="py-3 pl-4 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredTrainers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      No trainers added yet. Click &quot;Add Trainer&quot; to configure your coaching staff.
                    </td>
                  </tr>
                ) : (
                  filteredTrainers.map((tr) => (
                    <tr key={tr.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3.5 pl-6 pr-4">
                        <div className="font-semibold text-slate-900">{tr.name}</div>
                        <div className="text-[11px] text-slate-400">{tr.phone}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                          {tr.specialization || 'Fitness Coach'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-bold text-slate-900">
                        {tr.commission_rate_percent}%
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-slate-900">{tr.activeClients}</span>
                        <span className="text-[11px] text-slate-400"> ({tr.completedSessions}/{tr.totalSessions} sess)</span>
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-800">
                        ₹{tr.totalVolume.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-emerald-700">
                        ₹{tr.earnedCommission.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-bold text-xs ${
                          tr.pendingPayout > 0
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          ₹{tr.pendingPayout.toLocaleString('en-IN')}
                        </span>
                      </td>
                      <td className="py-3.5 pl-4 pr-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => sendWhatsAppStatement(tr)}
                            title="Send WhatsApp Statement"
                            className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 transition"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleOpenPayout(tr)}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 transition"
                          >
                            Pay ₹
                          </button>
                          <button
                            onClick={() => handleOpenEditTrainer(tr)}
                            title="Edit Trainer"
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 transition"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === 'clients' ? (
          /* Tab 2: PT Client Subscriptions */
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 pl-6 pr-4">Member Name</th>
                  <th className="px-4 py-3">Assigned Coach</th>
                  <th className="px-4 py-3">Sessions Progress</th>
                  <th className="px-4 py-3">Amount Paid</th>
                  <th className="px-4 py-3">Period Validity</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {subscriptions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      No personal training subscriptions active. Click &quot;Assign PT Package&quot; to book a client.
                    </td>
                  </tr>
                ) : (
                  subscriptions.map((s) => {
                    const trainer = trainers.find((t) => t.id === s.trainer_id);
                    const pct = s.total_sessions > 0
                      ? Math.min(100, Math.round((s.completed_sessions / s.total_sessions) * 100))
                      : 0;
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/60 transition">
                        <td className="py-3.5 pl-6 pr-4">
                          <div className="font-semibold text-slate-900">
                            {s.members?.full_name || 'Member'}
                          </div>
                          <div className="text-[11px] text-slate-400">{s.members?.phone || '—'}</div>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-slate-800">
                          {trainer?.name || 'Assigned Coach'}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">
                              {s.completed_sessions} / {s.total_sessions}
                            </span>
                            <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-bold text-slate-900">
                          ₹{Number(s.amount_paid || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3.5 text-slate-600 text-[11px]">
                          {s.start_date} to {s.end_date}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                            s.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {s.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Tab 3: Disbursement Ledger */
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 pl-6 pr-4">Trainer Paid</th>
                  <th className="px-4 py-3">Disbursed Amount</th>
                  <th className="px-4 py-3">Payment Method</th>
                  <th className="px-4 py-3">Billing Cycle / Period</th>
                  <th className="px-4 py-3">Date Disbursed</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      No payout logs recorded yet. Use &quot;Pay ₹&quot; on any trainer to disburse commission.
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3.5 pl-6 pr-4 font-bold text-slate-900">
                        {l.trainer_name}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-emerald-700">
                        ₹{Number(l.amount).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center uppercase rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                          {l.payment_method}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 font-medium">
                        {l.period}
                      </td>
                      <td className="px-4 py-3.5 text-slate-500 text-[11px]">
                        {new Date(l.paid_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 text-slate-400 text-[11px]">
                        {l.notes || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: Add/Edit Trainer */}
      {showTrainerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                {editingTrainer ? 'Edit Trainer Details' : 'Add New Trainer'}
              </h3>
              <button
                onClick={() => setShowTrainerModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTrainer} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700">Trainer Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={trName}
                  onChange={(e) => setTrName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Phone Number (with WhatsApp)</label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9876543210"
                  value={trPhone}
                  onChange={(e) => setTrPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Coaching Specialization</label>
                <input
                  type="text"
                  placeholder="e.g. Strength & Conditioning, HIIT, Weight Loss"
                  value={trSpecialization}
                  onChange={(e) => setTrSpecialization(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Commission Rate (% of PT fee)</label>
                <div className="relative mt-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    required
                    value={trCommission}
                    onChange={(e) => setTrCommission(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none pr-8"
                  />
                  <span className="absolute right-3 top-2 text-xs font-bold text-slate-400">%</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="trActive"
                  checked={trActive}
                  onChange={(e) => setTrActive(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="trActive" className="text-xs text-slate-700">
                  Active coach (available for booking on gym floor)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowTrainerModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={trSaving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {trSaving ? 'Saving...' : 'Save Trainer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Record Payout */}
      {showPayoutModal && selectedTrainer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Record Commission Payout</h3>
                <p className="text-xs text-slate-500">Coach: {selectedTrainer.name}</p>
              </div>
              <button
                onClick={() => setShowPayoutModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSavePayout} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700">Payout Amount (₹)</label>
                <input
                  type="number"
                  required
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Payment Method</label>
                <select
                  value={payoutMethod}
                  onChange={(e) => setPayoutMethod(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="upi">UPI / GPay / PhonePe</option>
                  <option value="bank_transfer">Direct IMPS / NEFT Bank Transfer</option>
                  <option value="cash">Counter Cash</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Billing Cycle / Period</label>
                <input
                  type="text"
                  placeholder="e.g. October 2026"
                  value={payoutPeriod}
                  onChange={(e) => setPayoutPeriod(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Notes / Reference ID</label>
                <input
                  type="text"
                  placeholder="e.g. UPI Ref #98721345, bonus included"
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowPayoutModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={payoutSaving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {payoutSaving ? 'Recording...' : 'Disburse & Log Payout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Assign PT Package */}
      {showNewPTModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Assign Personal Training Client</h3>
              <button
                onClick={() => setShowNewPTModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNewPT} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700">Select Member</label>
                <select
                  required
                  value={ptMemberId}
                  onChange={(e) => setPtMemberId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">-- Choose Member --</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name} ({m.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Select Personal Trainer</label>
                <select
                  required
                  value={ptTrainerId}
                  onChange={(e) => setPtTrainerId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">-- Choose Trainer --</option>
                  {trainers.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.name} ({tr.commission_rate_percent}% split)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Total Sessions</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={ptSessions}
                    onChange={(e) => setPtSessions(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Fee Collected (₹)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={ptAmount}
                    onChange={(e) => setPtAmount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Start Date</label>
                  <input
                    type="date"
                    required
                    value={ptStartDate}
                    onChange={(e) => setPtStartDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Expiry Date</label>
                  <input
                    type="date"
                    required
                    value={ptEndDate}
                    onChange={(e) => setPtEndDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewPTModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={ptSaving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {ptSaving ? 'Assigning...' : 'Confirm PT Subscription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
