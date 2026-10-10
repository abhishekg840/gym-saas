'use client';

import { useId, useState } from 'react';
import { TrendingDown, TriangleAlert } from 'lucide-react';

/**
 * Revenue Leakage Calculator — the one interactive island on an otherwise
 * server-rendered landing page.
 *
 * It needs state (two sliders driving a live figure), so it ships as a Client
 * Component; everything else on the page stays pure HTML. Its styling mirrors
 * the surrounding editorial design — the same off-white canvas, sage section
 * band, hairline rules, deep-forest accent and mono-free quiet type — so it
 * reads as part of the same product rather than a dropped-in widget. Amber is
 * used sparingly, only to mark the "leakage" figure as something to act on.
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
    <section
      id="calculator"
      className="border-y border-[#dfe4dd] bg-[#eef1ec]"
    >
      <div className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 sm:py-24 lg:px-12">
        <div className="grid gap-8 md:grid-cols-[0.75fr_1.25fr] md:items-end">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#63776a]">
              Revenue leakage
            </p>
            <h2 className="mt-5 max-w-[430px] text-3xl font-medium leading-tight tracking-[-0.04em] sm:text-[42px]">
              See what slips through each month.
            </h2>
          </div>
          <p className="max-w-[540px] text-sm leading-7 text-[#68746c] md:justify-self-end">
            Set the sliders to your gym&apos;s numbers. We assume roughly 10% of
            active members are training on an expired or unpaid membership — one
            month of fees that quietly goes uncollected.
          </p>
        </div>

        <div className="mt-14 grid border-l border-t border-[#d4dcd3] lg:grid-cols-[1.1fr_0.9fr]">
          {/* ---- Sliders -------------------------------------------------- */}
          <div className="space-y-10 border-b border-r border-[#d4dcd3] bg-white/40 p-6 sm:p-8">
            <div>
              <div className="flex items-baseline justify-between gap-4">
                <label
                  htmlFor={membersId}
                  className="text-xs font-medium text-[#53615a]"
                >
                  Active gym members
                </label>
                <span className="text-lg font-medium tabular-nums tracking-tight text-[#17221f]">
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
                className="mt-4 w-full cursor-pointer accent-[#243b30]"
              />
              <div className="mt-2 flex justify-between text-[10px] tabular-nums text-[#8a968d]">
                <span>{MEMBERS_MIN}</span>
                <span>{MEMBERS_MAX}</span>
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-4">
                <label
                  htmlFor={feeId}
                  className="text-xs font-medium text-[#53615a]"
                >
                  Monthly membership fee
                </label>
                <span className="text-lg font-medium tabular-nums tracking-tight text-[#17221f]">
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
                className="mt-4 w-full cursor-pointer accent-[#243b30]"
              />
              <div className="mt-2 flex justify-between text-[10px] tabular-nums text-[#8a968d]">
                <span>₹{inr(FEE_MIN)}</span>
                <span>₹{inr(FEE_MAX)}</span>
              </div>
            </div>
          </div>

          {/* ---- Dynamic leakage figure ----------------------------------- */}
          <div className="flex flex-col justify-center border-b border-r border-[#d4dcd3] bg-white/70 p-6 sm:p-8">
            <div className="flex items-center gap-2 text-[#a1622f]">
              <TriangleAlert size={15} strokeWidth={1.75} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                Estimated monthly leakage
              </span>
            </div>

            <p className="mt-5 text-[44px] font-medium leading-none tracking-[-0.04em] tabular-nums text-[#17221f] sm:text-[56px]">
              ₹{inr(lostRevenue)}
            </p>

            <p className="mt-5 max-w-[360px] text-[13px] leading-6 text-[#68746c]">
              A realistic view of renewals and visits that go uncollected each
              month. Vyroniq brings these back into focus before the membership
              lapses.
            </p>

            <div className="mt-7 flex items-center gap-2 border-t border-[#dfe4dd] pt-5 text-[#7a857d]">
              <TrendingDown size={15} strokeWidth={1.75} className="shrink-0 text-[#a1622f]" />
              <span className="text-[11px] leading-5">
                Roughly{' '}
                <span className="font-medium tabular-nums text-[#17221f]">
                  ₹{inr(annualLoss)}
                </span>{' '}
                across a full year.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
