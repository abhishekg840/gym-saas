'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
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
} from 'lucide-react';
import { useState } from 'react';

const WHATSAPP = '9569272339';

const wa = (message: string) =>
  `https://wa.me/91${WHATSAPP}?text=${encodeURIComponent(message)}`;

export default function PricingLandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className="min-h-screen bg-[#090909] text-[#f5f5f0] overflow-x-hidden">
      {/* Announcement */}
      <div className="bg-[#c8ff00] text-black text-[11px] font-bold tracking-[0.16em] uppercase text-center py-2.5 px-4">
        14 Days Free Trial · No Credit Card Required
      </div>

      {/* NAVBAR */}
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#090909]/90 backdrop-blur-xl">
        <div className="max-w-[1380px] mx-auto px-5 sm:px-8">
          <nav className="h-[76px] flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-9 h-9 bg-[#c8ff00] text-black flex items-center justify-center rounded-full font-black text-sm">
                GF
              </div>

              <div>
                <div className="font-semibold tracking-[-0.03em] leading-none">
                  GlitchFiesta
                </div>
                <div className="text-[9px] uppercase tracking-[0.22em] text-white/40 mt-1">
                  Gym OS
                </div>
              </div>
            </Link>

            <div className="hidden md:flex items-center gap-9 text-[13px] text-white/55">
              <a href="#features" className="hover:text-white transition">
                Features
              </a>
              <a href="#biometric" className="hover:text-white transition">
                Biometric
              </a>
              <a href="#pricing" className="hover:text-white transition">
                Pricing
              </a>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <Link
                href="/"
                className="text-[12px] font-medium text-white/60 hover:text-white transition px-4"
              >
                Live Demo
              </Link>

              <a
                href={wa('Hi, I want to book a demo of GlitchFiesta Gym OS.')}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-2 bg-white text-black rounded-full px-5 py-2.5 text-[12px] font-bold hover:bg-[#c8ff00] transition"
              >
                Book a Demo
                <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden w-10 h-10 border border-white/10 rounded-full flex items-center justify-center"
              aria-label="Toggle menu"
            >
              {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </nav>

          {menuOpen && (
            <div className="md:hidden border-t border-white/10 py-5 flex flex-col gap-5">
              <a href="#features" onClick={() => setMenuOpen(false)}>
                Features
              </a>
              <a href="#biometric" onClick={() => setMenuOpen(false)}>
                Biometric
              </a>
              <a href="#pricing" onClick={() => setMenuOpen(false)}>
                Pricing
              </a>
              <a
                href={wa('Hi, I want to book a demo of GlitchFiesta Gym OS.')}
                target="_blank"
                rel="noreferrer"
                className="bg-[#c8ff00] text-black rounded-full px-5 py-3 text-center font-bold"
              >
                Book a Demo
              </a>
            </div>
          )}
        </div>
      </header>

      {/* HERO */}
      <section className="relative border-b border-white/[0.08]">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute right-[-10%] top-[15%] w-[500px] h-[500px] rounded-full bg-[#c8ff00]/[0.045] blur-[140px]" />
        </div>

        <div className="max-w-[1380px] mx-auto px-5 sm:px-8 pt-20 sm:pt-28 pb-20 sm:pb-28">
          <div className="grid lg:grid-cols-[1.15fr_.85fr] gap-14 lg:gap-20 items-end">
            <div>
              <div className="flex items-center gap-3 mb-8">
                <span className="w-8 h-px bg-[#c8ff00]" />
                <span className="text-[10px] uppercase tracking-[0.28em] text-white/45 font-semibold">
                  Gym Management · Reimagined
                </span>
              </div>

              <h1 className="text-[clamp(52px,8vw,118px)] leading-[0.86] tracking-[-0.075em] font-black max-w-[950px]">
                RUN YOUR
                <br />
                GYM.
                <br />
                <span className="text-[#c8ff00]">WITHOUT</span>
                <br />
                THE CHAOS.
              </h1>
            </div>

            <div className="lg:pb-3">
              <p className="text-lg sm:text-xl leading-relaxed text-white/50 max-w-[470px]">
                One powerful system for memberships, attendance, payments,
                retention and everyday gym operations.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mt-8">
                <a
                  href={wa(
                    'Hi, I want to start the 14-day free trial of GlitchFiesta Gym OS.'
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center justify-center gap-3 bg-[#c8ff00] text-black px-7 py-4 rounded-full font-bold text-sm hover:bg-[#d5ff3b] transition"
                >
                  Start Free Trial
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </a>

                <Link
                  href="/scan"
                  target="_blank"
                  className="inline-flex items-center justify-center gap-3 border border-white/15 px-7 py-4 rounded-full font-semibold text-sm hover:bg-white hover:text-black transition"
                >
                  Try the Kiosk
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              </div>

              <div className="flex items-center gap-6 mt-8 text-[10px] uppercase tracking-[0.15em] text-white/30">
                <span>Built for modern gyms</span>
                <span className="w-1 h-1 rounded-full bg-white/20" />
                <span>Cloud based</span>
                <span className="w-1 h-1 rounded-full bg-white/20" />
                <span>24/7 access</span>
              </div>
            </div>
          </div>

          {/* HERO PRODUCT VISUAL */}
          <div className="mt-20 sm:mt-28">
            <div className="relative border border-white/[0.1] bg-[#111] rounded-[28px] overflow-hidden">
              <div className="h-11 border-b border-white/[0.08] flex items-center px-5 gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                <div className="ml-4 text-[9px] tracking-[0.18em] uppercase text-white/25">
                  GlitchFiesta Gym OS
                </div>
              </div>

              <div className="grid md:grid-cols-[220px_1fr] min-h-[430px]">
                <aside className="hidden md:block border-r border-white/[0.08] p-6">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/25 mb-8">
                    Workspace
                  </div>

                  {[
                    'Overview',
                    'Members',
                    'Attendance',
                    'Memberships',
                    'Payments',
                    'Analytics',
                  ].map((item, i) => (
                    <div
                      key={item}
                      className={`px-3 py-2.5 text-xs mb-1 ${
                        i === 0
                          ? 'bg-white/[0.07] text-white'
                          : 'text-white/35'
                      }`}
                    >
                      {item}
                    </div>
                  ))}
                </aside>

                <div className="p-6 sm:p-9">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">
                        {new Date().toLocaleDateString('en-US', {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                      <h3 className="text-2xl font-bold tracking-tight mt-2">
                        Good day, Admin.
                      </h3>
                    </div>

                    <div className="hidden sm:block text-right">
                      <p className="text-[9px] uppercase tracking-[0.15em] text-white/30">
                        Today&apos;s attendance
                      </p>
                      <p className="text-3xl font-black text-[#c8ff00] mt-1">
                        84
                      </p>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-3 mt-9">
                    {[
                      ['Active Members', '248', '+12 this month'],
                      ["Today's Check-ins", '84', '+8.4%'],
                      ['Renewals Due', '17', 'Next 7 days'],
                    ].map(([title, value, sub]) => (
                      <div
                        key={title}
                        className="border border-white/[0.08] bg-white/[0.025] p-5"
                      >
                        <p className="text-[9px] uppercase tracking-[0.15em] text-white/30">
                          {title}
                        </p>
                        <p className="text-3xl font-black mt-4">{value}</p>
                        <p className="text-[10px] text-[#c8ff00]/70 mt-2">
                          {sub}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="grid sm:grid-cols-[1.4fr_.6fr] gap-3 mt-3">
                    <div className="border border-white/[0.08] bg-white/[0.025] p-5 h-44">
                      <div className="flex justify-between">
                        <p className="text-[9px] uppercase tracking-[0.15em] text-white/30">
                          Weekly attendance
                        </p>
                        <BarChart3 className="w-4 h-4 text-white/20" />
                      </div>

                      <div className="h-24 mt-7 flex items-end gap-2">
                        {[38, 55, 45, 72, 62, 88, 78, 96, 68, 82, 75, 91].map(
                          (height, i) => (
                            <div
                              key={i}
                              className="flex-1 bg-[#c8ff00]/[0.65] hover:bg-[#c8ff00] transition"
                              style={{ height: `${height}%` }}
                            />
                          )
                        )}
                      </div>
                    </div>

                    <div className="border border-white/[0.08] bg-[#c8ff00] text-black p-5 h-44">
                      <p className="text-[9px] uppercase tracking-[0.15em] font-bold">
                        Retention
                      </p>
                      <p className="text-5xl font-black mt-5 tracking-[-0.06em]">
                        92%
                      </p>
                      <p className="text-[10px] mt-2 max-w-[130px]">
                        members active this month
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INTRO */}
      <section className="max-w-[1380px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <div className="grid md:grid-cols-[0.75fr_1.25fr] gap-12">
          <div>
            <span className="text-[10px] uppercase tracking-[0.28em] text-[#c8ff00] font-bold">
              One system
            </span>
          </div>

          <div>
            <h2 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-[-0.06em] leading-[0.95]">
              Your gym deserves
              <br />
              better than spreadsheets.
            </h2>

            <p className="text-white/40 text-base sm:text-lg max-w-[650px] leading-relaxed mt-8">
              Stop switching between registers, payment apps and attendance
              machines. Gym OS brings your daily operations into one clean,
              intelligent workspace.
            </p>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section
        id="features"
        className="border-y border-white/[0.08] bg-[#0d0d0d]"
      >
        <div className="max-w-[1380px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
          <div className="flex justify-between items-end mb-16">
            <div>
              <span className="text-[10px] uppercase tracking-[0.28em] text-white/30">
                Everything connected
              </span>
              <h2 className="text-4xl sm:text-6xl font-black tracking-[-0.06em] mt-4">
                Built around
                <br />
                your workflow.
              </h2>
            </div>

            <span className="hidden md:block text-[10px] uppercase tracking-[0.2em] text-white/20">
              01 — 06
            </span>
          </div>

          <div className="grid md:grid-cols-2 border-t border-l border-white/[0.08]">
            {[
              {
                number: '01',
                title: 'Memberships',
                text: 'Create plans, manage renewals and keep every member record organised.',
                icon: Users,
              },
              {
                number: '02',
                title: 'Attendance',
                text: 'Fast QR and biometric check-ins with a complete attendance history.',
                icon: Fingerprint,
              },
              {
                number: '03',
                title: 'Payments',
                text: 'Track collections, renewals and digital receipts without the paperwork.',
                icon: CreditCard,
              },
              {
                number: '04',
                title: 'Retention',
                text: 'Automatically identify inactive members and bring them back before they leave.',
                icon: MessageCircle,
              },
              {
                number: '05',
                title: 'Analytics',
                text: 'Understand peak hours, member activity and gym performance at a glance.',
                icon: BarChart3,
              },
              {
                number: '06',
                title: 'Access Control',
                text: 'Give your staff the right tools and permissions while keeping your gym secure.',
                icon: ShieldCheck,
              },
            ].map(({ number, title, text, icon: Icon }) => (
              <div
                key={number}
                className="group border-r border-b border-white/[0.08] p-7 sm:p-10 min-h-[280px] hover:bg-white/[0.025] transition"
              >
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono text-white/25">
                    {number}
                  </span>
                  <Icon className="w-5 h-5 text-white/20 group-hover:text-[#c8ff00] transition" />
                </div>

                <div className="mt-20">
                  <h3 className="text-2xl font-bold tracking-tight">
                    {title}
                  </h3>
                  <p className="text-sm text-white/35 leading-relaxed max-w-[430px] mt-3">
                    {text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BIOMETRIC */}
      <section id="biometric" className="border-b border-white/[0.08]">
        <div className="max-w-[1380px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="text-[10px] uppercase tracking-[0.28em] text-[#c8ff00] font-bold">
                Biometric Access
              </span>

              <h2 className="text-5xl sm:text-7xl font-black tracking-[-0.07em] leading-[0.9] mt-6">
                ONE TOUCH.
                <br />
                ATTENDANCE
                <br />
                <span className="text-white/30">DONE.</span>
              </h2>

              <p className="text-white/40 max-w-[470px] leading-relaxed mt-8">
                Give your members a faster, more secure check-in experience.
                Every biometric entry is connected to the member profile and
                attendance history.
              </p>

              <div className="flex items-center gap-4 mt-9">
                <div className="w-12 h-12 rounded-full border border-[#c8ff00]/30 flex items-center justify-center">
                  <Fingerprint className="w-5 h-5 text-[#c8ff00]" />
                </div>

                <div>
                  <p className="text-sm font-semibold">Fast & secure access</p>
                  <p className="text-[11px] text-white/30 mt-1">
                    Designed for everyday gym check-ins
                  </p>
                </div>
              </div>
            </div>

            {/* biometric visual */}
            <div className="relative">
              <div className="aspect-square max-w-[540px] ml-auto bg-[#111] border border-white/[0.1] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-10 border border-white/[0.06]" />
                <div className="absolute inset-20 border border-white/[0.06]" />

                <div className="relative w-56 h-56 rounded-full border border-[#c8ff00]/20 flex items-center justify-center">
                  <div className="absolute inset-8 rounded-full border border-[#c8ff00]/20" />
                  <div className="absolute inset-16 rounded-full bg-[#c8ff00]/[0.06]" />

                  <Fingerprint className="w-24 h-24 text-[#c8ff00] stroke-[1]" />
                </div>

                <div className="absolute top-8 left-8 text-[9px] uppercase tracking-[0.2em] text-white/20">
                  Secure Access
                </div>

                <div className="absolute bottom-8 right-8 flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-[#c8ff00]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#c8ff00]" />
                  Verified
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AUTOMATION */}
      <section className="bg-[#c8ff00] text-black">
        <div className="max-w-[1380px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
          <div className="grid lg:grid-cols-[1fr_.8fr] gap-16">
            <div>
              <span className="text-[10px] uppercase tracking-[0.28em] font-bold">
                Automation
              </span>

              <h2 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-[-0.075em] leading-[0.86] mt-5">
                YOUR GYM.
                <br />
                ON AUTOPILOT.
              </h2>
            </div>

            <div className="lg:pt-12">
              {[
                ['01', 'Expiry reminders', 'Never forget a renewal again.'],
                ['02', 'Inactivity alerts', 'Bring inactive members back.'],
                ['03', 'WhatsApp communication', 'Keep members connected automatically.'],
                ['04', 'Digital renewals', 'Make getting back into the gym effortless.'],
              ].map(([number, title, text]) => (
                <div
                  key={number}
                  className="border-t border-black/15 py-5 flex gap-5"
                >
                  <span className="font-mono text-[10px] opacity-40">
                    {number}
                  </span>

                  <div>
                    <h3 className="font-bold">{title}</h3>
                    <p className="text-sm opacity-55 mt-1">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-b border-white/[0.08]">
        <div className="max-w-[1380px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
          <div className="max-w-2xl">
            <span className="text-[10px] uppercase tracking-[0.28em] text-[#c8ff00] font-bold">
              Pricing
            </span>

            <h2 className="text-5xl sm:text-7xl font-black tracking-[-0.07em] leading-[0.9] mt-5">
              SIMPLE.
              <br />
              NO SURPRISES.
            </h2>

            <p className="text-white/35 mt-6">
              Start small. Upgrade when your gym grows.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-px bg-white/[0.08] mt-16 border border-white/[0.08]">
            <PricingCard
              name="Starter"
              description="For boutique gyms and growing studios."
              price="799"
              features={[
                'Up to 150 active members',
                'Dynamic QR attendance',
                'Member self-service portal',
                'Digital invoices & receipts',
              ]}
              button="Start with Starter"
              whatsapp="Hi, I want the Starter Gym OS plan."
            />

            <PricingCard
              featured
              name="Pro"
              description="Complete automation for serious gym owners."
              price="1,499"
              features={[
                'Unlimited members',
                'Biometric attendance',
                'Automated WhatsApp alerts',
                '5-day inactivity alerts',
                'Staff roles & permissions',
                'Peak-hour analytics',
              ]}
              button="Deploy Pro"
              whatsapp="Hi, I want to deploy the Pro Gym OS plan."
            />

            <PricingCard
              name="Multi-Gym"
              description="For owners operating multiple locations."
              price="3,499"
              features={[
                'Up to 5 gym locations',
                'Multi-branch management',
                'Advanced access control',
                'Custom branding',
                'Priority technical support',
              ]}
              button="Talk to Sales"
              whatsapp="Hi, I need the Multi-Gym setup."
            />
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section>
        <div className="max-w-[1380px] mx-auto px-5 sm:px-8 py-28 sm:py-40">
          <div className="border border-white/[0.1] bg-[#101010] p-8 sm:p-16 lg:p-20 relative overflow-hidden">
            <div className="absolute right-[-100px] top-[-100px] w-[300px] h-[300px] rounded-full bg-[#c8ff00]/10 blur-[100px]" />

            <div className="relative">
              <span className="text-[10px] uppercase tracking-[0.28em] text-[#c8ff00] font-bold">
                Ready when you are
              </span>

              <h2 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-[-0.075em] leading-[0.86] mt-6 max-w-[850px]">
                BUILD A BETTER
                <br />
                GYM BUSINESS.
              </h2>

              <div className="flex flex-col sm:flex-row gap-3 mt-10">
                <a
                  href={wa(
                    'Hi, I want to start a free trial of GlitchFiesta Gym OS.'
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-3 bg-[#c8ff00] text-black px-7 py-4 rounded-full font-bold text-sm hover:bg-[#d5ff3b] transition"
                >
                  Start Free Trial
                  <ArrowRight className="w-4 h-4" />
                </a>

                <a
                  href={wa(
                    'Hi, I would like to book a demo of GlitchFiesta Gym OS.'
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-3 border border-white/15 px-7 py-4 rounded-full font-semibold text-sm hover:bg-white hover:text-black transition"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp Us
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/[0.08]">
        <div className="max-w-[1380px] mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row justify-between gap-4 text-[10px] uppercase tracking-[0.15em] text-white/25">
          <div>© 2026 GlitchFiesta Technologies</div>

          <div className="flex gap-6">
            <span>Gym OS</span>
            <span>Made for modern gyms</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ---------------------------------------------
   PRICING CARD
--------------------------------------------- */

function PricingCard({
  name,
  description,
  price,
  features,
  button,
  whatsapp,
  featured = false,
}: {
  name: string;
  description: string;
  price: string;
  features: string[];
  button: string;
  whatsapp: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`relative bg-[#0b0b0b] p-7 sm:p-9 lg:p-10 min-h-[530px] flex flex-col ${
        featured ? 'ring-1 ring-[#c8ff00] z-10' : ''
      }`}
    >
      {featured && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-[#c8ff00]" />
      )}

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">{name}</h3>

          {featured && (
            <span className="text-[9px] uppercase tracking-[0.16em] font-bold text-black bg-[#c8ff00] px-2.5 py-1 rounded-full">
              Popular
            </span>
          )}
        </div>

        <p className="text-sm text-white/30 mt-3 max-w-[280px] leading-relaxed">
          {description}
        </p>

        <div className="mt-10 flex items-end gap-2">
          <span className="text-5xl font-black tracking-[-0.06em]">
            ₹{price}
          </span>
          <span className="text-xs text-white/25 mb-2">/ month</span>
        </div>

        <div className="border-t border-white/[0.08] mt-9 pt-7">
          <p className="text-[9px] uppercase tracking-[0.18em] text-white/25 mb-5">
            Includes
          </p>

          <ul className="space-y-4">
            {features.map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-3 text-xs text-white/65"
              >
                <Check className="w-3.5 h-3.5 text-[#c8ff00] mt-0.5 shrink-0" />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <a
        href={wa(whatsapp)}
        target="_blank"
        rel="noreferrer"
        className={`mt-auto w-full py-3.5 rounded-full text-center text-xs font-bold transition ${
          featured
            ? 'bg-[#c8ff00] text-black hover:bg-[#d5ff3b]'
            : 'border border-white/15 hover:bg-white hover:text-black'
        }`}
      >
        {button}
      </a>
    </div>
  );
}