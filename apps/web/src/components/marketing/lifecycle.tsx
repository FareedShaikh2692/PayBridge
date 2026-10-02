'use client';

import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui';

interface Step {
  time: string;
  title: string;
  summary: string;
  state: 'done' | 'current' | 'upcoming';
  detail: { heading: string; rows: [string, string][]; note: string };
}

// Fictional data throughout.
const STEPS: Step[] = [
  { time: '10:42:11', title: 'Quote created', summary: 'Rate locked for 60 seconds', state: 'done',
    detail: { heading: 'FX quote', rows: [['Rate', '1 AED = 22.5865 INR'], ['Mid-market', '22.7000'], ['Spread', '0.50%'], ['Fee', 'AED 25.00'], ['Expires in', '00:47']], note: 'A quote is immutable and can fund exactly one payment. The database refuses a second.' } },
  { time: '10:42:19', title: 'Payment created', summary: 'AED 10,025.00 reserved in the wallet', state: 'done',
    detail: { heading: 'Ledger — hold', rows: [['Dr Customer wallet', 'AED 10,025.00'], ['Cr Payment hold', 'AED 10,025.00'], ['Idempotency-Key', '6f1c…5a6b'], ['Posting key', 'payment:…:hold']], note: 'Quote, payment, hold and audit record commit in one transaction — or none of them do.' } },
  { time: '10:42:19', title: 'Compliance cleared', summary: 'Five rules evaluated, none fired', state: 'done',
    detail: { heading: 'Compliance checks', rows: [['Amount threshold', 'Not triggered'], ['Velocity (24h)', 'Not triggered'], ['Destination country', 'Not triggered'], ['Sanctions (mock)', 'Clear'], ['PEP (mock)', 'Clear']], note: 'Every rule is recorded, including the ones that did not fire. Screening uses a mock provider.' } },
  { time: '10:42:25', title: 'Payment approved', summary: 'Approved by a second person', state: 'done',
    detail: { heading: 'Maker-checker', rows: [['Created by', 'Omar Farouk (Maker)'], ['Approved by', 'Layla Hassan (Approver)'], ['Self-approval', 'Not permitted']], note: 'The person who creates a payment can never be the one who approves it.' } },
  { time: '10:42:31', title: 'Processing', summary: 'Captured and sent to the mock provider', state: 'current',
    detail: { heading: 'Ledger — capture', rows: [['Dr Payment hold', 'AED 10,025.00'], ['Cr Fee revenue', 'AED 25.00'], ['Cr FX margin', 'AED 50.00'], ['Cr FX position', 'AED 9,950.00'], ['Cr INR payable', 'INR 225,865.00']], note: 'Debits equal credits in each currency. A database trigger checks it again.' } },
  { time: '—', title: 'Paid', summary: 'Signed webhook settles the payout', state: 'upcoming',
    detail: { heading: 'Webhook — payment.paid', rows: [['Signature', 'HMAC-SHA256, verified'], ['Event id', 'evt_9b2e… (stored once)'], ['Dr INR payable', 'INR 225,865.00'], ['Cr Nostro INR', 'INR 225,865.00']], note: 'Delivered twice or out of order, the event still has exactly one effect.' } },
];

/** A payment as a timeline. Hovering or focusing a step shows what the platform recorded at that moment. */
export function Lifecycle() {
  const [active, setActive] = useState(4);
  const step = STEPS[active];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.05fr] lg:gap-10">
      <div className="card p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
          <div>
            <p className="text-xs text-muted-foreground">Payment <span className="num">#PAY-10482</span></p>
            <p className="num mt-1 text-3xl font-semibold tracking-tight"><span className="mr-1.5 text-base font-medium text-muted-foreground">AED</span>10,000.00</p>
          </div>
          <Badge tone="info">Processing</Badge>
        </div>
        <ol className="mt-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              {i < STEPS.length - 1 && <span aria-hidden="true" className={clsx('absolute left-[11px] top-7 h-[calc(100%-20px)] w-px', s.state === 'done' ? 'bg-success/50' : 'bg-border')} />}
              <button
                type="button" onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} aria-pressed={active === i}
                className={clsx('relative flex w-full items-start gap-3.5 rounded-lg px-2 py-2.5 text-left transition-colors duration-200', active === i ? 'bg-primary-soft' : 'hover:bg-muted')}
              >
                <span className={clsx('relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-card', s.state === 'done' ? 'border-success bg-success text-white' : s.state === 'current' ? 'border-info' : 'border-border')}>
                  {s.state === 'done' && <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />}
                  {s.state === 'current' && <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-info" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={clsx('block font-medium', s.state === 'upcoming' && 'text-muted-foreground')}>{s.title}</span>
                  <span className="block text-xs text-muted-foreground">{s.summary}</span>
                </span>
                <span className="num shrink-0 pt-0.5 text-xs text-ink-faint">{s.time}{s.time !== '—' && ' AM'}</span>
                <span className="sr-only">{s.state === 'done' ? 'Completed' : s.state === 'current' ? 'Current step' : 'Upcoming'}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div key={active} className="card animate-fade-up self-start p-5 md:p-6 lg:sticky lg:top-24" aria-live="polite">
        <p className="eyebrow">Step {active + 1} of {STEPS.length} · {step.title}</p>
        <h3 className="mt-2 text-lg font-semibold tracking-tight">{step.detail.heading}</h3>
        <dl className="mt-4 divide-y divide-border rounded-lg border border-border">
          {step.detail.rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="num text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-muted-foreground">{step.detail.note}</p>
      </div>
    </div>
  );
}
