'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, ShieldAlert, Clock, Smartphone, LogOut, Dumbbell } from 'lucide-react';

interface MemberData {
  id: string;
  full_name: string;
  phone: string;
  membership_end: string;
  status: string;
}

export default function MemberPass() {
  const [phone, setPhone] = useState('');
  const [member, setMember] = useState<MemberData | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(30);

  // Phone number se member lookup
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const formattedPhone = phone.trim();
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('phone', formattedPhone)
      .maybeSingle();

    if (error || !data) {
      alert('Member record not found. Please check your phone number or ask reception.');
    } else {
      setMember(data);
      localStorage.setItem('gym_member_phone', formattedPhone);
    }
    setLoading(false);
  }

  // Saved session check
  useEffect(() => {
    const savedPhone = localStorage.getItem('gym_member_phone');
    if (savedPhone) {
      supabase
        .from('members')
        .select('*')
        .eq('phone', savedPhone)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setMember(data);
        });
    }
  }, []);

  // 30-second Dynamic QR payload generator
  useEffect(() => {
    if (!member) return;

    function generateDynamicPayload() {
      // 30 second block timestamp
      const timeWindow = Math.floor(Date.now() / 30000);
      const payload = JSON.stringify({
        id: member?.id,
        t: timeWindow,
        ph: member?.phone,
      });
      // Base64 encode for clean QR payload
      setToken(btoa(payload));
      setSecondsLeft(30 - (Math.floor(Date.now() / 1000) % 30));
    }

    generateDynamicPayload();
    const timer = setInterval(() => {
      const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
      setSecondsLeft(remaining);
      if (remaining === 30) {
        generateDynamicPayload();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [member]);

  function handleLogout() {
    localStorage.removeItem('gym_member_phone');
    setMember(null);
    setPhone('');
  }

  const isExpired = member ? new Date(member.membership_end) < new Date() : false;

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-4">
      {!member ? (
        // Login Screen
        <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 p-8 rounded-3xl text-center">
          <div className="w-14 h-14 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
            <Dumbbell className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold">Member Entry Pass</h1>
          <p className="text-xs text-neutral-400 mt-1 mb-6">
            Enter your registered WhatsApp phone number
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <Smartphone className="w-5 h-5 absolute left-3.5 top-3 text-neutral-500" />
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (e.g. 9876543210)"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-11 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 text-white"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-semibold py-2.5 rounded-xl transition text-sm disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Access My QR Pass'}
            </button>
          </form>
        </div>
      ) : (
        // Dynamic Pass Card
        <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 p-6 rounded-3xl text-center relative overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            <span className="text-xs uppercase tracking-wider font-semibold text-neutral-400">
              Access Token
            </span>
            <button
              onClick={handleLogout}
              className="text-neutral-500 hover:text-neutral-300 p-1 rounded-lg"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-white">{member.full_name}</h2>
          <p className="text-xs text-neutral-400 mt-0.5">{member.phone}</p>

          {/* Status Badge */}
          <div className="my-4">
            {isExpired ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full text-xs font-semibold">
                <ShieldAlert className="w-3.5 h-3.5" /> Plan Expired
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" /> Valid Membership
              </div>
            )}
          </div>

          {/* Dynamic QR Code Screen */}
          <div className="bg-white p-5 rounded-2xl inline-block my-2 shadow-inner border-4 border-neutral-800">
            {token ? (
              <QRCodeSVG
                value={token}
                size={190}
                level="M"
                includeMargin={false}
              />
            ) : (
              <div className="w-[190px] h-[190px] flex items-center justify-center text-neutral-400 text-xs">
                Generating Token...
              </div>
            )}
          </div>

          {/* Timer Indicator */}
          {!isExpired && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-neutral-400 mt-3 font-mono">
              <Clock className="w-3.5 h-3.5 text-emerald-400 animate-spin" style={{ animationDuration: '3s' }} />
              Refreshes in <span className="text-emerald-400 font-bold">{secondsLeft}s</span>
            </div>
          )}

          {/* Expiry Details */}
          <div className="mt-5 pt-4 border-t border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
            <span>Valid Until:</span>
            <span className="font-semibold text-neutral-200">{member.membership_end}</span>
          </div>

          {isExpired && (
            <div className="mt-3 p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs font-medium">
              Entry denied at gate. Please renew your plan at the counter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}