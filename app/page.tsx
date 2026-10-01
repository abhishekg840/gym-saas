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
  LogOut,
  Snowflake,
  ArrowRightLeft,
  ServerCog,
  ShoppingBag
} from 'lucide-react';
import Link from 'next/link';
import {
  freezeMembership,
  unfreezeMembership,
  transferMembership,
  type MembershipResult,
} from '@/lib/membership';
import { convertLead, takeEnrollPrefill } from '@/lib/crm';
import { clearSession, readSession } from '@/lib/session';

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
  is_frozen?: boolean;
  freeze_start_date?: string | null;
  freeze_end_date?: string | null;
  total_freeze_days?: number | null;
  plans?: {
    name: string;
  } | null;
}

interface GymSession {
  userId: string;
  role: string;
  name: string;
  phone: string;
  tenantId?: string | null;
  tenantName?: string | null;
}

export default function GymDashboard() {
  const router = useRouter();
  const [session, setSession] = useState<GymSession | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'expired' | 'frozen'>('all');

  // Membership transfer modal: null = closed. Owner-only action.
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);
  const [transferName, setTransferName] = useState('');
  const [transferPhone, setTransferPhone] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  
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

  // Set when the enrolment was started from a card on /leads: the lead id rides
  // along so a successful enrolment can convert that card too.
  const [enrollLeadId, setEnrollLeadId] = useState<string | null>(null);
  const [enrollBanner, setEnrollBanner] = useState<string | null>(null);

  useEffect(() => {
    const parsed = readSession();
    if (!parsed) {
      router.push('/login');
      return;
    }

    // The session lives in localStorage, which only exists in the browser, so it
    // can only be read after hydration — this setState is the effect's whole job.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(parsed);
    if (parsed.role === 'receptionist') {
      setCurrentRole('reception');
    }
    fetchPlans(parsed.tenantId);
    fetchMembers(parsed.tenantId);
    // A card on /leads can hand a prospect over to this form. The payload sits
    // in localStorage rather than the URL, so a phone number never lands in
    // browser history, and takeEnrollPrefill clears it on read.
    applyEnrollPrefill();
  }, [router]);

  /**
   * Fills the enrolment form from the Lead Pipeline hand-off and remembers which
   * lead it came from, so submitting can flip that card to Converted.
   */
  function applyEnrollPrefill() {
    const prefill = takeEnrollPrefill();
    if (!prefill) return;

    setName(prefill.name);
    setPhone(prefill.phone);
    setEmail(prefill.email ?? '');
    setEnrollLeadId(prefill.leadId);
    setEnrollBanner(prefill.name);
  }

  async function fetchPlans(tenantId?: string | null) {
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

  async function fetchMembers(tenantId?: string | null) {
    // Never run this unscoped: with no gym on the session the query would return
    // every tenant's members. The dashboard is always a single-gym view.
    if (!tenantId) {
      setMembers([]);
      console.warn('Member list not loaded: no gym is linked to this session.');
      return;
    }

    const { data, error } = await supabase
      .from('members')
      .select('*, plans(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (data) setMembers(data as unknown as Member[]);
    if (error) console.error('Fetch error:', error.message);
  }

  function handleLogout() {
    clearSession();
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

      // When the enrolment began on a pipeline card, link the lead to the member
      // we just created and flip it to Converted. convertLead refuses a second
      // conversion, so a re-submitted form cannot mint a duplicate membership.
      if (enrollLeadId) {
        const linked = await convertLead({
          tenantId: session?.tenantId ?? null,
          leadId: enrollLeadId,
          memberId: memberData.id,
          planId: selectedPlanId || null,
          amountPaid: feeAmount,
        });

        if (!linked.ok) {
          alert(
            linked.error ||
              'The member was enrolled, but the lead could not be marked converted. Convert it from the pipeline.'
          );
        }
        setEnrollLeadId(null);
        setEnrollBanner(null);
      }

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

  /**
   * Freeze / unfreeze / transfer are delegated to /api/membership/actions, which
   * runs the tenant-checked Postgres functions. The dashboard never edits the
   * membership columns directly, so the freeze day maths lives in exactly one
   * place and cannot drift from what the gate enforces.
   */
  function requireTenant(): string {
    const tenantId = session?.tenantId ?? '';
    if (!tenantId) throw new Error('No gym is linked to this session. Sign in again.');
    return tenantId;
  }

  function reportFailure(res: MembershipResult) {
    alert(res.error || 'The gym server rejected this action.');
  }

  async function freezeMember(member: Member) {
    if (!confirm(`Freeze ${member.full_name}'s membership? Gate access stops immediately.`)) return;

    setActionId(member.id);
    try {
      const res = await freezeMembership(member.id, requireTenant());
      if (!res.ok) reportFailure(res);
      else fetchMembers(session?.tenantId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Freeze failed');
    }
    setActionId(null);
  }

  async function unfreezeMember(member: Member) {
    setActionId(member.id);
    try {
      const res = await unfreezeMembership(member.id, requireTenant());
      if (!res.ok) reportFailure(res);
      else fetchMembers(session?.tenantId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unfreeze failed');
    }
    setActionId(null);
  }

  function openTransferModal(member: Member) {
    if (currentRole !== 'owner') {
      alert('Only Owner role can transfer a membership to another person.');
      return;
    }
    setTransferTarget(member);
    setTransferName('');
    setTransferPhone('');
  }

  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transferTarget) return;

    setTransferBusy(true);
    try {
      const res = await transferMembership({
        memberId: transferTarget.id,
        tenantId: requireTenant(),
        toName: transferName,
        toPhone: transferPhone,
      });

      if (!res.ok) {
        reportFailure(res);
      } else {
        alert(
          `Transferred ${transferTarget.full_name} to ${res.to_name ?? transferName} — ` +
            `${res.transferred_days ?? 0} days carried over.`
        );
        setTransferTarget(null);
        fetchMembers(session?.tenantId);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Transfer failed');
    }
    setTransferBusy(false);
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
      `"${m.is_frozen ? 'Frozen' : new Date(m.membership_end) < new Date() ? 'Expired' : 'Active'}"`,
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

  // A frozen pass is neither active nor expired, so count it separately to keep
  // the summary tiles from double-counting the same member.
  const frozenCount = members.filter((m) => m.is_frozen).length;
  const activeCount = members.filter(
    (m) => !m.is_frozen && new Date(m.membership_end) >= new Date()
  ).length;
  const expiredCount = members.filter(
    (m) => !m.is_frozen && new Date(m.membership_end) < new Date()
  ).length;

  const filteredMembers = members.filter(member => {
    const isExpired = new Date(member.membership_end) < new Date();
    const matchesSearch = 
      member.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.phone.includes(searchTerm) ||
      (member.biometric_id && member.biometric_id.toString().includes(searchTerm));

    if (!matchesSearch) return false;
    // Frozen is its own bucket: a frozen pass must not read as merely active.
    if (filterTab === 'frozen') return Boolean(member.is_frozen);
    if (filterTab === 'active') return !isExpired && !member.is_frozen;
    if (filterTab === 'expired') return isExpired && !member.is_frozen;
    return true;
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 md:p-12">
      {transferTarget && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={submitTransfer}
            className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl w-full max-w-md"
          >
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-amber-400" /> Transfer Membership
            </h3>
            <p className="text-xs text-neutral-400 mb-5 leading-relaxed">
              {transferTarget.full_name}&apos;s remaining valid days move onto a new member profile.
              The current profile is closed as <span className="text-neutral-200">transferred</span>.
            </p>

            <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
              Recipient Name
            </label>
            <input
              autoFocus
              value={transferName}
              onChange={(e) => setTransferName(e.target.value)}
              placeholder="Full name"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 mb-4"
            />

            <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
              Recipient Phone (10 digits)
            </label>
            <input
              value={transferPhone}
              onChange={(e) => setTransferPhone(e.target.value)}
              placeholder="9876543210"
              inputMode="numeric"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono mb-6"
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setTransferTarget(null)}
                className="flex-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 py-2 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={transferBusy}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-black py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition disabled:opacity-50"
              >
                {transferBusy ? 'Transferring...' : 'Confirm Transfer'}
              </button>
            </div>
          </form>
        </div>
      )}

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
              <h1 className="text-2xl font-extrabold tracking-tight">
                {session?.tenantName || 'Gym'} Dashboard
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
            href="/trainers"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-xs transition"
          >
            <Dumbbell className="w-4 h-4 text-cyan-400" /> Trainers
          </Link>
          <Link
            href="/store"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-xs transition"
          >
            <ShoppingBag className="w-4 h-4 text-rose-400" /> Store
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
          {(currentRole === 'owner' || session?.role === 'super_admin') && (
            <Link
              href="/hardware"
              title="Terminals, machine keys and the gym geofence"
              className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-xs transition"
            >
              <ServerCog className="w-4 h-4 text-emerald-400" /> Hardware
            </Link>
          )}
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
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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

        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-sky-500/10 text-sky-400 rounded-xl">
            <Snowflake className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-neutral-400">Frozen (On Hold)</p>
            <p className="text-2xl font-bold text-sky-400">{frozenCount}</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Enroll Form */}
        <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl h-fit">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-400" /> New Member Enrollment
          </h2>
          {enrollBanner && (
            <div className="mb-4 flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-200">
              <Target className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Enrolling <strong>{enrollBanner}</strong> from the Lead Pipeline. Submitting this form
                also moves that lead card to Converted.
              </span>
            </div>
          )}
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
              <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">Email (optional)</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Optional"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
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
              <button
                onClick={() => setFilterTab('frozen')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  filterTab === 'frozen' ? 'bg-sky-500/20 text-sky-400' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Frozen ({frozenCount})
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
                    const isFrozen = Boolean(member.is_frozen);
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
                          {isFrozen ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-mono rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-bold">
                              <Snowflake className="w-3 h-3" /> FROZEN
                            </span>
                          ) : isExpired ? (
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

                            {isFrozen ? (
                              <button
                                disabled={isProcessing}
                                onClick={() => unfreezeMember(member)}
                                title={`Resume membership${member.freeze_end_date ? ` (frozen until ${member.freeze_end_date})` : ''}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-xs rounded-lg transition disabled:opacity-50 font-mono"
                              >
                                <Unlock className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
                                Resume
                              </button>
                            ) : (
                              <button
                                disabled={isProcessing || isExpired}
                                onClick={() => freezeMember(member)}
                                title="Freeze Membership"
                                className="p-1.5 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 text-sky-400 rounded-lg transition disabled:opacity-50"
                              >
                                <Snowflake className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {currentRole === 'owner' && (
                              <button
                                disabled={isProcessing}
                                onClick={() => openTransferModal(member)}
                                title="Transfer Membership To Another Person"
                                className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 rounded-lg transition disabled:opacity-50"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                              </button>
                            )}

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