'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { errorMessage, type PageMeta } from '@/lib/api';
import { formatAmount, formatDateTime, titleCase } from '@/lib/format';

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const TONE: Record<Tone, string> = {
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  neutral: 'bg-surface-sunken text-ink-muted',
};

/** Every status carries a glyph as well as a colour, so state is never conveyed by colour alone. */
const GLYPH: Record<Tone, string> = {
  good: 'M3.5 8.5l3 3 6-7',
  warn: 'M8 3v6M8 12v.5',
  bad: 'M4 4l8 8M12 4l-8 8',
  info: 'M8 4v4l2.5 2',
  neutral: 'M4 8h8',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', TONE[tone])}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={GLYPH[tone]} />
      </svg>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  // payments
  CREATED: 'info', COMPLIANCE_REVIEW: 'warn', APPROVED: 'good', PROCESSING: 'info', PAID: 'good', FAILED: 'bad', CANCELLED: 'neutral',
  // KYB
  DRAFT: 'neutral', SUBMITTED: 'info', UNDER_REVIEW: 'warn', REJECTED: 'bad', EXPIRED: 'bad',
  // compliance
  CLEAR: 'good', REVIEW: 'warn', REJECT: 'bad', CLEARED_BY_ADMIN: 'good', REJECTED_BY_ADMIN: 'bad', PEP_MATCH: 'warn', MATCH: 'bad', PENDING: 'warn',
  // quotes, beneficiaries, approvals
  ACTIVE: 'good', USED: 'neutral', INACTIVE: 'neutral', BLOCKED: 'bad', NOT_REQUIRED: 'neutral',
  // reconciliation, webhooks, jobs
  MATCHED: 'good', MISMATCH: 'bad', MISSING: 'bad', DUPLICATE: 'bad', REVIEW_REQUIRED: 'warn', RECEIVED: 'info', PROCESSED: 'good', IGNORED: 'neutral', RUNNING: 'info', COMPLETED: 'good', SUSPENDED: 'bad', INVITED: 'info',
  LOW: 'good', MEDIUM: 'warn', HIGH: 'bad', PASS: 'good', FAIL: 'bad',
};

export function StatusBadge({ value, label, testId }: { value: string | null | undefined; label?: string; testId?: string }) {
  if (!value) return <span className="text-ink-faint">—</span>;
  return (
    <span data-testid={testId} data-status={value}>
      <Badge tone={STATUS_TONE[value] ?? 'neutral'}>{label ?? titleCase(value)}</Badge>
    </span>
  );
}

export function Money({ value, currency, className, strong }: { value: string | null | undefined; currency: string; className?: string; strong?: boolean }) {
  return (
    <span className={clsx('num whitespace-nowrap', strong && 'font-semibold', className)}>
      <span className="mr-1 text-xs font-medium text-ink-muted">{currency.trim()}</span>
      {formatAmount(value)}
    </span>
  );
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-xs font-medium text-ink-muted hover:text-accent">
            ← {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-surface-line px-4 py-3">
          <h2>{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-4' : undefined}>{children}</div>
    </section>
  );
}

export function Alert({ tone = 'info', title, children, testId }: { tone?: Tone; title?: string; children?: React.ReactNode; testId?: string }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} data-testid={testId} className={clsx('rounded-md border px-3 py-2.5 text-sm', TONE[tone], tone === 'bad' ? 'border-bad/30' : tone === 'warn' ? 'border-warn/30' : tone === 'good' ? 'border-good/30' : 'border-surface-line')}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={clsx(title && 'mt-0.5', 'text-ink')}>{children}</div>}
    </div>
  );
}

export function ErrorNote({ error, testId = 'error' }: { error: unknown; testId?: string }) {
  if (!error) return null;
  return (
    <Alert tone="bad" title="That did not work" testId={testId}>
      {errorMessage(error)}
    </Alert>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-ink-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-surface-line border-t-accent" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-ink-muted">{children}</div>}
    </div>
  );
}

/** Wraps the three states every data view has. */
export function QueryState<T>({ query, children, empty }: { query: { isLoading: boolean; error: unknown; data: T | undefined }; children: (data: T) => React.ReactNode; empty?: (data: T) => boolean }) {
  if (query.isLoading) return <Loading />;
  if (query.error) return <div className="p-4"><ErrorNote error={query.error} /></div>;
  if (query.data === undefined) return null;
  if (empty?.(query.data)) return <Empty title="Nothing here yet" />;
  return <>{children(query.data)}</>;
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta: PageMeta | undefined; onPage: (page: number) => void }) {
  if (!meta || meta.total === 0) return null;
  return (
    <div className="flex items-center justify-between border-t border-surface-line px-4 py-2.5 text-xs text-ink-muted">
      <span className="num">
        {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Previous
        </button>
        <button className="btn-secondary" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} className="w-full max-w-lg rounded-lg border border-surface-line p-0 shadow-xl backdrop:bg-ink/40" aria-label={title}>
      {open && (
        <>
          <header className="flex items-center justify-between border-b border-surface-line px-4 py-3">
            <h2>{title}</h2>
            <button className="btn-ghost !min-h-0 !px-2 !py-1" onClick={onClose} aria-label="Close dialog">
              ✕
            </button>
          </header>
          <div className="p-4">{children}</div>
        </>
      )}
    </dialog>
  );
}

export function Rows({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-surface-line">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="shrink-0 text-ink-muted">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({ items }: { items: { id: string; title: React.ReactNode; detail?: React.ReactNode; at: string; tone?: Tone }[] }) {
  return (
    <ol className="relative ml-2 border-l border-surface-line">
      {items.map((item) => (
        <li key={item.id} className="relative pb-4 pl-5 last:pb-0">
          <span aria-hidden="true" className={clsx('absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface', item.tone === 'good' ? 'bg-good' : item.tone === 'bad' ? 'bg-bad' : item.tone === 'warn' ? 'bg-warn' : 'bg-accent')} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{item.title}</span>
            <time className="num text-xs text-ink-faint" dateTime={item.at}>
              {formatDateTime(item.at)}
            </time>
          </div>
          {item.detail && <div className="mt-0.5 text-ink-muted">{item.detail}</div>}
        </li>
      ))}
    </ol>
  );
}

export function Stat({ label, value, sub, testId }: { label: string; value: React.ReactNode; sub?: React.ReactNode; testId?: string }) {
  return (
    <div className="card p-4" data-testid={testId}>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="num mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

export function statusTone(value: string): Tone {
  return STATUS_TONE[value] ?? 'neutral';
}
