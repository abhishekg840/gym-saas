'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  Plus,
  Phone,
  Calendar,
  MessageSquare,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  TrendingUp,
  UserCheck,
  UserX,
  X,
  RotateCw,
  Dumbbell,
  Filter,
  Sparkles,
  MoreVertical,
  ChevronRight
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { readSession, type GymSession } from '@/lib/session';
import { waLink } from '@/lib/whatsapp';
import { useFeatureFlags } from '@/lib/use-feature-flags';
import FeatureLockedScreen from '@/components/feature-locked-screen';

interface Lead {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  source: string;
  status: 'new' | 'contacted' | 'trial_booked' | 'trial_completed' | 'converted' | 'lost';
  trial_date: string | null;
  follow_up_date: string | null;
  notes: string | null;
  created_at: string;
}

const STAGES = [
  { id: 'all', label: 'All Leads' },
  { id: 'new', label: 'New Walk-Ins', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'trial_booked', label: 'Trial Scheduled', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'trial_completed', label: 'Trial Done', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 'converted', label: 'Converted to Member', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'lost', label: 'Lost / Dropped', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
];

export default function AdminCrmPage() {
  const router = useRouter();
  const [session, setSession] = useState<GymSession | null>(null);
  const { isEnabled, loading: flagsLoading } = useFeatureFlags();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Add Lead Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newSource, setNewSource] = useState('walk-in');
  const [newStatus, setNewStatus] = useState<Lead['status']>('new');
  const [newTrialDate, setNewTrialDate] = useState('');
  const [newNotes, setNewNotes] = useState('');
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

  const loadLeads = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) console.error('Error fetching leads:', error);
      setLeads((data ?? []) as Lead[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) void loadLeads();
  }, [tenantId, loadLeads]);

  // Gate check
  if (!flagsLoading && !isEnabled('lead_crm')) {
    return (
      <FeatureLockedScreen
        featureName="CRM & Member Lead Pipeline"
        featureKey="lead_crm"
        description="The CRM & Lead Inquiries pipeline is currently locked. Upgrade your subscription tier to manage walk-in prospects and automate follow-ups."
      />
    );
  }

  // Create Lead
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !newName || !newPhone) return;
    setSaveBusy(true);

    try {
      const { error } = await supabase.from('leads').insert({
        tenant_id: tenantId,
        full_name: newName,
        phone: newPhone,
        email: newEmail || null,
        source: newSource,
        status: newStatus,
        trial_date: newTrialDate || null,
        notes: newNotes || null,
      });

      if (error) throw error;

      setShowAddModal(false);
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setNewTrialDate('');
      setNewNotes('');
      void loadLeads();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save lead.');
    } finally {
      setSaveBusy(false);
    }
  };

  // Update Status
  const handleUpdateStatus = async (leadId: string, status: Lead['status']) => {
    try {
      await supabase.from('leads').update({ status }).eq('id', leadId);
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status } : l))
      );
    } catch {
      alert('Failed to update stage.');
    }
  };

  // Delete Lead
  const handleDeleteLead = async (leadId: string) => {
    if (!confirm('Delete this inquiry record?')) return;
    try {
      await supabase.from('leads').delete().eq('id', leadId);
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
    } catch {
      alert('Failed to delete lead.');
    }
  };

  // Filter
  const filteredLeads = leads.filter((l) => {
    const q = search.toLowerCase().trim();
    const matchSearch =
      l.full_name.toLowerCase().includes(q) ||
      l.phone.includes(q) ||
      (l.notes && l.notes.toLowerCase().includes(q));

    if (!matchSearch) return false;
    if (stageFilter === 'all') return true;
    return l.status === stageFilter;
  });

  // Analytics
  const totalCount = leads.length;
  const trialCount = leads.filter((l) => l.status === 'trial_booked' || l.status === 'trial_completed').length;
  const convertedCount = leads.filter((l) => l.status === 'converted').length;
  const conversionRate = totalCount > 0 ? Math.round((convertedCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased">
      {/* Top Header */}
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
                <h1 className="text-base font-bold text-slate-900">Member Lead Pipeline &amp; CRM</h1>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                  Lead CRM Active
                </span>
              </div>
              <p className="text-[11px] text-slate-500">Track walk-in prospects, free trials, and conversion follow-ups</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadLeads()}
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
              Add Walk-In Lead
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Metric Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Inquiries</span>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{totalCount}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Prospects logged</p>
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active Trials</span>
            <p className="mt-1 text-2xl font-extrabold text-amber-600">{trialCount}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Scheduled or attended</p>
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Converted Members</span>
            <p className="mt-1 text-2xl font-extrabold text-emerald-600">{convertedCount}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Signed up &amp; paid</p>
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Conversion Rate</span>
            <p className="mt-1 text-2xl font-extrabold text-indigo-600">{conversionRate}%</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Lead to member ratio</p>
          </div>
        </div>

        {/* Filter Bar & Tabs */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search leads by name, phone or notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Stage Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto text-xs">
            {STAGES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStageFilter(s.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  stageFilter === s.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Leads Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Lead / Prospect</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Trial Date</th>
                <th className="px-4 py-3">Pipeline Stage</th>
                <th className="px-4 py-3 text-right">Quick Follow-Up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <RotateCw className="mx-auto h-6 w-6 animate-spin text-slate-300 mb-2" />
                    Loading leads pipeline...
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <Users className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No prospect leads found matching current stage.
                  </td>
                </tr>
              ) : (
                filteredLeads.map((l) => {
                  const stageObj = STAGES.find((s) => s.id === l.status) || STAGES[1];
                  const gymName = session?.tenantName || 'Gym';
                  const waText = `Hi ${l.full_name}, thank you for checking out ${gymName}! Would you like to schedule your free workout session with one of our certified trainers?`;

                  return (
                    <tr key={l.id} className="hover:bg-slate-50/60 transition">
                      <td className="px-4 py-3.5">
                        <p className="font-bold text-slate-900">{l.full_name}</p>
                        {l.notes && <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{l.notes}</p>}
                      </td>

                      <td className="px-4 py-3.5">
                        <a href={`tel:${l.phone}`} className="font-mono text-slate-700 hover:text-emerald-600 font-semibold flex items-center gap-1">
                          <Phone className="h-3 w-3 text-slate-400" />
                          {l.phone}
                        </a>
                        {l.email && <p className="text-[10px] text-slate-400 mt-0.5">{l.email}</p>}
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                          {l.source}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-slate-600">
                        {l.trial_date ? (
                          <span className="flex items-center gap-1 font-semibold text-amber-700">
                            <Calendar className="h-3.5 w-3.5" />
                            {l.trial_date}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <select
                          value={l.status}
                          onChange={(e) => void handleUpdateStatus(l.id, e.target.value as Lead['status'])}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none"
                        >
                          <option value="new">New Inquiry</option>
                          <option value="trial_booked">Trial Scheduled</option>
                          <option value="trial_completed">Trial Completed</option>
                          <option value="converted">Converted to Member</option>
                          <option value="lost">Lost / Dropped</option>
                        </select>
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <a
                            href={waLink(l.phone, waText)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition"
                          >
                            <MessageSquare className="h-3 w-3" />
                            WhatsApp
                          </a>

                          <button
                            type="button"
                            onClick={() => void handleDeleteLead(l.id)}
                            className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                          >
                            <X className="h-3.5 w-3.5" />
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
      </main>

      {/* Add Lead Modal */}
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
              <Users className="h-5 w-5 text-indigo-600" />
              Add Walk-In / Prospect Lead
            </h3>
            <p className="text-xs text-slate-500 mt-1">Log inquiry details to track trial visits and follow-ups.</p>

            <form onSubmit={handleCreateLead} className="mt-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Prospect Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone Number (10 digits)</label>
                  <input
                    type="tel"
                    required
                    placeholder="9876543210"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Inquiry Source</label>
                  <select
                    value={newSource}
                    onChange={(e) => setNewSource(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                  >
                    <option value="walk-in">Walk-in Visit</option>
                    <option value="instagram">Instagram Ad / DM</option>
                    <option value="referral">Member Referral</option>
                    <option value="phone">Phone Call</option>
                    <option value="google">Google Maps</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Initial Stage</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as Lead['status'])}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                  >
                    <option value="new">New Walk-in</option>
                    <option value="trial_booked">Trial Scheduled</option>
                    <option value="trial_completed">Trial Completed</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Free Trial Date</label>
                  <input
                    type="date"
                    value={newTrialDate}
                    onChange={(e) => setNewTrialDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes / Target Fitness Goal</label>
                <textarea
                  rows={3}
                  placeholder="e.g. Looking for weight loss plan, interested in evening slots after 6 PM."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saveBusy}
                  className="w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50"
                >
                  {saveBusy ? 'Saving Prospect...' : 'Add Lead to Pipeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
