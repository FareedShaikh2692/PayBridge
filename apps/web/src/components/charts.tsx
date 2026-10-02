'use client';

import { useState } from 'react';
import { formatAmount, titleCase } from '@/lib/format';
import { StatusBadge } from './ui';

/**
 * Daily payment volume: one series, so one hue and no legend. Thin columns that grow from a single baseline,
 * rounded at the data end only; hairline gridlines; values in text colour, never the series colour.
 * Each column has a hover/focus tooltip, and the same figures are available as a table.
 *
 * Heights are computed from integer minor units (BigInt), so no monetary value passes through a float.
 */
export function VolumeChart({ data, currency }: { data: { date: string; amount: string; count: number }[]; currency: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const minor = data.map((d) => BigInt(d.amount.replace('.', '')));
  const max = minor.reduce((m, v) => (v > m ? v : m), 0n);
  // Round the axis top up to a clean number: 1, 2 or 5 × 10^n in major units.
  const maxMajor = Number(max / 100n) + 1;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(maxMajor, 1)));
  const top = [1, 2, 5, 10].map((m) => m * magnitude).find((v) => v >= maxMajor) ?? maxMajor;
  const ticks = [0, top / 2, top];
  const W = 640, H = 220, padL = 56, padR = 8, padT = 12, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / data.length;
  const barW = Math.min(24, band - 6);
  const y = (major: number) => padT + plotH - (major / top) * plotH;
  const heightOf = (v: bigint) => (max === 0n ? 0 : (Number((v * 10_000n) / BigInt(top * 100)) / 10_000) * plotH);
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const total = data.reduce((n, d) => n + d.count, 0);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-ink-muted">
          {currency} sent per day, last 14 days · {total} payment{total === 1 ? '' : 's'} (cancelled payments excluded)
        </p>
        <button className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="text-right">Payments</th>
                <th className="text-right">Volume ({currency})</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date}>
                  <td>{dayLabel(d.date)}</td>
                  <td className="num text-right">{d.count}</td>
                  <td className="num text-right">{formatAmount(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Bar chart of daily payment volume in ${currency} over the last 14 days`}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} stroke="#e3e6eb" strokeWidth="1" />
                <text x={padL - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#566072" className="num">
                  {formatAmount(String(tick))}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const h = heightOf(minor[i]);
              const x = padL + i * band + (band - barW) / 2;
              const r = Math.min(4, h);
              const base = padT + plotH;
              return (
                <g key={d.date}>
                  {h > 0 && (
                    // Rounded at the top (the data end), square at the baseline.
                    <path d={`M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barW - r} Q${x + barW},${base - h} ${x + barW},${base - h + r} V${base} Z`} fill="#2a78d6" opacity={active === null || active === i ? 1 : 0.45} />
                  )}
                  {/* Hit target is the whole band, larger than the mark. */}
                  <rect
                    x={padL + i * band}
                    y={padT}
                    width={band}
                    height={plotH + padB}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${dayLabel(d.date)}: ${currency} ${formatAmount(d.amount)}, ${d.count} payment${d.count === 1 ? '' : 's'}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  />
                  {(i % 2 === 0 || data.length <= 7) && (
                    <text x={padL + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#566072">
                      {dayLabel(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="#8691a3" strokeWidth="1" />
          </svg>
          {active !== null && (
            <div role="tooltip" className="pointer-events-none absolute top-0 rounded-md border border-surface-line bg-surface px-2.5 py-1.5 text-xs shadow-card" style={{ left: `${Math.min(78, Math.max(8, ((padL + active * band) / W) * 100))}%` }}>
              <p className="font-semibold">{dayLabel(data[active].date)}</p>
              <p className="num">
                {currency} {formatAmount(data[active].amount)}
              </p>
              <p className="text-ink-muted">
                {data[active].count} payment{data[active].count === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Payment status distribution. Status is a state, not a series: every row is labelled with its status badge
 * (glyph + text) and its count, and the bars share one neutral hue so colour carries no meaning on its own.
 */
export function StatusDistribution({ data }: { data: { status: string; count: number }[] }) {
  const total = data.reduce((n, d) => n + d.count, 0);
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <ul className="space-y-2.5" aria-label="Payments by status">
      {data.map((d) => (
        <li key={d.status} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-3" title={`${titleCase(d.status)}: ${d.count} of ${total}`}>
          <StatusBadge value={d.status} />
          <div className="h-2.5 rounded-sm bg-surface-sunken">
            <div className="h-2.5 rounded-r-[4px] bg-series" style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
          <span className="num text-right font-medium">{d.count}</span>
        </li>
      ))}
    </ul>
  );
}
