'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import PageHeader from '@/components/page-header';

/** Accent ramp for the four pipeline counters. Meaning, not decoration: the
    follow-up tile is the one an owner scans for, so it is the only rose. */
const METRIC_TONE: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  violet: 'bg-violet-50 text-violet-600',
  rose: 'bg-rose-50 text-rose-600',
};

/** One pipeline counter. Presentational only — it renders what it is given. */
function MetricTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: keyof typeof METRIC_TONE;
}) {
  return (
    <div className="vy-card flex items-center gap-3 p-4">
      <span
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${METRIC_TONE[tone]}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </p>
        <p className="mt-0.5 text-[20px] font-semibold leading-none tracking-tight tabular-nums text-ink">
          {value}
        </p>
      </div>
    </div>
  );
}

interface LeadCardProps {
  lead: Lead;
  busy: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDelete: (lead: Lead) => void;
  onAdvance: (lead: Lead, stage: LeadStage) => void;
  onWhatsApp: (lead: Lead) => void;
  onCall: (lead: Lead) => void;
  onEnroll: (lead: Lead) => void;
}

/**
 * One lead card inside a lane.
 *
 * Lifted out of the board so the lane map stays readable: seven lanes of this
 * markup inline is how a board stops being reviewable. It is still pure
 * presentation — every action arrives as a handler, so drag/drop, WhatsApp,
 * call and stage-move all stay in the page where they already lived.
 */
function LeadCard({
  lead,
  busy,
  dragging,
  onDragStart,
  onDragEnd,
  onDelete,
  onAdvance,
  onWhatsApp,
  onCall,
  onEnroll,
}: LeadCardProps) {
  const followState = followUpState(lead.follow_up_date);
  const advance = nextStage(lead.status);

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-busy={busy}
      className={`space-y-2.5 rounded-lg border border-line bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition ${
        busy ? 'opacity-50' : ''
      } ${dragging ? 'cursor-grabbing ring-2 ring-brand/40' : 'cursor-grab hover:border-line-strong'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-[13px] font-semibold text-ink">{lead.full_name}</h4>
          <p className="truncate font-mono text-[11px] tabular-nums text-muted">{lead.phone}</p>
        </div>
        <button
          onClick={() => onDelete(lead)}
          aria-label={`Delete ${lead.full_name}`}
          title="Delete lead"
          className="vy-icon-btn-sm -mr-1 -mt-1 hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="vy-chip vy-chip-slate capitalize">{lead.source.replace(/-/g, ' ')}</span>

        {followState === 'overdue' && (
          <span className="vy-chip vy-chip-rose">Overdue {lead.follow_up_date}</span>
        )}
        {followState === 'today' && <span className="vy-chip vy-chip-amber">Call today</span>}
        {lead.trial_date && <span className="vy-chip vy-chip-blue">Trial {lead.trial_date}</span>}
      </div>

      {lead.notes && (
        <p className="line-clamp-3 rounded-lg border border-line bg-subtle p-2 text-[11px] italic leading-relaxed text-muted">
          {lead.notes}
        </p>
      )}

<div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <button
          onClick={() => onWhatsApp(lead)}
          title="Open a WhatsApp chat with this lead"
          aria-label={`WhatsApp ${lead.full_name}`}
          className="vy-icon-btn-sm border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        >
          <MessageCircle className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => onCall(lead)}
          title="Call this lead"
          aria-label={`Call ${lead.full_name}`}
          className="vy-icon-btn-sm border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
        >
          <PhoneCall className="h-3.5 w-3.5" />
        </button>

        {advance && (
          <button
            onClick={() => onAdvance(lead, advance)}
            title={`Move to ${leadStageLabel(advance)}`}
            className="vy-btn vy-btn-secondary !px-2 !py-1 text-[10px]"
          >
            {leadStageLabel(advance)} <ArrowRight className="h-3 w-3" />
          </button>
        )}

        {lead.status !== 'lost' && lead.status !== 'converted' && (
          <button
            onClick={() => onAdvance(lead, 'lost')}
            title="Mark as lost"
            aria-label={`Mark ${lead.full_name} as lost`}
            className="vy-icon-btn-sm hover:bg-rose-50 hover:text-rose-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {lead.status === 'converted' ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Member
          </span>
        ) : (
          <button
            onClick={() => onEnroll(lead)}
            disabled={busy}
            title="Enroll as a member"
            className="vy-btn vy-btn-brand ml-auto !px-2 !py-1 text-[10px]"
          >
            <Sparkles className="h-3 w-3" /> Enroll
          </button>
        )}
      </div>
    </article>
  );
}

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
    <div className="vy-page vy-noscroll">
      {/* ---- Kanban viewport --------------------------------------------------
          The board is seven lanes wide, so it is genuinely wider than any
          laptop. Scrolling therefore has to be CONFINED to the wrapper below:

            1. `min-w-0` on the shell lets it shrink below its content's
               intrinsic width. Without it a flex/grid item refuses to shrink,
               the overflow escapes the wrapper and starts scrolling the whole
               page — which is exactly the bug this board used to have.
            2. `overflow-x-auto` is the ONLY scroll container, and
               `overscroll-x-contain` stops the horizontal gesture from
               chaining out to the document.
            3. Lanes are a fixed track width rather than a 1fr share, so adding
               a stage widens the board (scroll it) instead of squashing every
               column until the text wraps into slivers.
            4. The page root carries `vy-noscroll` (`overflow-x: clip`) as the
               backstop, so even a mis-sized child cannot move the layout.
        */}
      <div className="mx-auto w-full max-w-[1600px] min-w-0 px-4 sm:px-6">
        <PageHeader
          icon={<Target className="h-5 w-5" />}
          title="Lead Pipeline"
          subtitle={`${session?.tenantName || 'Your gym'} · ${metrics.total} inquiries tracked`}
          actions={
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, phone, source"
                  aria-label="Search leads"
                  className="vy-input w-full pl-8 sm:w-64"
                />
              </div>

              <button
                onClick={() => setOnlyFollowUps((value) => !value)}
                aria-pressed={onlyFollowUps}
                className={`vy-btn ${onlyFollowUps ? 'vy-chip-rose' : 'vy-btn-secondary'}`}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                Follow-ups ({metrics.openFollowUps})
              </button>

              <button onClick={() => setAddOpen(true)} className="vy-btn vy-btn-brand">
                <Plus className="h-3.5 w-3.5" /> Add Lead
              </button>
            </>
          }
        />

        {notice && (
          <div
            role="status"
            className={`vy-notice mb-5 ${
              noticeKind === 'ok' ? 'vy-notice-ok' : 'vy-notice-bad'
            }`}
          >
            <span className="break-words">{notice}</span>
            <button
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 opacity-70 transition hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Metrics */}
        <section aria-label="Pipeline metrics" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile
            icon={<Users className="h-3.5 w-3.5" />}
            tone="blue"
            label="In Pipeline"
            value={metrics.total}
          />
          <MetricTile
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            tone="emerald"
            label="Converted"
            value={metrics.converted}
          />
          <MetricTile
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            tone="violet"
            label="Conversion"
            value={`${metrics.conversionRate}%`}
          />
          <MetricTile
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            tone="rose"
            label="Due / Overdue"
            value={metrics.openFollowUps}
          />
        </section>

{/* The ONLY horizontal scroll container on the page. `w-max` lets the track
            exceed the viewport (so lanes keep their width) while the wrapper
            clips it; without `w-max` the grid would shrink the lanes instead. */}
        <div className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-4">
          <div className="grid w-max grid-flow-col auto-cols-[minmax(268px,1fr)] gap-3">
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
                  className={`flex min-h-[440px] min-w-0 flex-col rounded-xl border bg-subtle p-3 transition ${
                    draggingId ? 'border-dashed ' + stage.lane : stage.lane
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={`vy-chip ${stage.badge}`}>{stage.label}</span>
                    <span className="text-[11px] font-semibold tabular-nums text-faint">
                      {stageLeads.length}
                    </span>
                  </div>
                  <p className="mb-3 text-[10px] leading-snug text-faint">{stage.hint}</p>

                  {/* Lanes scroll vertically on their own; the board scrolls
                      horizontally as a whole. Two axes, two containers. */}
                  <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
                    {stageLeads.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-[11px] text-faint">
                        Nothing here yet
                      </p>
                    ) : (
                      stageLeads.map((lead) => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          busy={busyId === lead.id}
                          dragging={draggingId === lead.id}
                          onDragStart={() => setDraggingId(lead.id)}
                          onDragEnd={() => setDraggingId(null)}
                          onDelete={removeLead}
                          onAdvance={moveLead}
                          onWhatsApp={sendWhatsApp}
                          onCall={callLead}
                          onEnroll={openConvert}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
{addOpen && (
        <div className="vy-scrim">
          <div className="vy-modal max-w-lg">
            <div className="vy-modal-head">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
                <Plus className="h-4 w-4 text-brand" /> New walk-in / inquiry
              </h2>
              <button
                onClick={() => setAddOpen(false)}
                aria-label="Close"
                className="vy-icon-btn"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="vy-modal-body space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="vy-label" htmlFor="lead-name">
                    Prospect name
                  </label>
                  <input
                    id="lead-name"
                    required
                    autoFocus
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    placeholder="Aryan Patel"
                    className="vy-input"
                  />
                </div>

                <div>
                  <label className="vy-label" htmlFor="lead-phone">
                    WhatsApp number
                  </label>
                  <input
                    id="lead-phone"
                    required
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="9876543210"
                    className="vy-input font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="vy-label" htmlFor="lead-source">
                  Lead source
                </label>
                <select
                  id="lead-source"
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  className="vy-select capitalize"
                >
                  {LEAD_SOURCES.map((source) => (
                    <option key={source} value={source} className="capitalize">
                      {source.replace(/-/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="vy-label" htmlFor="lead-followup">
                  Follow-up date (optional)
                </label>
                <input
                  id="lead-followup"
                  type="date"
                  value={form.follow_up_date}
                  onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })}
                  className="vy-input"
                />
                <p className="mt-1.5 text-[10px] text-faint">
                  The card turns red the day after this date if nobody has called yet.
                </p>
              </div>

              <div>
                <label className="vy-label" htmlFor="lead-notes">
                  Remarks
                </label>
                <textarea
                  id="lead-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Interested in the evening slot, wants a PT trial"
                  className="vy-textarea resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="vy-btn vy-btn-lg vy-btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="vy-btn vy-btn-lg vy-btn-brand">
                  {saving ? 'Saving…' : 'Add to pipeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

{convertTarget && (
        <div className="vy-scrim">
          <div className="vy-modal max-w-lg">
            <div className="vy-modal-head">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
                <Sparkles className="h-4 w-4 text-brand" /> Enroll as a member
              </h2>
              <button
                onClick={() => setConvertTarget(null)}
                aria-label="Close"
                className="vy-icon-btn"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="vy-modal-body space-y-4">
              <div className="vy-panel">
                <p className="text-[13px] font-semibold text-ink">{convertTarget.full_name}</p>
                <p className="font-mono text-[12px] tabular-nums text-muted">{convertTarget.phone}</p>
                {convertTarget.email && (
                  <p className="truncate text-[12px] text-muted">{convertTarget.email}</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="vy-label" htmlFor="convert-plan">
                    Membership plan
                  </label>
                  <select
                    id="convert-plan"
                    value={convertPlanId}
                    onChange={(e) => handlePlanChange(e.target.value)}
                    className="vy-select"
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
                  <label className="vy-label" htmlFor="convert-amount">
                    Amount collected
                  </label>
                  <input
                    id="convert-amount"
                    inputMode="decimal"
                    value={convertAmount}
                    onChange={(e) => setConvertAmount(e.target.value)}
                    className="vy-input font-mono"
                  />
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-faint">
                Creates the active membership, records the fee in the revenue ledger and moves this
                card to Converted. A lead can only be converted once, so a double click cannot
                create two memberships.
              </p>

              <div className="flex flex-col items-stretch gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => prefillOnDashboard(convertTarget)}
                  className="vy-btn vy-btn-lg vy-btn-secondary"
                >
                  Prefill on Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setConvertTarget(null)}
                  className="vy-btn vy-btn-lg vy-btn-ghost sm:ml-auto"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmConvert}
                  disabled={converting}
                  className="vy-btn vy-btn-lg vy-btn-brand"
                >
                  {converting ? 'Converting…' : 'Create member'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
