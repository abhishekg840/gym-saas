'use client';

import { useState } from 'react';

/**
 * Hourly check-in activity for the owner console.
 *
 * PRESENTATION ONLY. The numbers arrive as a 24-bucket array the page already
 * computed from today's punches; this file draws them and knows nothing about
 * the database, auth or gym rules.
 *
 * A gym's day has a real shape — quiet overnight, a morning rush, an evening
 * peak — so the columns are coloured by that shape instead of by a rainbow.
 * The hues come from the product palette (blue = information, green = active,
 * purple = secondary, amber = warning) and each maps to a legend entry, so the
 * chart reads as business analytics rather than decoration.
 */

export const HOUR_BANDS = [
  { label: 'Late night', color: '#A5B4FC', from: 0, to: 5 },
  { label: 'Morning', color: '#34D399', from: 6, to: 10 },
  { label: 'Midday', color: '#60A5FA', from: 11, to: 16 },
  { label: 'Evening', color: '#A78BFA', from: 17, to: 20 },
  { label: 'Night', color: '#FBBF24', from: 21, to: 23 },
] as const;

/** The band a given hour belongs to. */
function hourBand(hour: number) {
  return HOUR_BANDS.find((b) => hour >= b.from && hour <= b.to) ?? HOUR_BANDS[0];
}

/** "07:00" for a 0-23 hour, on the gym clock. */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Tooltip heading for an hour column, e.g. "07:00–08:00". */
function hourRangeLabel(hour: number): string {
  return `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`;
}

interface AttendanceChartProps {
  /** 24 entry counts, index 0 = 00:00. */
  hist: number[];
  /** The busiest hour the desk should see called out, if there is one. */
  peakHour: number | null;
}
/**
 * A real chart, not a decorative strip: a y-axis with gridlines and tick
 * labels, hour labels every three hours, hover tooltips on every column, and a
 * marker on the peak. The axis ceiling is rounded up to a 1/2/5 x 10^n step so
 * the ticks read 0, 5, 10 rather than 0, 3.3, 6.7.
 */
export default function AttendanceChart({ hist, peakHour }: AttendanceChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...hist);
  const rawStep = max / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const normalised = rawStep / magnitude;
  const step =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  const ceiling = Math.max(step, Math.ceil(max / step) * step);

  const W = 720;
  const H = 190;
  const padL = 30;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slot = plotW / hist.length;
  const barW = Math.max(3, slot * 0.62);

  const y = (value: number) => padT + plotH - (value / ceiling) * plotH;
  const x = (hour: number) => padL + slot * hour + (slot - barW) / 2;

  const gridLines: number[] = [];
  for (let v = 0; v <= ceiling; v += step) gridLines.push(v);

  const hoveredCount = hover === null ? 0 : hist[hover];

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Hourly check-ins today. Peak ${
          peakHour === null ? 'not yet determined' : hourRangeLabel(peakHour)
        }.`}
        onMouseLeave={() => setHover(null)}
      >
        {gridLines.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? '#E5E7EB' : '#F1F5F9'}
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={y(v) + 3}
              textAnchor="end"
              fill="#9CA3AF"
              fontSize={9}
              className="tabular-nums"
            >
              {v}
            </text>
          </g>
        ))}

        {hist.map((count, hour) => {
          const band = hourBand(hour);
          const barH = count === 0 ? 2 : Math.max(2, (count / ceiling) * plotH);
          const isHover = hover === hour;
          const isPeak = peakHour === hour && count > 0;
          return (
            <g key={hour}>
              {/* Full-height hit area: the tooltip must not need a 3px bar. */}
              <rect
                x={padL + slot * hour}
                y={padT}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(hour)}
              />
              <rect
                x={x(hour)}
                y={padT + plotH - barH}
                width={barW}
                height={barH}
                rx={2}
                fill={band.color}
                opacity={count === 0 ? 0.25 : isHover ? 1 : 0.82}
                pointerEvents="none"
              />
              {/* The busiest hour carries a marker, not a louder colour. */}
              {isPeak && (
                <circle
                  cx={x(hour) + barW / 2}
                  cy={padT + plotH - barH - 4}
                  r={2.5}
                  fill="#111827"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {hist.map((_, hour) =>
          hour % 3 === 0 ? (
            <text
              key={hour}
              x={padL + slot * hour + slot / 2}
              y={H - 6}
              textAnchor="middle"
              fill="#9CA3AF"
              fontSize={9}
              className="tabular-nums"
            >
              {hourLabel(hour)}
            </text>
          ) : null
        )}
      </svg>

      {/* Hover readout, positioned in the chart's own coordinate space so it
          tracks its column without a positioning library. */}
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-white px-2 py-1 text-[11px] shadow-lg shadow-[#0F172A]/10"
          style={{
            left: `${((padL + slot * hover + slot / 2) / W) * 100}%`,
            top: `${(y(hoveredCount) / H) * 100}%`,
            marginTop: '-8px',
          }}
        >
          <span className="font-medium tabular-nums text-ink">
            {hourRangeLabel(hover)}
          </span>
          <span className="text-muted">
            {' · '}
            {hoveredCount} check-in{hoveredCount === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3">
        {HOUR_BANDS.map((band) => (
          <span
            key={band.label}
            className="inline-flex items-center gap-1.5 text-[10px] text-muted"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: band.color }}
            />
            {band.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[10px] text-muted">
          <span className="h-2 w-2 shrink-0 rounded-full bg-ink" />
          Peak hour
        </span>
      </figcaption>
    </figure>
  );
}