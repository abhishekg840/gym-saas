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
  qr_kiosk: { label: 'Gate QR', tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' },
  qr_geofence: { label: 'Gate QR', tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' },
  qr: { label: 'Gate QR', tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' },
  manual: { label: 'Front Desk', tone: 'bg-violet-500/10 text-violet-300 border-violet-500/25' },
  biometric: { label: 'Fingerprint', tone: 'bg-sky-500/10 text-sky-300 border-sky-500/25' },
  biometric_rfid: { label: 'Fingerprint', tone: 'bg-sky-500/10 text-sky-300 border-sky-500/25' },
  rfid_card: { label: 'RFID Card', tone: 'bg-sky-500/10 text-sky-300 border-sky-500/25' },
  rfid: { label: 'RFID Card', tone: 'bg-sky-500/10 text-sky-300 border-sky-500/25' },
  hardware_punch: { label: 'Gate Reader', tone: 'bg-amber-500/10 text-amber-300 border-amber-500/25' },
  gate: { label: 'Gate Reader', tone: 'bg-amber-500/10 text-amber-300 border-amber-500/25' },
  mobile_geo: { label: 'App Check-in', tone: 'bg-teal-500/10 text-teal-300 border-teal-500/25' },
  geofence: { label: 'App Check-in', tone: 'bg-teal-500/10 text-teal-300 border-teal-500/25' },
};

function methodMeta(method: string) {
  return (
    METHOD_META[method] ?? {
      label: 'Gate Reader',
      tone: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
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
    <main className="min-h-screen bg-zinc-950 text-white p-6 sm:p-12 font-sans">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="p-2.5 rounded-xl bg-zinc-900/80 backdrop-blur-md border border-white/10 text-zinc-400 hover:text-white hover:border-emerald-500/40 active:scale-95 transition-all duration-150"
            aria-label="Back to the dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Live Member Entries</h1>
            <p className="text-xs text-zinc-400 font-medium flex items-center gap-2">
              Check-ins from the gate and front desk
              {/* The dot is the honest answer to "why isn't this updating?":
                  Live means the socket is healthy, Auto-refresh means the poll is
                  carrying it. Silently showing stale data is what made the old
                  version impossible to trust. */}
              <span
                className={`inline-flex items-center gap-1 rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] font-bold ${statusMeta.tone}`}
                title={
                  status === 'live'
                    ? 'Connected — new check-ins appear instantly'
                    : 'Socket unavailable — refreshing every 10 seconds'
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    status === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}
                />
                {statusMeta.label}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search member, phone, bio ID..."
              className="w-full bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/60"
            />
          </div>
          <button
            onClick={() => void refresh()}
            title="Refresh now"
            aria-label="Refresh now"
            className="p-2.5 rounded-xl bg-zinc-900/80 border border-white/10 text-zinc-400 hover:text-white hover:border-emerald-500/40 transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {scopeError && (
        <div className="max-w-6xl mx-auto mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-300">
          {scopeError}
        </div>
      )}

      <div className="max-w-6xl mx-auto bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        {loading ? (
          <div className="py-16 text-center text-sm text-zinc-400">Loading entries…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <UserCheck className="w-8 h-8 mx-auto mb-3 text-zinc-600" />
            <p className="text-sm font-semibold text-zinc-300">
              {searchTerm ? 'No entries match that search' : 'No check-ins recorded yet'}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {searchTerm
                ? 'Try a different name, number or bio ID.'
                : 'Entries appear here the moment a member taps in.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map((log) => {
              const meta = methodMeta(log.method);
              const granted = log.status === 'granted';
              return (
                <li
                  key={log.id}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.02] transition"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] font-bold text-zinc-400">
                    {initialsOf(log.member?.full_name)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {log.member?.full_name ?? 'Unknown member'}
                    </p>
                    <p className="truncate text-[11px] text-zinc-500">
                      {log.member?.phone ?? 'No number on file'}
                      {log.member?.biometric_id ? ` · Bio #${log.member.biometric_id}` : ''}
                    </p>
                  </div>

                  <span
                    className={`hidden sm:inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${meta.tone}`}
                  >
                    <MethodIcon method={log.method} />
                    {meta.label}
                  </span>

                  <div className="shrink-0 text-right">
                    <p className="font-mono text-xs font-bold text-zinc-200 tabular-nums">
                      {gymClock(log.punch_time)}
                    </p>
                    <p className="text-[10px] text-zinc-500">{relativeTime(log.punch_time)}</p>
                  </div>

                  {granted ? (
                    <CheckCircle2
                      className="w-4 h-4 shrink-0 text-emerald-400"
                      aria-label="Access granted"
                    />
                  ) : (
                    <XCircle
                      className="w-4 h-4 shrink-0 text-rose-400"
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
        <p className="max-w-6xl mx-auto mt-3 text-[11px] text-zinc-600">
          Showing {filtered.length} of the {rows.length} most recent entries
          {searchTerm && ` matching “${searchTerm}”`}. Times are gym local (IST); the
          latest was {gymStamp(rows[0].punch_time)}.
        </p>
      )}
    </main>
  );
}

