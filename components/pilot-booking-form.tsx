'use client';

import { useState } from 'react';
import { CheckCircle2, MessageCircle, ShieldCheck } from 'lucide-react';

/**
 * Quick Pilot Booking Form — the conversion endpoint of the landing page.
 *
 * WHAT "HANDLES CLEANLY" MEANS HERE
 * --------------------------------
 * The real handoff is a prefilled WhatsApp chat with our team. The database
 * write to /api/pilot-lead is best-effort: it is fired in the background and
 * never awaited before the WhatsApp window opens, so a Supabase hiccup or a
 * missing migration can never stop a prospect from reaching us. The WhatsApp
 * window is opened synchronously inside the click handler on purpose — a window
 * opened after an await is treated as a popup and blocked by most browsers.
 */

const PILOT_WHATSAPP = '918114039175';

interface Status {
  state: 'idle' | 'done';
  gym?: string;
}

export default function PilotBookingForm() {
  const [gymName, setGymName] = useState('');
  const [city, setCity] = useState('Kanpur');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const gym = gymName.trim();
    const cityClean = city.trim() || 'Kanpur';
    const digits = phone.replace(/\D/g, '');

    if (!gym) {
      setError('Please enter your gym name.');
      return;
    }
    if (digits.length < 10) {
      setError('Enter a valid 10-digit WhatsApp number.');
      return;
    }

    const message = [
      'Hi Vyroniq team, I want to book the 14-day free floor pilot.',
      '',
      `Gym: ${gym}`,
      `City: ${cityClean}`,
      `WhatsApp: ${digits}`,
    ].join('\n');

    // Open the chat NOW, inside the user gesture, so it is never popup-blocked.
    window.open(
      `https://wa.me/${PILOT_WHATSAPP}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer'
    );
    setStatus({ state: 'done', gym });

    // Best-effort persist for the sales pipeline; fire-and-forget.
    void fetch('/api/pilot-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gym_name: gym, city: cityClean, phone: digits }),
    }).catch(() => {
      /* WhatsApp is the source of truth for the handoff; ignore DB failures. */
    });
  }

  if (status.state === 'done') {
    return (
      <div className="rounded-3xl border border-[#26A69A]/30 bg-[#111215] p-8 text-center shadow-[0_0_70px_-35px_rgba(38,166,154,0.65)] sm:p-12">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#26A69A]/15 text-[#26A69A]">
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <h3 className="mt-5 text-2xl font-black tracking-tight text-white">
          Booking started for {status.gym}
        </h3>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-neutral-400">
          {"We've opened a WhatsApp chat with our team so you can confirm a slot. "}
          If the window did not open, tap the button below.
        </p>
        <a
          href={`https://wa.me/${PILOT_WHATSAPP}?text=${encodeURIComponent(
            `Hi Vyroniq team, I want to book the 14-day free floor pilot for ${status.gym ?? 'my gym'}.`
          )}`}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-[#26A69A] px-6 py-3.5 text-sm font-bold text-[#0B0C0E] transition hover:bg-[#2dbcaf] active:scale-[0.98]"
        >
          <MessageCircle className="h-4 w-4" />
          Open WhatsApp again
        </a>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-3xl border border-white/10 bg-[#111215] p-6 shadow-[0_0_70px_-35px_rgba(38,166,154,0.65)] sm:p-8"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label
            htmlFor="pilot-gym"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400"
          >
            Gym Name
          </label>
          <input
            id="pilot-gym"
            name="gym_name"
            type="text"
            autoComplete="organization"
            placeholder="e.g. Iron Paradise Gym"
            value={gymName}
            onChange={(event) => setGymName(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#0B0C0E] px-4 py-3 text-sm text-white placeholder:text-neutral-600 focus:border-[#26A69A] focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="pilot-city"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400"
          >
            City / Location
          </label>
          <input
            id="pilot-city"
            name="city"
            type="text"
            autoComplete="address-level2"
            placeholder="Kanpur"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#0B0C0E] px-4 py-3 text-sm text-white placeholder:text-neutral-600 focus:border-[#26A69A] focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="pilot-phone"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400"
          >
            WhatsApp Mobile Number
          </label>
          <input
            id="pilot-phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#0B0C0E] px-4 py-3 text-sm tabular-nums text-white placeholder:text-neutral-600 focus:border-[#26A69A] focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-xs font-medium text-rose-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#26A69A] px-6 py-4 text-sm font-bold text-[#0B0C0E] shadow-[0_0_30px_-8px_rgba(38,166,154,0.8)] transition hover:bg-[#2dbcaf] active:scale-[0.98]"
      >
        <MessageCircle className="h-4 w-4" />
        Book My 14-Day Free Pilot
      </button>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-neutral-500">
        <ShieldCheck className="h-3.5 w-3.5 text-[#26A69A]" />
        ₹0 software fee · No card required · Uninstall free if it doesn’t work
      </p>
    </form>
  );
}
