'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Fingerprint,
  Menu,
  X,
  ShieldCheck,
  BarChart3,
  Users,
  CreditCard,
  MessageCircle,
  Sparkles,
  QrCode,
  Zap,
  Clock,
  PhoneCall,
} from 'lucide-react';
import { useState } from 'react';

const WHATSAPP = '9569272339';

const wa = (message: string) =>
  `https://wa.me/91${WHATSAPP}?text=${encodeURIComponent(message)}`;

export default function PricingLandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 font-sans selection:bg-emerald-500 selection:text-white">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white text-xs font-semibold tracking-wide py-2.5 px-4 text-center shadow-sm">
        <span className="inline-flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 animate-pulse text-emerald-200" />
          Flat 14-Day Free Trial for Gym Owners in India · No Credit Card Required
        </span>
      </div>

      {/* NAVBAR */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-neutral-200/80 transition-all">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white flex items-center justify-center font-black text-lg shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
              GF
            </div>
            <div>
              <div className="font-extrabold text-lg tracking-tight text-neutral-900">
                GlitchFiesta <span className="text-emerald-600">Gym OS</span>
              </div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-neutral-600">
                Smart Gym Management
              </div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-neutral-600">
            <a href="#features" className="hover:text-emerald-600 transition">Features</a>
            <a href="#comparison" className="hover:text-emerald-600 transition">Why Us</a>
            <a href="#pricing" className="hover:text-emerald-600 transition">Pricing Plans</a>
            <Link href="/" className="hover:text-emerald-600 transition">Staff Dashboard</Link>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <a
              href={wa('Hi Abhishek, I would like to schedule a quick demo of GlitchFiesta Gym OS.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 py-2.5 rounded-full shadow-md shadow-emerald-600/20 hover:shadow-lg transition-all active:scale-95"
            >
              <MessageCircle className="w-4 h-4" />
              Book Live Demo
            </a>
          </div>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 text-neutral-700 hover:text-neutral-900 rounded-xl"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden bg-white border-b border-neutral-200 px-6 py-4 flex flex-col gap-4 shadow-xl">
            <a href="#features" onClick={() => setMenuOpen(false)} className="font-medium text-neutral-700">Features</a>
            <a href="#comparison" onClick={() => setMenuOpen(false)} className="font-medium text-neutral-700">Why Us</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="font-medium text-neutral-700">Pricing</a>
            <a
              href={wa('Hi Abhishek, I want a demo of GlitchFiesta Gym OS.')}
              target="_blank"
              rel="noreferrer"
              className="bg-emerald-600 text-white text-center py-2.5 rounded-xl font-bold text-sm shadow"
            >
              Book Live Demo
            </a>
          </div>
        )}
      </header>

      {/* HERO SECTION WITH SUBTLE BACKGROUND GYM IMAGE */}
      <section className="relative overflow-hidden pt-12 pb-24 border-b border-neutral-200/70">
        {/* Soft Background Gym Photo with Gradient Masks */}
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center pointer-events-none opacity-[0.07] filter grayscale"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=1920&auto=format&fit=crop')`,
          }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-white via-transparent to-[#fafafa] pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-6 shadow-sm">
            <Zap className="w-3.5 h-3.5 text-emerald-600" />
            Designed for Gym Owners, Not IT Technicians
          </div>

          <h1 className="text-4xl sm:text-6xl font-black text-neutral-900 tracking-tight leading-[1.12] mb-6">
            Manage your gym without <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700">
              unpaid fees, fake check-ins & paperwork.
            </span>
          </h1>

          <p className="text-neutral-600 text-base sm:text-xl max-w-2xl mx-auto font-normal leading-relaxed mb-10">
            Smart QR and Biometric access control, automatic WhatsApp fee reminders with direct UPI payment links, and real-time attendance logs — all in one simple mobile-first app.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href={wa('Hi Abhishek, I want to start my 14-day free trial of GlitchFiesta Gym OS.')}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-xl shadow-emerald-600/25 hover:shadow-2xl transition-all text-base flex items-center justify-center gap-2.5 active:scale-95"
            >
              Start Free 14-Day Trial
              <ArrowRight className="w-4 h-4" />
            </a>

            <Link
              href="/scan"
              target="_blank"
              className="w-full sm:w-auto px-7 py-4 bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-300 font-bold rounded-2xl shadow-sm transition-all text-base flex items-center justify-center gap-2"
            >
              <QrCode className="w-4 h-4 text-emerald-600" />
              Try Live Scanner Demo
            </Link>
          </div>

          {/* Trust Highlights */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto mt-16 text-left">
            {[
              { title: 'Zero Per-SMS Cost', desc: 'WhatsApp reminders directly on members phones' },
              { title: 'Anti-Proxy QR', desc: 'Auto-rotating 30s QR codes stop proxy attendance' },
              { title: 'Direct UPI Pay', desc: '100% money in your bank, 0% gateway cuts' },
              { title: 'Biometric Ready', desc: 'Plug and play with budget fingerprint hardware' },
            ].map((item, idx) => (
              <div key={idx} className="bg-white/80 backdrop-blur-sm border border-neutral-200/90 p-4 rounded-2xl shadow-sm">
                <p className="text-xs font-bold text-emerald-700">{item.title}</p>
                <p className="text-[11px] text-neutral-500 mt-1 leading-snug">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CORE WORKFLOW HIGHLIGHTS (PICTURE-BACKED CARD SECTION) */}
      <section id="features" className="py-20 max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-600">Complete Control</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-neutral-900 tracking-tight mt-2">
            Everything your gym needs on a single screen
          </h2>
          <p className="text-neutral-500 text-sm mt-3">
            Replace notebooks, multiple WhatsApp groups, and clunky legacy software with one effortless workflow.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="group relative bg-white border border-neutral-200 rounded-3xl p-7 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-6">
                <QrCode className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-neutral-900 mb-2">Anti-Screenshot QR Pass</h3>
              <p className="text-neutral-600 text-xs leading-relaxed">
                Members scan their unique pass at the gate. The QR code automatically refreshes every 30 seconds so friends cannot screenshot and proxy entry.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <Check className="w-4 h-4" /> Blocks expired members at entry
            </div>
          </div>

          {/* Card 2 */}
          <div className="group relative bg-white border border-neutral-200 rounded-3xl p-7 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-6">
                <MessageCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-neutral-900 mb-2">Automated WhatsApp Reminders</h3>
              <p className="text-neutral-600 text-xs leading-relaxed">
                Sends polite payment reminders 3 days before expiry with your UPI link, plus automatic motivational nudges to members absent for more than 5 days.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center gap-1.5 text-xs font-semibold text-blue-600">
              <Check className="w-4 h-4" /> Recovers 20-30% lost renewals
            </div>
          </div>

          {/* Card 3 */}
          <div className="group relative bg-white border border-neutral-200 rounded-3xl p-7 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-6">
                <BarChart3 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-neutral-900 mb-2">Rush Hours & Cash Analytics</h3>
              <p className="text-neutral-600 text-xs leading-relaxed">
                Know exactly when your gym is packed (Morning vs Evening rush) and track all cash, UPI collections, and pending balances in one neat tab.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center gap-1.5 text-xs font-semibold text-amber-600">
              <Check className="w-4 h-4" /> Owner-only lock with PIN protection
            </div>
          </div>
        </div>
      </section>

      {/* REAL COMPARISON TABLE (US VS FITBOAT / LEGACY) */}
      <section id="comparison" className="py-20 bg-neutral-100/70 border-y border-neutral-200">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-600">The Hard Truth</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-neutral-900 tracking-tight mt-2">
              Why gym owners ditch legacy softwares
            </h2>
            <p className="text-neutral-500 text-sm mt-2">
              See what you actually save compared to expensive SMS-based ERP tools like FitBoat.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-neutral-200/90 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50/80 text-xs text-neutral-500 uppercase tracking-wider">
                    <th className="py-4 px-6">Feature</th>
                    <th className="py-4 px-6 text-emerald-700 font-bold bg-emerald-50/50">GlitchFiesta Gym OS</th>
                    <th className="py-4 px-6 text-neutral-500">Traditional Software (FitBoat)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 text-neutral-700">
                  <tr>
                    <td className="py-4 px-6 font-semibold text-neutral-900">WhatsApp Notification Fees</td>
                    <td className="py-4 px-6 bg-emerald-50/30 text-emerald-700 font-bold">₹0 (Zero cost direct pings)</td>
                    <td className="py-4 px-6 text-neutral-500">₹0.35 to ₹0.60 per message</td>
                  </tr>
                  <tr>
                    <td className="py-4 px-6 font-semibold text-neutral-900">Biometric Machine Cost</td>
                    <td className="py-4 px-6 bg-emerald-50/30 text-emerald-700 font-bold">Affordable Pi/Optical Sensor</td>
                    <td className="py-4 px-6 text-neutral-500">₹15,000 – ₹25,000 proprietary machines</td>
                  </tr>
                  <tr>
                    <td className="py-4 px-6 font-semibold text-neutral-900">UPI Renewal Fees</td>
                    <td className="py-4 px-6 bg-emerald-50/30 text-emerald-700 font-bold">0% Cut (Direct to your QR)</td>
                    <td className="py-4 px-6 text-neutral-500">2% to 3% payment gateway charges</td>
                  </tr>
                  <tr>
                    <td className="py-4 px-6 font-semibold text-neutral-900">Proxy Attendance Protection</td>
                    <td className="py-4 px-6 bg-emerald-50/30 text-emerald-700 font-bold">Live 30-sec Rotating Passcode</td>
                    <td className="py-4 px-6 text-neutral-500">Static codes easily shared on WhatsApp</td>
                  </tr>
                  <tr>
                    <td className="py-4 px-6 font-semibold text-neutral-900">Inactive Member Retention</td>
                    <td className="py-4 px-6 bg-emerald-50/30 text-emerald-700 font-bold">Auto 5-Day WhatsApp Nudges</td>
                    <td className="py-4 px-6 text-neutral-500">Manual calls or no tracking</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING PLANS */}
      <section id="pricing" className="py-24 max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-600">Transparent Pricing</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-neutral-900 tracking-tight mt-2">
            Affordable monthly plans. Cancel anytime.
          </h2>
          <p className="text-neutral-500 text-sm mt-2">
            No hidden setup fees, no per-member penalties, no annual locked contracts.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 items-stretch">
          {/* Plan 1 */}
          <div className="bg-white border border-neutral-200 rounded-3xl p-8 shadow-sm flex flex-col justify-between hover:border-neutral-300 transition-all">
            <div>
              <h3 className="text-lg font-bold text-neutral-900">Starter Club</h3>
              <p className="text-neutral-500 text-xs mt-1">For single-floor local gyms & fitness studios</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-black text-neutral-900">₹799</span>
                <span className="text-xs text-neutral-500 font-medium">/ month</span>
              </div>
              <ul className="mt-8 space-y-3.5 text-xs text-neutral-600">
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Up to 150 Active Members</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Dynamic Anti-Screenshot QR Scanner</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Member Self-Service Pass & UPI Portal</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Auto PDF Invoices & Receipts</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Receptionist vs Owner Staff PIN Mode</li>
              </ul>
            </div>
            <a
              href={wa('Hi Abhishek, I would like to get started with the Starter Gym OS plan (₹799/mo).')}
              target="_blank"
              rel="noreferrer"
              className="mt-8 w-full py-3.5 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 font-bold text-xs rounded-xl text-center transition"
            >
              Choose Starter
            </a>
          </div>

          {/* Plan 2 - POPULAR */}
          <div className="relative bg-white border-2 border-emerald-500 rounded-3xl p-8 shadow-xl shadow-emerald-500/10 flex flex-col justify-between scale-105 z-10">
            <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[10px] uppercase font-black tracking-widest px-3.5 py-1 rounded-full shadow-md">
              Most Popular
            </span>
            <div>
              <h3 className="text-lg font-bold text-neutral-900">Pro Fitness OS</h3>
              <p className="text-neutral-500 text-xs mt-1">Complete automated retention & hardware control</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-black text-emerald-600">₹1,499</span>
                <span className="text-xs text-neutral-500 font-medium">/ month</span>
              </div>
              <ul className="mt-8 space-y-3.5 text-xs text-neutral-700 font-medium">
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> <strong>Unlimited Members</strong></li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Auto WhatsApp 3-Day Expiry Alerts</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> 5-Day Inactive Member Retention Nudges</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Raspberry Pi Biometric Fingerprint API</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Peak Hour Rush Analytics & Heatmap</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Leads CRM & Inquiry Follow-ups</li>
              </ul>
            </div>
            <a
              href={wa('Hi Abhishek, I want to activate the Pro Fitness OS plan (₹1,499/mo).')}
              target="_blank"
              rel="noreferrer"
              className="mt-8 w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl text-center shadow-lg shadow-emerald-600/25 transition active:scale-95"
            >
              Start 14-Day Free Trial
            </a>
          </div>

          {/* Plan 3 */}
          <div className="bg-white border border-neutral-200 rounded-3xl p-8 shadow-sm flex flex-col justify-between hover:border-neutral-300 transition-all">
            <div>
              <h3 className="text-lg font-bold text-neutral-900">Franchise & Multi-Gym</h3>
              <p className="text-neutral-500 text-xs mt-1">For multi-branch gym owners and chains</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-black text-neutral-900">₹3,499</span>
                <span className="text-xs text-neutral-500 font-medium">/ month</span>
              </div>
              <ul className="mt-8 space-y-3.5 text-xs text-neutral-600">
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Up to 5 Branch Locations</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Multi-turnstile Gate Access Support</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Custom Gym Logo & Receipts Branding</li>
                <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Priority Onboarding & Phone Support</li>
              </ul>
            </div>
            <a
              href={wa('Hi Abhishek, I want to discuss the Franchise Multi-Gym setup.')}
              target="_blank"
              rel="noreferrer"
              className="mt-8 w-full py-3.5 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 font-bold text-xs rounded-xl text-center transition"
            >
              Talk to Sales
            </a>
          </div>
        </div>
      </section>

      {/* FINAL CALL TO ACTION CARD */}
      <section className="py-20 max-w-5xl mx-auto px-6">
        <div className="relative rounded-3xl bg-gradient-to-br from-neutral-900 via-neutral-950 to-neutral-900 text-white p-10 sm:p-14 overflow-hidden shadow-2xl">
          {/* Subtle gym background inside CTA card */}
          <div 
            className="absolute inset-0 z-0 bg-cover bg-center pointer-events-none opacity-15"
            style={{
              backgroundImage: `url('https://images.unsplash.com/photo-1540497077202-7c8a3999166f?q=80&w=1920&auto=format&fit=crop')`,
            }}
          />
          <div className="relative z-10 max-w-xl">
            <span className="text-xs uppercase tracking-widest font-bold text-emerald-400">Ready to Upgrade?</span>
            <h2 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight mt-3">
              Upgrade your gym setup in less than 10 minutes.
            </h2>
            <p className="text-neutral-400 text-sm sm:text-base mt-4 leading-relaxed">
              No tech knowledge required. We help you set up your packages, members, and QR gate scanner over a 15-minute WhatsApp call.
            </p>
            <div className="flex flex-col sm:flex-row gap-3.5 mt-8">
              <a
                href={wa('Hi Abhishek, I want to set up GlitchFiesta Gym OS for my gym.')}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-sm px-7 py-3.5 rounded-2xl shadow-lg shadow-emerald-500/25 transition active:scale-95"
              >
                <MessageCircle className="w-4 h-4" />
                Chat on WhatsApp Directly
              </a>
              <a
                href="tel:+919569272339"
                className="inline-flex items-center justify-center gap-2 border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white font-bold text-sm px-6 py-3.5 rounded-2xl transition"
              >
                <PhoneCall className="w-4 h-4" />
                Call Founder
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-neutral-200 py-10 bg-white">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500">
          <p>© 2026 GlitchFiesta Technologies · Built with pride in India for modern gyms</p>
          <div className="flex items-center gap-6">
            <Link href="/" className="hover:text-neutral-900 transition">Gym Dashboard</Link>
            <Link href="/scan" className="hover:text-neutral-900 transition">Kiosk Scanner</Link>
            <a href={wa('Hi, I need support.')} target="_blank" rel="noreferrer" className="hover:text-neutral-900 transition">Support</a>
          </div>
        </div>
      </footer>
    </main>
  );
}