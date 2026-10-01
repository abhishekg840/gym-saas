'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { isUuid, readSession } from '@/lib/session';
import { 
  ArrowLeft, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Fingerprint, 
  QrCode,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';

interface AttendanceRecord {
  id: string;
  punch_time: string;
  method: string;
  status: string;
  member?: {
    full_name: string;
    phone: string;
    biometric_id?: number | null;
  } | null;
}

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
  hardware_punch: { label: 'Gate Reader', tone: 'bg-amber-500/10 text-amber-300 border-amber-500/25' },
};

function methodMeta(method: string) {
  return (
    METHOD_META[method] ?? {
      label: 'Gate Reader',
      tone: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
    }
  );
}

/** Up to two initials from a member name, for the rounded avatar chip. */
function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "just now" / "12 min ago" / "3 hr ago" / "2 days ago". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function AttendanceLogsPage() {
  const [logs, setLogs] = useState<AttendanceRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [scopeError, setScopeError] = useState<string | null>(null);

  async function fetchLogs() {
    setLoading(true);

    // The ledger is tenant-scoped. Without a gym linked to this session we show
    // an error instead of an unscoped query, which would list every gym's punches.
    const tenantId = readSession()?.tenantId ?? null;
    if (!isUuid(tenantId)) {
      setLogs([]);
      setScopeError('Sign in again to load this gym\'s live entries.');
      setLoading(false);
      return;
    }
    setScopeError(null);

    // Fetch logs with joined member details
    const { data: attendances, error } = await supabase
      .from('attendances')
      .select('id, punch_time, method, status, member_id, members(full_name, phone, biometric_id)')
      .eq('tenant_id', tenantId)
      .order('punch_time', { ascending: false })
      .limit(100);

    if (attendances && !error) {
      const formatted = attendances.map((a: unknown) => {
        const item = a as {
          id: string;
          punch_time: string;
          method: string;
          status: string;
          members?: { full_name: string; phone: string; biometric_id?: number | null } | { full_name: string; phone: string; biometric_id?: number | null }[];
        };
        const memberObj = Array.isArray(item.members) ? item.members[0] : item.members;
        return {
          id: item.id,
          punch_time: item.punch_time,
          method: item.method || 'qr',
          status: item.status || 'granted',
          member: memberObj || null,
        };
      });
      setLogs(formatted);
    } else {
      console.error('Failed to load logs:', error?.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    // Load-on-mount, not render-derived state: the setStates land after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    const name = log.member?.full_name?.toLowerCase() || '';
    const phone = log.member?.phone || '';
    const bio = log.member?.biometric_id?.toString() || '';
    const q = searchTerm.toLowerCase();

    return name.includes(q) || phone.includes(q) || bio.includes(q);
  });

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-6 sm:p-12 font-sans">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2.5 rounded-xl bg-zinc-900/80 backdrop-blur-md border border-white/10 text-zinc-400 hover:text-white hover:border-emerald-500/40 active:scale-95 transition-all duration-150"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Live Member Entries</h1>
            <p className="text-xs text-zinc-400 font-medium">Today&apos;s check-ins from the gate and front desk</p>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search member, phone, bio ID..."
            className="w-full bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/60"
          />
        </div>
      </div>

      {/* Table */}
      <div className="max-w-6xl mx-auto bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-white/[0.02] text-zinc-400 uppercase tracking-wider text-[10px] font-semibold border-b border-white/10">
              <tr>
                <th className="px-5 py-4">Check-in Time</th>
                <th className="px-5 py-4">Member Name</th>
                <th className="px-4 py-4">Phone Number</th>
                <th className="px-4 py-4">Biometric ID</th>
                <th className="px-4 py-4">How</th>
                <th className="px-5 py-4 text-right">Gate Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {scopeError ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-rose-400 font-sans">
                    {scopeError}
                  </td>
                </tr>
              ) : loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-zinc-500">
                    Loading attendance entries...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-zinc-500">
                    No attendance logs matched.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isBlocked = log.status.includes('blocked');
                  const punchDate = new Date(log.punch_time);
                  const method = methodMeta(log.method);
                  const name = log.member?.full_name || 'Guest Entry';

                  return (
                    <tr key={log.id} className="hover:bg-white/[0.03] transition-colors duration-150">
                      <td className="px-5 py-4 font-sans">
                        <div className="flex items-center gap-2 text-xs">
                          <strong className="text-white font-semibold tracking-tight">
                            {punchDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </strong>
                          <span className="text-zinc-500">
                            {punchDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        <span className="mt-0.5 block text-[11px] text-zinc-400 font-medium">
                          {relativeTime(log.punch_time)}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-sans">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/25 to-emerald-500/20 text-[11px] font-bold text-white ring-1 ring-white/10">
                            {initialsOf(name)}
                          </span>
                          <span className="text-sm font-semibold text-white">{name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-zinc-400 font-sans">
                        {log.member?.phone || '—'}
                      </td>
                      <td className="px-4 py-4 font-sans">
                        {log.member?.biometric_id ? (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/10 border border-sky-500/25 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                            <Fingerprint className="w-3 h-3" /> #{log.member.biometric_id}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 font-sans">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${method.tone}`}
                        >
                          {log.method.includes('biometric') ? (
                            <Fingerprint className="w-3 h-3" />
                          ) : log.method.includes('manual') ? (
                            <UserCheck className="w-3 h-3" />
                          ) : (
                            <QrCode className="w-3 h-3" />
                          )}
                          {method.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right font-sans">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            isBlocked
                              ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                              : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                          }`}
                        >
                          {isBlocked ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                          {isBlocked ? 'Refused' : 'Checked in'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}