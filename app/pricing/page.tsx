'use client';

import Link from 'next/link';
import { 
  Check, 
  X, 
  Dumbbell, 
  Zap, 
  ShieldCheck, 
  QrCode, 
  Fingerprint, 
  MessageSquare, 
  ArrowRight,
  TrendingUp,
  CreditCard
} from 'lucide-react';

export default function PricingLandingPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white selection:bg-emerald-500 selection:text-black">
      {/* Top Navbar */}
      <nav className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500 text-black rounded-xl">
              <Dumbbell className="w-5 h-5 font-black" />
            </div>
            <span className="font-bold text-lg tracking-tight">GlitchFiesta Gym OS</span>
          </div>
          <div className="flex items-center gap-3">
            <Link 
              href="/"
              className="text-xs text-neutral-400 hover:text-white transition px-3 py-1.5"
            >
              Live Demo
            </Link>
            <a 
              href="https://wa.me/918114039175?text=Hello%20I%20am%20interested%20in%20GlitchFiesta%20Gym%20OS"
              target="_blank"
              className="text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-xl transition flex items-center gap-1.5"
            >
              Book Demo <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-6">
          <Zap className="w-3.5 h-3.5" /> Stop paying ₹25,000 for biometric machines & SMS charges
        </div>
        <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.1] mb-6">
          The Modern Operating System for <span className="text-emerald-400">High-Growth Gyms</span>
        </h1>
        <p className="text-neutral-400 text-base sm:text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
          Dynamic anti-screenshot QR codes, Raspberry Pi biometric integration, automated WhatsApp retention alerts, and direct UPI renewal—all in one subscription.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="https://wa.me/918114039175?text=Hi,%20I%20want%20to%20deploy%20Gym%20OS%20for%20my%20gym."
            target="_blank"
            className="w-full sm:w-auto px-8 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl transition shadow-lg shadow-emerald-500/20 text-sm flex items-center justify-center gap-2"
          >
            Start Free 14-Day Trial <ArrowRight className="w-4 h-4" />
          </a>
          <Link
            href="/scan"
            target="_blank"
            className="w-full sm:w-auto px-8 py-3.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 font-semibold rounded-xl transition text-sm flex items-center justify-center gap-2"
          >
            <QrCode className="w-4 h-4 text-emerald-400" /> Test Kiosk Scanner
          </Link>
        </div>
      </section>

      {/* Feature Comparison Table vs Traditional Gym Software */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Why Owners Switch to GlitchFiesta</h2>
          <p className="text-neutral-400 text-sm mt-2">See how we compare against legacy gym management tools like FitBoat</p>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-950 text-neutral-400 uppercase text-xs border-b border-neutral-800">
              <tr>
                <th className="px-6 py-4">Capability</th>
                <th className="px-6 py-4 text-emerald-400 font-bold">GlitchFiesta Gym OS</th>
                <th className="px-6 py-4 text-neutral-500">Legacy ERPs (FitBoat etc.)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              <tr>
                <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-400" /> WhatsApp Reminders
                </td>
                <td className="px-6 py-4 text-emerald-400 font-semibold">Included (Zero Per-SMS Cost)</td>
                <td className="px-6 py-4 text-neutral-500">₹0.35 to ₹0.60 per SMS/WhatsApp</td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-blue-400" /> Anti-Screenshot Dynamic QR
                </td>
                <td className="px-6 py-4 text-emerald-400 font-semibold flex items-center gap-1.5">
                  <Check className="w-4 h-4" /> 30-sec Rotating Passcode
                </td>
                <td className="px-6 py-4 text-rose-400 flex items-center gap-1.5">
                  <X className="w-4 h-4" /> Static / Easy to proxy
                </td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-cyan-400" /> Biometric Hardware Setup
                </td>
                <td className="px-6 py-4 text-emerald-400 font-semibold">Raspberry Pi (₹1,500 Sensor)</td>
                <td className="px-6 py-4 text-neutral-500">₹18,000–₹25,000 Proprietary Device</td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-amber-400" /> Member Self-Renewal Flow
                </td>
                <td className="px-6 py-4 text-emerald-400 font-semibold flex items-center gap-1.5">
                  <Check className="w-4 h-4" /> Direct UPI 0% Gateway Fee
                </td>
                <td className="px-6 py-4 text-neutral-500">2-3% Payment Gateway Cuts</td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-purple-400" /> Inactivity Churn Alerts
                </td>
                <td className="px-6 py-4 text-emerald-400 font-semibold flex items-center gap-1.5">
                  <Check className="w-4 h-4" /> Automated 5-Day Nudges
                </td>
                <td className="px-6 py-4 text-rose-400 flex items-center gap-1.5">
                  <X className="w-4 h-4" /> Manual Reports Only
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-black">Simple, Transparent Pricing</h2>
          <p className="text-neutral-400 text-sm mt-2">No setup charges, no per-member fees, cancel anytime</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Starter Plan */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-lg text-white mb-1">Starter Gym</h3>
              <p className="text-xs text-neutral-400 mb-6">For boutique studios and single-floor gyms</p>
              <div className="mb-6">
                <span className="text-4xl font-black text-white font-mono">₹799</span>
                <span className="text-xs text-neutral-400"> /month</span>
              </div>
              <ul className="space-y-3 text-xs text-neutral-300">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Up to 150 Active Members</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Web Kiosk Dynamic QR Scanner</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Member Self-Service Portal</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> PDF Invoices & Receipts</li>
                <li className="flex items-center gap-2 text-neutral-500"><X className="w-4 h-4" /> Biometric Hardware Relay</li>
              </ul>
            </div>
            <a
              href="https://wa.me/918114039175?text=I%20want%20Starter%20Gym%20Plan"
              target="_blank"
              className="w-full text-center mt-8 py-3 rounded-xl border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 font-bold text-xs transition"
            >
              Get Started
            </a>
          </div>

          {/* Growth Plan (Popular) */}
          <div className="bg-neutral-900 border-2 border-emerald-500 rounded-3xl p-8 flex flex-col justify-between relative shadow-2xl shadow-emerald-500/10">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-black font-extrabold text-[10px] uppercase tracking-wider px-3 py-1 rounded-full">
              Most Popular
            </span>
            <div>
              <h3 className="font-bold text-lg text-white mb-1">Pro Fitness Club</h3>
              <p className="text-xs text-neutral-400 mb-6">Complete automated access control and retention</p>
              <div className="mb-6">
                <span className="text-4xl font-black text-emerald-400 font-mono">₹1,499</span>
                <span className="text-xs text-neutral-400"> /month</span>
              </div>
              <ul className="space-y-3 text-xs text-neutral-300">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Unlimited Members</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Automated WhatsApp Bots (3-Day Expire Alert)</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 5-Day Inactivity Retention Alerts</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Raspberry Pi Biometric Integration</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Staff Roles (Owner vs Receptionist)</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Peak Hour Rush Analytics</li>
              </ul>
            </div>
            <a
              href="https://wa.me/918114039175?text=I%20want%20Pro%20Fitness%20Plan"
              target="_blank"
              className="w-full text-center mt-8 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs transition shadow-lg shadow-emerald-500/20"
            >
              Deploy Pro Plan
            </a>
          </div>

          {/* Franchise Plan */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-lg text-white mb-1">Franchise & Multi-Gym</h3>
              <p className="text-xs text-neutral-400 mb-6">For multi-branch gym owners and chains</p>
              <div className="mb-6">
                <span className="text-4xl font-black text-white font-mono">₹3,499</span>
                <span className="text-xs text-neutral-400"> /month</span>
              </div>
              <ul className="space-y-3 text-xs text-neutral-300">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Up to 5 Branch Locations</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Multi-branch Turnstile Gates</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Custom Domain & White-label Logo</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Dedicated Technical Support</li>
              </ul>
            </div>
            <a
              href="https://wa.me/918114039175?text=I%20need%20Franchise%20Multi-branch%20Setup"
              target="_blank"
              className="w-full text-center mt-8 py-3 rounded-xl border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 font-bold text-xs transition"
            >
              Contact Sales
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-900 py-8 text-center text-xs text-neutral-500">
        <p>© 2026 GlitchFiesta Technologies. Built for next-generation gym management.</p>
      </footer>
    </div>
  );
}