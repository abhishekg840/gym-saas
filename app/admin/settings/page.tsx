'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  Loader2,
  Megaphone,
  Pin,
  PinOff,
  Plus,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { isUuid, readSession } from '@/lib/session';
import PageHeader from '@/components/page-header';
import {
  DAY_KEYS,
  DAY_LABELS,
  DEFAULT_OPERATING_HOURS,
  formatClock,
  loadOperatingHours,
  saveOperatingHours,
  type DayKey,
  type OperatingHours,
} from '@/lib/settings';
import {
  NOTICE_TYPES,
  deleteAnnouncement,
  endOfDayIso,
  isoToDateInput,
  listAnnouncements,
  noticeTone,
  saveAnnouncement,
  type Announcement,
  type NoticeType,
} from '@/lib/announcements';

/**
 * /admin/settings — the two owner tools the member app used to be missing.
 *
 *   1. Gym Announcements  (Module 4.1.3) — until this screen existed there was
 *      NO write path for a notice at all: the table is revoked from PostgREST
 *      and Phase 4 only defined a member reader. Members saw "No notices"
 *      because publishing one was impossible, not because the widget was broken.
 *
 *   2. Operating Hours    (Module 4.1.2) — the schedule behind the member app's
 *      "Open now / Closed" indicator, which used to be a hardcoded 05:00-23:00.
 *
 * Dark like the rest of the owner console (/leads, /admin/challenges): handing
 * the desk phone to a member should clearly change product.
 */

const INPUT =
  'w-full rounded-xl border border-line bg-surface rounded-xl px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-amber-500';

const EMPTY_NOTICE = {
  id: null as string | null,
  title: '',
  body: '',
  type: 'general' as NoticeType,
  is_pinned: false,
  is_published: true,
  expires: '',
};

/** One day of the weekly schedule: a Closed toggle and two time inputs. */
function DayEditor({
  dayKey,
  day,
  onPatch,
}: {
  dayKey: DayKey;
  day: OperatingHours[DayKey];
  onPatch: (patch: Partial<OperatingHours[DayKey]>) => void;
}) {
  return (
    <div
      className={`vy-card p-3.5 ${
        day.closed ? 'border-line bg-subtle' : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-[11px] font-semibold text-ink">{DAY_LABELS[dayKey]}</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-muted">
          <input
            type="checkbox"
            checked={day.closed}
            onChange={(event) => onPatch({ closed: event.target.checked })}
            className="w-3.5 h-3.5 rounded accent-neutral-600"
          />
          Closed
        </label>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={day.open}
          disabled={day.closed}
          onChange={(event) => onPatch({ open: event.target.value })}
          aria-label={`${DAY_LABELS[dayKey]} opening time`}
          className="w-full vy-input-sm disabled:opacity-40"
        />
        <span className="text-faint text-xs">&ndash;</span>
        <input
          type="time"
          value={day.close}
          disabled={day.closed}
          onChange={(event) => onPatch({ close: event.target.value })}
          aria-label={`${DAY_LABELS[dayKey]} closing time`}
          className="w-full vy-input-sm disabled:opacity-40"
        />
      </div>

      <p className="mt-2 text-[10px] text-faint">
        {day.closed
          ? 'Rest day'
          : `${formatClock(day.open)} – ${formatClock(day.close)}`}
      </p>
    </div>
  );
}

/** One notice row: badges, body, and the four one-tap actions. */
function NoticeRow({
  item,
  busy,
  now,
  onEdit,
  onTogglePin,
  onTogglePublish,
  onDelete,
}: {
  item: Announcement;
  busy: boolean;
  /**
   * `Date.now()` passed down rather than read during render.
   *
   * A render is supposed to be pure: reading the clock inside it makes the output
   * depend on WHEN it ran, so two renders with identical props can disagree. The
   * parent owns the timestamp, which also means every row on the page expires
   * against the same instant instead of each doing its own.
   */
  now: number;
  onEdit: () => void;
  onTogglePin: () => void;
  onTogglePublish: () => void;
  onDelete: () => void;
}) {
  const expired = item.expires_at ? new Date(item.expires_at).getTime() < now : false;

  return (
    <li
      className={`rounded-2xl border p-4 ${
        item.is_published ? 'border-line bg-surface' : 'border-line bg-subtle'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {item.is_pinned && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                <Pin className="w-3 h-3" /> Pinned
              </span>
            )}
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${noticeTone(item.type)}`}>
              {NOTICE_TYPES.find((t) => t.id === item.type)?.label ?? item.type}
            </span>
            {!item.is_published && (
              <span className="rounded-md border border-line-strong bg-wash px-1.5 py-0.5 text-[10px] font-bold text-muted">
                Draft
              </span>
            )}
            {expired && item.is_published && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                <AlertTriangle className="w-3 h-3" /> Expired
              </span>
            )}
          </div>

          <h3 className="mt-1.5 text-[13px] font-semibold text-ink">{item.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted whitespace-pre-wrap">
            {item.body}
          </p>
          <p className="mt-2 text-[10px] text-faint">
            Posted {new Date(item.created_at).toLocaleString('en-IN')}
            {item.expires_at && ` · expires ${new Date(item.expires_at).toLocaleDateString('en-IN')}`}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            onClick={onTogglePin}
            disabled={busy}
            title={item.is_pinned ? 'Unpin' : 'Pin to top'}
            className="vy-icon-btn-sm border border-line bg-surface hover:text-amber-600 disabled:opacity-50"
          >
            {item.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onTogglePublish}
            disabled={busy}
            title={item.is_published ? 'Unpublish' : 'Publish'}
            className={`p-2 rounded-lg border transition disabled:opacity-50 ${
              item.is_published
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-line bg-surface text-faint hover:text-ink'
            }`}
          >
            {item.is_published ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onEdit}
            disabled={busy}
            className="vy-btn !px-3 !py-1.5 text-[11px] border border-line bg-surface hover:border-line-strong disabled:opacity-50"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            title="Delete notice"
            className="p-2 rounded-lg border border-line bg-surface text-faint hover:text-rose-400 hover:border-rose-500/30 transition disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [gymName, setGymName] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; kind: 'ok' | 'bad' } | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- announcements -------------------------------------------------------
  const [notices, setNotices] = useState<Announcement[]>([]);
  const [form, setForm] = useState(EMPTY_NOTICE);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * A single timestamp for the whole page, stamped on every load.
   *
   * Reading the clock inside NoticeRow's render would make the output depend on
   * WHEN React happened to run, so two renders with identical props could
   * disagree. Worse, an expiry badge could silently flip to "Expired" while the
   * owner was reading the list. One stamp per load keeps every row agreed.
   *
   * 0 means "not loaded yet", and is never compared against — the list is empty
   * until load() has run.
   */
  const [now, setNow] = useState<number>(0);

  // ---- operating hours ------------------------------------------------------
  const [hours, setHours] = useState<OperatingHours>(DEFAULT_OPERATING_HOURS);
  const [hoursSaved, setHoursSaved] = useState<OperatingHours>(DEFAULT_OPERATING_HOURS);
  const [hoursBusy, setHoursBusy] = useState(false);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGymName(session.tenantName ?? null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTenantId(isUuid(session.tenantId) ? session.tenantId : null);
  }, [router]);

  const load = useCallback(async (tenant: string) => {
    const [noticeResult, hoursResult] = await Promise.all([
      listAnnouncements(tenant),
      loadOperatingHours(tenant),
    ]);

    setNotices(noticeResult.announcements);
    setHours(hoursResult.hours);
    setHoursSaved(hoursResult.hours);
    // The expiry badges are judged against this instant, captured once per load
    // so every row on the page agrees.
    setNow(Date.now());

    // Only surface a failure when there was nothing to show; an empty board on a
    // fresh install is a normal first run, not an error.
    if (!noticeResult.ok && noticeResult.announcements.length === 0) {
      setNotice({ message: noticeResult.error ?? 'Could not load notices.', kind: 'bad' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tenantId) {
      // load() is async, so its setState calls all land after this render has
      // committed; the rule cannot see that through the call boundary.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load(tenantId);
    }
  }, [tenantId, load]);

  const hoursDirty = useMemo(
    () => DAY_KEYS.some((key) => JSON.stringify(hours[key]) !== JSON.stringify(hoursSaved[key])),
    [hours, hoursSaved]
  );

  function patchDay(key: DayKey, patch: Partial<OperatingHours[DayKey]>) {
    setHours((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function openNewNotice() {
    setForm(EMPTY_NOTICE);
    setFormOpen(true);
  }

  function openEditNotice(target: Announcement) {
    setForm({
      id: target.id,
      title: target.title,
      body: target.body,
      type: (NOTICE_TYPES.find((entry) => entry.id === target.type)?.id ?? 'general') as NoticeType,
      is_pinned: target.is_pinned,
      is_published: target.is_published,
      expires: isoToDateInput(target.expires_at),
    });
    setFormOpen(true);
  }

  async function submitNotice(event: React.FormEvent) {
    event.preventDefault();
    if (!tenantId) return;

    setSaving(true);
    const result = await saveAnnouncement(tenantId, {
      id: form.id,
      title: form.title,
      body: form.body,
      type: form.type,
      is_pinned: form.is_pinned,
      is_published: form.is_published,
      // End-of-day so a notice set to expire "today" lasts the day the owner
      // actually picked, instead of vanishing at midnight.
      expires_at: endOfDayIso(form.expires),
    });
    setSaving(false);

    if (!result.ok) {
      setNotice({ message: result.error ?? 'Could not save that notice.', kind: 'bad' });
      return;
    }

    setFormOpen(false);
    setNotice({ message: form.id ? 'Notice updated.' : 'Notice published to members.', kind: 'ok' });
    await load(tenantId);
  }

  /** Pin/unpublish are one-tap toggles that re-save the whole notice. */
  async function toggleFlag(target: Announcement, flag: 'is_pinned' | 'is_published') {
    if (!tenantId) return;
    setBusyId(target.id);

    const result = await saveAnnouncement(tenantId, {
      id: target.id,
      title: target.title,
      body: target.body,
      type: (NOTICE_TYPES.find((entry) => entry.id === target.type)?.id ?? 'general') as NoticeType,
      is_pinned: flag === 'is_pinned' ? !target.is_pinned : target.is_pinned,
      is_published: flag === 'is_published' ? !target.is_published : target.is_published,
      expires_at: target.expires_at,
    });
    setBusyId(null);

    if (!result.ok) {
      setNotice({ message: result.error ?? 'Could not update that notice.', kind: 'bad' });
      return;
    }
    await load(tenantId);
  }

  async function removeNotice(target: Announcement) {
    if (!tenantId) return;
    if (!window.confirm(`Delete "${target.title}"? Members will stop seeing it immediately.`)) {
      return;
    }

    setBusyId(target.id);
    const result = await deleteAnnouncement(tenantId, target.id);
    setBusyId(null);

    if (!result.ok) {
      setNotice({ message: result.error ?? 'Could not delete that notice.', kind: 'bad' });
      return;
    }
    setNotice({ message: 'Notice deleted.', kind: 'ok' });
    await load(tenantId);
  }

  async function submitHours(event: React.FormEvent) {
    event.preventDefault();
    if (!tenantId) return;

    setHoursBusy(true);
    const result = await saveOperatingHours(tenantId, hours);
    setHoursBusy(false);

    if (!result.ok) {
      setNotice({ message: result.error ?? 'Could not save your hours.', kind: 'bad' });
      return;
    }
    setHours(result.hours);
    setHoursSaved(result.hours);
    setNotice({ message: 'Opening hours saved. Members see the change immediately.', kind: 'ok' });
  }

  return (
    <div className="vy-page vy-noscroll font-sans">
      <div className="vy-shell">
        <PageHeader
          icon={<Settings className="h-5 w-5" />}
          title="Gym Settings"
          subtitle={`${gymName || 'Your gym'} · announcements & opening hours`}
          actions={
            <button onClick={openNewNotice} className="vy-btn vy-btn-lg vy-btn-brand self-start">
              <Plus className="h-4 w-4" /> New Notice
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

        {/* ---- Gym announcements ------------------------------------------- */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-black tracking-tight">Gym Announcements</h2>
            <span className="text-[11px] text-faint">
              {notices.length} total &middot; {notices.filter((n) => n.is_published).length} live
            </span>
          </div>
          <p className="text-[11px] text-faint mb-4 max-w-3xl">
            These appear on every member&apos;s Home tab, pinned notices first. Unpublish
            hides a notice without deleting it, and an expiry removes it automatically.
          </p>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading settings…
            </div>
          ) : notices.length === 0 ? (
            <div className="vy-empty p-10 text-center">
              <Bell className="mx-auto mb-3 w-9 h-9 text-faint" />
              <p className="text-sm font-bold text-ink-2">No notices yet</p>
              <p className="mt-1 text-[11px] text-faint">
                Members currently see &ldquo;No notices from the gym today&rdquo;.
              </p>
              <button
                onClick={openNewNotice}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-xl text-xs transition"
              >
                <Plus className="w-4 h-4" /> Write the first one
              </button>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {notices.map((item) => (
                <NoticeRow
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  now={now}
                  onEdit={() => openEditNotice(item)}
                  onTogglePin={() => void toggleFlag(item, 'is_pinned')}
                  onTogglePublish={() => void toggleFlag(item, 'is_published')}
                  onDelete={() => void removeNotice(item)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ---- Operating hours ---------------------------------------------- */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-black tracking-tight">Operating Hours</h2>
          </div>
          <p className="text-[11px] text-faint mb-4 max-w-3xl">
            Drives the &ldquo;Open now / Closed&rdquo; indicator on every member&apos;s
            Home tab and gate pass. Times are the gym&apos;s local time (IST). Tick
            &ldquo;Closed&rdquo; for a rest day — the hours you set are remembered, so
            un-ticking restores them.
          </p>

          <form onSubmit={submitHours}>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {DAY_KEYS.map((key) => (
                <DayEditor
                  key={key}
                  dayKey={key}
                  day={hours[key]}
                  onPatch={(patch) => patchDay(key, patch)}
                />
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[11px] text-faint">
                {hoursDirty
                  ? 'Unsaved changes — members still see the previous schedule.'
                  : 'Saved. Members see this schedule.'}
              </p>
              <button
                type="submit"
                disabled={!hoursDirty || hoursBusy}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-bold rounded-xl text-xs transition"
              >
                {hoursBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CalendarClock className="w-3.5 h-3.5" />
                )}
                Save Hours
              </button>
            </div>
          </form>
        </section>
      </div>

      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={form.id ? 'Edit notice' : 'New notice'}
          onClick={() => setFormOpen(false)}
        >
          <form
            onSubmit={submitNotice}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-black tracking-tight">
                {form.id ? 'Edit Notice' : 'New Notice'}
              </h2>
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
                  placeholder="New Personal Training Slots"
                  maxLength={140}
                  required
                  minLength={3}
                  className={INPUT}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                  Notice
                </label>
                <textarea
                  value={form.body}
                  onChange={(event) => setForm({ ...form, body: event.target.value })}
                  placeholder="Four new PT slots open this Sunday. Book at the desk."
                  maxLength={2000}
                  rows={4}
                  required
                  className={`${INPUT} resize-none`}
                />
                <p className="mt-1 text-[10px] text-faint">
                  {form.body.length}/2000
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                    Type
                  </label>
                  <select
                    value={form.type}
                    onChange={(event) =>
                      setForm({ ...form, type: event.target.value as NoticeType })
                    }
                    className={INPUT}
                  >
                    {NOTICE_TYPES.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">
                    Expires (optional)
                  </label>
                  <input
                    type="date"
                    value={form.expires}
                    onChange={(event) => setForm({ ...form, expires: event.target.value })}
                    className={INPUT}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 rounded-xl border border-line bg-surface p-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-2">
                  <input
                    type="checkbox"
                    checked={form.is_pinned}
                    onChange={(event) => setForm({ ...form, is_pinned: event.target.checked })}
                    className="w-3.5 h-3.5 rounded accent-amber-500"
                  />
                  Pin to top
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-2">
                  <input
                    type="checkbox"
                    checked={form.is_published}
                    onChange={(event) => setForm({ ...form, is_published: event.target.checked })}
                    className="w-3.5 h-3.5 rounded accent-emerald-500"
                  />
                  Visible to members
                </label>
              </div>
              <p className="text-[10px] text-faint">
                Leave the expiry empty for a standing notice. A dated notice is hidden
                automatically at the end of the day you picked.
              </p>
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
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 px-5 py-2.5 text-xs font-bold text-black transition disabled:opacity-60"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {form.is_published ? 'Save & Publish' : 'Save Draft'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}