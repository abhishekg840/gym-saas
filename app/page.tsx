'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Users, 
  AlertTriangle, 
  CheckCircle, 
  Plus, 
  Dumbbell, 
  Send, 
  ExternalLink, 
  QrCode, 
  Calendar,
  RotateCw,
  Trash2,
  Search,
  Download,
  Tag,
  FileText
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
  membership_end: string;
  status: string;
  amount_paid?: number;
  plans?: {
    name: string;
  } | null;
}

export default function GymDashboard() {
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'expired'>('all');
  
  // Form States
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  async function fetchPlans() {
    const { data } = await supabase.from('plans').select('id, name, duration_days, price');
    if (data && data.length > 0) {
      setPlans(data);
      setSelectedPlanId(data[0].id);
      setAmountPaid(data[0].price.toString());
    }
  }

  async function fetchMembers() {
    const { data, error } = await supabase
      .from('members')
      .select('*, plans(name)')
      .order('created_at', { ascending: false });
    if (data) setMembers(data as unknown as Member[]);
    if (error) console.error('Fetch error:', error.message);
  }

  useEffect(() => {
    fetchPlans();
    fetchMembers();
  }, []);

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

    // 1. Insert Member
    const { data: memberData, error: memberError } = await supabase
      .from('members')
      .insert([
        {
          full_name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          emergency_contact: emergencyPhone.trim() || null,
          plan_id: selectedPlanId || null,
          amount_paid: feeAmount,
          membership_end: endDate.toISOString().split('T')[0],
          status: 'active'
        }
      ])
      .select()
      .single();

    if (!memberError && memberData) {
      // 2. Auto-generate Tax Receipt / Invoice
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
      fetchMembers();
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
      // Create renewal invoice record
      await supabase.from('invoices').insert([
        {
          member_id: member.id,
          amount: member.amount_paid || 1500,
          payment_method: 'Renewal',
          status: 'paid'
        }
      ]);
      fetchMembers();
    } else {
      alert(error.message);
    }
    setActionId(null);
  }

  async function deleteMember(member: Member) {
    if (!confirm(`Are you sure you want to remove ${member.full_name}?`)) return;

    setActionId(member.id);
    const { error } = await supabase.from('members').delete().eq('id', member.id);

    if (!error) {
      fetchMembers();
    } else {
      alert(error.message);
    }
    setActionId(null);
  }

  // Open latest invoice receipt for member
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
      alert('No invoice receipt generated yet for this member.');
    }
  }

  // Direct UPI Intent + WhatsApp Reminder
  function sendWhatsAppReminder(member: Member) {
    const cleanPhone = member.phone.replace(/[^0-9]/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    
    // Custom Gym UPI link (0% gateway fee)
    const upiPayLink = `upi://pay?pa=paytmqr@paytm&pn=GlitchFiestaGym&am=${member.amount_paid || 1500}&cu=INR`;

    const message = encodeURIComponent(
      `Hello ${member.full_name}! 👋\n\nYour membership at GlitchFiesta Fitness ended on ${member.membership_end}.\n\n💳 Pay directly via UPI to instantly unblock your gate access:\n${upiPayLink}\n\nThank you!`
    );

    window.open(`https://wa.me/${phoneWithCountry}?text=${message}`, '_blank');
  }

  function exportToCSV() {
    if (members.length === 0) return alert('No members to export.');

    const headers = ['Full Name', 'Phone', 'Email', 'Emergency Contact', 'Plan', 'Expiry Date', 'Status', 'Fee Paid'];
    const rows = members.map(m => [
      `"${m.full_name}"`,
      `"${m.phone}"`,
      `"${m.email || ''}"`,
      `"${m.emergency_contact || ''}"`,
      `"${m.plans?.name || 'Custom'}"`,
      `"${m.membership_end}"`,
      `"${new Date(m.membership_end) < new Date() ? 'Expired' : 'Active'}"`,
      `"${m.amount_paid || 0}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `gym_members_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const activeCount = members.filter(m => new Date(m.membership_end) >= new Date()).length;
  const expiredCount = members.length - activeCount;

  const filteredMembers = members.filter(member => {
    const isExpired = new Date(member.membership_end) < new Date();
    const matchesSearch = 
      member.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.phone.includes(searchTerm);

    if (!matchesSearch) return false;
    if (filterTab === 'active') return !isExpired;
    if (filterTab === 'expired') return isExpired;
    return true;
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 md:p-12">
      {/* Top Bar */}
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400">
            <Dumbbell className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Gym Command Center</h1>
            <p className="text-sm text-neutral-400">Manage memberships, gate access, and real-time billing</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link
            href="/plans"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-sm transition"
          >
            <Tag className="w-4 h-4 text-emerald-400" /> Packages
          </Link>
          <Link
            href="/attendance"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-sm transition"
          >
            <Calendar className="w-4 h-4 text-blue-400" /> Logs
          </Link>
          <button
            onClick={exportToCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-sm transition"
            title="Download CSV"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <Link
            href="/scan"
            target="_blank"
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold rounded-xl text-sm transition shadow-lg shadow-emerald-500/20"
          >
            <QrCode className="w-4 h-4" /> Scanner
          </Link>
        </div>
      </div>

      {/* Metrics */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-neutral-400">Total Members</p>
            <p className="text-2xl font-bold">{members.length}</p>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <CheckCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-neutral-400">Active Gate Access</p>
            <p className="text-2xl font-bold text-emerald-400">{activeCount}</p>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-rose-500/10 text-rose-400 rounded-xl">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-neutral-400">Expired (Blocked)</p>
            <p className="text-2xl font-bold text-rose-400">{expiredCount}</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Enroll Member Form */}
        <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl h-fit">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-emerald-400" /> New Enrollment
          </h2>
          <form onSubmit={addMember} className="space-y-3.5">
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Full Name</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Rohit Verma"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">WhatsApp Phone</label>
              <input
                required
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="9876543210"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Membership Plan</label>
              <select
                value={selectedPlanId}
                onChange={e => handlePlanChange(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
              >
                {plans.length === 0 ? (
                  <option value="">No Plans Available</option>
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
                <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Fee Paid (₹)</label>
                <input
                  type="number"
                  value={amountPaid}
                  onChange={e => setAmountPaid(e.target.value)}
                  placeholder="0"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Emergency Ph</label>
                <input
                  value={emergencyPhone}
                  onChange={e => setEmergencyPhone(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-semibold py-2.5 rounded-xl transition text-sm disabled:opacity-50 mt-2"
            >
              {loading ? 'Enrolling...' : 'Enroll & Generate Invoice'}
            </button>
          </form>
        </div>

        {/* Member Table with Invoices Action */}
        <div className="lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                placeholder="Search member or phone..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-neutral-300">
              <thead className="bg-neutral-950 text-neutral-400 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4">Member</th>
                  <th className="px-6 py-4">Package</th>
                  <th className="px-6 py-4">Expiry Date</th>
                  <th className="px-6 py-4">Gate Access</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-neutral-500">
                      No matching member records found.
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map(member => {
                    const isExpired = new Date(member.membership_end) < new Date();
                    const isProcessing = actionId === member.id;

                    return (
                      <tr key={member.id} className="hover:bg-neutral-800/40 transition">
                        <td className="px-6 py-4">
                          <p className="font-medium text-white">{member.full_name}</p>
                          <p className="font-mono text-xs text-neutral-400">{member.phone}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                            {member.plans?.name || 'Custom Plan'}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-xs">{member.membership_end}</td>
                        <td className="px-6 py-4">
                          {isExpired ? (
                            <span className="px-2.5 py-1 text-xs rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">
                              Blocked
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                              Allowed
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* View Tax Receipt */}
                            <button
                              onClick={() => viewLatestInvoice(member.id)}
                              title="View / Print Tax Receipt"
                              className="p-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 rounded-lg transition"
                            >
                              <FileText className="w-3.5 h-3.5 text-blue-400" />
                            </button>

                            {/* +30 Days Renewal */}
                            <button
                              disabled={isProcessing}
                              onClick={() => renewMember(member)}
                              title="Extend 30 Days & Invoiced"
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-xs rounded-lg transition disabled:opacity-50"
                            >
                              <RotateCw className={`w-3 h-3 text-emerald-400 ${isProcessing ? 'animate-spin' : ''}`} />
                              +30D
                            </button>

                            {/* WhatsApp Reminder + Direct UPI Link */}
                            {isExpired && (
                              <button
                                onClick={() => sendWhatsAppReminder(member)}
                                title="Send WhatsApp Fee & Direct UPI Link"
                                className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg transition"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Delete */}
                            <button
                              disabled={isProcessing}
                              onClick={() => deleteMember(member)}
                              title="Delete Member"
                              className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 rounded-lg transition disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
      </div>
    </div>
  );
}