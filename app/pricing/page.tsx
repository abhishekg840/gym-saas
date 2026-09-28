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

export default function HaikeiGymLanding() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  return (
    <main className="min-h-screen bg-[#F4F4F0] text-[#111215] font-sans selection:bg-[#111215] selection:text-[#F4F4F0] relative overflow-hidden">
      
      {/* ==========================================
          HAIKEI SVG CANVAS LAYER 1: HERO TOP WAVES
          ========================================== */}
      <div className="absolute top-0 left-0 right-0 w-full overflow-hidden leading-none pointer-events-none z-0">
        <svg
          className="w-full h-[520px] sm:h-[680px] object-cover opacity-90"
          viewBox="0 0 1440 600"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Layer 1: Soft Stone Fluid */}
          <path
            d="M0 0H1440V340C1320 390 1180 430 980 380C780 330 640 210 460 250C280 290 120 420 0 460V0Z"
            fill="#EAE9E1"
          />
          {/* Layer 2: Subtle Tint Fluid */}
          <path
            d="M0 0H1440V240C1280 310 1100 320 940 270C760 210 680 130 480 160C260 190 140 330 0 350V0Z"
            fill="#E1E5DC"
            fillOpacity="0.65"
          />
          {/* Layer 3: Sage Curve Edge */}
          <path
            d="M0 0H1440V160C1260 230 1120 200 960 150C780 90 620 60 420 110C240 160 100 240 0 250V0Z"
            fill="#D5DDD2"
            fillOpacity="0.45"
          />
          {/* Geometric Topo Contour Grid Overlay */}
          <line x1="240" y1="0" x2="240" y2="500" stroke="#111215" strokeOpacity="0.05" strokeWidth="1" strokeDasharray="6 6" />
          <line x1="720" y1="0" x2="720" y2="500" stroke="#111215" strokeOpacity="0.05" strokeWidth="1" strokeDasharray="6 6" />
          <line x1="1200" y1="0" x2="1200" y2="500" stroke="#111215" strokeOpacity="0.05" strokeWidth="1" strokeDasharray="6 6" />
        </svg>
      </div>

      {/* TOP HEADER */}
      <header className="relative z-30 border-b border-[#111215]/10 bg-transparent">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-md bg-[#111215] text-[#F4F4F0] font-black text-xs flex items-center justify-center tracking-tighter">
              GF
            </span>
            <div className="leading-tight">
              <span className="font-extrabold text-sm uppercase tracking-tight block">GlitchFiesta</span>
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#111215]/50 block">Gym OS</span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-9 text-xs font-mono uppercase tracking-widest text-[#111215]/70">
            <a href="#features" className="hover:text-black transition">Platform</a>
            <a href="#flow" className="hover:text-black transition">Workflow</a>
            <a href="#pricing" className="hover:text-black transition">Plans</a>
            <Link href="/" className="hover:text-black transition text-emerald-800 font-semibold">Live System</Link>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <a
              href={wa('Hi Abhishek, I would like to see a demo of GlitchFiesta Gym software.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-[#111215] hover:bg-neutral-800 text-[#F4F4F0] text-xs font-semibold px-5 py-2.5 rounded-full transition shadow-sm active:scale-95"
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
              Schedule 10-Min Demo
            </a>
          </div>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 text-neutral-800"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-neutral-300 bg-[#F4F4F0] px-6 py-5 flex flex-col gap-4 text-xs font-mono uppercase">
            <a href="#features" onClick={() => setMenuOpen(false)}>Platform</a>
            <a href="#flow" onClick={() => setMenuOpen(false)}>Workflow</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>Plans</a>
            <a
              href={wa('Hi Abhishek, I want a demo of GlitchFiesta Gym software.')}
              target="_blank"
              rel="noreferrer"
              className="bg-[#111215] text-[#F4F4F0] text-center py-3 rounded-full font-bold"
            >
              WhatsApp Support
            </a>
          </div>
        )}
      </header>

      {/* HERO SECTION: Asymmetric Typography + Generative Geometry */}
      <section className="relative z-10 pt-16 sm:pt-24 pb-28 max-w-7xl mx-auto px-6 sm:px-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-start">
          
          <div className="lg:col-span-8">
            <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#111215]/70 mb-8 border-b border-[#111215]/20 pb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
              Version 3.4 // Autonomous Desk Engine
            </div>

            <h1 className="text-[clamp(46px,7vw,104px)] font-black tracking-[-0.06em] leading-[0.88] uppercase text-[#111215]">
              ZERO UNPAID
              <br />
              CHECK-INS.
              <br />
              <span className="text-emerald-800">AUTOMATED</span>
              <br />
              RENEWALS.
            </h1>

            <p className="mt-8 text-base sm:text-xl text-[#111215]/70 max-w-xl font-normal leading-relaxed">
              Anti-proxy rotating passes, hardware biometric gate sync, auto WhatsApp fee reminders with direct 0% UPI links, and instant tax receipts.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mt-10">
              <a
                href={wa('Hi Abhishek, I want to start our 14-day free gym trial on GlitchFiesta Gym OS.')}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-3 bg-[#111215] hover:bg-neutral-800 text-[#F4F4F0] px-8 py-4 rounded-full font-semibold text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 group"
              >
                <span>Activate Free 14-Day Pilot</span>
                <ArrowRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-1 transition-transform" />
              </a>

              <Link
                href="/scan"
                target="_blank"
                className="inline-flex items-center justify-center gap-2 border border-[#111215]/30 hover:border-[#111215] bg-[#F4F4F0]/80 backdrop-blur-md px-7 py-4 rounded-full font-mono text-xs uppercase tracking-wider transition"
              >
                <span>Live Front-Desk Kiosk</span>
                <ArrowUpRight className="w-4 h-4 text-neutral-500" />
              </Link>
            </div>
          </div>

          {/* Right Column: Generative Telemetry Card */}
          <div className="lg:col-span-4 relative lg:pt-8">
            <div className="border border-[#111215]/15 bg-[#FBFBFA]/90 backdrop-blur-xl rounded-[28px] p-6 shadow-xl relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#111215]/10 pb-4 mb-5 font-mono">
                <span className="text-[10px] uppercase tracking-widest text-[#111215]/50">Desk Telemetry</span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
                  GATE LIVE
                </span>
              </div>

              <div className="space-y-4">
                <div className="bg-[#EFEFEA] p-4 rounded-2xl border border-[#111215]/5">
                  <div className="flex justify-between items-baseline font-mono text-xs text-[#111215]/60">
                    <span>TODAY CHECK-INS</span>
                    <span className="text-emerald-800 font-bold">142 GRANTED</span>
                  </div>
                  <div className="text-3xl font-black font-mono tracking-tight mt-1">100% Verified</div>
                </div>

                <div className="bg-[#EFEFEA] p-4 rounded-2xl border border-[#111215]/5">
                  <div className="flex justify-between items-baseline font-mono text-xs text-[#111215]/60">
                    <span>PROXY PREVENTED</span>
                    <span className="text-rose-600 font-bold">7 BLOCKED</span>
                  </div>
                  <div className="text-xl font-bold font-mono tracking-tight mt-1 text-rose-700">Expired Gates Locked</div>
                </div>

                <div className="p-4 bg-[#111215] text-[#F4F4F0] rounded-2xl flex items-center justify-between text-xs font-mono">
                  <span className="text-neutral-400">Direct Shop UPI</span>
                  <span className="font-bold text-emerald-400">0% Gateway Fee</span>
                </div>
              </div>
            </div>

            {/* Badge Indicator */}
            <div className="mt-4 flex items-center justify-between px-2 font-mono text-[10px] uppercase text-[#111215]/50">
              <span>Dynamic 30s Pass</span>
              <span>Biometric Sync Ready</span>
            </div>
          </div>
        </div>
      </section>

      {/* ==========================================
          HAIKEI SECTION DIVIDER: Wave Shape Step
          ========================================== */}
      <div className="relative w-full overflow-hidden leading-none z-10 -mb-1">
        <svg
          className="w-full h-20 sm:h-32 object-fill"
          viewBox="0 0 1440 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 60C320 120 480 0 800 60C1120 120 1280 30 1440 60V120H0V60Z"
            fill="#FFFFFF"
          />
        </svg>
      </div>

      {/* ==========================================
          SECTION 2: EDITORIAL GRID (CLEAN WHITE)
          ========================================== */}
      <section id="features" className="relative z-20 py-24 bg-white border-b border-[#111215]/10">
        <div className="max-w-7xl mx-auto px-6 sm:px-10">
          <div className="border-b border-[#111215]/15 pb-6 mb-16 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <span className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-800 font-bold block mb-1">
                [ 01 // OPERATIONAL MODULES ]
              </span>
              <h2 className="text-3xl sm:text-5xl font-black uppercase tracking-tight text-[#111215]">
                Engineered for daily speed
              </h2>
            </div>
            <span className="font-mono text-xs text-[#111215]/40">System Architecture</span>
          </div>

          <div className="grid md:grid-cols-3 gap-10">
            {/* Block 1 */}
            <div className="border-l-2 border-[#111215] pl-6 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs text-[#111215]/40 block mb-6">MODULE 01</span>
                <h3 className="text-xl font-black uppercase tracking-tight mb-3">Anti-Proxy QR Pass</h3>
                <p className="text-sm text-[#111215]/70 leading-relaxed font-normal">
                  Members show a pass on their phone that auto-refreshes every 30 seconds. Screenshots cannot be shared among friends. Expired members trigger a loud chime at reception and access is automatically refused.
                </p>
              </div>
              <span className="mt-8 font-mono text-[11px] text-emerald-800 font-bold block">
                → ZERO UNAUTHORIZED ENTRIES
              </span>
            </div>

            {/* Block 2 */}
            <div className="border-l-2 border-[#111215] pl-6 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs text-[#111215]/40 block mb-6">MODULE 02</span>
                <h3 className="text-xl font-black uppercase tracking-tight mb-3">Automated WhatsApp Alert</h3>
                <p className="text-sm text-[#111215]/70 leading-relaxed font-normal">
                  Sends friendly renewal alerts 3 days prior with your direct UPI payment link. Also sends automatic motivational nudges to members who haven't checked in for 5 consecutive days to prevent churn.
                </p>
              </div>
              <span className="mt-8 font-mono text-[11px] text-emerald-800 font-bold block">
                → NO MANUAL CALLING
              </span>
            </div>

            {/* Block 3 */}
            <div className="border-l-2 border-[#111215] pl-6 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs text-[#111215]/40 block mb-6">MODULE 03</span>
                <h3 className="text-xl font-black uppercase tracking-tight mb-3">Biometrics & Turnstiles</h3>
                <p className="text-sm text-[#111215]/70 leading-relaxed font-normal">
                  Ready for physical turnstile gates and optical fingerprint sensors. Members can enter either using their dynamic phone pass or their registered fingerprint ID instantly.
                </p>
              </div>
              <span className="mt-8 font-mono text-[11px] text-emerald-800 font-bold block">
                → COMPLETE GATE AUTOMATION
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ==========================================
          SECTION 3: HOW IT WORKS (STEP CURVATURE)
          ========================================== */}
      <section id="flow" className="relative z-10 py-24 max-w-7xl mx-auto px-6 sm:px-10">
        <div className="max-w-xl mb-16">
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-[#111215]/50 font-bold block mb-2">
            [ 02 // ONBOARDING ]
          </span>
          <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">
            Ready in 15 minutes
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-[#EAE9E1]/70 border border-[#111215]/10 p-8 rounded-[24px]">
            <span className="font-mono text-xs font-bold text-[#111215]/40 block mb-4">STEP 01</span>
            <h3 className="text-lg font-bold uppercase mb-2">Send Your Member List</h3>
            <p className="text-xs text-[#111215]/70 leading-relaxed">
              Share your member register or Excel sheet over WhatsApp. We configure your packages, plans, and existing member list immediately.
            </p>
          </div>

          <div className="bg-[#EAE9E1]/70 border border-[#111215]/10 p-8 rounded-[24px]">
            <span className="font-mono text-xs font-bold text-[#111215]/40 block mb-4">STEP 02</span>
            <h3 className="text-lg font-bold uppercase mb-2">Open Front Kiosk</h3>
            <p className="text-xs text-[#111215]/70 leading-relaxed">
              Open the scanner URL on any tablet, front desk PC, or phone. Members scan their phone pass upon entering the facility.
            </p>
          </div>

          <div className="bg-[#EAE9E1]/70 border border-[#111215]/10 p-8 rounded-[24px]">
            <span className="font-mono text-xs font-bold text-[#111215]/40 block mb-4">STEP 03</span>
            <h3 className="text-lg font-bold uppercase mb-2">Autonomous Renewals</h3>
            <p className="text-xs text-[#111215]/70 leading-relaxed">
              WhatsApp reminders and direct UPI collections run automatically. Receipts are generated with zero manual paperwork.
            </p>
          </div>
        </div>
      </section>

      {/* ==========================================
          SECTION 4: PRICING (MONOLITHIC CONTRAST)
          ========================================== */}
      <section id="pricing" className="relative z-10 py-28 border-t border-[#111215]/10 bg-[#EFEFEA]">
        <div className="max-w-7xl mx-auto px-6 sm:px-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6 border-b border-[#111215]/15 pb-6">
            <div>
              <span className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-800 font-bold block mb-1">
                [ 03 // MEMBERSHIP TIERS ]
              </span>
              <h2 className="text-3xl sm:text-5xl font-black uppercase tracking-tight">
                Simple monthly plans
              </h2>
            </div>

            <div className="flex items-center bg-[#F4F4F0] border border-[#111215]/15 p-1 rounded-full text-xs font-mono">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-4 py-1.5 rounded-full font-bold transition ${
                  billingCycle === 'monthly' ? 'bg-[#111215] text-[#F4F4F0]' : 'text-neutral-500'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle('yearly')}
                className={`px-4 py-1.5 rounded-full font-bold transition flex items-center gap-1 ${
                  billingCycle === 'yearly' ? 'bg-[#111215] text-[#F4F4F0]' : 'text-neutral-500'
                }`}
              >
                Yearly <span className="text-[10px] text-emerald-700">(-20%)</span>
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 items-stretch">
            {/* Plan 1: Starter */}
            <div className="border border-[#111215]/15 bg-[#F4F4F0] rounded-[28px] p-8 flex flex-col justify-between shadow-sm hover:shadow-lg transition-all">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#111215]/50 block mb-1">Single Floor Studio</span>
                <h3 className="text-2xl font-black uppercase">Starter Club</h3>
                <p className="text-xs text-[#111215]/60 mt-2 font-normal">
                  Ideal for local fitness clubs, yoga centers, and strength gyms.
                </p>

                <div className="my-8">
                  <span className="text-5xl font-black font-mono">
                    ₹{billingCycle === 'monthly' ? '799' : '649'}
                  </span>
                  <span className="text-xs font-mono text-[#111215]/50"> /month</span>
                </div>

                <ul className="space-y-3.5 text-xs text-[#111215]/80">
                  <li className="flex items-center gap-2.5 font-medium"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> Up to 150 active members</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> Dynamic anti-proxy QR kiosk scanner</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> Member self-service pass & UPI portal</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> PDF billing receipts & invoice generator</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> Staff vs Owner PIN access lock</li>
                </ul>
              </div>

              <a
                href={wa('Hi Abhishek, I would like to set up the Starter Gym OS plan (₹799/mo).')}
                target="_blank"
                rel="noreferrer"
                className="mt-10 w-full py-4 rounded-full border border-[#111215]/30 hover:border-[#111215] bg-[#F4F4F0] text-center font-mono font-bold text-xs uppercase tracking-wider transition"
              >
                Choose Starter
              </a>
            </div>

            {/* Plan 2: Pro (Solid Black Accent Card) */}
            <div className="border-2 border-[#111215] bg-[#111215] text-[#F4F4F0] rounded-[28px] p-8 sm:p-10 flex flex-col justify-between shadow-2xl relative lg:-translate-y-3">
              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-400 text-[#111215] font-black font-mono text-[10px] uppercase tracking-widest px-3.5 py-1 rounded-full shadow-md">
                RECOMMENDED
              </span>

              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-400 block mb-1">Full Automation</span>
                <h3 className="text-3xl font-black uppercase text-white">Pro Fitness OS</h3>
                <p className="text-xs text-neutral-400 mt-2 font-normal">
                  Complete WhatsApp reminders, retention engine, and gate sync.
                </p>

                <div className="my-8">
                  <span className="text-6xl font-black font-mono text-emerald-400">
                    ₹{billingCycle === 'monthly' ? '1,499' : '1,199'}
                  </span>
                  <span className="text-xs font-mono text-neutral-400"> /month</span>
                </div>

                <ul className="space-y-3.5 text-xs text-neutral-300">
                  <li className="flex items-center gap-2.5 font-bold text-white"><Check className="w-4 h-4 text-emerald-400 shrink-0" /> Unlimited registered members</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-400 shrink-0" /> Automated 3-day advance WhatsApp expiry alerts</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-400 shrink-0" /> 5-day inactive member retention pings</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-400 shrink-0" /> Biometric optical scanner integration</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-400 shrink-0" /> Peak-hour traffic breakdown analytics</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-400 shrink-0" /> Leads CRM & enquiry follow-ups</li>
                </ul>
              </div>

              <a
                href={wa('Hi Abhishek, I want to activate the Pro Fitness OS plan (₹1,499/mo).')}
                target="_blank"
                rel="noreferrer"
                className="mt-10 w-full py-4 rounded-full bg-emerald-400 hover:bg-emerald-300 text-[#111215] text-center font-mono font-black text-xs uppercase tracking-wider transition shadow-lg shadow-emerald-400/20 active:scale-95"
              >
                Deploy 14-Day Free Pilot
              </a>
            </div>

            {/* Plan 3: Franchise */}
            <div className="border border-[#111215]/15 bg-[#F4F4F0] rounded-[28px] p-8 flex flex-col justify-between shadow-sm hover:shadow-lg transition-all">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#111215]/50 block mb-1">Multi-Branch Setup</span>
                <h3 className="text-2xl font-black uppercase">Franchise & Chain</h3>
                <p className="text-xs text-[#111215]/60 mt-2 font-normal">
                  For multi-location gym chains and multi-gate turnstiles.
                </p>

                <div className="my-8">
                  <span className="text-5xl font-black font-mono">
                    ₹{billingCycle === 'monthly' ? '3,499' : '2,899'}
                  </span>
                  <span className="text-xs font-mono text-[#111215]/50"> /month</span>
                </div>

                <ul className="space-y-3.5 text-xs text-[#111215]/80">
                  <li className="flex items-center gap-2.5 font-medium"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> Up to 5 gym branch locations</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> Multi-turnstile entry management</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> Custom branding & receipts</li>
                  <li className="flex items-center gap-2.5"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> Priority telephone onboarding</li>
                </ul>
              </div>

              <a
                href={wa('Hi Abhishek, I want to discuss the Franchise Multi-Gym setup.')}
                target="_blank"
                rel="noreferrer"
                className="mt-10 w-full py-4 rounded-full border border-[#111215]/30 hover:border-[#111215] bg-[#F4F4F0] text-center font-mono font-bold text-xs uppercase tracking-wider transition"
              >
                Talk to Sales
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ==========================================
          SECTION 5: DIRECT ONBOARDING CALL
          ========================================== */}
      <section className="py-20 max-w-7xl mx-auto px-6 sm:px-10">
        <div className="bg-[#111215] text-[#F4F4F0] rounded-[32px] p-8 sm:p-14 flex flex-col sm:flex-row items-center justify-between gap-8 shadow-xl">
          <div>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold block mb-2">
              Instant Setup
            </span>
            <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tight">
              Ready to upgrade your gym floor?
            </h2>
            <p className="text-neutral-400 text-xs sm:text-sm mt-2 max-w-md font-light">
              Chat directly with our team. We configure your members and run your first test check-in with you over WhatsApp.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <a
              href={wa('Hi Abhishek, I want to set up GlitchFiesta Gym software for my gym.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-emerald-400 hover:bg-emerald-300 text-[#111215] font-mono font-bold text-xs uppercase px-7 py-4 rounded-full transition active:scale-95"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp Us
            </a>

            <a
              href="tel:+919569272339"
              className="inline-flex items-center justify-center gap-2 border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white font-mono text-xs uppercase px-6 py-4 rounded-full transition"
            >
              <PhoneCall className="w-4 h-4" />
              Call +91 9569272339
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#111215]/10 py-10 max-w-7xl mx-auto px-6 sm:px-10 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs text-[#111215]/50 uppercase tracking-wider">
        <p>© 2026 GlitchFiesta Technologies · Gym Management Platform</p>
        <div className="flex items-center gap-6">
          <Link href="/" className="hover:text-black transition">Dashboard</Link>
          <Link href="/scan" className="hover:text-black transition">Scanner</Link>
          <a href={wa('Hi, I need support.')} target="_blank" rel="noreferrer" className="hover:text-black transition">Support</a>
        </div>
      </footer>
    </main>
  );
}