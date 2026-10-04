'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { isUuid, readSession, type GymSession } from '@/lib/session';
import {
  PT_STATUS_META,
  TRAINER_SPECIALITIES,
  createSubscription,
  createTrainer,
  daysUntilDate,
  deleteTrainer,
  formatRupees,
  formatStamp,
  listSubscriptions,
  listTrainers,
  loadPayoutReport,
  logSession,
  monthStartIso,
  todayIso,
  updateTrainer,
  type PtSubscription,
  type PayoutReport,
  type Trainer,
} from '@/lib/crm';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Dumbbell,
  IndianRupee,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

/** The slice of a member row the PT picker needs. */
interface MemberOption {
  id: string;
  full_name: string;
  phone: string;
  status: string;
}

const EMPTY_TRAINER = {
  name: '',
  phone: '',
  specialization: TRAINER_SPECIALITIES[0] as string,
  commission_rate_percent: '20',
};

const EMPTY_PT = {
  memberId: '',
  trainerId: '',
  totalSessions: '12',
  amountPaid: '',
  startDate: '',
  endDate: '',
};

export default function TrainersPayoutPage() {
  const router = useRouter();

  const [session, setSession] = useState<GymSession | null>(null);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [report, setReport] = useState<PayoutReport | null>(null);
  const [subscriptions, setSubscriptions] = useState<PtSubscription[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);

  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());

  const [loading, setLoading] = useState(true);
  const [reportBusy, setReportBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'bad'>('ok');

  /** null = closed, '' = adding a new trainer, otherwise the id being edited. */
  const [trainerFormId, setTrainerFormId] = useState<string | null>(null);
  const [trainerForm, setTrainerForm] = useState(EMPTY_TRAINER);
  const [savingTrainer, setSavingTrainer] = useState(false);

  const [ptForm, setPtForm] = useState(EMPTY_PT);
  const [savingPt, setSavingPt] = useState(false);

  const tenantId = isUuid(session?.tenantId) ? (session?.tenantId as string) : null;

  function flash(message: string, kind: 'ok' | 'bad' = 'ok') {
    setNotice(message);
    setNoticeKind(kind);
  }

  const activeTrainers = useMemo(() => trainers.filter((t) => t.is_active).length, [trainers]);

  const openSubscriptions = useMemo(
    () => subscriptions.filter((s) => s.status === 'active').length,
    [subscriptions]
  );

  const sessionsLeft = useMemo(
    () =>
      subscriptions.reduce(
        (sum, s) => sum + Math.max(s.total_sessions - s.completed_sessions, 0),
        0
      ),
    [subscriptions]
  );

  /** Loads everything the page shows. Shared by the mount effect and the reload button. */
  const loadAll = useCallback(
    async (tenant: string | null) => {
      const [roster, subs] = await Promise.all([
        listTrainers(tenant),
        listSubscriptions(tenant),
      ]);

      if (roster.ok) setTrainers(roster.trainers);
      else flash(roster.error ?? 'Could not load the trainer roster.', 'bad');

      if (subs.ok) setSubscriptions(subs.subscriptions);
      else flash(subs.error ?? 'Could not load PT packages.', 'bad');

      setLoading(false);
    },
    []
  );

  /** The payout numbers come from fn_trainer_payout_report, never the browser. */
  const loadReport = useCallback(async (tenant: string | null, winFrom: string, winTo: string) => {
    setReportBusy(true);
    const result = await loadPayoutReport(tenant, winFrom, winTo);
    setReportBusy(false);

    if (!result.ok || !result.report) {
      flash(result.error ?? 'Could not build the payout report.', 'bad');
      return;
    }
    setReport(result.report);
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
      setNotice('No gym is linked to this session. Sign in again to load the roster.');
      setNoticeKind('bad');
      setLoading(false);
      return;
    }

    loadAll(parsed.tenantId ?? null);
    loadReport(parsed.tenantId ?? null, monthStartIso(), todayIso());
  }, [router, loadAll, loadReport]);


  // The PT form needs a member list. Reads go straight to PostgREST, exactly like
  // the dashboard's member table; every Phase 3 write above goes through a
  // tenant-checked Postgres function instead.
  useEffect(() => {
    if (!tenantId) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('members')
        .select('id, full_name, phone, status')
        .eq('tenant_id', tenantId)
        .order('full_name', { ascending: true })
        .limit(1000);

      if (cancelled || !data) return;
      setMembers(data as MemberOption[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // ---- Trainer roster ------------------------------------------------------

  function openAddTrainer() {
    setTrainerFormId('');
    setTrainerForm(EMPTY_TRAINER);
  }

  function openEditTrainer(trainer: Trainer) {
    setTrainerFormId(trainer.id);
    setTrainerForm({
      name: trainer.name,
      phone: trainer.phone,
      specialization: trainer.specialization ?? TRAINER_SPECIALITIES[0],
      commission_rate_percent: String(trainer.commission_rate_percent),
    });
  }

  async function saveTrainer(e: React.FormEvent) {
    e.preventDefault();
    if (trainerFormId === null) return;

    const payload = {
      name: trainerForm.name.trim(),
      phone: trainerForm.phone.trim(),
      specialization: trainerForm.specialization || null,
      commission_rate_percent: Number(trainerForm.commission_rate_percent),
    };

    setSavingTrainer(true);
    const result = trainerFormId
      ? await updateTrainer(tenantId, trainerFormId, payload)
      : await createTrainer(tenantId, payload);
    setSavingTrainer(false);

    if (!result.ok) {
      flash(result.error ?? 'Could not save this trainer.', 'bad');
      return;
    }

    flash(trainerFormId ? `${payload.name} updated.` : `${payload.name} added to the roster.`);
    setTrainerFormId(null);
    loadAll(tenantId);
    loadReport(tenantId, from, to);
  }

  async function toggleTrainerActive(trainer: Trainer) {
    setBusyId(trainer.id);
    const result = await updateTrainer(tenantId, trainer.id, { is_active: !trainer.is_active });
    setBusyId(null);

    if (!result.ok) {
      flash(result.error ?? 'Could not change this trainer.', 'bad');
      return;
    }
    setTrainers((prev) =>
      prev.map((row) => (row.id === trainer.id ? { ...row, is_active: !trainer.is_active } : row))
    );
    flash(
      `${trainer.name} marked ${trainer.is_active ? 'inactive' : 'active'}.`
    );
  }

  async function removeTrainer(trainer: Trainer) {
    if (
      !confirm(
        `Remove ${trainer.name} from the roster? Trainers who have already sold PT packages are kept for the payout history.`
      )
    ) {
      return;
    }

    setBusyId(trainer.id);
    const result = await deleteTrainer(tenantId, trainer.id);
    setBusyId(null);

    if (!result.ok) {
      flash(result.error ?? 'Could not remove this trainer.', 'bad');
      return;
    }
    flash(`${trainer.name} removed.`);
    loadAll(tenantId);
    loadReport(tenantId, from, to);
  }

  // ---- PT sessions ---------------------------------------------------------

  async function punchSession(subscription: PtSubscription) {
    setBusyId(subscription.id);
    const result = await logSession(tenantId, subscription.id);
    setBusyId(null);

    if (!result.ok || !result.punch) {
      flash(result.error ?? 'Could not log that session.', 'bad');
      return;
    }

    const punch = result.punch;
    setSubscriptions((prev) =>
      prev.map((row) =>
        row.id === subscription.id
          ? {
              ...row,
              completed_sessions: punch.completed_sessions,
              total_sessions: punch.total_sessions,
              status: punch.status,
            }
          : row
      )
    );

    flash(
      punch.package_finished
        ? `Session ${punch.completed_sessions}/${punch.total_sessions} logged — ${
            punch.member_name ?? 'this client'
          }'s package is complete.`
        : `Session ${punch.completed_sessions}/${punch.total_sessions} logged for ${
            punch.member_name ?? 'this client'
          }.`
    );

    loadReport(tenantId, from, to);
  }

  // ---- Selling a PT package ------------------------------------------------

  async function sellPtPackage(e: React.FormEvent) {
    e.preventDefault();

    const memberId = ptForm.memberId || members[0]?.id || '';
    const trainerId = ptForm.trainerId || trainers.find((t) => t.is_active)?.id || '';
    const totalSessions = Number(ptForm.totalSessions);

    if (!memberId || !trainerId) {
      flash('Pick a member and a trainer first.', 'bad');
      return;
    }
    if (!Number.isInteger(totalSessions) || totalSessions < 1 || totalSessions > 500) {
      flash('Sessions must be a whole number between 1 and 500.', 'bad');
      return;
    }

    setSavingPt(true);
    const result = await createSubscription(tenantId, {
      memberId,
      trainerId,
      totalSessions,
      amountPaid: Number(ptForm.amountPaid) || 0,
      startDate: ptForm.startDate || null,
      endDate: ptForm.endDate || null,
    });
    setSavingPt(false);

    if (!result.ok || !result.subscription) {
      flash(result.error ?? 'Could not create this PT package.', 'bad');
      return;
    }

    const created = result.subscription;
    setSubscriptions((prev) => [created, ...prev]);
    setPtForm({ ...EMPTY_PT, trainerId });
    flash(
      `${created.total_sessions} PT sessions sold to ${created.member_name ?? 'the member'}${
        created.end_date ? ` — valid until ${created.end_date}` : ''
      }.`
    );

    loadReport(tenantId, from, to);
  }

  function refreshReport() {
    loadReport(tenantId, from, to);
  }

  return (
    <div className="vy-page vy-noscroll font-sans">
      {/* Header */}
      <div className="vy-topbar">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2.5 rounded-xl rounded-xl border border-line bg-surface text-muted hover:text-ink transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-wash text-ink-2">
              <Dumbbell className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-[17px] font-semibold tracking-tight text-ink">Trainers &amp; PT Payroll</h1>
              <p className="text-[12px] text-muted">
                {session?.tenantName || 'Your gym'} &middot; {activeTrainers} of {trainers.length}{' '}
                trainers active
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface rounded-xl px-3 py-1.5">
              <CalendarClock className="w-4 h-4 text-faint" />
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="bg-transparent text-xs text-ink-2 focus:outline-none"
              />
              <span className="text-faint text-xs">&rarr;</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="bg-transparent text-xs text-ink-2 focus:outline-none"
              />
              <button
                onClick={refreshReport}
                title="Rebuild the payout report for this window"
                className="vy-icon-btn-sm"
              >
                {reportBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <button
              onClick={openAddTrainer}
              className="vy-btn vy-btn-lg vy-btn-brand"
            >
              <UserPlus className="w-4 h-4" /> Add Trainer
            </button>
          </div>
        </div>
      </div>

      <div className="vy-shell-wide">
        {notice && (
          <div
            className={`mb-5 vy-notice ${
              noticeKind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-700'
            }`}
          >
            {noticeKind === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <X className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{notice}</span>
            <button
              onClick={() => setNotice(null)}
              className="text-muted hover:text-ink transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}


        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border border-line bg-surface rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Dumbbell className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">Trainers</p>
              <p className="text-xl font-bold">
                {activeTrainers}
                <span className="text-sm font-normal text-faint"> / {trainers.length}</span>
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
              <BadgeCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">PT Packages Live</p>
              <p className="text-xl font-bold">{openSubscriptions}</p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">Sessions Left</p>
              <p className="text-xl font-bold">{sessionsLeft}</p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400">
              <IndianRupee className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">Commission Due</p>
              <p className="text-xl font-bold">{formatRupees(report?.total_commission ?? 0)}</p>
            </div>
          </div>
        </div>


        {/* Roster */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="vy-eyebrow flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-400" /> Trainer Roster
            </h2>
            <p className="text-[11px] text-faint">
              Commission is earned on PT packages sold inside the selected window.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted py-10 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading the roster…
            </div>
          ) : trainers.length === 0 ? (
            <div className="vy-empty rounded-2xl p-10 text-center">
              <Dumbbell className="w-8 h-8 text-faint mx-auto mb-3" />
              <p className="text-sm text-ink-2 font-semibold">No trainers on the roster yet</p>
              <p className="text-[11px] text-faint mt-1">
                Add a trainer to start assigning PT packages and tracking commission.
              </p>
              <button
                onClick={openAddTrainer}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-xl text-xs transition"
              >
                <Plus className="w-4 h-4" /> Add Trainer
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">

              {trainers.map((trainer) => {
                const busy = busyId === trainer.id;
                const stats = report?.trainers.find((row) => row.id === trainer.id);

                return (
                  <div
                    key={trainer.id}
                    className={`bg-surface border rounded-2xl p-4 ${
                      trainer.is_active ? 'border-line' : 'border-line opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-700 flex items-center justify-center font-bold shrink-0">
                          {trainer.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold truncate">{trainer.name}</p>
                          <p className="text-[11px] text-muted font-mono truncate">
                            {trainer.phone}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          trainer.is_active
                            ? 'vy-chip-emerald'
                            : 'vy-chip-slate'
                        }`}
                      >
                        {trainer.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <p className="mt-3 text-[11px] text-muted truncate">
                      {trainer.specialization ?? 'General training'}
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="vy-input-sm">
                        <p className="text-faint">Clients</p>
                        <p className="font-bold text-ink">{stats?.clients ?? 0}</p>
                      </div>
                      <div className="vy-input-sm">
                        <p className="text-faint">Commission</p>
                        <p className="font-bold text-amber-700">{trainer.commission_rate_percent}%</p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <button
                        onClick={() => toggleTrainerActive(trainer)}
                        disabled={busy}
                        className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-wash hover:bg-line-strong text-ink-2 transition disabled:opacity-50"
                      >
                        {trainer.is_active ? 'Pause' : 'Reactivate'}
                      </button>
                      <button
                        onClick={() => openEditTrainer(trainer)}
                        title="Edit trainer"
                        className="vy-icon-btn-sm"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeTrainer(trainer)}
                        disabled={busy}
                        title="Remove trainer"
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>


        {/* Payout report */}
        <div className="vy-card overflow-hidden mb-6">
          <div className="p-4 border-b border-line flex flex-wrap items-center justify-between gap-2">
            <h2 className="vy-eyebrow flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> Payout Report
            </h2>
            <p className="text-[11px] text-faint">
              {report ? `${report.from} &rarr; ${report.to}` : 'Loading window…'} &middot; the
              commission maths runs in Postgres, not in the browser
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead className="bg-surface text-muted uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5">Trainer</th>
                  <th className="text-right px-3 py-2.5">Clients</th>
                  <th className="text-right px-3 py-2.5">Packages</th>
                  <th className="text-right px-3 py-2.5">Sessions</th>
                  <th className="text-right px-3 py-2.5">Sold</th>
                  <th className="text-right px-3 py-2.5">Rate</th>
                  <th className="text-right px-4 py-2.5">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(report?.trainers ?? []).map((row) => (
                  <tr key={row.id} className="hover:bg-surface/60 transition">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-ink">{row.name}</p>
                      <p className="text-[10px] text-faint">
                        {row.specialization ?? 'General training'}
                        {row.is_active ? '' : ' · inactive'}
                      </p>
                    </td>
                    <td className="text-right px-3 py-2.5 text-ink-2">{row.clients}</td>
                    <td className="text-right px-3 py-2.5 text-ink-2">{row.subscriptions}</td>
                    <td className="text-right px-3 py-2.5 text-ink-2">
                      {row.sessions_completed}
                      <span className="text-faint"> / {row.sessions_total}</span>
                      {row.sessions_remaining > 0 && (
                        <span className="block text-[10px] text-faint">
                          {row.sessions_remaining} left
                        </span>
                      )}
                    </td>
                    <td className="text-right px-3 py-2.5 text-ink-2">
                      {formatRupees(row.revenue)}
                    </td>
                    <td className="text-right px-3 py-2.5 text-muted">
                      {row.commission_rate_percent}%
                    </td>
                    <td className="text-right px-4 py-2.5 font-bold text-amber-700">
                      {formatRupees(row.commission)}
                    </td>
                  </tr>
                ))}

                {(report?.trainers ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-faint">
                      {reportBusy
                        ? 'Building the payout report…'
                        : 'No trainers on the roster — add one to start tracking payouts.'}
                    </td>
                  </tr>
                )}
              </tbody>
              {(report?.trainers ?? []).length > 0 && (
                <tfoot className="bg-surface border-t border-line font-bold">
                  <tr>
                    <td className="px-4 py-3 text-ink-2">Gym total</td>
                    <td className="px-3 py-3" />
                    <td className="text-right px-3 py-3 text-ink-2">{report?.subscriptions ?? 0}</td>
                    <td className="text-right px-3 py-3 text-ink-2">
                      {report?.sessions_completed ?? 0}
                    </td>
                    <td className="text-right px-3 py-3 text-ink-2">
                      {formatRupees(report?.total_revenue ?? 0)}
                    </td>
                    <td className="px-3 py-3" />
                    <td className="text-right px-4 py-3 text-amber-700">
                      {formatRupees(report?.total_commission ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>


        {/* Personal training */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="rounded-xl border border-line bg-surface rounded-2xl p-5 h-fit">
            <h2 className="vy-eyebrow flex items-center gap-2 mb-4">
              <Plus className="w-4 h-4 text-emerald-400" /> Sell a PT Package
            </h2>

            <form onSubmit={sellPtPackage} className="space-y-3">
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                  Member
                </label>
                <select
                  value={ptForm.memberId || members[0]?.id || ''}
                  onChange={(e) => setPtForm((prev) => ({ ...prev, memberId: e.target.value }))}
                  className="w-full vy-input-sm text-sm focus:outline-none focus:border-emerald-500"
                >
                  {members.length === 0 ? (
                    <option value="">No members enrolled yet</option>
                  ) : (
                    members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.full_name} · {member.phone}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                  Trainer
                </label>
                <select
                  value={ptForm.trainerId || trainers.find((t) => t.is_active)?.id || ''}
                  onChange={(e) => setPtForm((prev) => ({ ...prev, trainerId: e.target.value }))}
                  className="w-full vy-input-sm text-sm focus:outline-none focus:border-emerald-500"
                >
                  {trainers.length === 0 ? (
                    <option value="">Add a trainer first</option>
                  ) : (
                    trainers.map((trainer) => (
                      <option key={trainer.id} value={trainer.id}>
                        {trainer.name}
                        {trainer.is_active ? '' : ' (inactive)'}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                    Sessions
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={ptForm.totalSessions}
                    onChange={(e) => setPtForm((prev) => ({ ...prev, totalSessions: e.target.value }))}
                    className="w-full vy-input-sm text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                    Fee Paid
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={ptForm.amountPaid}
                    onChange={(e) => setPtForm((prev) => ({ ...prev, amountPaid: e.target.value }))}
                    placeholder="0"
                    className="w-full vy-input-sm text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                    Start
                  </label>
                  <input
                    type="date"
                    value={ptForm.startDate}
                    onChange={(e) => setPtForm((prev) => ({ ...prev, startDate: e.target.value }))}
                    className="w-full vy-input-sm text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                    Valid Until
                  </label>
                  <input
                    type="date"
                    value={ptForm.endDate}
                    onChange={(e) => setPtForm((prev) => ({ ...prev, endDate: e.target.value }))}
                    className="w-full vy-input-sm text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <p className="text-[10px] text-faint leading-relaxed">
                Leave the dates blank and the server stamps today (with a 30-day validity window).
                A non-zero fee writes a paid PT invoice for the member.
              </p>

              <button
                type="submit"
                disabled={savingPt || members.length === 0 || trainers.length === 0}
                className="w-full flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-black font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-50"
              >
                {savingPt ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Selling…
                  </>
                ) : (
                  <>
                    <BadgeCheck className="w-3.5 h-3.5" /> Sell Package + Invoice
                  </>
                )}
              </button>
            </form>
          </div>


          <div className="lg:col-span-2 vy-card overflow-hidden">
            <div className="p-4 border-b border-line flex flex-wrap items-center justify-between gap-2">
              <h2 className="vy-eyebrow flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-blue-400" /> PT Packages
              </h2>
              <p className="text-[11px] text-faint">
                {openSubscriptions} active &middot; {sessionsLeft} sessions pending
              </p>
            </div>

            {subscriptions.length === 0 ? (
              <div className="p-10 text-center">
                <BadgeCheck className="w-8 h-8 text-faint mx-auto mb-3" />
                <p className="text-sm text-ink-2 font-semibold">No PT packages sold yet</p>
                <p className="text-[11px] text-faint mt-1">
                  Sell a package on the left and it will show up here for session punching.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line max-h-[560px] overflow-y-auto">
                {subscriptions.map((sub) => {
                  const meta = PT_STATUS_META[sub.status];
                  const done = sub.completed_sessions >= sub.total_sessions;
                  const pct = sub.total_sessions
                    ? Math.min(100, Math.round((sub.completed_sessions / sub.total_sessions) * 100))
                    : 0;
                  const dLeft = daysUntilDate(sub.end_date);
                  const busy = busyId === sub.id;

                  return (
                    <div key={sub.id} className="p-4 hover:bg-surface/60 transition">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm truncate">
                              {sub.member_name ?? 'Member'}
                            </p>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.badge}`}
                            >
                              {meta.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted mt-0.5">
                            {sub.trainer_name ?? 'Unassigned trainer'} &middot;{' '}
                            {formatRupees(sub.amount_paid)} &middot; sold {formatStamp(sub.created_at)}
                          </p>
                          <p className="text-[10px] text-faint mt-0.5">
                            {sub.start_date} &rarr; {sub.end_date}
                            {sub.status === 'active' && dLeft >= 0 && (
                              <span className={dLeft <= 7 ? ' text-amber-400' : ''}>
                                {' '}
                                &middot; {dLeft} day{dLeft === 1 ? '' : 's'} left
                              </span>
                            )}
                            {sub.status === 'active' && dLeft < 0 && (
                              <span className="text-rose-400"> &middot; expired</span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-sm font-bold text-ink">
                              {sub.completed_sessions}
                              <span className="text-faint"> / {sub.total_sessions}</span>
                            </p>
                            <p className="text-[10px] text-faint">sessions</p>
                          </div>
                          <button
                            onClick={() => punchSession(sub)}
                            disabled={busy || done || sub.status !== 'active'}
                            title={
                              done
                                ? 'All sessions used'
                                : sub.status !== 'active'
                                  ? 'Only active packages can be punched'
                                  : 'Log one session'
                            }
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 border border-blue-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            Punch
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 h-1.5 rounded-full bg-wash overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            done ? 'bg-emerald-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>


      {/* Add / edit trainer */}
      {trainerFormId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-line bg-surface rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-wash text-ink-2">
                  {trainerFormId ? <Pencil className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-bold">
                    {trainerFormId ? 'Edit trainer' : 'Add a trainer'}
                  </h3>
                  <p className="text-[11px] text-muted">
                    Commission is a percentage of every PT package they sell.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTrainerFormId(null)}
                className="p-1.5 rounded-lg bg-wash hover:bg-line-strong text-muted hover:text-ink transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={saveTrainer} className="p-5 space-y-3">
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                  Name
                </label>
                <input
                  required
                  value={trainerForm.name}
                  onChange={(e) => setTrainerForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Ravi Menon"
                  className="w-full vy-input-sm text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                  Phone
                </label>
                <input
                  required
                  value={trainerForm.phone}
                  onChange={(e) => setTrainerForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="9876543210"
                  className="w-full vy-input-sm text-sm font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                  Specialization
                </label>
                <select
                  value={trainerForm.specialization}
                  onChange={(e) =>
                    setTrainerForm((prev) => ({ ...prev, specialization: e.target.value }))
                  }
                  className="w-full vy-input-sm text-sm focus:outline-none focus:border-amber-500"
                >
                  {TRAINER_SPECIALITIES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                  Commission %
                </label>
                <input
                  required
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={trainerForm.commission_rate_percent}
                  onChange={(e) =>
                    setTrainerForm((prev) => ({
                      ...prev,
                      commission_rate_percent: e.target.value,
                    }))
                  }
                  className="w-full vy-input-sm text-sm font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setTrainerFormId(null)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-wash hover:bg-line-strong text-ink-2 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTrainer}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-black transition disabled:opacity-50"
                >
                  {savingTrainer ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  {trainerFormId ? 'Save changes' : 'Add trainer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

