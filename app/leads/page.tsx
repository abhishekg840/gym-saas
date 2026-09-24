'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  UserCheck, 
  Plus, 
  ArrowLeft, 
  Send, 
  Calendar, 
  Trash2, 
  Target,
  Sparkles,
  PhoneCall
} from 'lucide-react';
import Link from 'next/link';

interface Lead {
  id: string;
  full_name: string;
  phone: string;
  goal: string;
  stage: 'new' | 'trial' | 'completed' | 'converted' | 'lost';
  trial_date: string | null;
  notes: string | null;
  created_at: string;
}

const STAGES = [
  { key: 'new', label: 'New Inquiries', color: 'border-blue-500/40 bg-blue-500/10 text-blue-400' },
  { key: 'trial', label: 'Trial Scheduled', color: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
  { key: 'completed', label: 'Trial Done', color: 'border-purple-500/40 bg-purple-500/10 text-purple-400' },
  { key: 'converted', label: 'Converted 🎉', color: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
];

export default function LeadsPipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [goal, setGoal] = useState('Weight Loss');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  async function fetchLeads() {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setLeads(data as Lead[]);
    if (error) console.error('Fetch error:', error.message);
  }

  useEffect(() => {
    fetchLeads();
  }, []);

  async function handleAddLead(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from('leads').insert([
      {
        full_name: name.trim(),
        phone: phone.trim(),
        goal,
        notes: notes.trim() || null,
        stage: 'new',
      },
    ]);

    if (!error) {
      setName('');
      setPhone('');
      setNotes('');
      fetchLeads();
    } else {
      alert(error.message);
    }
    setLoading(false);
  }

  async function updateStage(leadId: string, nextStage: Lead['stage']) {
    const { error } = await supabase
      .from('leads')
      .update({ stage: nextStage })
      .eq('id', leadId);

    if (!error) {
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, stage: nextStage } : l))
      );
    }
  }

  async function deleteLead(leadId: string, leadName: string) {
    if (!confirm(`Delete lead "${leadName}"?`)) return;
    const { error } = await supabase.from('leads').delete().eq('id', leadId);
    if (!error) fetchLeads();
  }

  // 1-Click Convert Lead to Active Member
  async function convertToMember(lead: Lead) {
    setConvertingId(lead.id);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30); // Default 1 month

    // Insert to members roster
    const { error: memberError } = await supabase.from('members').insert([
      {
        full_name: lead.full_name,
        phone: lead.phone,
        membership_end: endDate.toISOString().split('T')[0],
        status: 'active',
        notes: `Converted from lead (${lead.goal})`,
      },
    ]);

    if (!memberError) {
      await updateStage(lead.id, 'converted');
      alert(`🎉 ${lead.full_name} is now an Active Member with 30 days access!`);
    } else {
      alert(memberError.message);
    }
    setConvertingId(null);
  }

  // WhatsApp Follow-up & Free Trial Invitation
  function sendTrialInvite(lead: Lead) {
    const cleanPhone = lead.phone.replace(/[^0-9]/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    const message = encodeURIComponent(
      `Hey ${lead.full_name}! 💪\n\nThanks for reaching out to GlitchFiesta Fitness! We saw you're interested in ${lead.goal}.\n\nWe have scheduled a *Complimentary 1-Day VIP Trial* for you. When are you free to drop by this week?\n\nSee you on the workout floor!`
    );

    window.open(`https://wa.me/${phoneWithCountry}?text=${message}`, '_blank');
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 md:p-12">
      {/* Top Header */}
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 text-amber-400">
            <Target className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Leads & Inquiry CRM</h1>
            <p className="text-sm text-neutral-400">Track walk-ins, schedule trials, and convert visitors to members</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Quick Add Inquiry Form */}
        <div className="lg:col-span-1 bg-neutral-900 border border-neutral-800 p-6 rounded-2xl h-fit">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-amber-400" /> New Walk-In / Inquiry
          </h2>
          <form onSubmit={handleAddLead} className="space-y-3.5">
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Prospect Name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Aryan Patel"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500 text-white"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">WhatsApp Phone</label>
              <input
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Fitness Goal</label>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500 text-white"
              >
                <option value="Weight Loss">Weight Loss / Fat Burn</option>
                <option value="Muscle Gain">Muscle Building / Hypertrophy</option>
                <option value="General Fitness">General Fitness & Cardio</option>
                <option value="Personal Training">Personal Training (PT)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Remarks / Note</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Interested in evening slot..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500 text-white resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold py-2.5 rounded-xl transition text-sm disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add to Pipeline'}
            </button>
          </form>
        </div>

        {/* Kanban Pipeline Columns */}
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-4">
          {STAGES.map((col) => {
            const stageLeads = leads.filter((l) => l.stage === col.key);

            return (
              <div
                key={col.key}
                className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 flex flex-col min-h-[500px]"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${col.color}`}>
                    {col.label}
                  </span>
                  <span className="text-xs font-mono text-neutral-500">{stageLeads.length}</span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto">
                  {stageLeads.length === 0 ? (
                    <div className="text-center py-10 text-xs text-neutral-600">
                      Empty
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <div
                        key={lead.id}
                        className="bg-neutral-900 border border-neutral-800 hover:border-neutral-700 p-4 rounded-xl space-y-2 transition group shadow-md"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-semibold text-sm text-white">{lead.full_name}</h4>
                            <p className="font-mono text-xs text-neutral-400">{lead.phone}</p>
                          </div>
                          <button
                            onClick={() => deleteLead(lead.id, lead.full_name)}
                            className="text-neutral-600 hover:text-rose-400 p-1 transition"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <span className="inline-block text-[11px] bg-neutral-800 text-neutral-300 px-2 py-0.5 rounded-md">
                          🎯 {lead.goal}
                        </span>

                        {lead.notes && (
                          <p className="text-xs text-neutral-400 italic bg-neutral-950/60 p-2 rounded-lg border border-neutral-800/60">
                            &quot;{lead.notes}&quot;
                          </p>
                        )}

                        <div className="pt-2 border-t border-neutral-800 flex items-center justify-between gap-1">
                          <button
                            onClick={() => sendTrialInvite(lead)}
                            title="Send WhatsApp Free Pass"
                            className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs flex items-center gap-1 transition"
                          >
                            <Send className="w-3 h-3" /> WhatsApp
                          </button>

                          {/* Quick Stage Shifter */}
                          {lead.stage === 'new' && (
                            <button
                              onClick={() => updateStage(lead.id, 'trial')}
                              className="text-[11px] bg-neutral-800 hover:bg-neutral-700 px-2 py-1 rounded-lg text-neutral-300 transition"
                            >
                              Book Trial →
                            </button>
                          )}

                          {lead.stage === 'trial' && (
                            <button
                              onClick={() => updateStage(lead.id, 'completed')}
                              className="text-[11px] bg-neutral-800 hover:bg-neutral-700 px-2 py-1 rounded-lg text-neutral-300 transition"
                            >
                              Done →
                            </button>
                          )}

                          {lead.stage !== 'converted' && (
                            <button
                              disabled={convertingId === lead.id}
                              onClick={() => convertToMember(lead)}
                              title="1-Click Enroll Member"
                              className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-black rounded-lg text-xs font-bold transition flex items-center gap-1"
                            >
                              <Sparkles className="w-3 h-3" /> Enroll
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}