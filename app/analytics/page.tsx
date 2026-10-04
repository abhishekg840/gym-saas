'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  BarChart3,
  TrendingUp,
  IndianRupee,
  UserX,
  Clock,
  Calendar,
} from 'lucide-react';
import PageHeader from '@/components/page-header';

interface Stats {
  totalRevenue: number;
  totalMembers: number;
  activeMembers: number;
  expiredMembers: number;
  todayCheckins: number;
  hourlyRush: Record<string, number>;
}

/**
 * Owner analytics — light Vyroniq surface.
 *
 * The numbers are untouched: same members scan, same attendance buckets, same
 * rush split. Only the presentation moved onto the shared light tokens, since
 * this was the last owner page still rendering as a dark terminal.
 */

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
      <div className="vy-page flex items-center justify-center">
        <p className="text-sm text-muted">Crunching real-time analytics…</p>
      </div>
    );
  }

  const churnRate = stats.totalMembers > 0 
    ? Math.round((stats.expiredMembers / stats.totalMembers) * 100) 
    : 0;

  const retention = stats.totalMembers > 0
    ? Math.round((stats.activeMembers / stats.totalMembers) * 100)
    : 0;

  return (
    <div className="vy-page vy-noscroll">
      <div className="vy-shell">
        <PageHeader
          icon={<BarChart3 className="h-5 w-5" />}
          title="Analytics"
          subtitle="Revenue, retention and today’s footfall"
        />

        <div className="space-y-5 pb-16">
          <section
            aria-label="Headline metrics"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {/* Each metric keeps the console's stat-card shape: an eyebrow, one
                big figure, and a line that says what the figure means. */}
            <div className="vy-card p-4">
              <div className="flex items-start justify-between">
                <p className="vy-eyebrow">Total Revenue</p>
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <IndianRupee className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="vy-num mt-2 text-emerald-600">
                ₹{stats.totalRevenue.toLocaleString('en-IN')}
              </p>
              <p className="mt-1.5 text-[11px] text-faint">Total collection to date</p>
            </div>

            <div className="vy-card p-4">
              <div className="flex items-start justify-between">
                <p className="vy-eyebrow">Today&apos;s Check-ins</p>
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Calendar className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="vy-num mt-2">{stats.todayCheckins}</p>
              <p className="mt-1.5 text-[11px] text-faint">Footfall recorded today</p>
            </div>

            <div className="vy-card p-4">
              <div className="flex items-start justify-between">
                <p className="vy-eyebrow">Active Retention</p>
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                  <TrendingUp className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="vy-num mt-2">{retention}%</p>
              <p className="mt-1.5 text-[11px] text-emerald-600">
                {stats.activeMembers} of {stats.totalMembers} active
              </p>
            </div>

            <div className="vy-card p-4">
              <div className="flex items-start justify-between">
                <p className="vy-eyebrow">Inactive Members</p>
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                  <UserX className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className={`vy-num mt-2 ${churnRate > 0 ? 'text-rose-600' : ''}`}>
                {churnRate}%
              </p>
              <p className="mt-1.5 text-[11px] text-faint">
                {stats.expiredMembers} expired members
              </p>
            </div>
          </section>

          {/* Peak hours. Each bar is scaled against the busiest slot rather than
              today's total: a slow morning should still show its own shape
              instead of collapsing to a sliver beside an evening peak. */}
          <section className="vy-card" aria-label="Gym traffic distribution">
            <div className="vy-card-head">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-faint" />
                <h2 className="vy-card-title">Gym Traffic Distribution</h2>
              </div>
              <span className="vy-meta">Today</span>
            </div>

            <div className="vy-card-body">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(stats.hourlyRush).map(([slot, count]) => {
                  const busiest = Math.max(1, ...Object.values(stats.hourlyRush));

                  return (
                    <div key={slot} className="vy-panel">
                      <p className="text-[11px] font-medium text-muted">{slot}</p>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="vy-num">{count}</span>
                        <span className="text-[11px] text-faint">entries</span>
                      </div>
                      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all"
                          style={{ width: `${(count / busiest) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
