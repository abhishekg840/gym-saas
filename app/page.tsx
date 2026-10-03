import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Dumbbell,
  Fingerprint,
  MapPin,
  Megaphone,
  MessageCircle,
  QrCode,
  Receipt,
  ScanLine,
  ShieldCheck,
  ShoppingBag,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * The commercial front door (Phase 15).
 *
 * WHY THIS PAGE EXISTS AT ALL
 * ---------------------------
 * `/` used to BE the owner console. That meant the first thing a stranger, a
 * prospect or a search engine saw was a login screen for a gym they had not
 * signed up to: nowhere to send a lead, nothing to link to from a WhatsApp
 * message, and no page a sales conversation could end on. The console moved to
 * /admin -- still one click away via the header -- and this page took its place.
 *
 * EVERY CLAIM HERE IS BACKED BY SHIPPED CODE, NOT A ROADMAP. The features below
 * map onto real routes and RPCs in this repo: /hardware and fn_*_hardware_*,
 * /leads and convertLead, /store and the pickup queue, fn_monthly_leaderboard,
 * /api/cron/whatsapp, fn_superadmin_list_tenants. A landing page that advertises
 * a feature the product cannot demonstrate is the fastest way to lose a gym
 * during a trial.
 *
 * Deliberately a SERVER component: no state, no effects, no extra client JS. The
 * FAQ is <details>, which is keyboard accessible for free and needs no hydration
 * to open.
 */

const WHATSAPP = '9569272339';
const wa = (message: string) =>
  `https://wa.me/91${WHATSAPP}?text=${encodeURIComponent(message)}`;

export const metadata: Metadata = {
  title: 'Vyroniq — Gym OS for Modern Gyms',
  description:
    'Gate access, member passes, biometric attendance, POS, CRM and WhatsApp automation for Indian gyms. Live in a day, from ₹799/month.',
};

const STATS = [
  { value: '120ms', label: 'Gate decision' },
  { value: '12', label: 'Modules live' },
  { value: '1 day', label: 'Typical go-live' },
  { value: '99.9%', label: 'Uptime target' },
];

const FEATURES = [
  {
    icon: MapPin,
    title: 'Gate access & geofencing',
    body: 'Radius-locked entry with live enforcement, so a pass only opens the turnstile when the member is standing at your door.',
  },
  {
    icon: QrCode,
    title: 'Member Smart Pass',
    body: 'A signed QR pass on the member’s phone with expiry, freeze state and days remaining — no printed cards to reissue.',
  },
  {
    icon: Fingerprint,
    title: 'RFID & fingerprint terminals',
    body: 'Tap-to-enroll writes a card or fingerprint slot straight from the desk, with duplicate-slot protection built in.',
  },
  {
    icon: ScanLine,
    title: 'Front-desk scanner',
    body: 'One camera screen for check-ins, walk-in sales and pass verification. No dedicated hardware required.',
  },
  {
    icon: Users,
    title: 'Live attendance & crowd',
    body: 'See who is inside right now, your peak-hour pattern, and the members who quietly stopped showing up.',
  },
  {
    icon: UserPlus,
    title: 'Lead pipeline & CRM',
    body: 'Capture enquiries from Instagram, walk-ins or WhatsApp, work them through lanes, and convert a card into a member in one tap.',
  },
  {
    icon: ShoppingBag,
    title: 'Retail store & POS',
    body: 'Sell supplements and merchandise with stock control, a pickup queue, and receipts printed or sent on WhatsApp.',
  },
  {
    icon: Receipt,
    title: 'Plans, billing & invoices',
    body: 'Per-gym plans, renewals, freeze and transfer handling, plus a shareable invoice for every payment taken.',
  },
  {
    icon: Wallet,
    title: 'Trainer payouts',
    body: 'Assign personal-training clients and settle trainer earnings from the same ledger that records the sale.',
  },
  {
    icon: Trophy,
    title: 'Challenges & leaderboards',
    body: 'Monthly rankings, streaks and badges that give members a reason to come back on a low-motivation day.',
  },
  {
    icon: Megaphone,
    title: 'Announcements',
    body: 'Push notices to the member app instantly: holiday hours, new equipment, a class that just opened.',
  },
  {
    icon: BarChart3,
    title: 'Revenue analytics',
    body: 'Collections, active-versus-lapsed counts and retention trends, scoped to your gym and nobody else’s.',
  },
];

const STEPS = [
  {
    step: '01',
    title: 'We set your gym up',
    body: 'Your gym, plan and owner sign-in are created in minutes. The owner receives a first password and is asked to replace it immediately.',
  },
  {
    step: '02',
    title: 'Enrol members, send WhatsApp',
    body: 'Add a member at the desk or convert a lead, then send their onboarding link on WhatsApp: pass, login and first password included.',
  },
  {
    step: '03',
    title: 'Turn on the gate',
    body: 'Link your reader or use the phone scanner. Every entry is checked against a live membership, so expired passes stop at the door.',
  },
];

const PLANS = [
  {
    name: 'Starter Club',
    price: '₹799',
    tagline: 'One gym, everything needed to run the floor.',
    features: [
      'Up to 300 active members',
      'Gate access & Smart Pass',
      'Attendance, renewals & invoices',
      'WhatsApp expiry reminders',
    ],
    cta: 'Start with Starter',
    message: 'Hi Abhishek, I would like to set up the Starter Gym OS plan (₹799/mo).',
    featured: false,
  },
  {
    name: 'Pro Fitness OS',
    price: '₹1,499',
    tagline: 'The full suite: retail, CRM, trainers and challenges.',
    features: [
      'Unlimited active members',
      'Store, POS & pickup queue',
      'Lead pipeline and CRM',
      'Trainer payouts',
      'Challenges, leaderboards & badges',
      'Announcements and analytics',
    ],
    cta: 'Start with Pro',
    message: 'Hi Abhishek, I want to activate the Pro Fitness OS plan (₹1,499/mo).',
    featured: true,
  },
  {
    name: 'Franchise & Chain',
    price: 'Custom',
    tagline: 'Multi-branch operations with central reporting.',
    features: [
      'Unlimited branches',
      'Master console across every location',
      'Consolidated revenue reporting',
      'Priority onboarding and support',
    ],
    cta: 'Talk to us',
    message: 'Hi Abhishek, I want to discuss the Franchise Multi-Gym setup.',
    featured: false,
  },
];

const FAQS = [
  {
    q: 'Do we need to buy new hardware?',
    a: 'No. The front desk can check members in with a phone camera, and members open their own pass on their phone. If you already own RFID cards or a fingerprint reader, Vyroniq can drive those too.',
  },
  {
    q: 'How long does onboarding take?',
    a: 'Most single-gym setups are running the same day. We create your gym, import your members and hand over owner credentials, and you can enrol anyone else at your own pace.',
  },
  {
    q: 'What happens to our existing member data?',
    a: 'We import it. Existing members keep their names, numbers, plans and expiry dates. Every one of them gets a WhatsApp onboarding link so they can set their own password.',
  },
  {
    q: 'How are passwords handled?',
    a: 'Every password is stored as a bcrypt hash in a private database schema that the public API cannot read. Nobody at Vyroniq can look up a member’s or an owner’s password, and sign-ins are verified by the database rather than by the browser.',
  },
  {
    q: 'Could a member share their pass with a friend?',
    a: 'A pass is bound to the member and to the gym’s location. With geofence enforcement on, the gate only opens when the phone is physically inside your radius.',
  },
  {
    q: 'Is there a long contract?',
    a: 'No. Vyroniq is month to month. If it is not saving your desk time, stop paying and keep your data.',
  },
];

export default function VyroniqLanding() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white antialiased">
{/* ============================ NAV ============================ */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-neutral-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-black">
              <Dumbbell className="h-4 w-4" />
            </span>
            <span className="font-mono text-sm font-black uppercase tracking-[0.2em]">
              Vyroniq
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-xs font-medium text-neutral-400 md:flex">
            <a href="#features" className="transition hover:text-white">Platform</a>
            <a href="#how" className="transition hover:text-white">How it works</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-xl px-3.5 py-2 text-xs font-semibold text-neutral-300 transition hover:text-white"
            >
              Sign in
            </Link>
            <a
              href={wa('Hi Abhishek, I want a demo of Vyroniq Gym OS.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-black transition hover:bg-emerald-400 active:scale-95"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Book a demo
            </a>
          </div>
        </div>
      </header>

      {/* ============================ HERO ============================ */}
      <section className="relative overflow-hidden">
        {/* Soft emerald bloom behind the headline. Decorative only, and
            pointer-events-none so it can never swallow a click. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[-12rem] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-emerald-500/12 blur-[120px]"
        />

        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-20 sm:px-6 sm:pb-24 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Gym OS · Built for Indian gyms
            </span>

            <h1 className="mt-7 text-4xl font-black leading-[1.08] tracking-tight sm:text-6xl">
              Run the whole gym
              <br />
              <span className="text-emerald-400">from one screen.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-neutral-400 sm:text-base">
              Turnstile access, member passes, biometric attendance, retail, lead
              pipeline and WhatsApp follow-ups — in one system your front desk can
              learn before lunch. No cards to reissue. No register to lose.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={wa('Hi Abhishek, I want to start with Vyroniq Gym OS.')}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-400 active:scale-[0.98] sm:w-auto"
              >
                Get started on WhatsApp
                <ArrowRight className="h-4 w-4" />
              </a>
              <Link
                href="/pricing"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3.5 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/[0.06] sm:w-auto"
              >
                See full pricing
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>

            <p className="mt-5 font-mono text-[11px] text-neutral-500">
              From ₹799/month · No setup fee · Cancel any month
            </p>
          </div>

          <dl className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/5 bg-white/5 sm:grid-cols-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="bg-neutral-950 px-5 py-6 text-center">
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="block font-mono text-2xl font-black text-white">
                    {stat.value}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                    {stat.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ========================== FEATURES ========================== */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
            The platform
          </span>
          <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
            Twelve modules. One login.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-neutral-400">
            Most gyms run on four disconnected tools and a notebook. Vyroniq replaces
            them with one system where a lead, a membership, a payment and a turnstile
            entry are the same record.
          </p>
        </div>

        <ul className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/5 bg-white/5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="group bg-neutral-950 p-6 transition hover:bg-neutral-900/60"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                <feature.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-sm font-bold text-white">{feature.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                {feature.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ========================= HOW IT WORKS ========================= */}
      <section id="how" className="border-y border-white/5 bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="max-w-2xl">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
              How it works
            </span>
            <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Live before your next shift.
            </h2>
          </div>

          <ol className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {STEPS.map((item) => (
              <li
                key={item.step}
                className="relative rounded-2xl border border-white/8 bg-neutral-950 p-6"
              >
                <span className="font-mono text-3xl font-black text-emerald-500/30">
                  {item.step}
                </span>
                <h3 className="mt-3 text-base font-bold text-white">{item.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                  {item.body}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-12 flex flex-wrap items-center gap-3">
            <a
              href={wa('Hi Abhishek, I want to set up my gym on Vyroniq.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 active:scale-[0.98]"
            >
              <MessageCircle className="h-4 w-4" />
              Set up my gym
            </a>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/25"
            >
              I already have an account
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* =========================== PRICING =========================== */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
            Pricing
          </span>
          <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
            Priced per gym, not per headache.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-neutral-400">
            Flat monthly pricing on the plan you pick. No per-member surprises, no
            setup fee, and no charge for the members your staff add at the desk.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border p-7 ${
                plan.featured
                  ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                  : 'border-white/8 bg-neutral-950'
              }`}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-7 rounded-full bg-emerald-500 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black">
                  Most popular
                </span>
              )}

              <h3 className="text-lg font-black tracking-tight text-white">
                {plan.name}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
                {plan.tagline}
              </p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="font-mono text-3xl font-black text-white">
                  {plan.price}
                </span>
                {plan.price !== 'Custom' && (
                  <span className="font-mono text-xs text-neutral-500">/month</span>
                )}
              </p>

              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span className="text-xs leading-relaxed text-neutral-300">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <a
                href={wa(plan.message)}
                target="_blank"
                rel="noreferrer"
                className={`mt-7 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition active:scale-[0.98] ${
                  plan.featured
                    ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                    : 'border border-white/12 text-white hover:border-white/25'
                }`}
              >
                {plan.cta}
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-neutral-500">
          Need a side-by-side breakdown?{' '}
          <Link href="/pricing" className="text-emerald-400 underline-offset-4 hover:underline">
            See the full comparison
          </Link>
          .
        </p>
      </section>

      {/* ============================= FAQ ============================= */}
      <section id="faq" className="border-t border-white/5 bg-white/[0.015]">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
            FAQ
          </span>
          <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
            Questions we get on the call.
          </h2>

          <div className="mt-10 divide-y divide-white/8 border-y border-white/8">
            {FAQS.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="font-mono text-lg text-emerald-400 transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 pr-8 text-xs leading-relaxed text-neutral-400">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ========================= CTA + FOOTER ========================= */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 bottom-[-10rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[120px]"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-24">
          <h2 className="mx-auto max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
            Your front desk deserves better than a register.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-neutral-400">
            Message us and we will set up your gym, import your members and hand over
            the owner login — usually the same day.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={wa('Hi Abhishek, I am ready to onboard my gym on Vyroniq.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-400 active:scale-[0.98] sm:w-auto"
            >
              <MessageCircle className="h-4 w-4" />
              Chat on WhatsApp
            </a>
            <a
              href={`tel:+91${WHATSAPP}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-6 py-3.5 text-sm font-semibold text-white transition hover:border-white/25 sm:w-auto"
            >
              Call +91 {WHATSAPP}
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-center">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-black">
                <Dumbbell className="h-3.5 w-3.5" />
              </span>
              <span className="font-mono text-xs font-black uppercase tracking-[0.2em]">
                Vyroniq
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-neutral-500">
              Gym OS for Indian gyms — access control, memberships, retail and
              analytics in one console.
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-neutral-400">
            <a href="#features" className="transition hover:text-white">Platform</a>
            <Link href="/pricing" className="transition hover:text-white">Pricing</Link>
            <Link href="/login" className="transition hover:text-white">Sign in</Link>
            <a
              href={`tel:+91${WHATSAPP}`}
              className="transition hover:text-white"
            >
              Support
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
