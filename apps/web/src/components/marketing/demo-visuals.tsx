'use client';

import clsx from 'clsx';
import { ArrowRight, Building2, Check, CircleDollarSign, Landmark, Scale, ScrollText, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Checklist, DrawnCheck, LedgerTotals, Lifecycle, ReconciliationCompare, WebhookPipeline, type LifecycleStep } from '@/components/payment-visuals';
import { useInView } from '@/components/ui';

/*
 * Landing-page visuals. Every value here is fixed, fictional demo data — the same numbers the sandbox
 * produces for an AED 10,000 payment at the seeded rate — and is labelled as a demo where it appears.
 */
export const DEMO = {
  reference: 'PB-2026-000421',
  provider: 'SIM-88942',
  sender: 'Acme Trading LLC',
  senderCity: 'Dubai',
  beneficiary: 'Acme India Pvt Ltd',
  beneficiaryCity: 'Mumbai',
  send: '10,000.00',
  rate: '22.5865',
  receive: '225,865.00',
  fee: '25.00',
  total: '10,025.00',
};

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts from 0 to `target` steps once `start` is true, one step per `interval` ms. */
function useStepper(start: boolean, target: number, interval: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!start) return;
    if (reducedMotion()) return setN(target);
    if (n >= target) return;
    const t = setTimeout(() => setN((v) => v + 1), n === 0 ? 250 : interval);
    return () => clearTimeout(t);
  }, [start, n, target, interval]);
  return n;
}

function DemoTag({ dark = false }: { dark?: boolean }) {
  return <span className={clsx('rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider', dark ? 'bg-white/10 text-white/70' : 'bg-warning-soft text-warning')}>Demo</span>;
}

/* ───────────────────────── Hero payment card ───────────────────────── */

export function HeroPaymentCard() {
  const { ref, visible } = useInView<HTMLDivElement>({ rootMargin: '0px' });
  const step = useStepper(visible, 5, 650); // 1 amount, 2 fx, 3 compliance, 4 ledger, 5 settlement
  const checks = ['Compliance passed', 'Ledger balanced', 'Settlement simulated'];
  return (
    <div ref={ref} className="relative">
      <div aria-hidden="true" className="absolute -inset-8 -z-10 rounded-[32px] bg-primary/10 blur-3xl" />
      <figure className="card overflow-hidden shadow-overlay" aria-label={`Demo payment ${DEMO.reference}: AED ${DEMO.send} converted at ${DEMO.rate} to INR ${DEMO.receive}; compliance passed, ledger balanced, settlement simulated`}>
        <figcaption className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">Sandbox payment <DemoTag /></p>
            <p className="num mt-0.5 font-semibold">{DEMO.reference}</p>
          </div>
          <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors duration-500', step >= 5 ? 'bg-success-soft text-success' : 'bg-primary-soft text-primary')}>
            <span aria-hidden="true" className={clsx('h-1.5 w-1.5 rounded-full', step >= 5 ? 'bg-success-bright' : 'animate-pulse bg-primary')} />
            {step >= 5 ? 'Paid' : 'Processing'}
          </span>
        </figcaption>

        <div className="space-y-3 px-5 py-5">
          <div className={clsx('flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 transition-all duration-500', step >= 1 ? 'opacity-100' : 'translate-y-1 opacity-0')}>
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground"><Building2 aria-hidden="true" className="h-4 w-4" />{DEMO.sender}</span>
            <span className="num text-lg font-semibold"><span className="mr-1 text-xs font-medium text-muted-foreground">AED</span>{DEMO.send}</span>
          </div>
          <div className={clsx('flex items-center gap-3 px-1 transition-all duration-500', step >= 2 ? 'opacity-100' : 'opacity-0')}>
            <span aria-hidden="true" className="relative h-8 w-px overflow-hidden bg-border"><span className="absolute inset-x-0 h-full animate-flow-down bg-primary" /></span>
            <span className="num rounded-md border border-primary/20 bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">FX {DEMO.rate}</span>
            <span className="text-xs text-muted-foreground">fee AED {DEMO.fee}</span>
          </div>
          <div className={clsx('flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 transition-all duration-500', step >= 2 ? 'opacity-100' : 'translate-y-1 opacity-0')}>
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground"><Landmark aria-hidden="true" className="h-4 w-4" />{DEMO.beneficiary}</span>
            <span className="num text-lg font-semibold"><span className="mr-1 text-xs font-medium text-muted-foreground">INR</span>{DEMO.receive}</span>
          </div>
        </div>

        <ul className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
          {checks.map((c, i) => {
            const done = step >= i + 3;
            return (
              <li key={c} className="flex items-center gap-2 bg-card px-4 py-3 text-[13px]">
                <span className={clsx('grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors duration-300', done ? 'bg-success-bright text-white' : 'border border-border text-transparent')}>
                  {done ? <DrawnCheck className="h-3 w-3" /> : null}
                </span>
                <span className={done ? 'font-medium text-foreground' : 'text-muted-foreground'}>{c}</span>
              </li>
            );
          })}
        </ul>
      </figure>
    </div>
  );
}

/* ───────────────────────── Seven-stage flow ───────────────────────── */

const STAGES = [
  { icon: Building2, title: 'UAE Business', text: 'Acme Trading LLC, KYB approved' },
  { icon: CircleDollarSign, title: 'FX Quote', text: 'Rate locked for 60 seconds' },
  { icon: ShieldCheck, title: 'Compliance', text: 'Rules and maker-checker' },
  { icon: ScrollText, title: 'Ledger', text: 'Hold, capture, settle' },
  { icon: Send, title: 'Provider', text: 'Mock payout, signed webhooks' },
  { icon: Scale, title: 'Settlement', text: 'Confirmed and reconciled' },
  { icon: Landmark, title: 'India Beneficiary', text: 'Acme India Pvt Ltd' },
];

export function FlowStages() {
  const { ref, visible } = useInView<HTMLOListElement>();
  const lit = useStepper(visible, STAGES.length, 280);
  return (
    <ol ref={ref} className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-7 lg:gap-0">
      <span aria-hidden="true" className="absolute left-[10%] right-[10%] top-[27px] hidden h-px bg-border lg:block">
        <span className="block h-full origin-left bg-primary transition-transform duration-[1800ms] ease-out" style={{ transform: `scaleX(${visible ? 1 : 0})` }} />
      </span>
      {STAGES.map(({ icon: Icon, title, text }, i) => {
        const on = lit > i;
        return (
          <li key={title} className="relative flex items-center gap-3 rounded-lg border border-border bg-card p-3 lg:flex-col lg:border-0 lg:bg-transparent lg:p-0 lg:text-center">
            <span className={clsx('relative z-[1] grid h-14 w-14 shrink-0 place-items-center rounded-xl border bg-card transition-all duration-500', on ? 'border-primary/40 text-primary shadow-raised' : 'border-border text-ink-faint')}>
              <Icon aria-hidden="true" className="h-5 w-5" />
              <span className="num absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-navy-900 text-[10px] font-semibold text-white">{i + 1}</span>
            </span>
            <span className="lg:mt-3 lg:px-2">
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block text-xs text-muted-foreground">{text}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────────────────── Interactive payment demo ───────────────────────── */

const LIFECYCLE = ['Created', 'Compliance', 'Approved', 'Processing', 'Paid', 'Reconciled'];
const TIMES = ['10:02:11', '10:02:11', '10:04:37', '10:04:38', '10:04:41', '10:15:00'];
const TABS = ['Compliance', 'Ledger', 'Webhooks', 'Reconciliation'] as const;

export function PaymentDemo() {
  const { ref, visible } = useInView<HTMLDivElement>();
  const progress = useStepper(visible, LIFECYCLE.length, 700);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Compliance');
  const paid = progress >= 5;
  const steps: LifecycleStep[] = LIFECYCLE.map((label, i) => ({ label, sub: i < progress ? TIMES[i] : undefined, state: i < progress ? 'done' : i === progress ? 'current' : 'todo' }));

  return (
    <div ref={ref} className="card overflow-hidden shadow-overlay" data-testid="payment-demo">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4 md:px-6">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment ID <DemoTag /></p>
          <p className="num mt-1 text-xl font-semibold">{DEMO.reference}</p>
        </div>
        <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors duration-500', paid ? 'bg-success-soft text-success' : 'bg-primary-soft text-primary')} data-testid="demo-status">
          <span aria-hidden="true" className={clsx('h-2 w-2 rounded-full', paid ? 'bg-success-bright' : 'animate-pulse bg-primary')} />
          {paid ? 'Paid' : LIFECYCLE[Math.min(progress, 5)]}
        </span>
      </div>

      <div className="grid gap-px bg-border md:grid-cols-[1.1fr_1fr]">
        <div className="bg-card px-5 py-5 md:px-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div>
              <p className="text-xs text-muted-foreground">{DEMO.sender} · {DEMO.senderCity}</p>
              <p className="num mt-1 text-2xl font-semibold tracking-tight"><span className="mr-1 text-sm font-medium text-muted-foreground">AED</span>{DEMO.send}</p>
            </div>
            <ArrowRight aria-hidden="true" className="hidden h-4 w-4 text-ink-faint sm:block" />
            <div className="sm:text-right">
              <p className="text-xs text-muted-foreground">{DEMO.beneficiary} · {DEMO.beneficiaryCity}</p>
              <p className="num mt-1 text-2xl font-semibold tracking-tight"><span className="mr-1 text-sm font-medium text-muted-foreground">INR</span>{DEMO.receive}</p>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-px bg-border">
          {[['FX rate', DEMO.rate], ['Fee', `AED ${DEMO.fee}`], ['Provider', DEMO.provider]].map(([k, v]) => (
            <div key={k} className="bg-card px-4 py-5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="num mt-1 text-sm font-semibold">{v}</dd></div>
          ))}
        </dl>
      </div>

      <div className="border-t border-border px-5 py-6 md:px-6">
        <Lifecycle steps={steps} testId="demo-lifecycle" />
      </div>

      <div className="border-t border-border">
        <div role="tablist" aria-label="Payment detail" className="flex overflow-x-auto border-b border-border px-3 md:px-4">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              id={`demo-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`demo-panel-${t}`}
              onClick={() => setTab(t)}
              className={clsx('relative min-h-[44px] whitespace-nowrap px-3 text-sm font-medium transition-colors duration-150', tab === t ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
            >
              {t}
              <span aria-hidden="true" className={clsx('absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary transition-opacity', tab === t ? 'opacity-100' : 'opacity-0')} />
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`demo-panel-${tab}`} aria-labelledby={`demo-tab-${tab}`} className="px-5 py-5 md:px-6" key={tab}>
          {tab === 'Compliance' && <ComplianceDemo />}
          {tab === 'Ledger' && <LedgerDemo />}
          {tab === 'Webhooks' && <WebhookDemo />}
          {tab === 'Reconciliation' && <ReconciliationDemo />}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Feature visuals (also used standalone) ───────────────────────── */

export function ComplianceDemo() {
  return (
    <Checklist
      testId="demo-compliance"
      items={[
        { label: 'KYB approved', detail: `${DEMO.sender} · trade licence verified (simulated)`, state: 'pass' },
        { label: 'Beneficiary verified', detail: `${DEMO.beneficiary} · IFSC format valid`, state: 'pass' },
        { label: 'Payment limit', detail: 'AED 10,000.00 is under the AED 50,000.00 review threshold', state: 'pass' },
        { label: 'Currency supported', detail: 'AED → INR corridor', state: 'pass' },
        { label: 'Required data', detail: 'Purpose of payment and beneficiary bank details present', state: 'pass' },
        { label: 'Sanctions simulation', detail: 'No match on the mock screening list', state: 'pass' },
      ]}
      result={{ tone: 'pass', title: 'Approved', message: 'All configured sandbox rules passed.' }}
    />
  );
}

const LEDGER_LINES = [
  ['Customer wallet — Acme Trading', 'Debit', 'AED 10,025.00'],
  ['Payment hold', 'Credit', 'AED 10,025.00'],
  ['Payment hold', 'Debit', 'AED 10,025.00'],
  ['Fee revenue', 'Credit', 'AED 25.00'],
  ['FX margin', 'Credit', 'AED 50.00'],
  ['FX position (AED)', 'Credit', 'AED 9,950.00'],
  ['FX position (INR)', 'Debit', 'INR 225,865.00'],
  ['Provider settlement (INR)', 'Credit', 'INR 225,865.00'],
] as const;

export function LedgerDemo({ showLines = true }: { showLines?: boolean }) {
  return (
    <div className="space-y-4">
      {showLines && (
        <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
          {LEDGER_LINES.map(([acc, dir, amt], i) => (
            <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[1fr_auto_auto]">
              <span className={dir === 'Credit' ? 'pl-4 text-muted-foreground' : 'font-medium'}>{acc}</span>
              <span className={clsx('rounded px-1.5 text-[10px] font-bold uppercase tracking-wider', dir === 'Debit' ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground')}>{dir}</span>
              <span className="num col-span-2 text-right sm:col-span-1 sm:w-32">{amt}</span>
            </li>
          ))}
        </ul>
      )}
      <LedgerTotals testId="demo-ledger" totals={[{ currency: 'AED', debit: '20050.00', credit: '20050.00' }, { currency: 'INR', debit: '225865.00', credit: '225865.00' }]} />
    </div>
  );
}

const EVENTS = [
  { type: 'payment.processing', id: 'evt_7c1e04a2', at: '10:04:38', status: 'PROCESSED', note: 'Recorded; payment already processing' },
  { type: 'payment.paid', id: 'evt_9b3f61d0', at: '10:04:41', status: 'PROCESSED', note: 'Payment → PAID, settlement posted' },
  { type: 'payment.paid', id: 'evt_9b3f61d0', at: '10:04:43', status: 'IGNORED', note: 'Duplicate event id — acknowledged, nothing changed' },
];

export function WebhookDemo() {
  return (
    <ol className="space-y-4" data-testid="demo-webhooks">
      {EVENTS.map((e, i) => (
        <li key={i} className="animate-fade-up border-l-2 border-border pl-4" style={{ animationDelay: `${i * 120}ms` }}>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm"><span className="num font-semibold">{e.type}</span><span className="num text-xs text-muted-foreground">{e.id} · {e.at}</span></p>
          <p className="mb-2 text-xs text-muted-foreground">{e.note}</p>
          <WebhookPipeline status={e.status} />
        </li>
      ))}
    </ol>
  );
}

export function ReconciliationDemo() {
  return <ReconciliationCompare testId="demo-reconciliation" reference={DEMO.reference} providerId={DEMO.provider} currency="INR" expected="225865.00" received="225865.00" status="MATCHED" />;
}

/** Plays its children's entrance animations when they scroll into view. */
export function OnView({ children, className }: { children: React.ReactNode; className?: string }) {
  const { ref, visible } = useInView<HTMLDivElement>();
  // Always rendered (so the page height never jumps while scrolling); hidden until seen, then remounted so entrance animations play.
  return (
    <div ref={ref} className={clsx(!visible && 'invisible', className)}>
      <div key={visible ? 'seen' : 'unseen'}>{children}</div>
    </div>
  );
}

/* ───────────────────────── FX quote ───────────────────────── */

export function FxQuoteDemo() {
  const { ref, visible } = useInView<HTMLDivElement>();
  const [left, setLeft] = useState(60);
  useEffect(() => {
    if (!visible || reducedMotion()) return;
    const t = setInterval(() => setLeft((s) => (s <= 1 ? 60 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [visible]);
  const rows: [string, string, boolean?][] = [
    ['Mid-market rate (mock)', '22.700000'],
    ['Spread', '0.50%'],
    ['Your rate', DEMO.rate, true],
    ['You send', `AED ${DEMO.send}`],
    ['Fee', `AED ${DEMO.fee}`],
    ['Total debited', `AED ${DEMO.total}`, true],
    ['Recipient receives', `INR ${DEMO.receive}`, true],
  ];
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div ref={ref} className="card p-5 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">AED → INR quote <DemoTag /></p>
        <span className="flex items-center gap-2 text-xs text-muted-foreground" aria-label={`Quote locked, ${left} seconds left`}>
          <svg viewBox="0 0 44 44" className="h-9 w-9 -rotate-90" aria-hidden="true">
            <circle cx="22" cy="22" r={r} fill="none" stroke="rgb(var(--border))" strokeWidth="4" />
            <circle cx="22" cy="22" r={r} fill="none" stroke="rgb(var(--primary))" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left / 60)} className="transition-[stroke-dashoffset] duration-1000 ease-linear" />
          </svg>
          <span className="num w-16">{left}s locked</span>
        </span>
      </div>
      <dl className="divide-y divide-border text-sm">
        {rows.map(([k, v, strong]) => (
          <div key={k} className="flex items-center justify-between gap-3 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={clsx('num', strong && 'font-semibold text-foreground')}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 rounded-md bg-background px-3 py-2 text-xs text-muted-foreground"><span className="num">10,000.00 × 22.5865 = 225,865.00</span> — rounded down to 2 dp, never with floating point.</p>
    </div>
  );
}

/* ───────────────────────── Idempotency ───────────────────────── */

export function IdempotencyDemo() {
  const { ref, visible } = useInView<HTMLDivElement>();
  const step = useStepper(visible, 3, 900);
  return (
    <div ref={ref} className="space-y-3" data-testid="demo-idempotency">
      {[
        { n: 1, result: '201 Created', text: `Payment ${DEMO.reference} created` },
        { n: 2, result: '201 Created', text: 'Same key — existing payment returned', replay: true },
      ].map((r, i) => (
        <div key={r.n} className={clsx('overflow-hidden rounded-lg border border-border bg-card transition-all duration-500', step > i ? 'opacity-100' : 'translate-y-2 opacity-0')}>
          <div className="flex items-center justify-between border-b border-border bg-background px-4 py-2 text-xs">
            <span className="font-semibold">Request #{r.n}</span>
            <span className="num rounded bg-success-soft px-1.5 py-px font-semibold text-success">{r.result}</span>
          </div>
          <pre className="num overflow-x-auto px-4 py-3 text-xs leading-relaxed text-muted-foreground">{`POST /api/v1/payments
Idempotency-Key: 6f1c0f2e-4a7b-4d3e-9b1a${r.replay ? '\nIdempotent-Replayed: true' : ''}`}</pre>
          <p className="border-t border-border px-4 py-2 text-[13px]">{r.text}</p>
        </div>
      ))}
      <div className={clsx('flex items-center gap-2 rounded-lg bg-success-soft px-4 py-2.5 text-sm font-semibold text-success transition-opacity duration-500', step >= 3 ? 'opacity-100' : 'opacity-0')}>
        {step >= 3 && <DrawnCheck />} Duplicate prevented — one payment, one ledger hold
      </div>
    </div>
  );
}

/* ───────────────────────── Settlement ───────────────────────── */

export function SettlementDemo() {
  const { ref, visible } = useInView<HTMLOListElement>();
  const step = useStepper(visible, 3, 600);
  const rows = [
    { title: 'Hold', text: 'Funds reserved when the payment is created', amount: 'AED 10,025.00' },
    { title: 'Capture', text: 'Fee and FX margin recognised as the payout is submitted', amount: 'AED 10,025.00' },
    { title: 'Settle', text: 'Provider confirms by signed webhook; INR position cleared', amount: 'INR 225,865.00' },
  ];
  return (
    <ol ref={ref} className="card divide-y divide-border">
      {rows.map((r, i) => (
        <li key={r.title} className="flex items-center gap-4 px-5 py-4">
          <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors duration-300', step > i ? 'bg-success-bright text-white' : 'border border-border text-ink-faint')}>
            {step > i ? <Check aria-hidden="true" className="h-4 w-4" strokeWidth={3} /> : <span className="num text-xs">{i + 1}</span>}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{r.title}</span>
            <span className="block text-[13px] text-muted-foreground">{r.text}</span>
          </span>
          <span className="num shrink-0 text-sm font-medium">{r.amount}</span>
        </li>
      ))}
    </ol>
  );
}
