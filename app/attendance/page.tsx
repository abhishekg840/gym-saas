'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Fingerprint,
  QrCode,
  RefreshCw,
  Search,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { isUuid, readSession } from '@/lib/session';
import {
  LIVE_STATUS_META,
  gymClock,
  gymStamp,
  initialsOf,
  relativeTime,
  useLiveAttendance,
  type LiveStatus,
} from '@/lib/live-attendance';

/**
 * Live Member Entries — the desk's "who is walking in right now" board.
 *
 * Previously a one-shot fetch on mount, so the list only ever changed when the
 * page was reloaded — which for a screen whose whole job is "who walked in right
 * now" is the same as being broken. All the data handling now lives in
 * useLiveAttendance (realtime + visibility recovery + a polling floor); this
 * file is presentation only.
 */

/**
 * Member-facing names for the stored check-in methods. The raw database values
 * (`qr_kiosk`, `qr_geofence`, `biometric_rfid`) are an implementation detail, so
 * they never reach the screen.
 */
const METHOD_META: Record<string, { label: string; tone: string }> = {
  qr_kiosk: { label: 'Gate QR', tone: 'vy-chip-emerald' },
  qr_geofence: { label: 'Gate QR', tone: 'vy-chip-emerald' },
  qr: { label: 'Gate QR', tone: 'vy-chip-emerald' },
  manual: { label: 'Front Desk', tone: 'vy-chip-blue' },
  biometric: { label: 'Fingerprint', tone: 'vy-chip-amber' },
  biometric_rfid: { label: 'Fingerprint', tone: 'vy-chip-amber' },
  rfid_card: { label: 'RFID Card', tone: 'vy-chip-amber' },
  rfid: { label: 'RFID Card', tone: 'vy-chip-amber' },
  hardware_punch: { label: 'Gate Reader', tone: 'vy-chip-blue' },
  gate: { label: 'Gate Reader', tone: 'vy-chip-blue' },
  mobile_geo: { label: 'App Check-in', tone: 'vy-chip-emerald' },
  geofence: { label: 'App Check-in', tone: 'vy-chip-emerald' },
};

function methodMeta(method: string) {
  return (
    METHOD_META[method] ?? {
      label: 'Gate Reader',
      tone: 'vy-chip-blue',
    }
  );
}

function MethodIcon({ method }: { method: string }) {
  if (method === 'qr' || method.startsWith('qr_')) return <QrCode className="h-3 w-3" />;
  if (method.startsWith('biometric') || method.startsWith('rfid')) {
    return <Fingerprint className="h-3 w-3" />;
  }
  return <UserCheck className="h-3 w-3" />;
}

export default function AttendanceLogsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // localStorage only exists in the browser, so the tenant id can only arrive
  // after hydration — the same reason the member dashboard defers its session.
  useEffect(() => {
    const session = readSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTenantId(isUuid(session?.tenantId) ? session.tenantId : null);
  }, []);

  const { rows, loading, status, scopeError, refresh } = useLiveAttendance(tenantId);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((log) => {
      const name = log.member?.full_name?.toLowerCase() ?? '';
      const phone = log.member?.phone ?? '';
      const bio = log.member?.biometric_id?.toString() ?? '';
      return name.includes(q) || phone.includes(q) || bio.includes(q);
    });
  }, [rows, searchTerm]);

  const statusMeta = LIVE_STATUS_META[status as LiveStatus];

  return (
    <div className="vy-page vy-noscroll">
      <div className="vy-shell">
        {/* Header */}
        <div className="flex flex-col gap-4 pb-5 pt-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/admin"
              title="Back to console"
              className="vy-icon-btn shrink-0 border border-line"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-wash text-ink-2">
              <UserCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[17px] font-semibold tracking-tight text-ink">
                Live Member Entries
              </h1>
              <p className="truncate text-[12px] text-muted">
                Who walked in, through which gate, and when
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {/* Live-state chip. The dot carries the signal; the word names it,
                so "polling" is never a mystery to a receptionist. */}
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusMeta.dot}`} />
              <span className={statusMeta.text}>{statusMeta.label}</span>
            </span>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
              />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, phone or bio ID"
                aria-label="Search entries"
                className="vy-input w-full pl-8 sm:w-64"
              />
            </div>

            <button
              onClick={refresh}
              className="vy-btn vy-btn-secondary"
              title="Fetch the newest entries now"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {scopeError && <p className="vy-notice vy-notice-bad mb-4">{scopeError}</p>}

<div className="vy-card overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-muted">Loading entries…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <UserCheck className="mx-auto mb-3 h-8 w-8 text-faint" />
              <p className="text-sm font-semibold text-ink">
                {searchTerm ? 'No entries match that search' : 'No check-ins recorded yet'}
              </p>
              <p className="mt-1 text-xs text-muted">
                {searchTerm
                  ? 'Try a different name, number or bio ID.'
                  : 'Entries appear here the moment a member taps in.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {filtered.map((log) => {
                const meta = methodMeta(log.method);
                const granted = log.status === 'granted';
                return (
                  <li
                    key={log.id}
                    className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-subtle"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-wash text-[11px] font-semibold text-ink-2">
                      {initialsOf(log.member?.full_name)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink">
                        {log.member?.full_name ?? 'Unknown member'}
                      </p>
                      <p className="truncate text-[11px] tabular-nums text-faint">
                        {log.member?.phone ?? 'No number on file'}
                        {log.member?.biometric_id ? ` · Bio #${log.member.biometric_id}` : ''}
                      </p>
                    </div>

                    <span className={`vy-chip hidden shrink-0 sm:inline-flex ${meta.tone}`}>
                      <MethodIcon method={log.method} />
                      {meta.label}
                    </span>

                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-semibold tabular-nums text-ink-2">
                        {gymClock(log.punch_time)}
                      </p>
                      <p className="text-[10px] text-faint">{relativeTime(log.punch_time)}</p>
                    </div>

                    {granted ? (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-emerald-600"
                        aria-label="Access granted"
                      />
                    ) : (
                      <XCircle
                        className="h-4 w-4 shrink-0 text-rose-600"
                        aria-label={`Access ${log.status.replace(/_/g, ' ')}`}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {rows.length > 0 && (
          <p className="mt-3 text-[11px] text-faint">
            Showing {filtered.length} of the {rows.length} most recent entries
            {searchTerm && ` matching “${searchTerm}”`}. Times are gym local (IST); the
            latest was {gymStamp(rows[0].punch_time)}.
          </p>
        )}
      </div>
    </div>
  );
}
