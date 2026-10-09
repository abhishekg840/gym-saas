'use client';

import { useId, useState } from 'react';
import { AlertTriangle, Calculator, IndianRupee, TrendingDown } from 'lucide-react';

/**
 * Revenue Leakage Calculator — a client island on the marketing landing page.
 *
 * WHY IT IS INTERACTIVE: the point is a prospect dragging the sliders to their
 * own member count and monthly fee and watching a rupee figure move. That needs
 * state, so it ships as a Client Component; everything static on the page stays
 * server-rendered with zero JS.
 *
 * The model is deliberately simple and honest: ~10% of active members train on
 * an expired or unpaid plan, and each is one month of fee never collected. This
 * is not a forecast — it is arithmetic the owner can check against their register.
 */

const MEMBERS_MIN = 50;
const MEMBERS_MAX = 800;
const MEMBERS_DEFAULT = 250;

const FEE_MIN = 600;
const FEE_MAX = 4000;
const FEE_DEFAULT = 1200;
const FEE_STEP = 100;

/** Share of active members assumed to be training on an expired / unpaid plan. */
const LEAK_RATE = 0.1;

/** Indian digit grouping (1,20,000) — the locale a gym owner reads natively. */
const inr = (value: number) => value.toLocaleString('en-IN');

export default function RevenueCalculator() {
  const [members, setMembers] = useState(MEMBERS_DEFAULT);
  const [fee, setFee] = useState(FEE_DEFAULT);
  const membersId = useId();
  const feeId = useId();

  const lostRevenue = Math.round(members * LEAK_RATE * fee);
  const annualLoss = lostRevenue * 12;

  return (
    <section
      id="calculator"
      className="scroll-mt-24 border-y border-white/5 bg-[#0B0C0E] px-4 py-20 sm:px-6 sm:py-24"
    >
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#26A69A]/30 bg-[#26A69A]/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#26A69A]">
            <Calculator className="h-3 w-3" />
            Revenue Leakage Calculator
          </span>
          <h2 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">
            How much is your gym quietly losing every month?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-neutral-400">
            Drag the sliders to your real numbers. We assume roughly 10% of active
            members train on an expired or unpaid plan.
          </p>
        </div>

        <div className="mt-10 grid gap-6 rounded-3xl border border-white/10 bg-[#111215] p-6 shadow-[0_0_70px_-35px_rgba(38,166,154,0.65)] sm:p-8 md:grid-cols-2">
          {/* ---- Sliders ---------------------------------------------------- */}
          <div className="space-y-9">
            <div>
              <div className="flex items-baseline justify-between">
                <label
                  htmlFor={membersId}
                  className="text-xs font-semibold uppercase tracking-wider text-neutral-400"
                >
                  Active Gym Members
                </label>
                <span className="font-mono text-lg font-bold tabular-nums text-white">
                  {members}
                </span>
              </div>
              <input
                id={membersId}
                type="range"
                min={MEMBERS_MIN}
                max={MEMBERS_MAX}
                step={5}
                value={members}
                onChange={(event) => setMembers(Number(event.target.value))}
                className="mt-3 w-full cursor-pointer accent-[#26A69A]"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-500">
                <span>{MEMBERS_MIN}</span>
                <span>{MEMBERS_MAX}</span>
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label
                  htmlFor={feeId}
                  className="text-xs font-semibold uppercase tracking-wider text-neutral-400"
                >
                  Monthly Membership Fee
                </label>
                <span className="font-mono text-lg font-bold tabular-nums text-white">
                  ₹{inr(fee)}
                </span>
              </div>
              <input
                id={feeId}
                type="range"
                min={FEE_MIN}
                max={FEE_MAX}
                step={FEE_STEP}
                value={fee}
                onChange={(event) => setFee(Number(event.target.value))}
                className="mt-3 w-full cursor-pointer accent-[#26A69A]"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-500">
                <span>₹{inr(FEE_MIN)}</span>
                <span>₹{inr(FEE_MAX)}</span>
              </div>
            </div>
          </div>

          {/* ---- Dynamic red / amber callout ------------------------------- */}
          <div className="flex flex-col justify-center rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-rose-500/10 to-transparent p-6">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                Estimated monthly leakage
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold leading-snug text-white sm:text-3xl">
              Aapka gym har mahine lagbhag{' '}
              <span className="inline-flex items-center gap-1 text-amber-300">
                <IndianRupee className="h-6 w-6" />
                <span className="tabular-nums">{inr(lostRevenue)}</span>
              </span>{' '}
              gawa raha hai uncollected renewals aur unpaid workouts mein.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300">
              {"Vyroniq's gate terminal recovers this in the first 7 days."}
            </p>
            <div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 text-neutral-400">
              <TrendingDown className="h-4 w-4 shrink-0 text-rose-400" />
              <span className="text-xs leading-relaxed">
                {"That's about "}
                <span className="font-bold text-white tabular-nums">₹{inr(annualLoss)}</span>
                {' a year walking out the door.'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
