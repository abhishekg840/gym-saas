'use client';

import { useState, useEffect, useCallback } from 'react';
import { Timer, CheckCircle, LogOut, Sparkles, X, Dumbbell } from 'lucide-react';

interface ActiveSessionModalProps {
  memberId: string;
  tenantId?: string | null;
  onSessionClosed?: () => void;
}

interface ActiveSessionData {
  attendance_id: string;
  session_id: string | null;
  checkin_at: string;
  elapsed_minutes: number;
  is_near_expiry: boolean;
  is_expired: boolean;
}

export default function ActiveSessionModal({
  memberId,
  tenantId,
  onSessionClosed,
}: ActiveSessionModalProps) {
  const [session, setSession] = useState<ActiveSessionData | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    if (!memberId) return;
    try {
      const url = `/api/attendance/auto-checkout?member_id=${memberId}${tenantId ? `&tenant_id=${tenantId}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.ok && data.has_active_session && data.session) {
        const s = data.session as ActiveSessionData;
        setSession(s);

        // Check if member has already extended in the last 45 minutes
        const key = `extended_session_${s.session_id || s.attendance_id}`;
        const lastExtended = localStorage.getItem(key);
        const now = Date.now();
        const wasRecentlyExtended = lastExtended && now - Number(lastExtended) < 45 * 60 * 1000;

        // If active for >= 105 minutes (1h 45m) and not recently extended, pop up modal!
        if (s.is_near_expiry && !wasRecentlyExtended) {
          setShowModal(true);
        }
      } else {
        setSession(null);
        setShowModal(false);
      }
    } catch (err) {
      console.error('Failed to check active session:', err);
    }
  }, [memberId, tenantId]);

  useEffect(() => {
    checkSession();
    // Re-check session status every 45 seconds
    const interval = setInterval(checkSession, 45_000);
    return () => clearInterval(interval);
  }, [checkSession]);

  const handleExtend = async () => {
    if (!memberId || !session) return;
    setBusy(true);
    try {
      const res = await fetch('/api/attendance/auto-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend',
          member_id: memberId,
          tenant_id: tenantId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const key = `extended_session_${session.session_id || session.attendance_id}`;
        localStorage.setItem(key, Date.now().toString());
        setShowModal(false);
        setToastMessage('Session extended by 1 hour! Keep crushing it 💪');
        setTimeout(() => setToastMessage(null), 4000);
        checkSession();
      } else {
        alert(data.error || 'Could not extend session');
      }
    } catch (err) {
      console.error('Error extending session:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleCheckoutNow = async () => {
    if (!memberId || !session) return;
    setBusy(true);
    try {
      const res = await fetch('/api/attendance/auto-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'checkout',
          member_id: memberId,
          tenant_id: tenantId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setShowModal(false);
        setSession(null);
        setToastMessage('Checked out successfully! Great session today 🎉');
        setTimeout(() => setToastMessage(null), 4000);
        onSessionClosed?.();
        checkSession();
      } else {
        alert(data.error || 'Could not complete check-out');
      }
    } catch (err) {
      console.error('Error checking out:', err);
    } finally {
      setBusy(false);
    }
  };

  const elapsedHours = session ? Math.floor(session.elapsed_minutes / 60) : 0;
  const elapsedMins = session ? session.elapsed_minutes % 60 : 0;
  const progressPct = session ? Math.min(100, Math.round((session.elapsed_minutes / 120) * 100)) : 0;

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl bg-slate-900/95 text-white px-5 py-3 shadow-2xl backdrop-blur text-xs font-semibold animate-in fade-in slide-in-from-bottom-4 duration-200">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Interactive In-App Notification Modal */}
      {showModal && session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 text-center animate-in zoom-in-95 duration-150">
            {/* Top Indicator */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 shadow-inner">
              <Timer className="h-8 w-8 animate-pulse" />
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-2">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
              Active Gym Session
            </div>

            <h3 className="text-lg font-black tracking-tight text-slate-900">
              Still working out?
            </h3>

            <p className="mt-2 text-xs text-slate-600 leading-relaxed">
              Your floor session has been active for{' '}
              <strong className="text-slate-900 font-bold">
                {elapsedHours > 0 ? `${elapsedHours}h ${elapsedMins}m` : `${elapsedMins} minutes`}
              </strong>
              . Tap below to extend your session or confirm your exit.
            </p>

            {/* Session Timer Progress Bar */}
            <div className="my-5 rounded-2xl bg-slate-50 border border-slate-100 p-3.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 mb-1.5">
                <span>Workout Duration</span>
                <span className="text-amber-700">{elapsedHours}h {elapsedMins}m / 2h</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="mt-2 text-[10px] text-slate-400">
                Auto-checkout engages at 2 hours to keep gym live crowd accurate.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleExtend}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700 transition active:scale-98 disabled:opacity-50"
              >
                <Dumbbell className="h-4 w-4" />
                <span>I&apos;m Still Here / Extend</span>
              </button>

              <button
                type="button"
                onClick={handleCheckoutNow}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-98 disabled:opacity-50"
              >
                <LogOut className="h-4 w-4 text-slate-500" />
                <span>Check Out Now</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

