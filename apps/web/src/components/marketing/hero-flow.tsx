'use client';

import clsx from 'clsx';
import { ArrowLeftRight, BookOpenCheck, Building2, Check, Send, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

const STEPS: { icon: LucideIcon; title: string; meta: string; value: string }[] = [
  { icon: Building2, title: 'UAE business', meta: 'Acme Trading LLC · KYB approved', value: 'AED 10,025.00' },
  { icon: ArrowLeftRight, title: 'FX quote', meta: '1 AED = 22.5865 INR · locked 60s', value: 'Spread 0.50%' },
  { icon: ShieldCheck, title: 'Compliance', meta: '5 rules evaluated · maker-checker', value: 'Clear' },
  { icon: BookOpenCheck, title: 'Ledger', meta: 'Hold → capture, double entry', value: 'Balanced' },
  { icon: Send, title: 'Settlement', meta: 'Mock provider · signed webhook', value: 'payment.paid' },
  { icon: UserRound, title: 'India beneficiary', meta: 'Rahul Sharma · XXXXXX0400', value: 'INR 225,865.00' },
];

/**
 * The hero graphic: one fictional payment travelling through the platform. The active step advances slowly;
 * it pauses on hover and stays still for visitors who prefer reduced motion.
 */
export function HeroFlow() {
  const [active, setActive] = useState(2);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setActive((i) => (i + 1) % (STEPS.length + 1)), 2200);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* A quiet backdrop grid, masked so it fades out at the edges. */}
      <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[28px] [background-image:linear-gradient(rgb(var(--border))_1px,transparent_1px),linear-gradient(90deg,rgb(var(--border))_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)]" />
      <figure className="card overflow-hidden shadow-overlay" aria-label="Illustration: a simulated payment moving from a UAE business through FX, compliance, ledger and settlement to a beneficiary in India">
        <figcaption className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <p className="text-xs text-muted-foreground">Simulated payment</p>
            <p className="num font-semibold">PB-20261002-4F2A91C7</p>
          </div>
          <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', active >= STEPS.length ? 'bg-success-soft text-success' : 'bg-primary-soft text-info')}>
            <span aria-hidden="true" className={clsx('h-1.5 w-1.5 rounded-full', active >= STEPS.length ? 'bg-success' : 'animate-pulse bg-info')} />
            {active >= STEPS.length ? 'Paid' : 'In progress'}
          </span>
        </figcaption>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-muted/50 px-5 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">You send</p>
            <p className="num text-xl font-semibold tracking-tight"><span className="mr-1 text-sm font-medium text-muted-foreground">AED</span>10,000.00</p>
          </div>
          <ArrowLeftRight aria-hidden="true" className="h-4 w-4 text-ink-faint" />
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Recipient gets</p>
            <p className="num text-xl font-semibold tracking-tight"><span className="mr-1 text-sm font-medium text-muted-foreground">INR</span>225,865.00</p>
          </div>
        </div>

        <ol className="px-5 py-4">
          {STEPS.map((step, i) => {
            const done = i < active;
            const current = i === active;
            return (
              <li key={step.title} className="relative flex gap-3.5 pb-4 last:pb-0">
                {i < STEPS.length - 1 && (
                  <span aria-hidden="true" className="absolute left-[17px] top-9 h-[calc(100%-36px)] w-px overflow-hidden bg-border">
                    {current && <span className="absolute inset-x-0 h-full animate-flow-down bg-info" />}
                    {done && <span className="absolute inset-0 bg-success/60" />}
                  </span>
                )}
                <span className={clsx('relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors duration-300', done ? 'border-success/30 bg-success-soft text-success' : current ? 'border-info/40 bg-primary-soft text-info' : 'border-border bg-card text-ink-faint')}>
                  {done ? <Check aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} /> : <step.icon aria-hidden="true" className="h-4 w-4" />}
                </span>
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={clsx('font-medium transition-colors duration-300', done || current ? 'text-foreground' : 'text-muted-foreground')}>{step.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{step.meta}</p>
                  </div>
                  <span className={clsx('num shrink-0 text-xs font-medium transition-colors duration-300', done ? 'text-success' : current ? 'text-info' : 'text-ink-faint')}>{step.value}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </figure>
    </div>
  );
}
