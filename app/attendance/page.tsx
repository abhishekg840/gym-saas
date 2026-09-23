'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Dumbbell, ShieldCheck, ShieldAlert, ArrowLeft, RefreshCw, Calendar, Clock } from 'lucide-react';
import Link from 'next/link';

interface AttendanceRecord {
  id: string;
  punch_time: string;
  method: string;
  status: string;
  member_id: string;
  members: {
    full_name: string;
    phone: string;
    membership_end: string;
  } | null;
}

export default function AttendancePage() {
  const [logs, setLogs] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchAttendanceLogs() {
    setLoading(true);
    const { data, error } = await supabase
      .from('attendances')
      .select(`
        id,
        punch_time,
        method,
        status,
        member_id,
        members (
          full_name,
          phone,
          membership_end
        )
      `)
      .order('punch_time', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching logs:', error.message);
    } else if (data) {
      setLogs(data as unknown as AttendanceRecord[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchAttendanceLogs();

    // Auto-refresh every 10 seconds for real-time kiosk monitoring
    const interval = setInterval(fetchAttendanceLogs, 10000);
    return () => clearInterval(interval);
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];
  const todayLogs = logs.filter(l => l.punch_time.startsWith(todayStr));
  const grantedCount = todayLogs.filter(l => l.status === 'granted').length;
  const blockedCount = todayLogs.filter(l => l.status !== 'granted').length;

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 md:p-12">
      {/* Header */}
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400">
            <Dumbbell className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Gate Attendance Logs</h1>
            <p className="text-sm text-neutral-400">Real-time check-in stream & gate-access audits</p>
          </div>
        </div>

        <button
          onClick={fetchAttendanceLogs}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300 rounded-xl text-sm transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-neutral-400">Today&apos;s Total Punches</p>
            <p className="text-2xl font-bold">{todayLogs.length}</p>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-neutral-400">Entries Granted</p>
            <p className="text-2xl font-bold text-emerald-400">{grantedCount}</p>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl flex items-center gap-4">
          <div className="p-3 bg-rose-500/10 text-rose-400 rounded-xl">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-neutral-400">Blocked / Expired</p>
            <p className="text-2xl font-bold text-rose-400">{blockedCount}</p>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="max-w-6xl mx-auto bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Latest Check-In Stream</h2>
          <span className="text-xs text-neutral-500 font-mono">Auto-refreshes every 10s</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-neutral-300">
            <thead className="bg-neutral-950 text-neutral-400 uppercase text-xs">
              <tr>
                <th className="px-6 py-4">Time</th>
                <th className="px-6 py-4">Member Name</th>
                <th className="px-6 py-4">Phone</th>
                <th className="px-6 py-4">Scan Method</th>
                <th className="px-6 py-4 text-right">Access Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-neutral-500">
                    No attendance records found yet. Scan dynamic QR codes from the kiosk to generate logs.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isGranted = log.status === 'granted';
                  const dateObj = new Date(log.punch_time);
                  const timeFormatted = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const dateFormatted = dateObj.toLocaleDateString();

                  return (
                    <tr key={log.id} className="hover:bg-neutral-800/40 transition">
                      <td className="px-6 py-4 font-mono text-neutral-400">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-neutral-500" />
                          <span>{timeFormatted}</span>
                          <span className="text-xs text-neutral-600">({dateFormatted})</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium text-white">
                        {log.members?.full_name || 'Unregistered / Guest'}
                      </td>
                      <td className="px-6 py-4 font-mono text-neutral-400">
                        {log.members?.phone || 'N/A'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                          {log.method}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {isGranted ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                            <ShieldCheck className="w-3.5 h-3.5" /> Granted
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">
                            <ShieldAlert className="w-3.5 h-3.5" /> Blocked
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}