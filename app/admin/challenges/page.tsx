'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flame, Loader2, Plus, Scale, Target, Trash2, Trophy, Users, X } from 'lucide-react';
import { isUuid, readSession } from '@/lib/session';
import PageHeader from '@/components/page-header';
import {
  challengeUnit,
  createChallenge,
  deleteChallenge,
  listChallengesForOwner,
  progressPercent,
  type Challenge,
  type ChallengeKind,
} from '@/lib/gamification';

/**
 * /admin/challenges — the owner console for the challenge engine (Module 29).
 *
 * Deliberately dark like the rest of the owner console (/leads, /hardware): the
 * staff side and the member side are different products, and a receptionist who
 * hands the phone to a member should see a clearly different surface.
 *
 * Writes go through /api/challenges, which scopes every row to the session
 * tenant — there is no tenant id in the form, only in the session.
 */

const INPUT =
  'w-full rounded-xl border border-line bg-surface rounded-xl px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-amber-500';

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function inThirtyDaysIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset + 30 * 86_400_000).toISOString().slice(0, 10);
}

const EMPTY_FORM = {
  title: '',
  kind: 'attendance' as ChallengeKind,
  description: '',
  start_date: todayIso(),
  end_date: inThirtyDaysIso(),
  target_value: '30',
};

const KINDS: { id: ChallengeKind; label: string; icon: typeof Flame; hint: string }[] = [
  {
    id: 'attendance',
    label: 'Attendance',
    icon: Flame,
    hint: 'Counts granted gate check-ins inside the window.',
  },
  {
    id: 'weight_loss',
    label: 'Weight Loss',
    icon: Scale,
    hint: 'Kilograms lost against the weigh-in captured at join.',
  },
];

/** One challenge card in the owner table. */
function ChallengeRow({
  challenge,
  onDelete,
  busy,
}: {
  challenge: Challenge;
  onDelete: (challenge: Challenge) => Promise<void>;
  busy: boolean;
}) {
  const Icon = challenge.kind === 'weight_loss' ? Scale : Flame;
  const accent = challenge.kind === 'weight_loss' ? 'text-orange-400' : 'text-teal-400';

  // The owner side has no member id, so the "average" bar is the honest
  // summary: how far the cohort has got toward the target.
  const joined = challenge.participants;
  const barPercent = challenge.is_active
    ? progressPercent(Math.min(challenge.my_progress ?? 0, challenge.target_value), challenge.target_value)
    : 100;

  return (
    <article className="vy-card p-4">
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-xl bg-wash ${accent}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[13px] font-semibold tracking-tight text-ink leading-tight">
              {challenge.title}
            </h3>
            <button
              onClick={() => void onDelete(challenge)}
              disabled={busy}
              title="Delete challenge"
              aria-label={`Delete ${challenge.title}`}
              className="shrink-0 rounded-lg border border-line bg-surface p-1.5 text-faint hover:text-rose-400 transition disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="mt-0.5 text-[11px] text-faint">
            {challenge.start_date} → {challenge.end_date}
          </p>
        </div>
      </div>

      {challenge.description && (
        <p className="mt-2.5 text-xs leading-relaxed text-muted">{challenge.description}</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <p className="text-faint">Target</p>
          <p className="font-bold text-ink">
            {challenge.target_value} {challengeUnit(challenge.kind)}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <p className="text-faint">Joined</p>
          <p className="flex items-center gap-1 font-bold text-ink">
            <Users className="w-3 h-3 text-faint" /> {joined}
          </p>
        </div>
      </div>

      {challenge.is_active && joined > 0 && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-wash">
            <div
              className="h-full rounded-full bg-amber-500 transition-[width] duration-700"
              style={{ width: `${barPercent}%` }}
            />
          </div>
        </div>
      )}

      <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {challenge.is_active ? 'Live for members now' : 'Closed'}
      </p>
    </article>
  );
}

export default function AdminChallengesPage() {
  const router = useRouter();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ message: string; kind: 'ok' | 'bad' } | null>(null);

  /**
   * The gym's id (the write scope) and its display name, read from the same
   * session object — so they are set together, once.
   */
  const [context, setContext] = useState<{ tenantId: string | null; gymName: string | null }>({
    tenantId: null,
    gymName: null,
  });
  const { tenantId, gymName } = context;

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const session = readSession();
    if (!session) {
      router.push('/login');
      return;
    }
    if (session.role === 'member') {
      router.replace('/member/dashboard');
      return;
    }
    // One write: the gym name is presentation and the tenant id is the scope,
    // but they are read from the same object at the same instant.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContext({
      tenantId: isUuid(session.tenantId) ? session.tenantId : null,
      gymName: session.tenantName ?? null,
    });
  }, [router]);

  const reload = useCallback(async (tenant: string) => {
    const result = await listChallengesForOwner(tenant);

    if (!result.ok) {
      setChallenges([]);
      setNotice({ message: result.error ?? 'Could not load challenges.', kind: 'bad' });
    } else {
      setChallenges(result.challenges);
    }

    // Cleared last so the skeleton covers the whole round trip.
    setLoading(false);
  }, []);

  // No setLoading(true) here on purpose: `loading` starts true, and a reload
  // triggered by a create/delete already has the button's own spinner.
  //
  // reload() is async, so every setState it makes lands after the render has
  // committed; the rule cannot see that through the call boundary.
  useEffect(() => {
    if (!tenantId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload(tenantId);
  }, [reload, tenantId]);

  function openForm() {
    // Re-seeded on every open: a stale date from last month is the classic
    // "I launched a challenge that already ended" bug.
    setForm({
      ...EMPTY_FORM,
      start_date: todayIso(),
      end_date: inThirtyDaysIso(),
      target_value: form.kind === 'attendance' ? '30' : '5',
    });
    setFormOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!tenantId) return;

    const target = Number(form.target_value);
    if (!Number.isFinite(target) || target <= 0) {
      setNotice({ message: 'Target must be a positive number.', kind: 'bad' });
      return;
    }

    setSaving(true);
    const result = await createChallenge(tenantId, {
      title: form.title.trim(),
      kind: form.kind,
      description: form.description.trim() || null,
      startDate: form.start_date,
      endDate: form.end_date,
      targetValue: target,
    });
    setSaving(false);

    if (!result.ok) {
      setNotice({ message: result.error ?? 'Could not launch this challenge.', kind: 'bad' });
      return;
    }

    setFormOpen(false);
    setNotice({ message: `${form.title.trim()} is live.`, kind: 'ok' });
    await reload(tenantId);
  }

  async function remove(challenge: Challenge) {
    if (!tenantId) return;
    if (!window.confirm(`Delete "${challenge.title}"? Members already joined will lose their progress.`)) {
      return;
    }

    setBusyId(challenge.id);
    const result = await deleteChallenge(tenantId, challenge.id);
    setBusyId(null);

    if (!result.ok) {
      setNotice({ message: result.error ?? 'Could not delete that challenge.', kind: 'bad' });
      return;
    }
    setNotice({ message: `${challenge.title} deleted.`, kind: 'ok' });
    await reload(tenantId);
  }

  const active = challenges.filter((challenge) => challenge.is_active);
  const closed = challenges.filter((challenge) => !challenge.is_active);
  const totalParticipants = challenges.reduce((sum, challenge) => sum + challenge.participants, 0);

  return (
    <div className="vy-page vy-noscroll font-sans">
      <div className="vy-shell-wide">
        <PageHeader
          icon={<Trophy className="h-5 w-5" />}
          title="Gym Challenges"
          subtitle={`${gymName || 'Your gym'} · ${active.length} running · ${totalParticipants} members engaged`}
          actions={
            <button onClick={openForm} className="vy-btn vy-btn-lg vy-btn-brand self-start">
              <Plus className="w-4 h-4" /> Launch Challenge
            </button>
          }
        />
        {notice && (
          <div
            role="status"
            className={`vy-notice !px-3.5 !py-2.5 text-xs ${
              notice.kind === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-700'
            }`}
          >
            {notice.message}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading challenges…
          </div>
        ) : challenges.length === 0 ? (
          <div className="vy-card p-12 text-center">
            <Trophy className="mx-auto mb-3 w-9 h-9 text-faint" />
            <p className="text-sm font-bold text-ink-2">No challenges yet</p>
            <p className="mt-1 text-[11px] text-faint">
              Launch a 30-Day Attendance or Weight-Loss challenge and watch the floor light up.
            </p>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <section>
                <h2 className="mb-2.5 text-[11px] uppercase tracking-wider text-muted">
                  Running now
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {active.map((challenge) => (
                    <ChallengeRow
                      key={challenge.id}
                      challenge={challenge}
                      onDelete={remove}
                      busy={busyId === challenge.id}
                    />
                  ))}
                </div>
              </section>
            )}

            {closed.length > 0 && (
              <section>
                <h2 className="mb-2.5 text-[11px] uppercase tracking-wider text-muted">
                  Finished
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {closed.map((challenge) => (
                    <ChallengeRow
                      key={challenge.id}
                      challenge={challenge}
                      onDelete={remove}
                      busy={busyId === challenge.id}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Launch modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Launch a challenge"
          onClick={() => setFormOpen(false)}
        >
          <form
            onSubmit={submit}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-black tracking-tight">Launch a Challenge</h2>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                aria-label="Close"
                className="rounded-xl border border-line bg-surface p-2 text-muted hover:text-ink transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                  Title
                </label>
                <input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="30-Day Beast Mode"
                  maxLength={120}
                  required
                  minLength={3}
                  className={INPUT}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                  Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {KINDS.map((entry) => {
                    const Icon = entry.icon;
                    const selected = form.kind === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            kind: entry.id,
                            target_value: entry.id === 'attendance' ? '30' : '5',
                          })
                        }
                        aria-pressed={selected}
                        className={`rounded-xl border p-3 text-left transition ${
                          selected
                            ? 'border-amber-500 bg-amber-500/10'
                            : 'border-line bg-surface hover:border-line-strong'
                        }`}
                      >
                        <Icon
                          className={`mb-1.5 w-5 h-5 ${selected ? 'text-amber-400' : 'text-faint'}`}
                        />
                        <p className="text-[11px] font-semibold text-ink">{entry.label}</p>
                        <p className="mt-0.5 text-[10px] leading-snug text-faint">{entry.hint}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                  Description (optional)
                </label>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="Train every day for 30 days. Highest attendance wins the wall of fame."
                  maxLength={500}
                  rows={3}
                  className={`${INPUT} resize-none`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(event) => setForm({ ...form, start_date: event.target.value })}
                    required
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                    End date
                  </label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(event) => setForm({ ...form, end_date: event.target.value })}
                    required
                    className={INPUT}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                  Target ({challengeUnit(form.kind)})
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={form.target_value}
                  onChange={(event) => setForm({ ...form, target_value: event.target.value })}
                  required
                  className={INPUT}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="vy-btn vy-btn-lg vy-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 px-5 py-2.5 text-xs font-bold text-black transition disabled:opacity-60"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Launch Challenge
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
