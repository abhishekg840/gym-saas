'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Users, AlertTriangle, CheckCircle, Plus, Dumbbell, Send, ExternalLink, QrCode } from 'lucide-react';
import Link from 'next/link';

interface Member {
  id: string;
  full_name: string;
  phone: string;
  membership_end: string;
  status: string;
}

export default function GymDashboard() {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [days, setDays] = useState('30');
  const [loading, setLoading] = useState(false);

  async function fetchMembers() {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setMembers(data);
    if (error) console.error('Fetch error:', error.message);
  }

  useEffect(() => {
    fetchMembers();
  }, []);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(days));

    const { error } = await supabase.from('members').insert([
      {
        full_name: name,
        phone: phone,
        membership_end: endDate.toISOString().split('T')[0],
        status: 'active'
      }
    ]);

    if (!error) {
      setName('');
      setPhone('');
      fetchMembers();
    } else {
      alert(error.message);
    }
    setLoading(false);
  }

  function sendWhatsAppReminder(member: Member) {
    const cleanPhone = member.phone.replace(/[^0-9]/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    
    const message = encodeURIComponent(
      `Hello ${member.full_name}! 👋\n\nYour gym membership at GlitchFiesta Fitness ended on ${member.membership_end}.\n\nTo avoid gate access blockage, please renew your plan online or visit the counter.\n\nThank you!`
    );

    window.open(`https://wa.me/${phoneWithCountry}?text=${message}`, '_blank');
  }

  const activeCount = members.filter(m => new Date(m.membership_end) >= new Date()).length;
  const expiredCount = members.length - activeCount;

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 md:p-12">
      {/* Top Bar with Quick Navigation */}
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400">
            <Dumbbell className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Gym SaaS Command Center</h1>
            <p className="text-sm text-neutral-400">Manage memberships, gate access, and fee alerts</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/member"
            target="_blank"
            className="flex items-center gap-1.5 px-4 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-sm transition"
          >
            <ExternalLink className="w-4 h-4" /> Member App
          </Link>
          <Link
            href="/scan"
            target="_blank"
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold rounded-xl text-sm transition"
          >
            <QrCode className="w-4 h-4" /> Open Scanner
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
            <p className="text-sm text-neutral-400">Expired (Access Blocked)</p>
            <p className="text-2xl font-bold text-rose-400">{expiredCount}</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Enroll Form */}
        <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl h-fit">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-emerald-400" /> Enroll Member
          </h2>
          <form onSubmit={addMember} className="space-y-4">
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Member Name</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Rahul Sharma"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">WhatsApp Phone</label>
              <input
                required
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="9876543210"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Plan Validity</label>
              <select
                value={days}
                onChange={e => setDays(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value="30">1 Month (30 Days)</option>
                <option value="90">3 Months (90 Days)</option>
                <option value="365">1 Year (365 Days)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-semibold py-2.5 rounded-xl transition text-sm disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Enroll Member'}
            </button>
          </form>
        </div>

        {/* Member Table */}
        <div className="lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-neutral-800">
            <h2 className="text-lg font-semibold">Active Member Access Roster</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-neutral-300">
              <thead className="bg-neutral-950 text-neutral-400 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Phone</th>
                  <th className="px-6 py-4">Expiry Date</th>
                  <th className="px-6 py-4">Gate Access</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-neutral-500">
                      No members registered yet. Fill the form to enroll your first member.
                    </td>
                  </tr>
                ) : (
                  members.map(member => {
                    const isExpired = new Date(member.membership_end) < new Date();
                    return (
                      <tr key={member.id} className="hover:bg-neutral-800/40 transition">
                        <td className="px-6 py-4 font-medium text-white">{member.full_name}</td>
                        <td className="px-6 py-4">{member.phone}</td>
                        <td className="px-6 py-4">{member.membership_end}</td>
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
                          {isExpired && (
                            <button
                              onClick={() => sendWhatsAppReminder(member)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg transition"
                            >
                              <Send className="w-3 h-3" /> Remind
                            </button>
                          )}
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