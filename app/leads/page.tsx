'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { isUuid, readSession, type GymSession } from '@/lib/session';
import {
  PIPELINE_STAGES,
  LEAD_SOURCES,
  convertLead,
  createLead,
  deleteLead,
  followUpState,
  leadStageLabel,
  listLeads,
  nextStage,
  stashEnrollPrefill,
  updateLead,
  type Lead,
  type LeadStage,
} from '@/lib/crm';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  MessageCircle,
  PhoneCall,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  duration_days: number;
  price: number;
}

const EMPTY_FORM = {
  full_name: '',
  phone: '',
  email: '',
  source: 'walk-in',
  follow_up_date: '',
  notes: '',
};

export default function LeadsPipelinePage() {
  const router = useRouter();

  const [session, setSession] = useState<GymSession | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'bad'>('ok');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyFollowUps, setOnlyFollowUps] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  /** The lead being converted, plus the plan and fee the front desk picked. */
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null);
  const [convertPlanId, setConvertPlanId] = useState('');
  const [convertAmount, setConvertAmount] = useState('');
  const [converting, setConverting] = useState(false);

  const tenantId = isUuid(session?.tenantId) ? (session?.tenantId as string) : null;

  function flash(message: string, kind: 'ok' | 'bad' = 'ok') {
    setNotice(message);
    setNoticeKind(kind);
  }

  const reload = useCallback(async (tenant: string | null) => {
    const result = await listLeads(tenant);
    if (!result.ok) {
      setLeads([]);
      setNotice(result.error ?? 'Could not load the pipeline.');
      setNoticeKind('bad');
      return;
    }
    setLeads(result.leads);
  }, []);

  useEffect(() => {
    const parsed = readSession();
    if (!parsed) {
      router.push('/login');
      return;
    }

    // localStorage only exists in the browser, so the session can only arrive
    // after hydration. This setState is the whole point of the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(parsed);

    if (!isUuid(parsed.tenantId)) {
      setNotice('No gym is linked to this session. Sign in again to load the pipeline.');
      setNoticeKind('bad');
      return;
    }

    reload(parsed.tenantId ?? null);
  }, [router, reload]);

  // Plans feed the conversion modal, scoped exactly like the dashboard: this
  // gym's packages, plus any global template rows.
  useEffect(() => {
    if (!tenantId) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('plans')
        .select('id, name, duration_days, price')
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .order('duration_days', { ascending: true });

      if (cancelled || !data || data.length === 0) return;
      setPlans(data as Plan[]);
      setConvertPlanId(data[0].id);
      setConvertAmount(String(data[0].price));
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return leads.filter((lead) => {
      if (onlyFollowUps && followUpState(lead.follow_up_date) === 'none') return false;
      if (!query) return true;

      return (
        lead.full_name.toLowerCase().includes(query) ||
        (lead.phone ?? '').includes(query) ||
        (lead.source ?? '').toLowerCase().includes(query)
      );
    });
  }, [leads, search, onlyFollowUps]);

  const metrics = useMemo(() => {
    const converted = leads.filter((lead) => lead.status === 'converted').length;
    const lost = leads.filter((lead) => lead.status === 'lost').length;
    const settled = converted + lost;

    return {
      total: leads.length,
      converted,
      lost,
      openFollowUps: leads.filter(
        (lead) => lead.status !== 'converted' && followUpState(lead.follow_up_date) !== 'none'
      ).length,
      conversionRate: settled === 0 ? 0 : Math.round((converted / settled) * 100),
    };
  }, [leads]);

  /** Local update so a stage change lands instantly, then the server confirms. */
  function patchLocal(leadId: string, patch: Partial<Lead>) {
    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, ...patch } : lead)));
  }

  async function moveLead(lead: Lead, stage: LeadStage) {
    if (lead.status === stage) return;

    setBusyId(lead.id);
    patchLocal(lead.id, { status: stage });

    const result = await updateLead(tenantId, lead.id, { status: stage });
    if (!result.ok) {
      patchLocal(lead.id, { status: lead.status });
      flash(result.error ?? 'Could not move that lead.', 'bad');
    } else if (stage === 'converted') {
      flash(`${lead.full_name} marked as converted.`);
    }
    setBusyId(null);
  }

  async function handleCreateLead(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) {
      flash('No gym is linked to this session.', 'bad');
      return;
    }

    setSaving(true);
    const result = await createLead(tenantId, {
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      source: form.source,
      follow_up_date: form.follow_up_date || null,
      notes: form.notes.trim() || null,
      status: 'new',
    });
    setSaving(false);

    if (!result.ok) {
      flash(result.error ?? 'Could not save this lead.', 'bad');
      return;
    }

    setForm(EMPTY_FORM);
    setAddOpen(false);
    flash(`${result.lead?.full_name ?? 'Lead'} added to New Inquiry.`);
    reload(tenantId);
  }

  async function removeLead(lead: Lead) {
    if (!confirm(`Delete lead "${lead.full_name}"? This cannot be undone.`)) return;

    setBusyId(lead.id);
    const result = await deleteLead(tenantId, lead.id);
    setBusyId(null);

    if (!result.ok) {
      flash(result.error ?? 'Could not delete that lead.', 'bad');
      return;
    }
    flash('Lead deleted.');
    reload(tenantId);
  }

  // ---- WhatsApp ------------------------------------------------------------
  function whatsappMessage(lead: Lead): string {
    const gym = session?.tenantName || 'the gym';

    if (lead.status === 'trial_booked' && lead.trial_date) {
      return `Hi ${lead.full_name}! 💪\n\nYour complimentary trial at ${gym} is confirmed for ${lead.trial_date}. Please carry a water bottle and indoor shoes.\n\nSee you at the gym!`;
    }
    if (lead.status === 'trial_completed') {
      return `Hi ${lead.full_name}! 💪\n\nGreat session at ${gym} today. Ready to lock in a membership and keep the momentum going? Reply here and we'll set it up.`;
    }
    if (lead.status === 'converted') {
      return `Hi ${lead.full_name}! Welcome to ${gym} 🎉 Your membership is active. Message us any time for a spot, a plan change or a PT session.`;
    }
    return `Hi ${lead.full_name}! 💪\n\nThanks for your enquiry at ${gym}. We'd love to set up a *free trial session* for you — which day suits you this week?`;
  }

  function sendWhatsApp(lead: Lead) {
    const digits = (lead.phone ?? '').replace(/[^0-9]/g, '');
    if (!digits) {
      flash('This lead has no phone number saved.', 'bad');
      return;
    }

    const recipient = digits.length === 10 ? `91${digits}` : digits;
    window.open(
      `https://wa.me/${recipient}?text=${encodeURIComponent(whatsappMessage(lead))}`,
      '_blank',
      'noopener'
    );
  }

  // ---- Call ----------------------------------------------------------------
  /**
   * Hands the number to the dialler. `tel:` is the only way a phone screen can
   * start a call — a `wa.me` link cannot — so the button degrades to a plain
   * anchor that most desktop browsers turn into a "no handler" message, which
   * is why the button is labelled rather than left as a bare icon.
   */
  function callLead(lead: Lead) {
    const digits = (lead.phone ?? '').replace(/[^0-9]/g, '');
    if (!digits) {
      flash('This lead has no phone number saved.', 'bad');
      return;
    }

    // 10 digits are Indian mobiles: the +91 prefix is what makes the dialer
    // recognise the number as mobile rather than a landline.
    const tel = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    window.location.href = `tel:${tel}`;
  }

  // ---- Conversion ----------------------------------------------------------
  function openConvert(lead: Lead) {
    setConvertTarget(lead);
    const first = plans[0];
    setConvertPlanId(first?.id ?? '');
    setConvertAmount(first ? String(first.price) : '0');
  }

  function handlePlanChange(planId: string) {
    setConvertPlanId(planId);
    const chosen = plans.find((plan) => plan.id === planId);
    if (chosen) setConvertAmount(String(chosen.price));
  }

  async function confirmConvert() {
    if (!convertTarget) return;

    setConverting(true);
    const result = await convertLead({
      tenantId,
      leadId: convertTarget.id,
      planId: convertPlanId || null,
      amountPaid: Number(convertAmount) || 0,
    });
    setConverting(false);

    if (!result.ok) {
      flash(result.error ?? 'Could not convert this lead.', 'bad');
      return;
    }

    const converted = result.converted;
    setConvertTarget(null);
    flash(
      `🎉 ${converted?.full_name ?? convertTarget.full_name} is now an active member${
        converted?.membership_end ? ` until ${converted.membership_end}` : ''
      }.`
    );
    reload(tenantId);
  }

  /**
   * The dashboard owns the full enrolment form (biometrics, emergency contact,
   * plan and fee). Handing the lead over there keeps one enrolment code path
   * instead of two that can drift apart.
   */
  function prefillOnDashboard(lead: Lead) {
    stashEnrollPrefill({
      leadId: lead.id,
      name: lead.full_name,
      phone: lead.phone,
      email: lead.email,
    });
    setConvertTarget(null);
    router.push('/admin');
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Target className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">Lead Pipeline</h1>
              <p className="text-xs text-neutral-400">
                {session?.tenantName || 'Your gym'} &middot; {metrics.total} inquiries tracked
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, source"
                className="w-full sm:w-64 bg-neutral-900 border border-neutral-800 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              onClick={() => setOnlyFollowUps((value) => !value)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
                onlyFollowUps
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-700'
              }`}
            >
              <CalendarClock className="w-4 h-4" /> Follow-ups ({metrics.openFollowUps})
            </button>

            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-xl text-xs transition shadow-lg shadow-amber-500/20"
            >
              <Plus className="w-4 h-4" /> Add Lead
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-400">In Pipeline</p>
              <p className="text-xl font-bold">{metrics.total}</p>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-400">Converted</p>
              <p className="text-xl font-bold">{metrics.converted}</p>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-400">Conversion</p>
              <p className="text-xl font-bold">{metrics.conversionRate}%</p>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-400">Due / Overdue</p>
              <p className="text-xl font-bold">{metrics.openFollowUps}</p>
            </div>
          </div>
        </div>

        {notice && (
          <div
            className={`mb-5 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
              noticeKind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            }`}
          >
            <span className="break-words">{notice}</span>
            <button onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Kanban board. Six lanes, drag a card between them or use the arrows. */}
        <div className="overflow-x-auto pb-4">
          <div className="grid grid-flow-col auto-cols-[minmax(258px,1fr)] gap-4 items-stretch">
            {PIPELINE_STAGES.map((stage) => {
              const stageLeads = visible.filter((lead) => lead.status === stage.key);

              return (
                <div
                  key={stage.key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const lead = leads.find((item) => item.id === draggingId);
                    if (lead) moveLead(lead, stage.key);
                    setDraggingId(null);
                  }}
                  className={`bg-neutral-900/50 border rounded-2xl p-3 flex flex-col min-h-[440px] transition ${
                    draggingId ? 'border-dashed ' + stage.lane : stage.lane
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${stage.badge}`}>
                      {stage.label}
                    </span>
                    <span className="text-xs font-mono text-neutral-500">{stageLeads.length}</span>
                  </div>
                  <p className="text-[10px] text-neutral-500 mb-3 leading-snug">{stage.hint}</p>

                  <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                    {stageLeads.length === 0 ? (
                      <div className="text-center py-10 text-[11px] text-neutral-600 border border-dashed border-neutral-800 rounded-xl">
                        Nothing here yet
                      </div>
                    ) : (
                      stageLeads.map((lead) => {
                        const followState = followUpState(lead.follow_up_date);
                        const advance = nextStage(lead.status);
                        const busy = busyId === lead.id;

                        return (
                          <div
                            key={lead.id}
                            draggable
                            onDragStart={() => setDraggingId(lead.id)}
                            onDragEnd={() => setDraggingId(null)}
                            className={`bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl p-3 space-y-2.5 transition cursor-grab active:cursor-grabbing ${
                              busy ? 'opacity-50' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h4 className="font-semibold text-sm text-white truncate">
                                  {lead.full_name}
                                </h4>
                                <p className="font-mono text-[11px] text-neutral-400">{lead.phone}</p>
                              </div>
                              <button
                                onClick={() => removeLead(lead)}
                                title="Delete lead"
                                className="shrink-0 text-neutral-600 hover:text-rose-400 p-1 transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] bg-neutral-800 text-neutral-300 px-2 py-0.5 rounded-md capitalize">
                                {lead.source.replace(/-/g, ' ')}
                              </span>

                              {followState === 'overdue' && (
                                <span className="text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-md font-bold">
                                  Overdue {lead.follow_up_date}
                                </span>
                              )}
                              {followState === 'today' && (
                                <span className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-md font-bold">
                                  Call today
                                </span>
                              )}
                              {lead.trial_date && (
                                <span className="text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-md">
                                  Trial {lead.trial_date}
                                </span>
                              )}
                            </div>

                            {lead.notes && (
                              <p className="text-[11px] text-neutral-400 italic bg-neutral-950/60 p-2 rounded-lg border border-neutral-800/60 line-clamp-3">
                                {lead.notes}
                              </p>
                            )}

                            <div className="pt-2 border-t border-neutral-800 flex items-center gap-1.5">
                              <button
                                onClick={() => sendWhatsApp(lead)}
                                title="Open a WhatsApp chat with this lead"
                                aria-label={`WhatsApp ${lead.full_name}`}
                                className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg transition"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => callLead(lead)}
                                title="Call this lead"
                                aria-label={`Call ${lead.full_name}`}
                                className="p-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 rounded-lg transition"
                              >
                                <PhoneCall className="w-3.5 h-3.5" />
                              </button>

                              {advance && (
                                <button
                                  onClick={() => moveLead(lead, advance)}
                                  title={`Move to ${leadStageLabel(advance)}`}
                                  className="flex items-center gap-1 text-[10px] bg-neutral-800 hover:bg-neutral-700 px-2 py-1.5 rounded-lg text-neutral-200 transition"
                                >
                                  {leadStageLabel(advance)} <ArrowRight className="w-3 h-3" />
                                </button>
                              )}

                              {lead.status !== 'lost' && lead.status !== 'converted' && (
                                <button
                                  onClick={() => moveLead(lead, 'lost')}
                                  title="Mark as lost"
                                  className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded-lg transition"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {lead.status === 'converted' ? (
                                <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Member
                                </span>
                              ) : (
                                <button
                                  onClick={() => openConvert(lead)}
                                  disabled={busy}
                                  title="Enroll as a member"
                                  className="ml-auto flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-black rounded-lg text-[10px] font-bold transition disabled:opacity-50"
                                >
                                  <Sparkles className="w-3 h-3" /> Enroll
                                </button>
                              )}
                            </div>

                          </div>
                        );
                      })

                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Plus className="w-4 h-4 text-amber-400" /> New Walk-In / Inquiry
              </h2>
              <button
                onClick={() => setAddOpen(false)}
                className="text-neutral-500 hover:text-white transition"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-neutral-400 block mb-1.5">
                    Prospect Name
                  </label>
                  <input
                    required
                    autoFocus
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    placeholder="Aryan Patel"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] uppercase tracking-wider text-neutral-400 block mb-1.5">
                    WhatsApp Number
                  </label>
                  <input
                    required
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="9876543210"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-neutral-400 block mb-1.5">
                    Email (optional)
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="aryan@example.com"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] uppercase tracking-wider text-neutral-400 block mb-1.5">
                    Lead Source
                  </label>
                  <select
                    value={form.source}
                    onChange={(e) => setForm({ ...form, source: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 capitalize"
                  >
                    {LEAD_SOURCES.map((source) => (
                      <option key={source} value={source} className="capitalize">
                        {source.replace(/-/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] uppercase tracking-wider text-neutral-400 block mb-1.5">
                  Follow-up Date (optional)
                </label>
                <input
                  type="date"
                  value={form.follow_up_date}
                  onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
                <p className="text-[10px] text-neutral-500 mt-1.5">
                  The card turns red the day after this date if nobody has called yet.
                </p>
              </div>

              <div>
                <label className="text-[11px] uppercase tracking-wider text-neutral-400 block mb-1.5">
                  Remarks
                </label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Interested in the evening slot, wants a PT trial"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>


              <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-sm text-neutral-300 bg-neutral-800 hover:bg-neutral-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-600 text-black transition disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Add to Pipeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {convertTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" /> Enroll as a Member
              </h2>
              <button
                onClick={() => setConvertTarget(null)}
                className="text-neutral-500 hover:text-white transition"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3.5">
                <p className="text-sm font-bold text-white">{convertTarget.full_name}</p>
                <p className="font-mono text-xs text-neutral-400">{convertTarget.phone}</p>
                {convertTarget.email && (
                  <p className="text-xs text-neutral-400">{convertTarget.email}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-neutral-400 block mb-1.5">
                    Membership Plan
                  </label>
                  <select
                    value={convertPlanId}
                    onChange={(e) => handlePlanChange(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">No plan (30-day access)</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} &middot; {plan.duration_days} days &middot; ₹{plan.price}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] uppercase tracking-wider text-neutral-400 block mb-1.5">
                    Amount Collected
                  </label>
                  <input
                    inputMode="decimal"
                    value={convertAmount}
                    onChange={(e) => setConvertAmount(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <p className="text-[11px] text-neutral-500 leading-relaxed">
                Creates the active membership, records the fee in the revenue ledger and moves this
                card to Converted. A lead can only be converted once, so a double click cannot
                create two memberships.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-3 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => prefillOnDashboard(convertTarget)}
                  className="px-3.5 py-2.5 rounded-xl text-xs font-semibold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 transition"
                >
                  Prefill on Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setConvertTarget(null)}
                  className="px-3.5 py-2.5 rounded-xl text-xs text-neutral-400 hover:text-white transition sm:ml-auto"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmConvert}
                  disabled={converting}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-600 text-black transition disabled:opacity-50"
                >
                  {converting ? 'Converting...' : 'Create Member'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}


