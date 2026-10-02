import { ArrowRight, BookOpenCheck, Building2, CheckCircle2, FileClock, Fingerprint, KeyRound, Layers, Lock, Repeat2, Scale, ScrollText, Send, ShieldCheck, UserRoundPlus, Webhook, XCircle } from 'lucide-react';
import Link from 'next/link';
import { DashboardPreview } from '@/components/marketing/dashboard-preview';
import { Footer } from '@/components/marketing/footer';
import { HeroFlow } from '@/components/marketing/hero-flow';
import { Lifecycle } from '@/components/marketing/lifecycle';
import { Navbar } from '@/components/marketing/navbar';
import { Badge, Container, Section } from '@/components/ui';

const HOW = [
  { icon: Building2, title: 'Onboard and verify', text: 'Register a UAE company and submit it for simulated KYB. A platform administrator reviews the mock result and approves.' },
  { icon: UserRoundPlus, title: 'Add a beneficiary', text: 'Create an Indian payee. The IFSC and account number are validated, the account number is encrypted, and names are screened.' },
  { icon: Lock, title: 'Lock an FX quote', text: 'Get an AED to INR rate with the spread and fee shown up front. The quote is fixed for 60 seconds and can be used once.' },
  { icon: ShieldCheck, title: 'Clear the gates', text: 'Compliance rules run on every payment, and a second person must approve it. Nothing is processed until both are satisfied.' },
  { icon: Scale, title: 'Settle and reconcile', text: 'The ledger posts each step, the mock provider confirms by signed webhook, and reconciliation proves all three records agree.' },
];

const CHECKED = [
  ['156', 'integration tests against real PostgreSQL'],
  ['8', 'financial invariants, enforced twice'],
  ['6', 'end-to-end flows in a real browser'],
  ['0', 'floating-point numbers used for money'],
];

const SECURITY = [
  { icon: KeyRound, title: 'Authentication', text: 'Memory-hard password hashing, 15-minute access tokens, and rotating refresh tokens with reuse detection.' },
  { icon: Layers, title: 'Tenant isolation', text: 'Every query is scoped to the caller’s company, and composite foreign keys make a cross-tenant reference impossible.' },
  { icon: Fingerprint, title: 'Least privilege', text: 'Five roles and granular permissions. Routes are denied by default; makers cannot approve their own payments.' },
  { icon: Lock, title: 'Data protection', text: 'Account numbers are encrypted at rest and shown masked. Secrets come from the environment and never reach the logs.' },
  { icon: Webhook, title: 'Verified webhooks', text: 'HMAC signatures over the raw body with a timestamp window. Each event is stored once and applied once.' },
  { icon: ScrollText, title: 'Tamper-evident records', text: 'Ledger and audit rows are append-only, enforced by database triggers. Corrections are new postings.' },
];

function BentoCard({ icon: Icon, title, text, className, children }: { icon: typeof Lock; title: string; text: string; className?: string; children?: React.ReactNode }) {
  return (
    <article className={`card card-interactive flex min-w-0 flex-col p-6 ${className ?? ''}`}>
      <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon aria-hidden="true" className="h-[18px] w-[18px]" /></span>
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-muted-foreground">{text}</p>
      {children && <div className="mt-5 flex-1">{children}</div>}
    </article>
  );
}

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main>
        {/* ── Hero ── */}
        <section className="overflow-hidden pb-16 pt-12 md:pb-24 md:pt-20">
          <Container className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
            <div>
              <p className="eyebrow">Fintech engineering sandbox</p>
              <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[44px] xl:text-[52px]">
                Cross-Border Payments,
                <br />
                <span className="text-primary">Built for Learning.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
                PayBridge simulates how a UAE business pays a supplier in India — KYB, a locked FX quote, compliance checks, a double-entry ledger, provider webhooks and reconciliation. Mock providers, fictional data, working code.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/login" className="btn-primary btn-lg group">
                  Enter sandbox <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
                <Link href="#how-it-works" className="btn-secondary btn-lg">See how it works</Link>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
                {['Educational sandbox', 'No real money movement', 'Demo accounts included'].map((t) => (
                  <li key={t} className="flex items-center gap-1.5"><CheckCircle2 aria-hidden="true" className="h-4 w-4 text-success" /> {t}</li>
                ))}
              </ul>
            </div>
            <HeroFlow />
          </Container>
        </section>

        {/* ── What it is ── */}
        <Section tone="muted" eyebrow="Why it exists" title="Payment platforms are hard to learn from the outside." description="The interesting parts — the ledger, the retries, the compliance gates, the reconciliation — are exactly the parts you never get to see. PayBridge puts all of them in one place you can run and read.">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {[
              { icon: Send, title: 'The whole lifecycle', text: 'One payment, followed from onboarding to a reconciled settlement, with every state change explained and recorded.' },
              { icon: BookOpenCheck, title: 'Correct by construction', text: 'Money is never a float, every posting balances, and the rules are enforced in the service and again in the database.' },
              { icon: XCircle, title: 'What it is not', text: 'Not a bank, not a licensed service, and not connected to any payment rail. It makes no claim of regulatory compliance.' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-lg border border-border bg-background p-6">
                <Icon aria-hidden="true" className="h-5 w-5 text-primary" />
                <h3 className="mt-4 text-base font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── How it works ── */}
        <Section id="how-it-works" eyebrow="How it works" title="Five steps from onboarding to a reconciled payment." description="Each step is a real screen in the sandbox and a real set of API calls behind it.">
          <ol className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-5">
            {HOW.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="card card-interactive relative p-5">
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon aria-hidden="true" className="h-[18px] w-[18px]" /></span>
                  <span className="num text-xs font-semibold text-ink-faint">0{i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ── Features ── */}
        <Section id="features" tone="muted" eyebrow="What it demonstrates" title="The engineering that makes payments trustworthy." description="Each of these is implemented, tested and visible in the sandbox.">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-6">
            <BentoCard icon={BookOpenCheck} title="Double-entry ledger" text="Financial integrity at the core. Every event is one balanced transaction; balances are derived, never edited." className="md:col-span-3">
              <div className="overflow-hidden rounded-lg border border-border text-[13px]">
                <div className="flex justify-between bg-muted/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><span>Payment capture</span><span>Debit · Credit</span></div>
                {[['Payment hold', 'AED 10,025.00', ''], ['Fee revenue', '', 'AED 25.00'], ['FX margin', '', 'AED 50.00'], ['FX position', '', 'AED 9,950.00']].map(([acc, dr, cr]) => (
                  <div key={acc} className="grid grid-cols-[1fr_auto_auto] gap-4 border-t border-border px-3 py-1.5">
                    <span className={cr ? 'pl-4 text-muted-foreground' : 'font-medium'}>{acc}</span>
                    <span className="num w-24 text-right">{dr}</span>
                    <span className="num w-24 text-right">{cr}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border bg-success-soft px-3 py-1.5 text-xs font-semibold text-success"><span>Debits = credits</span><span className="num">10,025.00 = 10,025.00</span></div>
              </div>
            </BentoCard>
            <BentoCard icon={Repeat2} title="Idempotent payments" text="Retry-safe by design. The same request twice returns the original payment; the same webhook twice changes nothing." className="md:col-span-3">
              <pre className="num overflow-x-auto rounded-lg bg-navy-900 p-4 text-xs leading-relaxed text-white/90"><code>{`POST /api/v1/payments
Idempotency-Key: 6f1c0f2e-4a7b-4d3e-9b1a

201 Created        → payment created
201 Created        → same payment, replayed
Idempotent-Replayed: true`}</code></pre>
            </BentoCard>
            <BentoCard icon={ShieldCheck} title="Compliance engine" text="Configurable rules with a review queue and final, reasoned decisions." className="md:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {['Amount threshold', 'Velocity', 'Destination', 'Sanctions (mock)', 'PEP (mock)'].map((r) => <Badge key={r} tone="neutral" icon={false}>{r}</Badge>)}
              </div>
            </BentoCard>
            <BentoCard icon={Webhook} title="Webhooks" text="Signed, stored once, applied once — even when duplicated or out of order." className="md:col-span-2">
              <p className="num truncate rounded-md border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">t=1791200000,v1=5257a869e7ec…</p>
            </BentoCard>
            <BentoCard icon={FileClock} title="Audit trail" text="Who did what, and when — written in the same transaction as the change." className="md:col-span-2">
              <ul className="space-y-1.5 text-xs">
                {[['PAYMENT_CREATED', 'Maker'], ['PAYMENT_APPROVED', 'Approver'], ['PAYMENT_PAID', 'Provider']].map(([a, who]) => (
                  <li key={a} className="flex items-center justify-between gap-3"><span className="num font-medium">{a}</span><span className="text-muted-foreground">{who}</span></li>
                ))}
              </ul>
            </BentoCard>
            <article className="card card-interactive grid min-w-0 grid-cols-1 items-center gap-6 p-6 md:col-span-6 md:grid-cols-[1fr_1.4fr]">
              <div>
                <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary"><Scale aria-hidden="true" className="h-[18px] w-[18px]" /></span>
                <h3 className="text-base font-semibold tracking-tight">Reconciliation</h3>
                <p className="mt-1.5 text-muted-foreground">Match every transaction. Three independent records of each payment are compared, and any disagreement is reported with the exact values that differ.</p>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 text-center text-xs sm:gap-3 sm:text-[13px]">
                {['Internal payment', 'Provider record', 'Ledger'].map((label, i) => (
                  <div key={label} className="contents">
                    <div className="rounded-lg border border-border bg-background px-2 py-3">
                      <p className="font-medium">{label}</p>
                      <p className="num mt-0.5 text-xs text-muted-foreground">INR 225,865.00</p>
                    </div>
                    {i < 2 && <span aria-hidden="true" className="text-success">=</span>}
                  </div>
                ))}
                <div className="col-span-5 mt-1 flex justify-center"><Badge tone="good">Matched</Badge></div>
              </div>
            </article>
          </div>
        </Section>

        {/* ── Lifecycle ── */}
        <Section id="lifecycle" eyebrow="Payment lifecycle" title="Follow one payment, step by step." description="Hover or tap a step to see what the platform recorded at that moment. All data shown is fictional.">
          <Lifecycle />
        </Section>

        {/* ── Dashboard ── */}
        <Section id="dashboard" tone="muted" eyebrow="The sandbox" title="A working application, not a mock-up." description="Sign in with a demo account and you land here: live balances, payments, ledger, compliance queue and audit log, all backed by the API.">
          <DashboardPreview />
          <dl className="mt-10 grid grid-cols-2 gap-6 md:grid-cols-4">
            {CHECKED.map(([n, label]) => (
              <div key={label} className="border-l-2 border-primary/20 pl-4">
                <dt className="sr-only">{label}</dt>
                <dd><span className="num block text-3xl font-semibold tracking-tight text-foreground">{n}</span><span className="mt-1 block text-[13px] text-muted-foreground">{label}</span></dd>
              </div>
            ))}
          </dl>
        </Section>

        {/* ── Security ── */}
        <Section id="security" eyebrow="Security" title="Built the way a payment system should be." description="These are engineering practices demonstrated in code. They are not a certification, and PayBridge holds no real financial data.">
          <div className="grid gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
            {SECURITY.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary"><Icon aria-hidden="true" className="h-[18px] w-[18px]" /></span>
                <div>
                  <h3 className="font-semibold tracking-tight">{title}</h3>
                  <p className="mt-1 text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Final call to action ── */}
        <section className="pb-16 md:pb-24">
          <Container>
            <div className="relative overflow-hidden rounded-xl bg-navy-900 px-6 py-12 text-center md:px-12 md:py-16">
              <div aria-hidden="true" className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:32px_32px]" />
              <div className="relative">
                <h2 className="text-2xl font-semibold tracking-tight text-white md:text-[32px]">See a payment go end to end.</h2>
                <p className="mx-auto mt-3 max-w-xl text-base text-white/70">Sign in with a demo account, create a payment as the maker, approve it as the approver, and watch it settle and reconcile.</p>
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                  <Link href="/login" className="btn btn-lg group bg-white text-navy-900 hover:bg-white/90">
                    Enter sandbox <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                  <Link href="/api/docs" className="btn btn-lg border-white/25 text-white hover:bg-white/10">API reference</Link>
                </div>
              </div>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
