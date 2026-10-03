'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { formatAmount, titleCase } from '@/lib/format';
import { Button, statusTone, type Tone } from './ui';

/** Axis labels: 0, 50K, 250K, 1.5M. */
const compactAmount = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${+(n / 1_000).toFixed(1)}K` : String(n));

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Daily payment volume as a line: one series, so one hue and no legend. A 2px line over a faint area, hairline
 * gridlines, clean axis numbers, and a crosshair with a tooltip on hover or keyboard focus. The same figures
 * are available as a table.
 *
 * Positions are computed from integer minor units (BigInt), so no monetary value passes through a float.
 */
export function VolumeChart({ data, currency, compact = false }: { data: { date: string; amount: string; count: number }[]; currency: string; compact?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const minor = data.map((d) => BigInt(d.amount.replace('.', '')));
  const max = minor.reduce((m, v) => (v > m ? v : m), 0n);
  const maxMajor = Number(max / 100n) + 1;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(maxMajor, 1)));
  const top = [1, 2, 5, 10].map((m) => m * magnitude).find((v) => v >= maxMajor) ?? maxMajor;
  const ticks = [0, top / 2, top];
  const W = 640, H = compact ? 180 : 250, padL = 58, padR = 12, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const step = data.length > 1 ? plotW / (data.length - 1) : plotW;
  const x = (i: number) => padL + i * step;
  const yOf = (v: bigint) => padT + plotH - (Number((v * 10_000n) / BigInt(top * 100)) / 10_000) * plotH;
  const yTick = (major: number) => padT + plotH - (major / top) * plotH;
  const points = minor.map((v, i) => [x(i), yOf(v)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${padT + plotH} L${padL},${padT + plotH} Z`;
  const total = data.reduce((n, d) => n + d.count, 0);
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div>
      {!compact && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{currency} sent per day, last {data.length} days · {total} payment{total === 1 ? '' : 's'} (cancelled excluded)</p>
          <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>{asTable ? 'Show chart' : 'Show as table'}</Button>
        </div>
      )}
      {asTable ? (
        <div className="table-wrap max-h-64 overflow-y-auto rounded-md border border-border">
          <table className="table">
            <thead><tr><th>Day</th><th className="text-right">Payments</th><th className="text-right">Volume ({currency})</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date}><td>{dayLabel(d.date)}</td><td className="num text-right">{d.count}</td><td className="num text-right">{formatAmount(d.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Line chart of daily payment volume in ${currency} over the last ${data.length} days`}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={padL} x2={W - padR} y1={yTick(tick)} y2={yTick(tick)} stroke="rgb(var(--border))" strokeWidth="1" />
                <text x={padL - 10} y={yTick(tick) + 4} textAnchor="end" fontSize="11" fill="rgb(var(--muted-foreground))" className="num">{compactAmount(tick)}</text>
              </g>
            ))}
            <path d={area} fill="rgb(var(--chart-1))" opacity="0.08" />
            <path d={line} fill="none" stroke="rgb(var(--chart-1))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {active !== null && (
              <g>
                <line x1={points[active][0]} x2={points[active][0]} y1={padT} y2={padT + plotH} stroke="rgb(var(--faint))" strokeWidth="1" />
                <circle cx={points[active][0]} cy={points[active][1]} r="5" fill="rgb(var(--chart-1))" stroke="rgb(var(--card))" strokeWidth="2" />
              </g>
            )}
            {data.map((d, i) => (
              <g key={d.date}>
                {/* Hit target: the whole column, far larger than the point. */}
                <rect
                  x={x(i) - step / 2} y={padT} width={step} height={plotH + padB} fill="transparent" role="img" tabIndex={compact ? -1 : 0}
                  aria-label={`${dayLabel(d.date)}: ${currency} ${formatAmount(d.amount)}, ${d.count} payment${d.count === 1 ? '' : 's'}`}
                  onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                />
                {i % labelEvery === 0 && (
                  <text x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : 'middle'} fontSize="11" fill="rgb(var(--muted-foreground))">{dayLabel(d.date)}</text>
                )}
              </g>
            ))}
          </svg>
          {active !== null && (
            <div role="tooltip" className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-raised" style={{ left: `${Math.min(86, Math.max(14, (points[active][0] / W) * 100))}%` }}>
              <p className="font-semibold">{dayLabel(data[active].date)}</p>
              <p className="num mt-0.5">{currency} {formatAmount(data[active].amount)}</p>
              <p className="text-muted-foreground">{data[active].count} payment{data[active].count === 1 ? '' : 's'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SEGMENT: Record<Tone, string> = { good: 'rgb(var(--success))', info: 'rgb(var(--chart-1))', warn: 'rgb(var(--signal))', bad: 'rgb(var(--error))', neutral: 'rgb(var(--faint))' };

/**
 * Payment status as a donut with a legend. Status colours are the product's reserved status colours, and every
 * legend row repeats the status as an icon and a label with its count, so nothing depends on colour alone.
 * Segments are separated by a 2px gap in the surface colour.
 */
export function StatusDonut({ data, size = 148, layout = 'row' }: { data: { status: string; count: number }[]; size?: number; layout?: 'row' | 'stack' }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((n, d) => n + d.count, 0);
  const visible = data.filter((d) => d.count > 0);
  const r = 42, C = 2 * Math.PI * r, gap = visible.length > 1 ? 2.2 : 0;
  let offset = 0;
  const focus = hover ? data.find((d) => d.status === hover) : null;

  return (
    <div className={clsx('flex flex-col items-center gap-5', layout === 'row' && 'sm:flex-row sm:items-center')}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="-rotate-90" role="img" aria-label={`Donut chart of ${total} payments by status`}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--muted))" strokeWidth="11" />
          {visible.map((d) => {
            const length = (d.count / total) * C;
            const dash = Math.max(length - gap, 0.5);
            const el = (
              <circle
                key={d.status} cx="50" cy="50" r={r} fill="none" stroke={SEGMENT[statusTone(d.status)]} strokeWidth={hover === d.status ? 13 : 11}
                strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offset} opacity={hover && hover !== d.status ? 0.35 : 1}
                className="transition-all duration-200" onMouseEnter={() => setHover(d.status)} onMouseLeave={() => setHover(null)}
              />
            );
            offset += length;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-2xl font-semibold leading-none">{focus ? focus.count : total}</span>
          <span className="mt-1 max-w-[80px] text-center text-[11px] leading-tight text-muted-foreground">{focus ? titleCase(focus.status) : 'payments'}</span>
        </div>
      </div>
      <ul className={clsx('w-full min-w-0', layout === 'stack' ? 'grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-1' : 'space-y-1.5')} aria-label="Payments by status">
        {(layout === 'stack' ? visible : data).map((d) => (
          <li key={d.status} className={clsx('flex items-center justify-between gap-3 rounded-md px-2 py-1 transition-colors duration-150', hover === d.status && 'bg-muted')} onMouseEnter={() => setHover(d.status)} onMouseLeave={() => setHover(null)}>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SEGMENT[statusTone(d.status)] }} />
              <span className="truncate text-[13px] text-foreground">{titleCase(d.status)}</span>
            </span>
            <span className="num font-medium">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
