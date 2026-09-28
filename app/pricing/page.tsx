'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Menu,
  X,
  PhoneCall,
  MessageCircle,
} from 'lucide-react';

const WHATSAPP = '9569272339';
const wa = (msg: string) =>
  `https://wa.me/91${WHATSAPP}?text=${encodeURIComponent(msg)}`;

export default function GymLandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  return (
    <main className="min-h-screen bg-[#FBFBFA] text-[#191919] selection:bg-[#191919] selection:text-[#FBFBFA] relative overflow-hidden">
      {/* Editorial Top Border Accent */}
      <div className="h-1.5 w-full bg-gradient-to-r from-emerald-600 via-teal-500 to-neutral-900" />

      {/* TOP HEADER */}
      <header className="border-b border-neutral-200/80 bg-[#FBFBFA]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-[#191919] text-[#FBFBFA] font-black text-xs flex items-center justify-center tracking-tighter">
              GF
            </span>
            <div className="leading-tight">
              <span className="font-bold text-base tracking-tight block">GlitchFiesta Gym</span>
              <span className="text-[10px] uppercase tracking-widest text-neutral-400 block font-medium">Management Suite</span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-neutral-600">
            <a href="#features" className="hover:text-black transition">Features</a>
            <a href="#flow" className="hover:text-black transition">How It Works</a>
            <a href="#pricing" className="hover:text-black transition">Pricing</a>
            <Link href="/" className="hover:text-black transition text-neutral-500">Live Dashboard</Link>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <a
              href={wa('Hi Abhishek, I would like to see a quick demo of GlitchFiesta Gym software.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-[#191919] hover:bg-neutral-800 text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition"
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
              Schedule Demo
            </a>
          </div>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 text-neutral-700"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-neutral-200 bg-[#FBFBFA] px-6 py-5 flex flex-col gap-4 text-sm font-medium">
            <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
            <a href="#flow" onClick={() => setMenuOpen(false)}>How It Works</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
            <a
              href={wa('Hi Abhishek, I want to book a demo of GlitchFiesta Gym software.')}
              target="_blank"
              rel="noreferrer"
              className="bg-[#191919] text-white text-center py-2.5 rounded-lg text-xs font-semibold"
            >
              WhatsApp Support (+91 9569272339)
            </a>
          </div>
        )}
      </header>

      {/* HERO: Graphic Silhouette & Asymmetric Composition */}
      <section className="relative pt-16 pb-20 border-b border-neutral-200">
        {/* Haikei Fluid Curvature Graphic Layer in composition */}
        <div className="absolute right-0 top-0 bottom-0 w-full lg:w-1/2 pointer-events-none overflow-hidden opacity-90">
          <svg
            className="absolute -right-20 -top-12 w-[680px] h-[680px]"
            viewBox="0 0 800 800"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M718.5 244.5C768 335.5 733.5 456 673 543C612.5 630 526 683.5 425 718C324 752.5 208.5 768 126 718C43.5 668 -6 552.5 2 443.5C10 334.5 75.5 232 158 152.5C240.5 73 340 16.5 444.5 10C549 3.5 669 153.5 718.5 244.5Z"
              fill="#F0EFEA"
            />
            <path
              d="M660 300C700 375 670 475 620 545C570 615 500 655 420 680C340 705 250 715 185 675C120 635 80 545 85 455C90 365 140 280 205 215C270 150 350 105 435 100C520 95 620 225 660 300Z"
              fill="#E8F5E9"
              fillOpacity="0.4"
            />
          </svg>
        </div>

        <div className="max-w-6xl mx-auto px-6 relative z-10">
          <div className="max-w-2xl">
            <span className="inline-block text-xs font-semibold text-emerald-800 bg-emerald-100/70 border border-emerald-300/60 px-3 py-1 rounded-md mb-6">
              Complete Front-Desk & Gate Automation
            </span>

            <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.08] text-[#151515]">
              The effortless operating system for modern gyms.
            </h1>

            <p className="mt-6 text-base sm:text-lg text-neutral-600 leading-relaxed font-normal">
              Manage member enrollments, gate check-ins, automated WhatsApp renewal reminders, and tax billing from a single fast dashboard.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 mt-8">
              <a
                href={wa('Hi Abhishek, I want to start a 14-day trial of GlitchFiesta Gym OS.')}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-[#191919] hover:bg-neutral-800 text-white px-7 py-3.5 rounded-xl font-semibold text-sm transition shadow-sm"
              >
                <span>Start 14-Day Free Trial</span>
                <ArrowRight className="w-4 h-4 text-emerald-400" />
              </a>

              <Link
                href="/scan"
                target="_blank"
                className="inline-flex items-center justify-center gap-2 border border-neutral-300 hover:border-neutral-900 bg-white px-6 py-3.5 rounded-xl font-medium text-sm transition"
              >
                <span>Live Scanner View</span>
                <ArrowUpRight className="w-4 h-4 text-neutral-400" />
              </Link>
            </div>

            <div className="mt-10 pt-6 border-t border-neutral-200 grid grid-cols-3 gap-6 text-neutral-600 text-xs">
              <div>
                <p className="font-bold text-neutral-900 text-sm">30-Sec Pass</p>
                <p className="text-neutral-500 mt-0.5">Anti-proxy digital QR</p>
              </div>
              <div>
                <p className="font-bold text-neutral-900 text-sm">Direct UPI</p>
                <p className="text-neutral-500 mt-0.5">No gateway fee deductions</p>
              </div>
              <div>
                <p className="font-bold text-neutral-900 text-sm">Biometric</p>
                <p className="text-neutral-500 mt-0.5">Hardware & turnstile ready</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: EDITORIAL FEATURES LIST (NO GENERIC CARDS) */}
      <section id="features" className="py-20 max-w-6xl mx-auto px-6">
        <div className="border-b border-neutral-300 pb-4 mb-12 flex justify-between items-end">
          <div>
            <span className="text-xs uppercase tracking-widest text-emerald-700 font-bold block mb-1">
              Core Capabilities
            </span>
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-neutral-900">
              Built specifically for gym floor realities
            </h2>
          </div>
          <span className="hidden sm:inline text-xs text-neutral-400 font-medium">01 — 04</span>
        </div>

        <div className="divide-y divide-neutral-200">
          {/* Item 1 */}
          <div className="py-10 grid md:grid-cols-12 gap-6 items-baseline">
            <div className="md:col-span-1 text-sm font-bold text-neutral-400">01</div>
            <div className="md:col-span-4">
              <h3 className="text-xl font-bold text-neutral-900">Anti-Proxy Member QR Pass</h3>
              <p className="text-xs text-emerald-700 font-medium mt-1">Stops shared screenshot entries</p>
            </div>
            <div className="md:col-span-7 text-sm text-neutral-600 leading-relaxed">
              Members access their pass through their phone without installing heavy apps. The access token rotates dynamically every 30 seconds. Expired members are automatically blocked with a distinct alert chime at the reception.
            </div>
          </div>

          {/* Item 2 */}
          <div className="py-10 grid md:grid-cols-12 gap-6 items-baseline">
            <div className="md:col-span-1 text-sm font-bold text-neutral-400">02</div>
            <div className="md:col-span-4">
              <h3 className="text-xl font-bold text-neutral-900">Automated WhatsApp Reminders</h3>
              <p className="text-xs text-emerald-700 font-medium mt-1">Timely alerts without per-SMS bills</p>
            </div>
            <div className="md:col-span-7 text-sm text-neutral-600 leading-relaxed">
              Your system sends automated payment reminders 3 days before membership expiration with your direct UPI payment link. When active members stay absent for 5 days, it automatically sends a friendly motivational check-in.
            </div>
          </div>

          {/* Item 3 */}
          <div className="py-10 grid md:grid-cols-12 gap-6 items-baseline">
            <div className="md:col-span-1 text-sm font-bold text-neutral-400">03</div>
            <div className="md:col-span-4">
              <h3 className="text-xl font-bold text-neutral-900">Biometric & Turnstile Integration</h3>
              <p className="text-xs text-emerald-700 font-medium mt-1">Compatible with physical gym gates</p>
            </div>
            <div className="md:col-span-7 text-sm text-neutral-600 leading-relaxed">
              Connect biometric optical fingerprint sensors and turnstile gates seamlessly with our verification endpoints. Members can enter either using their digital QR pass or their enrolled fingerprint ID.
            </div>
          </div>

          {/* Item 4 */}
          <div className="py-10 grid md:grid-cols-12 gap-6 items-baseline">
            <div className="md:col-span-1 text-sm font-bold text-neutral-400">04</div>
            <div className="md:col-span-4">
              <h3 className="text-xl font-bold text-neutral-900">Hourly Rush & Cash Analytics</h3>
              <p className="text-xs text-emerald-700 font-medium mt-1">Protected with Owner PIN</p>
            </div>
            <div className="md:col-span-7 text-sm text-neutral-600 leading-relaxed">
              View morning vs evening traffic heatmaps to optimize floor trainer allocation. Front-desk staff only see check-in flows, while financial collections and package editing remain locked under your private Owner PIN.
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: HOW IT WORKS (SIMPLE TIMELINE) */}
      <section id="flow" className="py-16 bg-[#F3F2EE] border-y border-neutral-200">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-xl mb-12">
            <span className="text-xs uppercase tracking-widest text-neutral-500 font-bold block mb-1">
              Onboarding
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-neutral-900">
              Live in under 15 minutes
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white p-7 rounded-2xl border border-neutral-200/80 shadow-sm">
              <span className="text-xs font-mono font-bold text-neutral-400 block mb-3">STEP 01</span>
              <h3 className="text-base font-bold text-neutral-900 mb-2">Import Your Members</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Send us your member register or Excel sheet. We set up your gym details, member records, and packages immediately.
              </p>
            </div>

            <div className="bg-white p-7 rounded-2xl border border-neutral-200/80 shadow-sm">
              <span className="text-xs font-mono font-bold text-neutral-400 block mb-3">STEP 02</span>
              <h3 className="text-base font-bold text-neutral-900 mb-2">Place Your Front Kiosk</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Open the scanner page on any tablet, old laptop, or desk monitor. Members can immediately begin checking in.
              </p>
            </div>

            <div className="bg-white p-7 rounded-2xl border border-neutral-200/80 shadow-sm">
              <span className="text-xs font-mono font-bold text-neutral-400 block mb-3">STEP 03</span>
              <h3 className="text-base font-bold text-neutral-900 mb-2">Autopilot Collections</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Renewals, WhatsApp reminders, and receipts run automatically while you focus on training and acquiring new members.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: PRICING (HONEST & MINIMAL) */}
      <section id="pricing" className="py-24 max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6 border-b border-neutral-200 pb-6">
          <div>
            <span className="text-xs uppercase tracking-widest text-emerald-700 font-bold block mb-1">
              Subscriptions
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-neutral-900">
              Simple pricing for every gym stage
            </h2>
          </div>

          <div className="flex items-center bg-neutral-200/70 p-1 rounded-lg text-xs font-semibold text-neutral-600">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-3 py-1.5 rounded-md transition ${
                billingCycle === 'monthly' ? 'bg-white text-neutral-900 shadow-sm' : ''
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-3 py-1.5 rounded-md transition ${
                billingCycle === 'yearly' ? 'bg-white text-neutral-900 shadow-sm' : ''
              }`}
            >
              Yearly (Save 20%)
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 items-stretch">
          {/* Starter Plan */}
          <div className="border border-neutral-200 bg-white rounded-2xl p-7 flex flex-col justify-between">
            <div>
              <h3 className="text-lg font-bold text-neutral-900">Starter Gym</h3>
              <p className="text-xs text-neutral-500 mt-1">For single-floor clubs & boutique studios</p>
              <div className="my-6">
                <span className="text-4xl font-black text-neutral-900">
                  ₹{billingCycle === 'monthly' ? '799' : '649'}
                </span>
                <span className="text-xs text-neutral-500"> /month</span>
              </div>
              <ul className="space-y-3 text-xs text-neutral-700">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Up to 150 active members</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Dynamic QR kiosk scanner</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Member self-portal with instant pass</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> PDF billing & tax invoice generator</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Reception vs Owner access control</li>
              </ul>
            </div>
            <a
              href={wa('Hi Abhishek, I would like to get started with the Starter Gym plan.')}
              target="_blank"
              rel="noreferrer"
              className="mt-8 w-full py-3 rounded-xl border border-neutral-300 hover:border-neutral-900 text-neutral-900 font-semibold text-xs text-center transition"
            >
              Get Started
            </a>
          </div>

          {/* Pro Plan (Standard Recommended) */}
          <div className="border-2 border-[#191919] bg-white rounded-2xl p-7 flex flex-col justify-between shadow-xl relative">
            <span className="absolute -top-3 left-6 bg-[#191919] text-white text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded">
              Most Popular
            </span>
            <div>
              <h3 className="text-lg font-bold text-neutral-900">Pro Fitness OS</h3>
              <p className="text-xs text-neutral-500 mt-1">Full access automation & retention</p>
              <div className="my-6">
                <span className="text-4xl font-black text-emerald-700">
                  ₹{billingCycle === 'monthly' ? '1,499' : '1,199'}
                </span>
                <span className="text-xs text-neutral-500"> /month</span>
              </div>
              <ul className="space-y-3 text-xs text-neutral-800 font-medium">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> <strong>Unlimited member records</strong></li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Automated 3-day advance WhatsApp expiry alerts</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> 5-day inactive member retention pings</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Biometric optical scanner integration</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Peak-hour traffic breakdown analytics</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Inquiry & lead CRM management</li>
              </ul>
            </div>
            <a
              href={wa('Hi Abhishek, I would like to deploy the Pro Fitness OS plan.')}
              target="_blank"
              rel="noreferrer"
              className="mt-8 w-full py-3 rounded-xl bg-[#191919] hover:bg-neutral-800 text-white font-semibold text-xs text-center transition"
            >
              Start 14-Day Free Pilot
            </a>
          </div>

          {/* Multi-Gym Plan */}
          <div className="border border-neutral-200 bg-white rounded-2xl p-7 flex flex-col justify-between">
            <div>
              <h3 className="text-lg font-bold text-neutral-900">Franchise & Multi-Gym</h3>
              <p className="text-xs text-neutral-500 mt-1">For multi-branch gym owners</p>
              <div className="my-6">
                <span className="text-4xl font-black text-neutral-900">
                  ₹{billingCycle === 'monthly' ? '3,499' : '2,899'}
                </span>
                <span className="text-xs text-neutral-500"> /month</span>
              </div>
              <ul className="space-y-3 text-xs text-neutral-700">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Up to 5 gym branch locations</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Multi-turnstile entry management</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Custom branding & receipts</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Priority telephone onboarding</li>
              </ul>
            </div>
            <a
              href={wa('Hi Abhishek, I want to discuss the Franchise Multi-Gym setup.')}
              target="_blank"
              rel="noreferrer"
              className="mt-8 w-full py-3 rounded-xl border border-neutral-300 hover:border-neutral-900 text-neutral-900 font-semibold text-xs text-center transition"
            >
              Contact Solutions
            </a>
          </div>
        </div>
      </section>

      {/* FINAL DIRECT CTA */}
      <section className="py-16 max-w-6xl mx-auto px-6">
        <div className="bg-[#191919] text-white rounded-3xl p-8 sm:p-12 flex flex-col sm:flex-row items-center justify-between gap-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Ready to simplify your gym desk?
            </h2>
            <p className="text-neutral-400 text-xs sm:text-sm mt-2 max-w-md">
              Speak directly with our team. We set up your entire gym list and test the scanner with you over WhatsApp.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <a
              href={wa('Hi Abhishek, I want to set up GlitchFiesta Gym software for my gym.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs px-6 py-3.5 rounded-xl transition"
            >
              <MessageCircle className="w-4 h-4" />
              Chat on WhatsApp
            </a>
            <a
              href="tel:+919569272339"
              className="inline-flex items-center justify-center gap-2 border border-neutral-700 hover:border-neutral-500 text-white font-medium text-xs px-5 py-3.5 rounded-xl transition"
            >
              <PhoneCall className="w-4 h-4" />
              Call +91 9569272339
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-neutral-200 py-8 text-neutral-500 text-xs">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 GlitchFiesta Technologies · Gym Management Platform</p>
          <div className="flex items-center gap-6">
            <Link href="/" className="hover:text-neutral-900 transition">Gym Dashboard</Link>
            <Link href="/scan" className="hover:text-neutral-900 transition">Kiosk Scanner</Link>
            <a href={wa('Hi Abhishek, I need support.')} target="_blank" rel="noreferrer" className="hover:text-neutral-900 transition">
              Direct Support
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}