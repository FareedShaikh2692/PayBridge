import { ArrowRight, ChevronDown, CircleSlash, EyeOff, Puzzle } from 'lucide-react';
import Link from 'next/link';
import { Footer } from '@/components/marketing/footer';
import { ComplianceDemo, FlowStages, FxQuoteDemo, HeroPaymentCard, IdempotencyDemo, LedgerDemo, OnView, PaymentDemo, ReconciliationDemo, SettlementDemo, WebhookDemo } from '@/components/marketing/demo-visuals';
import { Navbar } from '@/components/marketing/navbar';
import { ProductDemoButton } from '@/components/marketing/video-modal';
import { Container, Reveal } from '@/components/ui';

const PRINCIPLES = [
  { title: 'Double-entry ledger', summary: 'Every movement is a balanced transaction.', detail: 'Hold, capture, settle, release and reversal are posting templates. Each transaction must balance per currency — checked in the service and again by a deferred database trigger — and ledger rows are append-only. Balances are derived from entries, never edited.' },
  { title: 'Idempotency everywhere', summary: 'Retries are safe by construction.', detail: 'Payment creation takes an Idempotency-Key; webhook events are unique by event id; every ledger posting has a unique key. The same request, event or job twice produces exactly one effect — tested under concurrency.' },
  { title: 'Explicit state machines', summary: 'Only listed transitions are possible.', detail: 'Payments, KYB and quotes move through transition tables. Any transition not in the table is rejected, and every change is written to the status history in the same transaction.' },
  { title: 'Transactional outbox', summary: 'No lost or phantom jobs.', detail: 'Work for the queue is written to an outbox table in the same database transaction as the change that caused it, then published to BullMQ (or drained inline on serverless). Handlers are idempotent; failures retry with backoff and land in a dead-letter queue.' },
  { title: 'Tenant isolation and RBAC', summary: 'Company A can never read Company B.', detail: 'Every query is scoped to the caller’s company, composite foreign keys prevent cross-tenant references, and routes are deny-by-default behind granular permissions. A maker can never approve their own payment.' },
  { title: 'Audit and reconciliation', summary: 'Every change is explainable.', detail: 'An append-only audit log is written with each change. Reconciliation compares the internal payment, the provider’s record and the ledger, and reports any disagreement with the exact values that differ.' },
];

const ARCH = [
  { name: 'Next.js', role: 'Web app', text: 'React 19, TanStack Query, proxies /api to the API' },
  { name: 'NestJS', role: 'API', text: 'Auth, RBAC, payments, compliance, ledger, webhooks' },
  { name: 'PostgreSQL', role: 'System of record', text: 'NUMERIC money, triggers, checks, outbox' },
  { name: 'Redis', role: 'Coordination', text: 'Queue transport and shared rate limits' },
  { name: 'BullMQ', role: 'Workers', text: 'Provider submission, webhooks, reconciliation' },
  { name: 'Docker', role: 'Packaging', text: 'Compose for the full stack; CI builds images' },
];

/** One storytelling chapter: copy on one side, a working visual on the other. */
function Chapter({ id, eyebrow, title, children, visual, flip = false, muted = false }: { id?: string; eyebrow: string; title: string; children: React.ReactNode; visual: React.ReactNode; flip?: boolean; muted?: boolean }) {
  return (
    <section id={id} className={muted ? 'border-y border-border bg-card py-16 md:py-24' : 'py-16 md:py-24'}>
      <Container className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal className={flip ? 'lg:order-2' : undefined}>
          <p className="eyebrow mb-3">{eyebrow}</p>
          <h2 className="text-2xl font-semibold tracking-tight md:text-[32px] md:leading-tight">{title}</h2>
          <div className="mt-4 space-y-3 text-base leading-relaxed text-muted-foreground">{children}</div>
        </Reveal>
        <Reveal className={flip ? 'lg:order-1' : undefined}>{visual}</Reveal>
      </Container>
    </section>
  );
}

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main>
        {/* ── Hero ── */}
        <section className="relative overflow-hidden pb-16 pt-12 md:pb-24 md:pt-20">
          <div aria-hidden="true" className="absolute inset-0 -z-10 [background-image:linear-gradient(rgb(var(--border)/0.7)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--border)/0.7)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
          <div aria-hidden="true" className="absolute left-1/2 top-[-240px] -z-10 h-[480px] w-[880px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <Container className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary shadow-card">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" /> Fintech engineering sandbox
              </p>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.06] tracking-[-0.025em] sm:text-5xl xl:text-[56px]">
                Cross-Border Payments,
                <br />
                <span className="text-primary">Built for Learning.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
                Explore how modern payment infrastructure connects businesses, FX pricing, compliance, ledger accounting, provider processing, settlement, and reconciliation.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/login" className="btn-primary btn-lg group">
                  Explore the Sandbox <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
                <ProductDemoButton />
              </div>
              <p className="mt-6 text-[13px] text-muted-foreground">
                <span className="font-semibold text-foreground">Educational Sandbox</span> — no real money movement. Mock providers, fictional data, working code.
              </p>
            </div>
            <HeroPaymentCard />
          </Container>
        </section>

        {/* ── Problem ── */}
        <section className="border-y border-border bg-card py-16 md:py-24">
          <Container>
            <Reveal className="max-w-3xl">
              <p className="eyebrow mb-3">The problem</p>
              <h2 className="text-2xl font-semibold tracking-tight md:text-[32px] md:leading-tight">Payment platforms are hard to learn from the outside.</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">The parts that make money movement trustworthy — the ledger, the retries, the compliance gates, the reconciliation — are exactly the parts you never get to see. PayBridge puts all of them in one system you can run, click through and read.</p>
            </Reveal>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {[
                { icon: EyeOff, title: 'Invisible internals', text: 'Real platforms hide the ledger and the state machine behind a single “Sent” label.' },
                { icon: Puzzle, title: 'Scattered concepts', text: 'FX, KYB, webhooks and reconciliation are usually explained one at a time, never connected.' },
                { icon: CircleSlash, title: 'Not a real service', text: 'PayBridge is not a bank or a licensed service, moves no money and claims no regulatory compliance.' },
              ].map(({ icon: Icon, title, text }) => (
                <Reveal key={title} className="rounded-lg border border-border bg-background p-6">
                  <Icon aria-hidden="true" className="h-5 w-5 text-primary" />
                  <h3 className="mt-4 font-semibold tracking-tight">{title}</h3>
                  <p className="mt-1.5 text-muted-foreground">{text}</p>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>

        {/* ── Flow ── */}
        <section id="flow" className="py-16 md:py-24">
          <Container>
            <Reveal className="mb-12 max-w-3xl">
              <p className="eyebrow mb-3">Payment flow</p>
              <h2 className="text-2xl font-semibold tracking-tight md:text-[32px] md:leading-tight">Seven stages from Dubai to Mumbai.</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">Each stage is a real module in the sandbox, with its own rules, records and tests.</p>
            </Reveal>
            <FlowStages />
          </Container>
        </section>

        {/* ── Interactive demo ── */}
        <section id="demo" className="border-y border-border bg-card py-16 md:py-24">
          <Container>
            <Reveal className="mb-10 max-w-3xl">
              <p className="eyebrow mb-3">Interactive demo</p>
              <h2 className="text-2xl font-semibold tracking-tight md:text-[32px] md:leading-tight">Follow one payment end to end.</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">This is the payment page from the sandbox, filled with demo data. Watch the lifecycle advance, then open each tab to see what the platform recorded.</p>
            </Reveal>
            <Reveal><PaymentDemo /></Reveal>
          </Container>
        </section>

        <Chapter eyebrow="FX pricing" title="A rate you can see, locked for 60 seconds." visual={<FxQuoteDemo />}>
          <p>The quote shows the mid-market rate, the spread and the flat fee up front. Once locked it is fixed for 60 seconds and can be used by exactly one payment.</p>
          <p>Money is never a floating-point number: amounts are exact decimals end to end, and the recipient amount is rounded down so the books always balance.</p>
        </Chapter>

        <Chapter muted flip eyebrow="Compliance" title="Every payment clears the gates first." visual={<div className="card p-5 md:p-6"><OnView><ComplianceDemo /></OnView></div>}>
          <p>Configurable rules run on every payment: amount threshold, velocity, destination, and simulated sanctions and PEP screening. A flagged payment waits in a review queue for a reasoned decision.</p>
          <p>Separately, maker-checker requires a second person to approve. Nothing is processed until both gates are closed.</p>
        </Chapter>

        <section id="ledger" className="py-16 md:py-24">
          <Container>
            <Reveal className="mb-10 max-w-3xl">
              <p className="eyebrow mb-3">Ledger accounting</p>
              <h2 className="text-2xl font-semibold tracking-tight md:text-[32px] md:leading-tight">Debits equal credits. Always.</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">Each step of a payment is one double-entry transaction. The service refuses an unbalanced posting, and a database trigger refuses it again at commit.</p>
            </Reveal>
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <Reveal className="card p-5 md:p-6">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Postings for {`PB-2026-000421`}</p>
                    <p className="num mt-2 text-3xl font-semibold tracking-tight md:text-4xl">DEBIT = CREDIT</p>
                  </div>
                </div>
                <OnView><LedgerDemo /></OnView>
              </Reveal>
              <div className="grid gap-6">
                <Reveal className="card p-5 md:p-6">
                  <h3 className="font-semibold tracking-tight">Idempotent by design</h3>
                  <p className="mb-4 mt-1 text-[13px] text-muted-foreground">Sending the same request twice returns the original payment. One payment, one hold.</p>
                  <IdempotencyDemo />
                </Reveal>
              </div>
            </div>
          </Container>
        </section>

        <Chapter muted eyebrow="Provider webhooks" title="Signed, stored once, applied once." visual={<div className="card p-5 md:p-6"><OnView><WebhookDemo /></OnView></div>}>
          <p>The mock payout provider reports back with HMAC-signed webhooks. Each event is verified, persisted by its event id, and only then allowed to change the payment and the ledger.</p>
          <p>Duplicates are acknowledged and ignored; out-of-order events are recorded but cannot move a payment backwards.</p>
        </Chapter>

        <Chapter flip eyebrow="Settlement" title="Hold, capture, settle." visual={<SettlementDemo />}>
          <p>Funds are reserved when the payment is created, captured when it is submitted to the provider, and settled when the provider confirms the payout.</p>
          <p>If the payout fails or is returned, reversal postings refund the wallet in full, fee included — never by editing history.</p>
        </Chapter>

        <Chapter muted eyebrow="Reconciliation" title="Three records, one answer." visual={<div className="card p-5 md:p-6"><OnView><ReconciliationDemo /></OnView></div>}>
          <p>Reconciliation compares the internal payment, the provider’s record and the ledger. When they agree the payment is matched; when they don’t, the report names the exact difference.</p>
          <p>It only reads. Fixing a mismatch is a deliberate, audited action.</p>
        </Chapter>

        {/* ── Architecture ── */}
        <section id="architecture" className="py-16 md:py-24">
          <Container>
            <Reveal className="mb-10 max-w-3xl">
              <p className="eyebrow mb-3">Under the hood</p>
              <h2 className="text-2xl font-semibold tracking-tight md:text-[32px] md:leading-tight">A production-shaped stack, end to end.</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">A TypeScript monorepo with shared domain logic. All providers are mocks running inside the platform.</p>
            </Reveal>
            <Reveal className="relative overflow-hidden rounded-xl bg-navy-900 p-5 text-white md:p-8">
              <div aria-hidden="true" className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:32px_32px]" />
              <ol className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ARCH.map((a, i) => (
                  <li key={a.name} className="rounded-lg border border-white/10 bg-white/[0.04] p-4 transition-colors duration-200 hover:border-white/25">
                    <p className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-white/50"><span>{a.role}</span><span className="num">0{i + 1}</span></p>
                    <p className="mt-2 text-lg font-semibold">{a.name}</p>
                    <p className="mt-1 text-[13px] text-white/65">{a.text}</p>
                  </li>
                ))}
              </ol>
              <p className="num relative mt-6 overflow-x-auto whitespace-nowrap rounded-md border border-white/10 bg-black/20 px-4 py-3 text-xs text-white/70">
                browser → Next.js → NestJS → PostgreSQL ⇢ outbox → BullMQ (Redis) → mock provider → signed webhook → NestJS
              </p>
            </Reveal>
          </Container>
        </section>

        {/* ── Principles ── */}
        <section className="border-y border-border bg-card py-16 md:py-24">
          <Container>
            <Reveal className="mb-10 max-w-3xl">
              <p className="eyebrow mb-3">Engineering principles</p>
              <h2 className="text-2xl font-semibold tracking-tight md:text-[32px] md:leading-tight">Built like a real fintech system.</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">Engineering practices demonstrated in code and tests — not a certification of any kind.</p>
            </Reveal>
            <div className="grid gap-3 md:grid-cols-2">
              {PRINCIPLES.map((p) => (
                <details key={p.title} className="group rounded-lg border border-border bg-background transition-colors duration-200 open:bg-card hover:border-primary/30">
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                    <span>
                      <span className="block font-semibold tracking-tight">{p.title}</span>
                      <span className="block text-[13px] text-muted-foreground">{p.summary}</span>
                    </span>
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <p className="px-5 pb-5 text-[13px] leading-relaxed text-muted-foreground">{p.detail}</p>
                </details>
              ))}
            </div>
          </Container>
        </section>

        {/* ── Call to action ── */}
        <section className="py-16 md:py-24">
          <Container>
            <Reveal className="relative overflow-hidden rounded-xl bg-navy-900 px-6 py-12 text-center md:px-12 md:py-16">
              <div aria-hidden="true" className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:32px_32px]" />
              <div className="relative">
                <h2 className="text-2xl font-semibold tracking-tight text-white md:text-[32px]">See a payment go end to end.</h2>
                <p className="mx-auto mt-3 max-w-xl text-base text-white/70">Sign in with a demo account, create a payment as the maker, approve it as the approver, and watch it settle and reconcile.</p>
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                  <Link href="/login" className="btn btn-lg group bg-white text-navy-900 hover:bg-white/90">
                    Explore the Sandbox <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                  {/* Served by the API, not by Next.js: a plain anchor, so the router does not try to prefetch it. */}
                  <a href="/api/docs" className="btn btn-lg border-white/25 text-white hover:bg-white/10">API reference</a>
                </div>
              </div>
            </Reveal>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
