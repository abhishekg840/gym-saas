'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { 
  Dumbbell, 
  ShieldCheck, 
  Lock, 
  ArrowRight, 
  UserCheck, 
  Sparkles,
  Phone
} from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const phone10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

    try {
      // 1. Check gym_users for super_admin, owner, receptionist
      const { data: user, error } = await supabase
        .from('gym_users')
        .select('*, tenants(name, subscription_status, subscription_tier)')
        .or(`phone.eq.${phone10},phone.ilike.%${phone10}%`)
        .eq('pin_code', pin.trim())
        .maybeSingle();

      if (user) {
        // Save session locally
        localStorage.setItem(
          'gym_session',
          JSON.stringify({
            userId: user.id,
            role: user.role,
            name: user.full_name,
            phone: user.phone,
            tenantId: user.tenant_id,
            tenantName: user.tenants?.name || 'GlitchFiesta Cloud',
            status: user.tenants?.subscription_status || 'active',
          })
        );

        if (user.role === 'super_admin') {
          router.push('/super-admin');
        } else if (user.role === 'owner') {
          router.push('/');
        } else {
          router.push('/scan');
        }
        return;
      }

      // 2. If not staff, check if member wants to open their pass
      const { data: member } = await supabase
        .from('members')
        .select('id, full_name, phone')
        .or(`phone.eq.${phone10},phone.ilike.%${phone10}%`)
        .maybeSingle();

      if (member) {
        localStorage.setItem(
          'gym_session',
          JSON.stringify({
            userId: member.id,
            role: 'member',
            name: member.full_name,
            phone: member.phone,
          })
        );
        router.push('/member');
        return;
      }

      setErrorMsg('Invalid phone number or PIN. Contact desk if you are an active member.');
    } catch (err: unknown) {
      setErrorMsg('Login failed: ' + (err instanceof Error ? err.message : 'Network error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0C0D0E] text-white flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm bg-[#16181D] border border-neutral-800 rounded-3xl p-8 shadow-2xl relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <Dumbbell className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight">GlitchFiesta Gym OS</h1>
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">Access Portal</span>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 block mb-1">
              Registered Phone
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3" />
              <input
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 9569272339"
                className="w-full bg-[#0C0D0E] border border-neutral-800 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-sm font-mono text-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 block mb-1">
              Access PIN / Passcode
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3" />
              <input
                required
                type="password"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="**** (e.g. 9999 for master)"
                className="w-full bg-[#0C0D0E] border border-neutral-800 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-sm font-mono text-white focus:outline-none tracking-widest"
              />
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">Super admin PIN: <strong>9999</strong> | Staff PIN: <strong>1234</strong></p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In'} <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-neutral-800/80 text-center">
          <Link href="/member" className="text-xs text-neutral-400 hover:text-emerald-400 font-mono transition">
            Member without PIN? Open Direct Pass →
          </Link>
        </div>
      </div>
    </main>
  );
}