import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Download,
  Fingerprint,
  MapPin,
  Megaphone,
  QrCode,
  Receipt,
  ScanLine,
  ShieldCheck,
  ShoppingBag,
  Trophy,
  UserPlus,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';

import RevenueCalculator from '@/components/revenue-calculator';

/**
 * The commercial front door.
 *
 * WHY THIS PAGE EXISTS: `/` used to be the owner console, so a stranger or a
 * prospect first hit a login screen for a gym they had not signed up to. The
 * console moved to /admin and this page took its place as the calm, considered
 * surface a sales conversation can end on.
 *
 * The visual language is deliberately quiet and editorial — a warm off-white
 * canvas, deep forest-green ink, hairline rules and generous whitespace — so it
 * reads as a considered operations product rather than a loud gym poster.
 *
 * Copy is intentionally measured: every capability is phrased as what it does
 * "where enabled / after compatibility is confirmed", because a landing page
 * that over-promises is the fastest way to lose a gym during onboarding. The
 * claims map onto shipped code in this repo (geofencing, Smart Pass, RFID /
 * fingerprint terminals, the front-desk scanner, CRM, POS, billing, payouts,
 * challenges, announcements and analytics).
 *
 * A SERVER component throughout, with one exception: the interactive Revenue
 * Calculator is a Client island (components/revenue-calculator.tsx). The FAQ is
 * <details>, which is keyboard accessible for free and needs no hydration.
 */

const WHATSAPP = '9569272339';
const wa = (message: string) =>
  `https://wa.me/91${WHATSAPP}?text=${encodeURIComponent(message)}`;

/** The signed Android build, staged in public/downloads by the release step. */
const APK_URL = '/downloads/vyroniq-gym.apk';

export const metadata: Metadata = {
  title: 'Vyroniq — The operating system for modern gyms',
  description:
    'Memberships, access control, attendance, billing, retail and member communication in one considered platform for Indian gyms.',
};

const features = [
  {
    n: '01',
    icon: MapPin,
    title: 'Access rules & geofencing',
    text: 'Apply location-aware access rules where enabled, and keep entry checks tied to the right gym and membership.',
  },
  {
    n: '02',
    icon: QrCode,
    title: 'Member Smart Pass',
    text: 'Give members a digital pass with membership status and expiry details, reducing reliance on printed cards.',
  },
  {
    n: '03',
    icon: Fingerprint,
    title: 'RFID & fingerprint attendance',
    text: 'Bring supported RFID cards and fingerprint readers into your attendance workflow after device compatibility is confirmed.',
  },
  {
    n: '04',
    icon: ScanLine,
    title: 'Front-desk check-in',
    text: 'Use a camera-based scanning workflow for QR passes and keep member verification close to the front desk.',
  },
  {
    n: '05',
    icon: Users,
    title: 'Attendance & member activity',
    text: 'Review check-ins and membership activity to understand how members use your gym over time.',
  },
  {
    n: '06',
    icon: UserPlus,
    title: 'Lead pipeline & CRM',
    text: 'Keep enquiries, follow-ups and member conversions organised instead of spread across messages and notebooks.',
  },
  {
    n: '07',
    icon: ShoppingBag,
    title: 'Retail store & POS',
    text: 'Manage gym merchandise and supplement sales alongside your daily operations, where enabled in your plan.',
  },
  {
    n: '08',
    icon: Receipt,
    title: 'Plans, billing & invoices',
    text: 'Track membership plans, renewals, freezes and payment records in one operational workflow.',
  },
  {
    n: '09',
    icon: Wallet,
    title: 'Trainer management',
    text: 'Organise trainer assignments and related payout records where these workflows are enabled for your gym.',
  },
  {
    n: '10',
    icon: Trophy,
    title: 'Challenges & leaderboards',
    text: 'Encourage participation with member challenges, activity streaks and leaderboard-style engagement.',
  },
  {
    n: '11',
    icon: Megaphone,
    title: 'Member announcements',
    text: 'Share relevant gym updates such as holiday timings, notices and service announcements through supported channels.',
  },
  {
    n: '12',
    icon: BarChart3,
    title: 'Operational reporting',
    text: 'Bring attendance, collections and membership activity into a clearer view for day-to-day decisions.',
  },
];

const plans = [
  {
    name: 'Starter Club',
    price: '₹799',
    suffix: '/ month',
    desc: 'The essentials for a single location.',
    items: [
      'Up to 300 active members',
      'Member passes and attendance',
      'Memberships and invoices',
      'WhatsApp expiry reminders',
    ],
    message:
      'Hi, I would like to discuss the Vyroniq Starter Club plan (₹799/month).',
    featured: false,
  },
  {
    name: 'Pro Fitness OS',
    price: '₹1,499',
    suffix: '/ month',
    desc: 'More control for a growing gym.',
    items: [
      'Unlimited active members',
      'Retail store and POS',
      'Lead pipeline and CRM',
      'Trainer payouts',
      'Challenges and announcements',
      'Analytics dashboard',
    ],
    message:
      'Hi, I would like a demo of the Vyroniq Pro Fitness OS plan (₹1,499/month).',
    featured: true,
  },
  {
    name: 'Multi-location',
    price: 'Custom',
    suffix: '',
    desc: 'Central visibility across your locations.',
    items: [
      'Multi-branch operations',
      'Central administration',
      'Consolidated reporting',
      'Guided onboarding and support',
    ],
    message: 'Hi, I would like to discuss Vyroniq for multiple gym locations.',
    featured: false,
  },
];

const faqs = [
  {
    q: 'Do I need to replace my existing hardware?',
    a: 'Not necessarily. The front desk can use a phone camera for QR check-ins. Compatibility with existing RFID or fingerprint equipment depends on the specific reader and setup, so we confirm that before onboarding.',
  },
  {
    q: 'Can you move our current member records?',
    a: 'We can help assess and import your existing member list. The available fields and the cleanup required depend on the format of your current records.',
  },
  {
    q: 'How long does setup take?',
    a: 'A straightforward single-gym setup may be ready quickly once the member data, plan details and access requirements are confirmed. Hardware integrations can require additional setup.',
  },
  {
    q: 'Is there a long-term contract?',
    a: 'The listed plans are presented on a monthly basis. Confirm the current billing, cancellation and data-export terms with the Vyroniq team before subscribing.',
  },
];

function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Vyroniq home"
      className={`inline-flex items-center gap-3 ${
        light ? 'text-white' : 'text-[#17221f]'
      }`}
    >
      <span
        className={`grid h-9 w-9 place-items-center border ${
          light ? 'border-white/25' : 'border-[#17221f]/20'
        }`}
      >
        <span className="block h-3 w-3 rotate-45 border-2 border-current" />
      </span>
      <span className="text-[15px] font-semibold tracking-[0.19em]">
        VYRONIQ
      </span>
    </Link>
  );
}

/**
 * A calm, illustrative rendering of the owner console for the hero.
 *
 * It is intentionally static and clearly labelled "Illustrative interface" —
 * it is a picture of the product, not a live embed, so nobody mistakes a mock
 * number for their own data. Purely presentational: no props, no state.
 */
function DashboardPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[590px]">
      <div
        className="absolute -right-5 -top-5 h-24 w-24 border-r border-t border-[#a8b5ae]"
        aria-hidden="true"
      />
      <div className="relative border border-[#d7ddd8] bg-white shadow-[0_28px_80px_rgba(22,35,29,0.10)]">
        <div className="flex items-center justify-between border-b border-[#e7ebe7] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center bg-[#e9eee9] text-[#243a30]">
              <Zap size={15} />
            </span>
            <div>
              <p className="text-xs font-semibold text-[#17221f]">Studio North</p>
              <p className="mt-0.5 text-[10px] text-[#7b8580]">Gym operations</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#67736c]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#54856a]" /> All systems
            operational
          </div>
        </div>
        <div className="grid grid-cols-3 border-b border-[#e7ebe7]">
          {[
            ['Active members', '842', '+8.4%'],
            ['Today’s visits', '126', 'Live count'],
            ['Collected this month', '₹2.84L', '+12.6%'],
          ].map(([label, value, note]) => (
            <div
              key={label}
              className="border-r border-[#e7ebe7] px-4 py-5 last:border-r-0"
            >
              <p className="text-[10px] text-[#77817b]">{label}</p>
              <p className="mt-2 text-xl font-semibold tracking-tight text-[#17221f]">
                {value}
              </p>
              <p className="mt-1 text-[10px] text-[#54856a]">{note}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-[1.35fr_0.9fr]">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-[#17221f]">
                  Weekly attendance
                </p>
                <p className="mt-1 text-[10px] text-[#87918b]">Member check-ins</p>
              </div>
              <span className="border border-[#e1e6e1] px-2 py-1 text-[9px] text-[#69746d]">
                This week⌄
              </span>
            </div>
            <div className="flex h-32 items-end gap-2 border-b border-l border-[#e8ece8] px-3">
              {[42, 64, 52, 78, 61, 91, 72, 84, 57, 76, 94, 68, 83, 60].map(
                (h, i) => (
                  <span
                    key={i}
                    className={`w-full ${
                      i === 10 ? 'bg-[#243f32]' : 'bg-[#c7d5ca]'
                    }`}
                    style={{ height: `${h}%` }}
                  />
                )
              )}
            </div>
            <div className="mt-2 flex justify-between text-[9px] text-[#8a948e]">
              <span>MON</span>
              <span>TUE</span>
              <span>WED</span>
              <span>THU</span>
              <span>FRI</span>
              <span>SAT</span>
              <span>SUN</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#17221f]">Recent check-ins</p>
            <p className="mt-1 text-[10px] text-[#87918b]">Updated activity</p>
            <div className="mt-3 space-y-3">
              {[
                ['AS', 'Aarav Sharma', '08:42 AM'],
                ['PK', 'Priya Kapoor', '08:39 AM'],
                ['RM', 'Rohan Mehta', '08:34 AM'],
              ].map(([initials, name, time]) => (
                <div
                  key={name}
                  className="flex items-center gap-2 border-b border-[#edf0ed] pb-3 last:border-0"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center bg-[#eef2ee] text-[9px] font-semibold text-[#435a4a]">
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] font-medium text-[#29352e]">
                      {name}
                    </p>
                    <p className="mt-0.5 text-[9px] text-[#87918b]">Verified entry</p>
                  </div>
                  <span className="text-[9px] text-[#77817b]">{time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[#e7ebe7] bg-[#fafbf9] px-5 py-3">
          <span className="text-[9px] tracking-wide text-[#7b8580]">
            VYRONIQ / OPERATIONS OVERVIEW
          </span>
          <span className="text-[9px] text-[#7b8580]">Illustrative interface</span>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-5 hidden items-center gap-3 border border-[#d7ddd8] bg-white px-4 py-3 shadow-sm sm:flex">
        <span className="grid h-9 w-9 place-items-center bg-[#edf2ed] text-[#35513f]">
          <ShieldCheck size={17} />
        </span>
        <div>
          <p className="text-[11px] font-semibold text-[#17221f]">
            One connected workflow
          </p>
          <p className="mt-1 text-[10px] text-[#77817b]">Members · Access · Billing</p>
        </div>
      </div>
    </div>
  );
}

export default function VyroniqLanding() {
  return (
    <main className="min-h-screen bg-[#f7f8f5] text-[#17221f] antialiased selection:bg-[#dce6dc] selection:text-[#17221f]">
      {/* ============================== NAV ============================== */}
      <header className="sticky top-0 z-40 border-b border-[#e1e5df] bg-[#f7f8f5]/95 backdrop-blur-sm">
        <div className="mx-auto flex h-[76px] max-w-[1240px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Wordmark />
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-8 md:flex"
          >
            <a
              className="text-xs text-[#53615a] transition hover:text-[#17221f]"
              href="#platform"
            >
              Platform
            </a>
            <a
              className="text-xs text-[#53615a] transition hover:text-[#17221f]"
              href="#approach"
            >
              How it works
            </a>
            <a
              className="text-xs text-[#53615a] transition hover:text-[#17221f]"
              href="#pricing"
            >
              Pricing
            </a>
            <a
              className="text-xs text-[#53615a] transition hover:text-[#17221f]"
              href="#faq"
            >
              FAQs
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden px-2 py-2 text-xs font-medium text-[#53615a] hover:text-[#17221f] sm:inline-flex"
            >
              Sign in
            </Link>
            <a
              href={wa('Hi, I would like to book a Vyroniq demo.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-[#243b30] px-4 py-3 text-xs font-medium text-white transition hover:bg-[#182a21]"
            >
              Book a demo <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </header>

      {/* ============================= HERO ============================= */}
      <section className="overflow-hidden border-b border-[#e1e5df]">
        <div className="mx-auto grid max-w-[1240px] items-center gap-16 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:px-12 lg:py-28">
          <div className="max-w-[550px]">
            <div className="mb-7 flex items-center gap-3">
              <span className="h-px w-8 bg-[#738a79]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#63776a]">
                Gym operations, brought together
              </span>
            </div>
            <h1 className="max-w-[600px] text-[42px] font-medium leading-[1.07] tracking-[-0.055em] sm:text-6xl lg:text-[68px]">
              Run your gym.
              <br />
              <span className="text-[#718579]">Not five different systems.</span>
            </h1>
            <p className="mt-7 max-w-[470px] text-[15px] leading-7 text-[#647069]">
              Memberships, attendance, access control, billing and member
              communication — connected in one thoughtful operating platform built
              for modern gyms.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href={wa('Hi, I would like to see a live demo of Vyroniq for my gym.')}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-3 bg-[#243b30] px-5 text-sm font-medium text-white transition hover:bg-[#182a21]"
              >
                Arrange a walkthrough <ArrowRight size={16} />
              </a>
              <a
                href="#platform"
                className="inline-flex min-h-12 items-center justify-center gap-2 border border-[#d5dcd5] px-5 text-sm font-medium text-[#27362d] transition hover:border-[#8b9b8f]"
              >
                Explore the platform <ArrowDownRight size={16} />
              </a>
              <a
                href={APK_URL}
                download
                className="inline-flex min-h-12 items-center justify-center gap-2 border border-[#d5dcd5] px-5 text-sm font-medium text-[#27362d] transition hover:border-[#8b9b8f]"
              >
                <Download size={15} /> Android app
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-[#78837c]">
              <span className="inline-flex items-center gap-2">
                <Check size={13} className="text-[#54725d]" /> Plans from
                ₹799/month
              </span>
              <span className="inline-flex items-center gap-2">
                <Check size={13} className="text-[#54725d]" /> Designed for Indian
                gyms
              </span>
            </div>
          </div>
          <div className="px-2 py-4 sm:px-6 lg:pl-2 lg:pr-0">
            <DashboardPreview />
          </div>
        </div>
        <div className="border-t border-[#e1e5df] bg-[#f1f3ef]">
          <div className="mx-auto grid max-w-[1240px] grid-cols-2 divide-x divide-y divide-[#dfe4dd] px-5 sm:px-8 md:grid-cols-4 md:divide-y-0 lg:px-12">
            {[
              ['01', 'Member management'],
              ['02', 'Access & attendance'],
              ['03', 'Payments & billing'],
              ['04', 'Reporting & insight'],
            ].map(([n, label]) => (
              <div key={n} className="flex items-center gap-4 py-5 sm:py-6">
                <span className="text-[10px] tracking-widest text-[#8a968d]">
                  {n}
                </span>
                <span className="text-xs font-medium text-[#3c4b41]">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =========================== PLATFORM =========================== */}
      <section
        id="platform"
        className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 sm:py-28 lg:px-12"
      >
        <div className="grid gap-8 md:grid-cols-[0.75fr_1.25fr] md:items-end">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#63776a]">
              The platform
            </p>
            <h2 className="mt-5 max-w-[430px] text-3xl font-medium leading-tight tracking-[-0.04em] sm:text-[42px]">
              Every moving part.
              <br />A clearer picture.
            </h2>
          </div>
          <p className="max-w-[540px] text-sm leading-7 text-[#68746c] md:justify-self-end">
            From a new enquiry to a renewed membership, Vyroniq helps your team
            work from connected information instead of scattered tools and manual
            registers.
          </p>
        </div>
        <div className="mt-14 grid border-l border-t border-[#dfe4dd] sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ n, icon: Icon, title, text }) => (
            <article
              key={n}
              className="group min-h-[230px] border-b border-r border-[#dfe4dd] bg-transparent p-6 transition-colors hover:bg-white sm:p-8"
            >
              <div className="flex items-start justify-between">
                <span className="text-[10px] tracking-[0.16em] text-[#8c978f]">
                  {n}
                </span>
                <Icon
                  size={20}
                  strokeWidth={1.5}
                  className="text-[#587060] transition-transform group-hover:-translate-y-0.5"
                />
              </div>
              <h3 className="mt-10 text-[17px] font-medium tracking-tight">
                {title}
              </h3>
              <p className="mt-3 max-w-[310px] text-[13px] leading-6 text-[#6d7870]">
                {text}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* =========================== APPROACH =========================== */}
      <section
        id="approach"
        className="border-y border-[#dfe4dd] bg-[#eef1ec]"
      >
        <div className="mx-auto grid max-w-[1240px] gap-14 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:px-12">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#63776a]">
              A practical setup
            </p>
            <h2 className="mt-5 max-w-md text-3xl font-medium leading-tight tracking-[-0.04em] sm:text-[42px]">
              Technology that fits the way your gym works.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-[#68746c]">
              Start with the workflows you need. Add compatible access hardware
              and operational tools as your setup grows.
            </p>
            <a
              href={wa('Hi, I would like help planning a Vyroniq setup for my gym.')}
              target="_blank"
              rel="noreferrer"
              className="mt-8 inline-flex items-center gap-2 border-b border-[#7f9184] pb-2 text-sm font-medium text-[#243b30]"
            >
              Plan your setup <ArrowRight size={15} />
            </a>
          </div>
          <div className="divide-y divide-[#d4dcd3] border-y border-[#d4dcd3]">
            {[
              {
                n: '01',
                title: 'Map your current workflow',
                text: 'We review how you handle memberships, check-ins, payments and member records today.',
              },
              {
                n: '02',
                title: 'Configure your workspace',
                text: 'Set up your gym profile, plans, staff access and member data for your operation.',
              },
              {
                n: '03',
                title: 'Connect and get moving',
                text: 'Introduce member passes and supported scanners, then help your team settle into the workflow.',
              },
            ].map((s) => (
              <div key={s.n} className="grid gap-3 py-6 sm:grid-cols-[56px_1fr]">
                <span className="text-xs tracking-widest text-[#809087]">
                  {s.n}
                </span>
                <div>
                  <h3 className="text-[15px] font-medium">{s.title}</h3>
                  <p className="mt-2 max-w-[500px] text-[13px] leading-6 text-[#68746c]">
                    {s.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== REVENUE CALCULATOR ===================== */}
      <RevenueCalculator />

      {/* =========================== PRICING =========================== */}
      <section
        id="pricing"
        className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 sm:py-28 lg:px-12"
      >
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#63776a]">
              Straightforward pricing
            </p>
            <h2 className="mt-5 text-3xl font-medium tracking-[-0.04em] sm:text-[42px]">
              Choose the right starting point.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-7 text-[#68746c]">
            Clear monthly plans for independent gyms, with a custom path for
            multi-location operations. Confirm plan limits and hardware
            compatibility with our team.
          </p>
        </div>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`flex flex-col border p-6 sm:p-8 ${
                plan.featured
                  ? 'border-[#294537] bg-[#243b30] text-white'
                  : 'border-[#dfe4dd] bg-white/50 text-[#17221f]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-medium tracking-tight">
                  {plan.name}
                </h3>
                {plan.featured && (
                  <span className="border border-white/25 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#d5e0d6]">
                    Popular
                  </span>
                )}
              </div>
              <p
                className={`mt-3 min-h-10 text-[13px] leading-6 ${
                  plan.featured ? 'text-white/65' : 'text-[#6d7870]'
                }`}
              >
                {plan.desc}
              </p>
              <div className="mt-7 flex items-baseline gap-2">
                <span className="text-3xl font-medium tracking-[-0.04em]">
                  {plan.price}
                </span>
                {plan.suffix && (
                  <span
                    className={`text-xs ${
                      plan.featured ? 'text-white/60' : 'text-[#77827a]'
                    }`}
                  >
                    {plan.suffix}
                  </span>
                )}
              </div>
              <div
                className={`my-7 h-px ${
                  plan.featured ? 'bg-white/20' : 'bg-[#dfe4dd]'
                }`}
              />
              <ul className="flex-1 space-y-3">
                {plan.items.map((item) => (
                  <li key={item} className="flex gap-3 text-[13px]">
                    <Check
                      size={15}
                      className={`mt-0.5 shrink-0 ${
                        plan.featured ? 'text-[#b6cdbb]' : 'text-[#5d7a64]'
                      }`}
                    />
                    <span
                      className={
                        plan.featured ? 'text-white/85' : 'text-[#536057]'
                      }
                    >
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
              <a
                href={wa(plan.message)}
                target="_blank"
                rel="noreferrer"
                className={`mt-9 inline-flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium transition ${
                  plan.featured
                    ? 'bg-[#f3f5f1] text-[#243b30] hover:bg-white'
                    : 'border border-[#cfd8cf] text-[#243b30] hover:border-[#829586]'
                }`}
              >
                Discuss this plan <ArrowRight size={15} />
              </a>
            </article>
          ))}
        </div>
        <p className="mt-5 text-[11px] leading-5 text-[#7a857d]">
          Pricing and inclusions are subject to confirmation. Hardware, messaging
          and payment-provider charges may vary by setup.
        </p>
      </section>

      {/* ========================= CTA BAND ========================= */}
      <section className="border-y border-[#dfe4dd] bg-[#eef1ec]">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-16 sm:px-8 sm:py-20 md:grid-cols-[1fr_auto] md:items-center lg:px-12">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#63776a]">
              See it in context
            </p>
            <h2 className="mt-4 max-w-2xl text-3xl font-medium leading-tight tracking-[-0.04em] sm:text-[40px]">
              A better run gym starts with a better system.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[#68746c]">
              Walk through your current setup with us and see where Vyroniq can
              simplify the day-to-day.
            </p>
          </div>
          <a
            href={wa('Hi, I would like to schedule a Vyroniq walkthrough for my gym.')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-3 bg-[#243b30] px-6 text-sm font-medium text-white transition hover:bg-[#182a21]"
          >
            Book a walkthrough <ArrowRight size={16} />
          </a>
        </div>
      </section>

      {/* ============================ FAQ ============================ */}
      <section
        id="faq"
        className="mx-auto max-w-[920px] px-5 py-20 sm:px-8 sm:py-28"
      >
        <div className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#63776a]">
            FAQs
          </p>
          <h2 className="mt-4 text-3xl font-medium tracking-[-0.04em] sm:text-[40px]">
            Good questions. Clear answers.
          </h2>
        </div>
        <div className="mt-10 border-t border-[#dfe4dd]">
          {faqs.map((item) => (
            <details
              key={item.q}
              className="group border-b border-[#dfe4dd] py-5"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown
                  size={16}
                  className="shrink-0 text-[#718579] transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="max-w-[740px] pt-4 text-[13px] leading-6 text-[#68746c]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* =========================== FOOTER =========================== */}
      <footer className="bg-[#17241e] text-white">
        <div className="mx-auto max-w-[1240px] px-5 sm:px-8 lg:px-12">
          <div className="grid gap-10 py-12 md:grid-cols-[1fr_auto] md:items-start">
            <div>
              <Wordmark light />
              <p className="mt-5 max-w-sm text-[13px] leading-6 text-white/55">
                A connected operating platform for gym memberships, access,
                attendance and day-to-day business.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-12 gap-y-4 text-xs text-white/65">
              <a href="#platform" className="hover:text-white">
                Platform
              </a>
              <a href="#pricing" className="hover:text-white">
                Pricing
              </a>
              <Link href="/pricing" className="hover:text-white">
                Plan comparison
              </Link>
              <Link href="/login" className="hover:text-white">
                Sign in
              </Link>
              <a href={`tel:+91${WHATSAPP}`} className="hover:text-white">
                Contact support
              </a>
              <a href={APK_URL} download className="hover:text-white">
                Android app
              </a>
              <a
                href={wa('Hi, I have a question about Vyroniq.')}
                target="_blank"
                rel="noreferrer"
                className="hover:text-white"
              >
                WhatsApp
              </a>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-white/15 py-5 text-[10px] text-white/40 sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} Vyroniq. All rights reserved.</span>
            <span>Built for the people who run the floor.</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
