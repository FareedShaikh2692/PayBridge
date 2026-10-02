'use client';

import clsx from 'clsx';
import { AlertCircle, AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Inbox, Info, Loader2, Minus, RotateCcw, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { errorMessage, type PageMeta } from '@/lib/api';
import { formatAmount, formatDateTime, titleCase } from '@/lib/format';

/* ────────────────────────────── Layout ────────────────────────────── */

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('container', className)}>{children}</div>;
}

export function Section({ id, eyebrow, title, description, children, className, tone = 'default' }: { id?: string; eyebrow?: string; title?: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string; tone?: 'default' | 'muted' }) {
  return (
    <section id={id} className={clsx('py-16 md:py-24', tone === 'muted' && 'border-y border-border bg-card', className)}>
      <Container>
        {(eyebrow || title) && (
          <div className="mb-10 max-w-3xl md:mb-14">
            {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
            {title && <h2 className="text-2xl font-semibold tracking-tight md:text-[32px] md:leading-tight">{title}</h2>}
            {description && <p className="mt-4 text-base leading-relaxed text-muted-foreground">{description}</p>}
          </div>
        )}
        {children}
      </Container>
    </section>
  );
}

/* ────────────────────────────── Feedback primitives ────────────────────────────── */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden="true" className={clsx('h-4 w-4 animate-spin', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={clsx('skeleton h-4', className)} />;
}

/** Skeleton shaped like the content it stands in for, so the page does not jump when data arrives. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="w-28" />
          <Skeleton className="flex-1" />
          <Skeleton className="hidden w-24 sm:block" />
          <Skeleton className="w-20" />
        </div>
      ))}
    </div>
  );
}

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner className="h-5 w-5 text-primary" />
      <span>{label}…</span>
    </div>
  );
}

/** Kept for compact inline use; prefer SkeletonRows or PageLoader. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
      <Spinner className="text-primary" />
      {label.replace(/…$/, '')}…
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link';
const BUTTON: Record<ButtonVariant, string> = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', destructive: 'btn-danger', link: 'btn-link' };

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  loadingLabel?: string;
  icon?: LucideIcon;
}

/** One button for the whole product. `loading` disables it and shows a spinner, so a double click cannot double-submit. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, loadingLabel, icon: Icon, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={clsx(BUTTON[variant], size === 'lg' && 'btn-lg', size === 'sm' && 'btn-sm', className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : null}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
});

/* ────────────────────────────── Status ────────────────────────────── */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const TONE: Record<Tone, string> = {
  good: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
  bad: 'bg-error-soft text-error',
  info: 'bg-primary-soft text-info',
  neutral: 'bg-muted text-muted-foreground',
};
/** Every status carries an icon as well as a colour, so state is never conveyed by colour alone. */
const TONE_ICON: Record<Tone, LucideIcon> = { good: Check, warn: AlertTriangle, bad: X, info: Clock, neutral: Minus };

export function Badge({ tone = 'neutral', children, title, icon }: { tone?: Tone; children: React.ReactNode; title?: string; icon?: LucideIcon | false }) {
  const Icon = icon === false ? null : (icon ?? TONE_ICON[tone]);
  return (
    <span title={title} className={clsx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold leading-5', TONE[tone])}>
      {Icon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  // payments
  CREATED: 'info', COMPLIANCE_REVIEW: 'warn', APPROVED: 'good', PROCESSING: 'info', PAID: 'good', FAILED: 'bad', CANCELLED: 'neutral', RETURNED: 'warn',
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

export function statusTone(value: string): Tone {
  return STATUS_TONE[value] ?? 'neutral';
}

export function StatusBadge({ value, label, testId }: { value: string | null | undefined; label?: string; testId?: string }) {
  if (!value) return <span className="text-ink-faint">—</span>;
  return (
    <span data-testid={testId} data-status={value}>
      <Badge tone={statusTone(value)}>{label ?? titleCase(value)}</Badge>
    </span>
  );
}

/* ────────────────────────────── Data display ────────────────────────────── */

export function Money({ value, currency, className, strong }: { value: string | null | undefined; currency: string; className?: string; strong?: boolean }) {
  return (
    <span className={clsx('num whitespace-nowrap', strong && 'font-semibold text-foreground', className)}>
      <span className="mr-1 text-[0.8em] font-medium text-muted-foreground">{currency.trim()}</span>
      {formatAmount(value)}
    </span>
  );
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary">
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('card overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2>{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : undefined}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, testId, icon: Icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; testId?: string; icon?: LucideIcon }) {
  return (
    <div className="card p-5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon aria-hidden="true" className="h-4 w-4 text-ink-faint" />}
      </div>
      <p className="num mt-2 text-[22px] font-semibold leading-8 tracking-tight sm:text-[26px]">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
export const StatCard = Stat;

export function Rows({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-border">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
}

/** Generic table for simple lists. Wide tables scroll inside their own wrapper, never the page. */
export function DataTable<T>({ columns, rows, rowKey, testId }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; testId?: string }) {
  return (
    <div className="table-wrap">
      <table className="table" data-testid={testId}>
        <thead>
          <tr>{columns.map((c) => <th key={c.header} className={c.align === 'right' ? 'text-right' : undefined}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>{columns.map((c) => <td key={c.header} className={c.align === 'right' ? 'text-right' : undefined}>{c.cell(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Timeline({ items }: { items: { id: string; title: React.ReactNode; detail?: React.ReactNode; at: string; tone?: Tone }[] }) {
  return (
    <ol className="relative ml-1.5 border-l border-border">
      {items.map((item) => (
        <li key={item.id} className="relative pb-5 pl-5 last:pb-0">
          <span aria-hidden="true" className={clsx('absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card', item.tone === 'good' ? 'bg-success' : item.tone === 'bad' ? 'bg-error' : item.tone === 'warn' ? 'bg-warning' : item.tone === 'neutral' ? 'bg-ink-faint' : 'bg-info')} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{item.title}</span>
            <time className="num text-xs text-ink-faint" dateTime={item.at}>{formatDateTime(item.at)}</time>
          </div>
          {item.detail && <div className="mt-0.5 text-muted-foreground">{item.detail}</div>}
        </li>
      ))}
    </ol>
  );
}

/* ────────────────────────────── States ────────────────────────────── */

const ALERT_ICON: Record<Tone, LucideIcon> = { good: CheckCircle2, warn: AlertTriangle, bad: AlertCircle, info: Info, neutral: Info };

export function Alert({ tone = 'info', title, children, testId }: { tone?: Tone; title?: string; children?: React.ReactNode; testId?: string }) {
  const Icon = ALERT_ICON[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} data-testid={testId} className={clsx('flex gap-3 rounded-lg border px-4 py-3 text-sm', tone === 'bad' ? 'border-error/25 bg-error-soft' : tone === 'warn' ? 'border-warning/25 bg-warning-soft' : tone === 'good' ? 'border-success/25 bg-success-soft' : tone === 'info' ? 'border-info/20 bg-primary-soft' : 'border-border bg-muted')}>
      <Icon aria-hidden="true" className={clsx('mt-0.5 h-4 w-4 shrink-0', tone === 'bad' ? 'text-error' : tone === 'warn' ? 'text-warning' : tone === 'good' ? 'text-success' : tone === 'info' ? 'text-info' : 'text-muted-foreground')} />
      <div className="min-w-0">
        {title && <p className="font-semibold text-foreground">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5', 'text-foreground/90')}>{children}</div>}
      </div>
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

export function EmptyState({ title, children, icon: Icon = Inbox, action }: { title: string; children?: React.ReactNode; icon?: LucideIcon; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="h-5 w-5" />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export const Empty = EmptyState;

/** A full error panel with a retry action. Shows the API's safe message only — never a stack trace. */
export function ErrorState({ error, onRetry, title = 'Something went wrong' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" data-testid="error" className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-error-soft text-error">
        <AlertCircle aria-hidden="true" className="h-5 w-5" />
      </span>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" icon={RotateCcw} className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Wraps the states every data view has: loading (skeleton), error (with retry), empty, and loaded. */
export function QueryState<T>({ query, children, empty, skeleton }: { query: { isLoading: boolean; error: unknown; data: T | undefined; refetch?: () => unknown }; children: (data: T) => React.ReactNode; empty?: (data: T) => boolean; skeleton?: React.ReactNode }) {
  if (query.isLoading) return <>{skeleton ?? <SkeletonRows />}</>;
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch ? () => void query.refetch?.() : undefined} />;
  if (query.data === undefined) return null;
  if (empty?.(query.data)) return <EmptyState title="Nothing here yet" />;
  return <>{children(query.data)}</>;
}

/* ────────────────────────────── Forms ────────────────────────────── */

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1 text-xs font-medium text-error">
          <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={clsx('input', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={clsx('input', className)} {...rest}>{children}</select>;
});

/* ────────────────────────────── Overlays ────────────────────────────── */

export function Pagination({ meta, onPage }: { meta: PageMeta | undefined; onPage: (page: number) => void }) {
  if (!meta || meta.total === 0) return null;
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <span className="num">{(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>Next <ChevronRight aria-hidden="true" className="h-4 w-4" /></Button>
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
    <dialog ref={ref} onClose={onClose} onCancel={onClose} className="w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-card p-0 text-foreground shadow-overlay backdrop:bg-navy-900/50 backdrop:backdrop-blur-[2px]" aria-label={title}>
      {open && (
        <div className="animate-fade-up">
          <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2>{title}</h2>
            <button className="btn-ghost !min-h-8 !px-2 text-muted-foreground" onClick={onClose} aria-label="Close dialog"><X aria-hidden="true" className="h-4 w-4" /></button>
          </header>
          <div className="p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Short explanation shown on hover and on keyboard focus. */
export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex" tabIndex={0}>
      {children}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[240px] -translate-x-1/2 rounded-md bg-navy-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-raised transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
      </span>
    </span>
  );
}

interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}
const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

/** Brief confirmation after an action. Announced politely to assistive technology; disappears on its own. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: Tone = 'good') => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-2), { id, tone, message }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => {
          const Icon = ALERT_ICON[t.tone];
          return (
            <div key={t.id} data-testid="toast" className="pointer-events-auto flex animate-fade-up items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-overlay">
              <Icon aria-hidden="true" className={clsx('mt-0.5 h-4 w-4 shrink-0', t.tone === 'bad' ? 'text-error' : t.tone === 'warn' ? 'text-warning' : t.tone === 'good' ? 'text-success' : 'text-info')} />
              <p className="font-medium">{t.message}</p>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
