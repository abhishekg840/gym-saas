'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  BarChart3, 
  ArrowLeft, 
  TrendingUp, 
  IndianRupee, 
  Users, 
  UserX, 
  Clock, 
  Calendar 
} from 'lucide-react';
import Link from 'next/link';

interface Stats {
  totalRevenue: number;
  totalMembers: number;
  activeMembers: number;
  expiredMembers: number;
  todayCheckins: number;
  hourlyRush: Record<string, number>;
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats>({
    totalRevenue: 0,
    totalMembers: 0,
    activeMembers: 0,
    expiredMembers: 0,
    todayCheckins: 0,
    hourlyRush: {},
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      // 1. Members metrics
      const { data: members } = await supabase.from('members').select('membership_end, amount_paid');
      
      let rev = 0;
      let active = 0;
      let expired = 0;
      const now = new Date();

      if (members) {
        members.forEach((m) => {
          rev += Number(m.amount_paid) || 0;
          if (new Date(m.membership_end) >= now) {
            active++;
          } else {
            expired++;
          }
        });
      }

      // 2. Attendance metrics
      const today = new Date().toISOString().split('T')[0];
      const { data: attendances } = await supabase
        .from('attendances')
        .select('scanned_at, status')
        .gte('scanned_at', `${today}T00:00:00Z`);

      const rush: Record<string, number> = {
        '6AM-9AM (Morning)': 0,
        '9AM-12PM (Noon)': 0,
        '4PM-7PM (Evening)': 0,
        '7PM-10PM (Night)': 0,
      };

      if (attendances) {
        attendances.forEach((a) => {
          const hour = new Date(a.scanned_at).getHours();
          if (hour >= 6 && hour < 9) rush['6AM-9AM (Morning)']++;
          else if (hour >= 9 && hour < 12) rush['9AM-12PM (Noon)']++;
          else if (hour >= 16 && hour < 19) rush['4PM-7PM (Evening)']++;
          else if (hour >= 19 && hour < 22) rush['7PM-10PM (Night)']++;
        });
      }

      setStats({
        totalRevenue: rev,
        totalMembers: members?.length || 0,
        activeMembers: active,
        expiredMembers: expired,
        todayCheckins: attendances?.length || 0,
        hourlyRush: rush,
      });
      setLoading(false);
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <p className="text-neutral-400 animate-pulse">Crunching Real-time Analytics...</p>
      </div>
    );
  }

  const churnRate = stats.totalMembers > 0 
    ? Math.round((stats.expiredMembers / stats.totalMembers) * 100) 
    : 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 md:p-12">
      <div className="max-w-6xl mx-auto flex items-center justify-between border-b border-neutral-800 pb-6 mb-8">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400">
            <BarChart3 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Business & Gym Analytics</h1>
            <p className="text-sm text-neutral-400">Live financial figures, retention metrics, and hourly rush trends</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto space-y-8">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-neutral-400 text-xs mb-3">
              <span>Total Revenue</span>
              <IndianRupee className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-3xl font-black text-emerald-400 font-mono">
              ₹{stats.totalRevenue.toLocaleString()}
            </p>
            <p className="text-[11px] text-neutral-500 mt-1">Direct lifetime collection</p>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-neutral-400 text-xs mb-3">
              <span>Today Check-ins</span>
              <Calendar className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-3xl font-black text-white font-mono">{stats.todayCheckins}</p>
            <p className="text-[11px] text-neutral-500 mt-1">Footfall recorded today</p>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-neutral-400 text-xs mb-3">
              <span>Active Retention</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-3xl font-black text-white font-mono">
              {stats.totalMembers > 0 ? Math.round((stats.activeMembers / stats.totalMembers) * 100) : 0}%
            </p>
            <p className="text-[11px] text-emerald-500 mt-1">{stats.activeMembers} of {stats.totalMembers} active</p>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-neutral-400 text-xs mb-3">
              <span>Membership Churn</span>
              <UserX className="w-4 h-4 text-rose-400" />
            </div>
            <p className="text-3xl font-black text-rose-400 font-mono">{churnRate}%</p>
            <p className="text-[11px] text-rose-500 mt-1">{stats.expiredMembers} expired members</p>
          </div>
        </div>

        {/* Peak Hours Rush Breakdown */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-6">
            <Clock className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold">Gym Traffic Distribution (Today)</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(stats.hourlyRush).map(([slot, count]) => (
              <div key={slot} className="bg-neutral-950 border border-neutral-800/80 p-4 rounded-xl">
                <p className="text-xs text-neutral-400 font-medium mb-1">{slot}</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-white">{count}</span>
                  <span className="text-xs text-neutral-500">entries</span>
                </div>
                <div className="w-full bg-neutral-800 h-1.5 rounded-full mt-3 overflow-hidden">
                  <div
                    className="bg-amber-400 h-full rounded-full transition-all"
                    style={{
                      width: `${stats.todayCheckins > 0 ? (count / stats.todayCheckins) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}