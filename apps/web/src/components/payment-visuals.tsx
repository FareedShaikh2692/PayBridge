'use client';

import clsx from 'clsx';
import { AlertTriangle, Check, X } from 'lucide-react';
import { formatAmount } from '@/lib/format';

/* Visual building blocks shared by the app (live data) and the landing page (fixed demo data). */

export type StepState = 'done' | 'current' | 'error' | 'todo';
export interface LifecycleStep { label: string; sub?: React.ReactNode; state: StepState }

/** Horizontal on wide screens, vertical on phones. The connector fills as steps complete. */
export function Lifecycle({ steps, testId }: { steps: LifecycleStep[]; testId?: string }) {
  return (
    <ol className="grid gap-0 md:flex md:items-start" data-testid={testId} aria-label="Payment lifecycle">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const filled = s.state === 'done';
        return (
          <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0 md:flex-1 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center" aria-current={s.state === 'current' ? 'step' : undefined}>
            {!last && (
              <span aria-hidden="true" className="absolute left-[13px] top-7 h-[calc(100%-28px)] w-0.5 overflow-hidden rounded bg-border md:left-[calc(50%+18px)] md:top-[13px] md:h-0.5 md:w-[calc(100%-36px)]">
                <span className={clsx('block h-full w-full origin-top bg-success-bright transition-transform duration-700 ease-out md:origin-left', filled ? 'scale-100' : 'scale-0')} />
              </span>
            )}
            <span
              className={clsx(
                'relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 bg-card text-xs font-semibold transition-colors duration-300',
                s.state === 'done' && 'border-success-bright bg-success-bright text-white',
                s.state === 'current' && 'border-primary text-primary',
                s.state === 'error' && 'border-error-bright bg-error-bright text-white',
                s.state === 'todo' && 'border-border text-ink-faint',
              )}
            >
              {s.state === 'done' ? <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} /> : s.state === 'error' ? <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
              {s.state === 'current' && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full border-2 border-primary/40 motion-reduce:hidden" />}
            </span>
            <span className="min-w-0 pt-0.5 md:pt-0">
              <span className={clsx('block text-[13px] font-medium', s.state === 'todo' ? 'text-muted-foreground' : 'text-foreground')}>{s.label}</span>
              {s.sub && <span className="block text-xs text-muted-foreground">{s.sub}</span>}
              <span className="sr-only">{s.state === 'done' ? 'complete' : s.state === 'current' ? 'in progress' : s.state === 'error' ? 'failed' : 'not started'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type CheckState = 'pass' | 'warn' | 'fail' | 'pending';
export interface CheckItem { label: string; detail?: React.ReactNode; state: CheckState }

const CHECK_ICON: Record<CheckState, React.ReactNode> = {
  pass: <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />,
  warn: <AlertTriangle aria-hidden="true" className="h-3 w-3" />,
  fail: <X aria-hidden="true" className="h-3 w-3" strokeWidth={3} />,
  pending: null,
};
const CHECK_STYLE: Record<CheckState, string> = {
  pass: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
  fail: 'bg-error-soft text-error',
  pending: 'border border-border bg-card',
};
const CHECK_TEXT: Record<CheckState, string> = { pass: 'passed', warn: 'flagged for review', fail: 'failed', pending: 'pending' };

export function Checklist({ items, result, testId }: { items: CheckItem[]; result?: { tone: 'pass' | 'warn' | 'fail'; title: string; message: string }; testId?: string }) {
  return (
    <div data-testid={testId}>
      <ul className="divide-y divide-border">
        {items.map((c, i) => (
          <li key={c.label} className="flex items-start gap-3 py-2.5 animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
            <span className={clsx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full', CHECK_STYLE[c.state])}>{CHECK_ICON[c.state]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{c.label}<span className="sr-only">: {CHECK_TEXT[c.state]}</span></span>
              {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      {result && (
        <div className={clsx('mt-3 flex items-center gap-3 rounded-lg px-4 py-3', result.tone === 'pass' ? 'bg-success-soft' : result.tone === 'warn' ? 'bg-warning-soft' : 'bg-error-soft')}>
          <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-white', result.tone === 'pass' ? 'bg-success-bright' : result.tone === 'warn' ? 'bg-warning-bright' : 'bg-error-bright')}>
            {result.tone === 'pass' ? <DrawnCheck /> : result.tone === 'warn' ? <AlertTriangle aria-hidden="true" className="h-4 w-4" /> : <X aria-hidden="true" className="h-4 w-4" strokeWidth={3} />}
          </span>
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Result</span>
            <span className={clsx('block text-sm font-semibold', result.tone === 'pass' ? 'text-success' : result.tone === 'warn' ? 'text-warning' : 'text-error')} data-testid={testId ? `${testId}-result` : undefined}>{result.title}</span>
            <span className="block text-xs text-muted-foreground">{result.message}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** A check mark that draws itself. */
export function DrawnCheck({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} strokeDasharray={1} className="animate-draw-check" />
    </svg>
  );
}

/** Adds two-decimal amounts exactly (as integer minor units). */
export function addAmounts(values: string[]): string {
  const total = values.reduce((acc, v) => {
    const negative = v.startsWith('-');
    const [i, f = ''] = v.replace('-', '').split('.');
    const minor = BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
    return acc + (negative ? -minor : minor);
  }, 0n);
  const abs = total < 0n ? -total : total;
  return `${total < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Debit and credit totals per currency, with the balanced indicator. */
export function LedgerTotals({ totals, testId }: { totals: { currency: string; debit: string; credit: string }[]; testId?: string }) {
  const balanced = totals.every((t) => t.debit === t.credit);
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-background text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left sm:px-4">Currency</th><th className="px-3 py-2 text-right sm:px-4">Debit</th><th className="px-3 py-2 text-right sm:px-4">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {totals.map((t) => (
              <tr key={t.currency}>
                <td className="px-3 py-2.5 font-medium sm:px-4">{t.currency}</td>
                <td className="num px-3 py-2.5 text-right sm:px-4">{formatAmount(t.debit)}</td>
                <td className="num px-3 py-2.5 text-right sm:px-4">{formatAmount(t.credit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={clsx('flex items-center justify-between rounded-lg px-4 py-2.5', balanced ? 'bg-success-soft text-success' : 'bg-error-soft text-error')}>
        <span className="text-[13px] font-medium">Debits {balanced ? '=' : '≠'} Credits</span>
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider" data-testid={testId ? `${testId}-balanced` : undefined}>
          {balanced ? <DrawnCheck /> : <X aria-hidden="true" className="h-4 w-4" />} {balanced ? 'Balanced' : 'Unbalanced'}
        </span>
      </div>
    </div>
  );
}

/** The stages every provider webhook passes through. */
export function WebhookPipeline({ status, testId }: { status: 'PROCESSED' | 'IGNORED' | 'FAILED' | 'RECEIVED' | string; testId?: string }) {
  const labels = ['Received', 'Signature verified', 'Persisted', 'Payment updated', 'Ledger updated'];
  const state = (i: number): 'pass' | 'skip' | 'fail' | 'pending' => {
    if (i < 3) return 'pass';
    if (status === 'PROCESSED') return 'pass';
    if (status === 'IGNORED') return 'skip';
    if (status === 'FAILED') return i === 3 ? 'fail' : 'pending';
    return 'pending';
  };
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2" data-testid={testId} aria-label="Webhook processing">
      {labels.map((l, i) => {
        const s = state(i);
        return (
          <li key={l} className="flex items-center gap-1.5 animate-fade-up" style={{ animationDelay: `${i * 90}ms` }}>
            <span className={clsx('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium', s === 'pass' ? 'border-success-bright/30 bg-success-soft text-success' : s === 'fail' ? 'border-error-bright/30 bg-error-soft text-error' : s === 'skip' ? 'border-border bg-muted text-muted-foreground line-through decoration-1' : 'border-dashed border-border text-muted-foreground')}>
              {s === 'pass' ? <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} /> : s === 'fail' ? <X aria-hidden="true" className="h-3 w-3" strokeWidth={3} /> : null}
              {l}
              <span className="sr-only">: {s === 'pass' ? 'done' : s === 'fail' ? 'failed' : s === 'skip' ? 'skipped (duplicate or stale)' : 'pending'}</span>
            </span>
            {i < labels.length - 1 && <span aria-hidden="true" className="text-ink-faint">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Internal record against the provider's record, with the difference. */
export function ReconciliationCompare({ reference, providerId, currency, expected, received, status, testId }: { reference: string; providerId: string | null; currency: string; expected: string | null; received: string | null; status: string; testId?: string }) {
  const difference = expected && received ? addAmounts([received, `-${expected}`]).replace('--', '') : null;
  const matched = status === 'MATCHED';
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Internal payment</p>
          <p className="num mt-1 font-semibold">{reference}</p>
        </div>
        <span aria-hidden="true" className="hidden text-center text-ink-faint sm:block">⇄</span>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Provider record</p>
          <p className="num mt-1 font-semibold">{providerId ?? 'No record'}</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm">
        {([['Expected', expected], ['Received', received], ['Difference', difference]] as const).map(([k, v]) => (
          <div key={k} className="bg-card px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className={clsx('num mt-0.5 font-medium', k === 'Difference' && v && v !== '0.00' && 'text-error')}>{v ? `${currency} ${formatAmount(v)}` : '—'}</dd>
          </div>
        ))}
      </dl>
      <div className={clsx('flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider', matched ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>
        {matched ? <DrawnCheck /> : <AlertTriangle aria-hidden="true" className="h-4 w-4" />} {status.replace(/_/g, ' ')}
      </div>
    </div>
  );
}
