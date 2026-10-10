'use client';

import { useId, useState } from 'react';
import { TrendingDown, TriangleAlert } from 'lucide-react';

/**
 * Revenue Leakage Calculator — the one interactive island on an otherwise
 * server-rendered landing page.
 *
 * It needs state (two sliders driving a live figure), so it ships as a Client
 * Component; the rest of the page stays pure HTML. Styling deliberately matches
 * the surrounding page — neutral-950 surfaces, the emerald accent, white/5
 * hairline borders, mono labels — so it reads as part of the same product
 * rather than a dropped-in widget.
 *
 * The model is intentionally simple and honest: roughly 10% of active members
 * train on an expired or unpaid plan, and each is one month of fee that never
 * got collected. It is arithmetic an owner can check against their own register,
 * not a forecast.
 */

const MEMBERS_MIN = 50;
const MEMBERS_MAX = 800;
const MEMBERS_DEFAULT = 250;
const MEMBERS_STEP = 5;

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
    <section id="calculator" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="max-w-2xl">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
          Revenue leakage
        </span>
        <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
          How much is your gym quietly losing?
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-neutral-400">
          Drag the sliders to your real numbers. We assume roughly 10% of active
          members train on an expired or unpaid plan.
        </p>
      </div>

      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/5 bg-white/5 lg:grid-cols-2">
        {/* ---- Sliders ---------------------------------------------------- */}
        <div className="space-y-9 bg-neutral-950 p-6 sm:p-8">
          <div>
            <div className="flex items-baseline justify-between">
              <label
                htmlFor={membersId}
                className="text-xs font-semibold uppercase tracking-wider text-neutral-400"
              >
                Active gym members
              </label>
              <span className="font-mono text-lg font-black tabular-nums text-white">
                {members}
              </span>
            </div>
            <input
              id={membersId}
              type="range"
              min={MEMBERS_MIN}
              max={MEMBERS_MAX}
              step={MEMBERS_STEP}
              value={members}
              onChange={(event) => setMembers(Number(event.target.value))}
              className="mt-3 w-full cursor-pointer accent-emerald-500"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-600">
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
                Monthly membership fee
              </label>
              <span className="font-mono text-lg font-black tabular-nums text-white">
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
              className="mt-3 w-full cursor-pointer accent-emerald-500"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-600">
              <span>₹{inr(FEE_MIN)}</span>
              <span>₹{inr(FEE_MAX)}</span>
            </div>
          </div>
        </div>

        {/* ---- Dynamic leakage callout ------------------------------------ */}
        <div className="flex flex-col justify-center bg-neutral-950 p-6 sm:p-8">
          <div className="flex items-center gap-2 text-amber-400">
            <TriangleAlert className="h-4 w-4" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]">
              Estimated monthly leakage
            </span>
          </div>

          <p className="mt-4 font-mono text-4xl font-black tabular-nums text-white sm:text-5xl">
            ₹{inr(lostRevenue)}
          </p>

          <p className="mt-4 text-sm leading-relaxed text-neutral-400">
            That is roughly what slips through the door each month in uncollected
            renewals and unpaid workouts. Vyroniq&apos;s gate terminal recovers it
            in the first 7 days.
          </p>

          <div className="mt-6 flex items-center gap-2 border-t border-white/5 pt-4 text-neutral-500">
            <TrendingDown className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="text-xs leading-relaxed">
              About{' '}
              <span className="font-mono font-bold tabular-nums text-neutral-300">
                ₹{inr(annualLoss)}
              </span>{' '}
              a year walking out the door.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
