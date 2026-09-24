'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { QRCodeSVG } from 'qrcode.react';
import Link from 'next/link';
import { 
  Dumbbell, 
  ShieldCheck, 
  ShieldAlert, 
  Receipt, 
  Clock, 
  CreditCard, 
  ExternalLink,
  Phone
} from 'lucide-react';

interface MemberData {
  id: string;
  full_name: string;
  phone: string;
  membership_end: string;
  amount_paid: number;
}

export default function MemberSelfServicePortal() {
  const [phoneInput, setPhoneInput] = useState('');
  const [member, setMember] = useState<MemberData | null>(null);
  const [qrPayload, setQrPayload] = useState('');
  const [countdown, setCountdown] = useState(30);
  const [invoices, setInvoices] = useState<{ id: string; amount: number; issued_at: string }[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const clean = phoneInput.replace(/[^0-9]/g, '');
    const { data } = await supabase
      .from('members')
      .select('id, full_name, phone, membership_end, amount_paid')
      .ilike('phone', `%${clean.slice(-10)}%`)
      .limit(1)
      .maybeSingle();

    if (data) {
      setMember(data);
      // Fetch Member Invoices
      const { data: invList } = await supabase
        .from('invoices')
        .select('id, amount, issued_at')
        .eq('member_id', data.id)
        .order('issued_at', { ascending: false });
      if (invList) setInvoices(invList);
    } else {
      alert('No active membership found with this phone number.');
    }
    setLoading(false);
  }

  // Dynamic QR Code Rotator (30 sec interval)
  useEffect(() => {
    if (!member) return;

    function refreshPass() {
      const windowIndex = Math.floor(Date.now() / 30000);
      const token = btoa(JSON.stringify({ id: member?.id, t: windowIndex, ph: member?.phone }));
      setQrPayload(token);
    }

    refreshPass();
    const interval = setInterval(() => {
      const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
      setCountdown(rem);
      if (rem === 30) refreshPass();
    }, 1000);

    return () => clearInterval(interval);
  }, [member]);

  const isExpired = member ? new Date(member.membership_end) < new Date() : false;
  const upiPayLink = member
    ? `upi://pay?pa=paytmqr@paytm&pn=GlitchFiestaGym&am=${member.amount_paid || 1500}&cu=INR`
    : '';

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-4 sm:p-8 flex flex-col items-center justify-center">
      {!member ? (
        <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl">
          <div className="flex items-center gap-2 mb-4 text-emerald-400">
            <Dumbbell className="w-6 h-6" />
            <h1 className="text-lg font-bold text-white">Member Self-Portal</h1>
          </div>
          <p className="text-xs text-neutral-400 mb-6">Enter your registered mobile number to open your smart access card.</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Mobile Number</label>
              <div className="relative">
                <Phone className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3" />
                <input
                  required
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="8114039175"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Access My Pass'}
            </button>
          </form>
        </div>
      ) : (
        <div className="w-full max-w-md space-y-4">
          {/* Virtual Pass Card */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 text-center shadow-2xl relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-4">
              <div className="text-left">
                <span className="text-[10px] text-neutral-500 uppercase tracking-widest block font-bold">Access Token</span>
                <h2 className="text-lg font-black text-white">{member.full_name}</h2>
                <p className="text-xs font-mono text-neutral-400">{member.phone}</p>
              </div>
              <div>
                {isExpired ? (
                  <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold">
                    <ShieldAlert className="w-3.5 h-3.5" /> Expired
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                    <ShieldCheck className="w-3.5 h-3.5" /> Valid
                  </span>
                )}
              </div>
            </div>

            {/* QR Section */}
            <div className="bg-white p-4 rounded-2xl w-fit mx-auto shadow-inner mb-3">
              {qrPayload ? (
                <QRCodeSVG value={qrPayload} size={180} level="M" />
              ) : (
                <div className="w-[180px] h-[180px] bg-neutral-200 animate-pulse rounded-lg" />
              )}
            </div>

            <div className="flex items-center justify-center gap-1 text-xs text-neutral-400 font-mono mb-4">
              <Clock className="w-3.5 h-3.5 text-emerald-400" /> Refreshes in {countdown}s
            </div>

            <div className="bg-neutral-950 border border-neutral-800/80 rounded-xl p-3 flex justify-between text-xs">
              <span className="text-neutral-400">Valid Until:</span>
              <span className="font-mono font-bold text-white">{member.membership_end}</span>
            </div>

            {/* Expired Action: Instant UPI Pay */}
            {isExpired && (
              <a
                href={upiPayLink}
                className="mt-4 flex items-center justify-center gap-2 w-full bg-emerald-500 hover:bg-emerald-600 text-black font-bold py-2.5 rounded-xl transition text-sm"
              >
                <CreditCard className="w-4 h-4" /> Renew Instantly via UPI (₹{member.amount_paid || 1500})
              </a>
            )}
          </div>

          {/* Member Receipts List */}
          {invoices.length > 0 && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">
                <Receipt className="w-4 h-4 text-emerald-400" /> Payment History & Receipts
              </div>
              <div className="space-y-2">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between p-2.5 bg-neutral-950 rounded-xl text-xs border border-neutral-800">
                    <div>
                      <p className="font-bold text-white">₹{inv.amount.toLocaleString()}</p>
                      <p className="text-[10px] text-neutral-500">{new Date(inv.issued_at).toLocaleDateString()}</p>
                    </div>
                    <Link
                      href={`/invoice/${inv.id}`}
                      target="_blank"
                      className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
                    >
                      Receipt <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setMember(null)}
            className="w-full text-xs text-neutral-500 hover:text-white transition py-2"
          >
            Switch Account
          </button>
        </div>
      )}
    </div>
  );
}