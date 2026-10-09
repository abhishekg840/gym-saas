import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BellRing,
  Cpu,
  Download,
  Fingerprint,
  Gauge,
  IndianRupee,
  MessageCircle,
  QrCode,
  ShieldCheck,
  Smartphone,
  Timer,
  Wallet,
  Zap,
} from 'lucide-react';

import RevenueCalculator from '@/components/revenue-calculator';
import PilotBookingForm from '@/components/pilot-booking-form';

/**
 * The commercial front door for GYM OWNERS (Phase 21 rebuild).
 *
 * This page has one job: convert a gym owner who is bleeding revenue to
 * expired/unpaid members into a 14-day hardware pilot booking. Every section
 * ladders to that — the hero names the pain, the calculator prices it, the
 * hardware grid proves the product is real and shipped, the pilot offer kills
 * the risk, and the form is the ask.
 *
 * The design is a dark "gym-tech" surface (#0B0C0E canvas, #111215 cards) with a
 * single teal accent (#26A69A) used only for glow and action, and sharp white
 * type. It is deliberately a SERVER component: no state, no effects, no client
 * JS for the static sections. The only client islands are the interactive
 * Revenue Calculator and the Booking Form — imported below — so the hero, the
 * hardware grid and the pilot offer ship as pure HTML.
 *
 * The claims map onto shipped code in this repo: R307S fingerprint + RC522 RFID
 * gate relay (/hardware, fn_hardware_punch), HMAC rotating member QR
 * (lib/whatsapp + the member app), zero-commission UPI + D-3/D-1/due reminders
 * (/api/cron/whatsapp, lib/whatsapp), and live floor occupancy
 * (components/live-crowd-card). Nothing here advertises a feature the product
 * cannot demonstrate.
 */

/** The number the pilot team answers on — distinct from the member/owner support line. */
const PILOT_WHATSAPP = '918114039175';

/** The exact prefilled pilot message the brief specifies for the hero primary CTA. */
const HERO_WHATSAPP_URL =
  'https://wa.me/918114039175?text=' +
  encodeURIComponent(
    'Hi Vyroniq team, I want to test the 14-day hardware pilot at my gym.'
  );

/** The signed Android build, staged in public/downloads by the release step. */
const APK_URL = '/downloads/vyroniq-gym.apk';

export const metadata: Metadata = {
  title: 'Vyroniq — Stop Gym Revenue Leakage | Biometric Gate + UPI Renewals',
  description:
    'Plug-and-play biometric & RFID door terminal with real-time UPI renewal tracking. Stop unauthorized entries, buddy-punching and forgotten renewals. Book a 14-day free floor pilot.',
};

const NAV_LINKS = [
  { href: '#hardware', label: 'Hardware Terminal' },
  { href: '#calculator', label: 'Revenue Calculator' },
  { href: '#pilot', label: 'Pilot Guarantee' },
  { href: '#pricing', label: 'Pricing' },
];

const FEATURES = [
  {
    icon: Fingerprint,
    title: 'Sub-Second Gate Punch',
    body:
      'Dual authentication with R307S optical fingerprint + RC522 RFID cards. A direct relay trigger fires your magnetic locks and turnstiles the instant a valid member is recognised.',
    tag: 'R307S + RC522',
  },
  {
    icon: QrCode,
    title: 'Anti-Proxy Member QR',
    body:
      'A 30-second dynamic rotating HMAC-signed QR pass on the member mobile app. Screenshots are strictly blocked, so a pass can never be forwarded or reused.',
    tag: 'HMAC rotating',
  },
  {
    icon: Wallet,
    title: 'Zero-Commission Direct UPI',
    body:
      'A dynamic UPI QR collects renewals straight into the gym owner’s bank account — no cut, no middleman. Automatic WhatsApp reminders fire on D-3, D-1 and the due date.',
    tag: '0% commission',
  },
  {
    icon: Gauge,
    title: 'Live Floor Occupancy Badge',
    body:
      'A real-time head-count tracker on the owner dashboard — Quiet, Moderate or Peak — so you can prevent an overcrowded floor before it becomes a problem.',
    tag: 'Real-time',
  },
];

const PILOT_POINTS = [
  {
    icon: Timer,
    title: '45-Minute Front Desk Setup',
    body: 'We mount the terminal at your desk or gate and wire the relay ourselves.',
  },
  {
    icon: IndianRupee,
    title: '₹0 Software Fee',
    body: 'Full software and hardware access for the entire 14 days. No card, no commitment.',
  },
  {
    icon: ShieldCheck,
    title: 'Leakage Guarantee',
    body:
      'If the terminal doesn’t catch at least 5 expired or unauthorized entries in 14 days, we uninstall it free — zero questions asked.',
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen scroll-smooth bg-[#0B0C0E] font-sans text-white antialiased selection:bg-[#26A69A] selection:text-[#0B0C0E]">
      {/* ===================== HEADER / NAVIGATION ===================== */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0B0C0E]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#26A69A] text-[#0B0C0E] shadow-[0_0_20px_-4px_rgba(38,166,154,0.9)]">
              <Cpu className="h-4 w-4" />
            </span>
            <span className="flex items-center gap-2">
              <span className="text-base font-black tracking-tight">Vyroniq</span>
              <span className="hidden rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-neutral-400 sm:inline">
                Hardware + OS
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-xs font-medium text-neutral-400 md:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="transition hover:text-white">
                {link.label}
              </a>
            ))}
          </nav>

          <a
            href="#booking"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#26A69A] px-4 py-2 text-xs font-bold text-[#0B0C0E] shadow-[0_0_24px_-6px_rgba(38,166,154,0.9)] transition hover:bg-[#2dbcaf] active:scale-[0.98]"
          >
            Book 14-Day Pilot
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {/* ========================= HERO SECTION ========================= */}
      <section className="relative overflow-hidden">
        {/* Teal accent glow behind the headline. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[-6rem] h-[26rem] w-[26rem] -translate-x-1/2 rounded-full bg-[#26A69A]/20 blur-[130px]"
        />
        <div className="relative mx-auto max-w-4xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pb-24 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#26A69A]/30 bg-[#26A69A]/10 px-3.5 py-1.5 text-xs font-semibold text-[#26A69A]">
            <Zap className="h-3.5 w-3.5" />
            Built for Indian Gyms &amp; Turnstiles
          </span>

          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-[1.08] tracking-tight sm:text-6xl">
            Gym Ka Revenue Leakage{' '}
            <span className="bg-gradient-to-r from-[#26A69A] to-emerald-300 bg-clip-text text-transparent">
              Hamesha Ke Liye Khatam.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-neutral-400 sm:text-lg">
            Stop unauthorized entries, buddy-punching, and forgotten renewals. A
            plug-and-play biometric &amp; RFID door terminal synced directly with
            real-time UPI renewal tracking.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={HERO_WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#26A69A] px-7 py-4 text-sm font-bold text-[#0B0C0E] shadow-[0_0_34px_-6px_rgba(38,166,154,0.95)] transition hover:bg-[#2dbcaf] active:scale-[0.98] sm:w-auto"
            >
              <MessageCircle className="h-4 w-4" />
              Claim 14-Day Free Floor Pilot
            </a>
            <a
              href={APK_URL}
              download
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-7 py-4 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10 active:scale-[0.98] sm:w-auto"
            >
              <Smartphone className="h-4 w-4" />
              Download Android App
            </a>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-wider text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[#26A69A]" />
              ₹0 for 14 days
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5 text-[#26A69A]" />
              45-min setup
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BellRing className="h-3.5 w-3.5 text-[#26A69A]" />
              Live in a day
            </span>
          </div>
        </div>
      </section>

      {/* ================= REVENUE LEAKAGE CALCULATOR ================= */}
      <RevenueCalculator />

      {/* ================= HARDWARE & SECURITY GRID ================= */}
      <section
        id="hardware"
        className="scroll-mt-24 bg-[#0B0C0E] px-4 py-20 sm:px-6 sm:py-24"
      >
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#26A69A]">
              The Terminal
            </span>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              Hardware that plugs in and just works.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-400">
              One device at your gate does access control, anti-proxy passes,
              commission-free collections and live occupancy — wired straight to
              your turnstile.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#111215] p-6 transition hover:border-[#26A69A]/40 hover:shadow-[0_0_50px_-20px_rgba(38,166,154,0.7)]"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#26A69A]/10 text-[#26A69A] transition group-hover:bg-[#26A69A]/15">
                  <feature.icon className="h-5 w-5" />
                </span>
                <span className="mt-4 inline-block rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-neutral-400">
                  {feature.tag}
                </span>
                <h3 className="mt-3 text-base font-bold text-white">{feature.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= 14-DAY ZERO-RISK PILOT OFFER ================= */}
      <section
        id="pilot"
        className="relative scroll-mt-24 overflow-hidden border-y border-white/5 px-4 py-20 sm:px-6 sm:py-24"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[22rem] w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#26A69A]/10 blur-[120px]"
        />
        <div className="relative mx-auto max-w-5xl">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#26A69A]/30 bg-[#26A69A]/10 px-3.5 py-1.5 text-xs font-semibold text-[#26A69A]">
              <ShieldCheck className="h-3.5 w-3.5" />
              The 14-Day Zero-Risk Pilot
            </span>
            <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
              Prove it on your floor, or pay nothing.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-neutral-400">
              We install, you watch the leakage stop. If it doesn’t perform, we
              take it back — no invoice, no argument.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PILOT_POINTS.map((point) => (
              <div
                key={point.title}
                className="rounded-2xl border border-white/10 bg-[#111215] p-6 text-center"
              >
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#26A69A]/10 text-[#26A69A]">
                  <point.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-bold text-white">{point.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">
                  {point.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= QUICK PILOT BOOKING FORM ================= */}
      <section
        id="booking"
        className="scroll-mt-24 bg-[#0B0C0E] px-4 py-20 sm:px-6 sm:py-24"
      >
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#26A69A]">
              Book Your Pilot
            </span>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              Lock in your 14-day free floor pilot.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-neutral-400">
              Tell us where your gym is. We’ll open a WhatsApp chat to confirm a
              slot, mount the terminal at your gate, and start catching leakage
              the same week.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-neutral-300">
              {[
                'Free install & 45-minute front-desk setup',
                'Full hardware + software for 14 days, ₹0',
                'Uninstalled free if it doesn’t catch 5 leaks',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#26A69A]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <PilotBookingForm />
        </div>
      </section>

      {/* ========================= FOOTER ========================= */}
      <footer className="border-t border-white/5 px-4 py-12 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#26A69A] text-[#0B0C0E]">
              <Cpu className="h-3.5 w-3.5" />
            </span>
            <span className="font-mono text-xs font-black uppercase tracking-[0.2em]">
              Vyroniq
            </span>
          </Link>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-neutral-400">
            <Link href="/pricing" className="transition hover:text-white">
              Pricing
            </Link>
            <Link href="/login" className="transition hover:text-white">
              Sign in
            </Link>
            <a
              href={APK_URL}
              download
              className="inline-flex items-center gap-1.5 transition hover:text-white"
            >
              <Download className="h-3.5 w-3.5" />
              Android App
            </a>
            <a
              href={`https://wa.me/${PILOT_WHATSAPP}`}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-white"
            >
              WhatsApp
            </a>
          </nav>

          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-600">
            © {new Date().getFullYear()} Vyroniq
          </p>
        </div>
      </footer>
    </main>
  );
}


