'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { 
  Users, 
  AlertTriangle, 
  CheckCircle, 
  Plus, 
  Dumbbell, 
  Send, 
  QrCode, 
  Calendar, 
  RotateCw, 
  Trash2, 
  Search, 
  Download, 
  Tag, 
  FileText, 
  BarChart3, 
  Lock, 
  Unlock, 
  Target, 
  Fingerprint, 
  Building2, 
  LogOut 
} from 'lucide-react';
import Link from 'next/link';

interface Plan {
  id: string;
  name: string;
  duration_days: number;
  price: number;
}

interface Member {
  id: string;
  full_name: string;
  phone: string;
  email?: string;
  emergency_contact?: string;
  biometric_id?: number | null;
  membership_end: string;
  status: string;
  amount_paid?: number;
  tenant_id?: string | null;
  plans?: {
    name: string;
  } | null;
}

interface GymSession {
  userId: string;
  role: string;
  name: string;
  phone: string;
  tenantId?: string;
  tenantName?: string;
}

export default function GymDashboard() {
  const router = useRouter();
  const [session, setSession] = useState<GymSession | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'expired'>('all');
  
  const [currentRole, setCurrentRole] = useState<'owner' | 'reception'>('owner');
  const [pinPrompt, setPinPrompt] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');

  // Form States
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [biometricId, setBiometricId] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('gym_session') : null;
    if (!raw) {
      router.push('/login');
      return;
    }

    try {
      const parsed: GymSession = JSON.parse(raw);
      setSession(parsed);
      if (parsed.role === 'receptionist') {
        setCurrentRole('reception');
      }
      fetchPlans(parsed.tenantId);
      fetchMembers(parsed.tenantId);
    } catch {
      router.push('/login');
    }
  }, [router]);

  async function fetchPlans(tenantId?: string) {
    let query = supabase.from('plans').select('id, name, duration_days, price');
    if (tenantId) {
      query = query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
    }
    const { data } = await query;
    if (data && data.length > 0) {
      setPlans(data);
      setSelectedPlanId(data[0].id);
      setAmountPaid(data[0].price.toString());
    }
  }

  async function fetchMembers(tenantId?: string) {
    let query = supabase
      .from('members')
      .select('*, plans(name)')
      .order('created_at', { ascending: false });

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query;
    if (data) setMembers(data as unknown as Member[]);
    if (error) console.error('Fetch error:', error.message);
  }

  function handleLogout() {
    localStorage.removeItem('gym_session');
    router.push('/login');
  }

  function handlePlanChange(planId: string) {
    setSelectedPlanId(planId);
    const chosen = plans.find(p => p.id === planId);
    if (chosen) {
      setAmountPaid(chosen.price.toString());
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const chosenPlan = plans.find(p => p.id === selectedPlanId);
    const durationDays = chosenPlan ? chosenPlan.duration_days : 30;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);
    const feeAmount = parseFloat(amountPaid) || 0;

    const { data: memberData, error: memberError } = await supabase
      .from('members')
      .insert([
        {
          full_name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          emergency_contact: emergencyPhone.trim() || null,
          biometric_id: biometricId ? parseInt(biometricId) : null,
          plan_id: selectedPlanId || null,
          amount_paid: feeAmount,
          membership_end: endDate.toISOString().split('T')[0],
          status: 'active',
          tenant_id: session?.tenantId || null
        }
      ])
      .select()
      .single();

    if (!memberError && memberData) {
      await supabase.from('invoices').insert([
        {
          member_id: memberData.id,
          amount: feeAmount,
          payment_method: 'Cash/UPI',
          status: 'paid'
        }
      ]);

      setName('');
      setPhone('');
      setEmail('');
      setEmergencyPhone('');
      setBiometricId('');
      fetchMembers(session?.tenantId);
    } else {
      alert(memberError?.message || 'Error enrolling member');
    }
    setLoading(false);
  }

  async function renewMember(member: Member) {
    setActionId(member.id);
    const currentEnd = new Date(member.membership_end);
    const today = new Date();
    const baseDate = currentEnd > today ? currentEnd : today;

    baseDate.setDate(baseDate.getDate() + 30);
    const newEndStr = baseDate.toISOString().split('T')[0];

    const { error } = await supabase
      .from('members')
      .update({ membership_end: newEndStr, status: 'active' })
      .eq('id', member.id);

    if (!error) {
      await supabase.from('invoices').insert([
        {
          member_id: member.id,
          amount: member.amount_paid || 1500,
          payment_method: 'Renewal',
          status: 'paid'
        }
      ]);
      fetchMembers(session?.tenantId);
    } else {
      alert(error.message);
    }
    setActionId(null);
  }

  async function deleteMember(member: Member) {
    if (currentRole !== 'owner') {
      alert('Only Owner role can delete member profiles.');
      return;
    }
    if (!confirm(`Are you sure you want to remove ${member.full_name}?`)) return;

    setActionId(member.id);
    const { error } = await supabase.from('members').delete().eq('id', member.id);

    if (!error) {
      fetchMembers(session?.tenantId);
    } else {
      alert(error.message);
    }
    setActionId(null);
  }

  async function viewLatestInvoice(memberId: string) {
    const { data } = await supabase
      .from('invoices')
      .select('id')
      .eq('member_id', memberId)
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      window.open(`/invoice/${data.id}`, '_blank');
    } else {
      alert('No invoice receipt generated yet.');
    }
  }

  function sendWhatsAppReminder(member: Member) {
    const cleanPhone = member.phone.replace(/[^0-9]/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const gymTitle = encodeURIComponent(session?.tenantName || 'Fitness Club');
    const upiPayLink = `upi://pay?pa=paytmqr@paytm&pn=${gymTitle}&am=${member.amount_paid || 1500}&cu=INR`;

    const message = encodeURIComponent(
      `Hello ${member.full_name}! 👋\n\nYour membership at ${session?.tenantName || 'Fitness Club'} ended on ${member.membership_end}.\n\n💳 Pay directly via UPI to instantly unblock your gate access:\n${upiPayLink}\n\nThank you!`
    );

    window.open(`https://wa.me/${phoneWithCountry}?text=${message}`, '_blank');
  }

  function exportToCSV() {
    if (members.length === 0) return alert('No members to export.');

    const headers = ['Full Name', 'Phone', 'Email', 'Biometric ID', 'Plan', 'Expiry Date', 'Status', 'Fee Paid'];
    const rows = members.map(m => [
      `"${m.full_name}"`,
      `"${m.phone}"`,
      `"${m.email || ''}"`,
      `"${m.biometric_id || 'N/A'}"`,
      `"${m.plans?.name || 'Custom'}"`,
      `"${m.membership_end}"`,
      `"${new Date(m.membership_end) < new Date() ? 'Expired' : 'Active'}"`,
      `"${m.amount_paid || 0}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${(session?.tenantName || 'gym').toLowerCase().replace(/\s+/g, '_')}_members_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleSwitchRole() {
    if (currentRole === 'owner') {
      setCurrentRole('reception');
    } else {
      setPinPrompt(true);
    }
  }

  function verifyPin(e: React.FormEvent) {
    e.preventDefault();
    if (enteredPin === '1111' || enteredPin === '1234') {
      setCurrentRole('owner');
      setPinPrompt(false);
      setEnteredPin('');
    } else {
      alert('Invalid Owner PIN (Default: 1234)');
    }
  }

  const activeCount = members.filter(m => new Date(m.membership_end) >= new Date()).length;
  const expiredCount = members.length - activeCount;

  const filteredMembers = members.filter(member => {
    const isExpired = new Date(member.membership_end) < new Date();
    const matchesSearch = 
      member.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.phone.includes(searchTerm) ||
      (member.biometric_id && member.biometric_id.toString().includes(searchTerm));

    if (!matchesSearch) return false;
    if (filterTab === 'active') return !isExpired;
    if (filterTab === 'expired') return isExpired;
    return true;
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 md:p-12">
      {pinPrompt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl w-full max-w-xs text-center">
            <Lock className="w-8 h-8 text-amber-400 mx-auto mb-2" />
            <h3 className="font-bold text-base mb-1">Enter Owner PIN</h3>
            <p className="text-xs text-neutral-400 mb-4">Required to switch to full Owner Admin mode.</p>
            <form onSubmit={verifyPin} className="space-y-3">
              <input
                type="password"
                maxLength={4}
                autoFocus
                value={enteredPin}
                onChange={e => setEnteredPin(e.target.value)}
                placeholder="****"
                className="w-full bg-neutral-950 border border-neutral-800 text-center tracking-widest text-xl rounded-xl py-2 focus:border-amber-400 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPinPrompt(false)}
                  className="w-1/2 bg-neutral-800 py-2 rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 bg-amber-500 font-bold text-black py-2 rounded-xl text-xs"
                >
                  Verify
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header with Dynamic Gym Identity */}
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400">
            <Dumbbell className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">
                {session?.tenantName || 'Gym'} Command Center
              </h1>
              <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                {session?.tenantName || 'Fitness Club'}
              </span>
              <button
                onClick={handleSwitchRole}
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                  currentRole === 'owner'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                }`}
              >
                {currentRole === 'owner' ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {currentRole} Mode
              </button>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              Signed in as <strong className="text-white">{session?.name || 'Owner'}</strong> ({session?.phone})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {session?.role === 'super_admin' && (
            <Link
              href="/super-admin"
              className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-500/10 border border-purple-500/30 text-purple-300 rounded-xl text-xs font-semibold hover:bg-purple-500/20 transition"
            >
              ★ Super Admin
            </Link>
          )}
          {currentRole === 'owner' && (
            <Link
              href="/analytics"
              className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-xs transition"
            >
              <BarChart3 className="w-4 h-4 text-emerald-400" /> Analytics
            </Link>
          )}
          <Link
            href="/leads"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-xs transition"
          >
            <Target className="w-4 h-4 text-amber-400" /> Leads CRM
          </Link>
          <Link
            href="/plans"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-xs transition"
          >
            <Tag className="w-4 h-4 text-purple-400" /> Packages
          </Link>
          <Link
            href="/attendance"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-xs transition"
          >
            <Calendar className="w-4 h-4 text-blue-400" /> Logs
          </Link>
          <button
            onClick={exportToCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-xs transition"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          <Link
            href="/scan"
            target="_blank"
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold rounded-xl text-xs transition shadow-lg shadow-emerald-500/20"
          >
            <QrCode className="w-4 h-4" /> Scanner
          </Link>
          <button
            onClick={handleLogout}
            title="Log out"
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 rounded-xl text-xs font-semibold transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-neutral-400">Total Enrolled</p>
            <p className="text-2xl font-bold">{members.length}</p>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <CheckCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-neutral-400">Active Gate Access</p>
            <p className="text-2xl font-bold text-emerald-400">{activeCount}</p>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-rose-500/10 text-rose-400 rounded-xl">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-neutral-400">Expired (Blocked)</p>
            <p className="text-2xl font-bold text-rose-400">{expiredCount}</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Enroll Form */}
        <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl h-fit">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-400" /> New Member Enrollment
          </h2>
          <form onSubmit={addMember} className="space-y-3.5">
            <div>
              <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">Full Name</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Member Full Name"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">WhatsApp Phone</label>
              <input
                required
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="10-digit Phone"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">Membership Plan</label>
              <select
                value={selectedPlanId}
                onChange={e => handlePlanChange(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
              >
                {plans.length === 0 ? (
                  <option value="">Standard Monthly Plan</option>
                ) : (
                  plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.duration_days} Days) - ₹{p.price}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">Fee Paid (₹)</label>
                <input
                  type="number"
                  value={amountPaid}
                  onChange={e => setAmountPaid(e.target.value)}
                  placeholder="0"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider block mb-1 flex items-center gap-1">
                  <Fingerprint className="w-3.5 h-3.5" /> Bio Slot #
                </label>
                <input
                  type="number"
                  value={biometricId}
                  onChange={e => setBiometricId(e.target.value)}
                  placeholder="Slot #"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-cyan-500 text-white font-mono"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">Emergency Ph</label>
              <input
                value={emergencyPhone}
                onChange={e => setEmergencyPhone(e.target.value)}
                placeholder="Optional"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-semibold py-2.5 rounded-xl transition text-xs uppercase tracking-wider disabled:opacity-50 mt-2"
            >
              {loading ? 'Enrolling...' : 'Enroll & Generate Invoice'}
            </button>
          </form>
        </div>

        {/* Member Table */}
        <div className="lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex bg-neutral-950 p-1 rounded-xl border border-neutral-800 text-xs font-semibold">
              <button
                onClick={() => setFilterTab('all')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  filterTab === 'all' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'
                }`}
              >
                All ({members.length})
              </button>
              <button
                onClick={() => setFilterTab('active')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  filterTab === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Active ({activeCount})
              </button>
              <button
                onClick={() => setFilterTab('expired')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  filterTab === 'expired' ? 'bg-rose-500/20 text-rose-400' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Expired ({expiredCount})
              </button>
            </div>

            <div className="relative w-full sm:w-60">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search member, phone..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-neutral-300">
              <thead className="bg-neutral-950 text-neutral-400 uppercase font-mono">
                <tr>
                  <th className="px-5 py-4">Member</th>
                  <th className="px-4 py-4">Biometric</th>
                  <th className="px-4 py-4">Package</th>
                  <th className="px-4 py-4">Expiry</th>
                  <th className="px-4 py-4">Gate</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-neutral-500 font-mono">
                      No members enrolled under {session?.tenantName || 'this gym'} yet. Add your first member on the left!
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map(member => {
                    const isExpired = new Date(member.membership_end) < new Date();
                    const isProcessing = actionId === member.id;

                    return (
                      <tr key={member.id} className="hover:bg-neutral-800/40 transition">
                        <td className="px-5 py-4">
                          <p className="font-bold text-white text-sm">{member.full_name}</p>
                          <p className="font-mono text-xs text-neutral-400">{member.phone}</p>
                        </td>
                        <td className="px-4 py-4">
                          {member.biometric_id ? (
                            <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                              <Fingerprint className="w-3 h-3" /> #{member.biometric_id}
                            </span>
                          ) : (
                            <span className="text-neutral-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 font-mono">
                          <span className="block text-white font-medium">{member.plans?.name || 'Standard'}</span>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs">{member.membership_end}</td>
                        <td className="px-4 py-4">
                          {isExpired ? (
                            <span className="px-2.5 py-0.5 text-[10px] font-mono rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">
                              BLOCKED
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 text-[10px] font-mono rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                              ALLOWED
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => viewLatestInvoice(member.id)}
                              title="Print Receipt"
                              className="p-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 rounded-lg transition"
                            >
                              <FileText className="w-3.5 h-3.5 text-blue-400" />
                            </button>

                            <button
                              disabled={isProcessing}
                              onClick={() => renewMember(member)}
                              title="Extend 30 Days"
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-xs rounded-lg transition disabled:opacity-50 font-mono"
                            >
                              <RotateCw className={`w-3 h-3 text-emerald-400 ${isProcessing ? 'animate-spin' : ''}`} />
                              +30D
                            </button>

                            {isExpired && (
                              <button
                                onClick={() => sendWhatsAppReminder(member)}
                                title="Send WhatsApp UPI Link"
                                className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg transition"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {currentRole === 'owner' && (
                              <button
                                disabled={isProcessing}
                                onClick={() => deleteMember(member)}
                                title="Delete Member"
                                className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 rounded-lg transition disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
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
      </div>
    </div>
  );
}