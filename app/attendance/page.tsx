'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  ArrowLeft, 
  Calendar, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Fingerprint, 
  QrCode,
  Download,
  Clock
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

export default function AttendanceLogsPage() {
  const [logs, setLogs] = useState<AttendanceRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  async function fetchLogs() {
    setLoading(true);
    // Fetch logs with joined member details
    const { data: attendances, error } = await supabase
      .from('attendances')
      .select('id, punch_time, method, status, member_id, members(full_name, phone, biometric_id)')
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
    <main className="min-h-screen bg-[#0C0D0E] text-white p-6 sm:p-12 font-sans">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Gate Attendance Ledger</h1>
            <p className="text-xs text-neutral-400">Live entry punches, dynamic QR tokens, and biometric logs</p>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search member, phone, bio ID..."
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-10 pr-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
          />
        </div>
      </div>

      {/* Table */}
      <div className="max-w-6xl mx-auto bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-300">
            <thead className="bg-neutral-950 text-neutral-400 uppercase font-mono border-b border-neutral-800">
              <tr>
                <th className="px-5 py-4">Punch Timestamp</th>
                <th className="px-5 py-4">Member Name</th>
                <th className="px-4 py-4">Phone Number</th>
                <th className="px-4 py-4">Biometric ID</th>
                <th className="px-4 py-4">Method</th>
                <th className="px-5 py-4 text-right">Gate Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 font-mono">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-neutral-500">
                    Loading attendance entries...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-neutral-500">
                    No attendance logs matched.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isBlocked = log.status.includes('blocked');
                  const punchDate = new Date(log.punch_time);

                  return (
                    <tr key={log.id} className="hover:bg-neutral-800/40 transition">
                      <td className="px-5 py-4 text-neutral-300 font-sans">
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <Clock className="w-3.5 h-3.5 text-neutral-500" />
                          <span>{punchDate.toLocaleDateString('en-IN')}</span>
                          <strong className="text-white ml-1">{punchDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-sans font-bold text-white text-sm">
                        {log.member?.full_name || 'Unlinked Member'}
                      </td>
                      <td className="px-4 py-4 text-neutral-400">
                        {log.member?.phone || 'N/A'}
                      </td>
                      <td className="px-4 py-4">
                        {log.member?.biometric_id ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-neutral-950 border border-neutral-800 text-cyan-400">
                            <Fingerprint className="w-3 h-3" /> #{log.member.biometric_id}
                          </span>
                        ) : (
                          <span className="text-neutral-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex items-center gap-1 uppercase text-[10px] text-neutral-400 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                          {log.method.includes('biometric') ? <Fingerprint className="w-3 h-3 text-cyan-400" /> : <QrCode className="w-3 h-3 text-emerald-400" />}
                          {log.method}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            isBlocked
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          }`}
                        >
                          {isBlocked ? <XCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                          {isBlocked ? 'ACCESS REFUSED' : 'ACCESS GRANTED'}
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