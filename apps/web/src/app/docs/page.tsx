import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/marketing/footer';
import { Navbar } from '@/components/marketing/navbar';
import { Container } from '@/components/ui';

export const metadata: Metadata = { title: 'Documentation' };

const ACCOUNTS = [
  ['maker@acme.test', 'Maker', 'Creates beneficiaries, quotes and payments'],
  ['approver@acme.test', 'Approver', 'Approves or rejects payments created by others'],
  ['admin@acme.test', 'Company admin', 'Manages the company, users and wallet'],
  ['viewer@acme.test', 'Viewer', 'Read-only'],
  ['platform.admin@paybridge.test', 'Platform admin', 'KYB review, compliance decisions, reconciliation, audit'],
];
const TOKENS = [
  ['TEST-FAIL', 'The mock payout fails; the capture is reversed and the wallet refunded'],
  ['TEST-PEP', 'Simulated PEP match: the payment goes to compliance review'],
  ['TEST-SANCTION', 'Simulated sanctions match: the beneficiary is blocked'],
  ['TEST-DUPLICATE-WEBHOOK', 'The provider delivers the same event twice'],
  ['TEST-OUT-OF-ORDER', 'The provider delivers “paid” before “processing”'],
  ['TEST-TIMEOUT', 'The first provider call times out and is retried with the same key'],
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="mt-12 scroll-mt-24 text-xl font-semibold tracking-tight first:mt-0">{children}</h2>;
}

export default function DocsPage() {
  return (
    <>
      <Navbar />
      <main className="py-12 md:py-16">
        <Container className="grid gap-10 lg:grid-cols-[220px_1fr]">
          <nav aria-label="On this page" className="hidden lg:block">
            <ul className="sticky top-24 space-y-2 border-l border-border pl-4 text-[13px]">
              {[['getting-started', 'Getting started'], ['demo-scenario', 'Demo scenario'], ['architecture', 'Architecture'], ['ledger', 'Ledger model'], ['test-tokens', 'Test tokens'], ['api', 'API']].map(([id, label]) => (
                <li key={id}><a href={`#${id}`} className="text-muted-foreground transition-colors hover:text-primary">{label}</a></li>
              ))}
            </ul>
          </nav>
          <article className="max-w-3xl">
            <p className="eyebrow">Documentation</p>
            <h1 className="mt-3 text-3xl md:text-4xl">Using the sandbox</h1>
            <p className="mt-4 text-base text-muted-foreground">PayBridge is a simulation. Everything below describes fictional data and mock providers; no money moves.</p>

            <div className="mt-10">
              <H2 id="getting-started">Getting started</H2>
              <p className="mt-3 text-muted-foreground">Sign in with a seeded demo account. All of them share the password <code className="num rounded bg-muted px-1.5 py-0.5 text-foreground">PayBridge-Demo-2026!</code> — or use the demo buttons on the <Link href="/login" className="link">sign-in page</Link>.</p>
              <div className="card mt-5 overflow-hidden">
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Email</th><th>Role</th><th>What it can do</th></tr></thead>
                    <tbody>{ACCOUNTS.map(([email, role, what]) => <tr key={email}><td className="num whitespace-nowrap font-medium">{email}</td><td className="whitespace-nowrap">{role}</td><td className="text-muted-foreground">{what}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>

              <H2 id="demo-scenario">Demo scenario</H2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground marker:font-semibold marker:text-foreground">
                <li>As the <strong className="text-foreground">Maker</strong>, open New payment, choose a beneficiary and enter AED 10,000. The quote shows the rate, spread, fee, INR amount and a 60-second countdown.</li>
                <li>Submit. The wallet is debited AED 10,025 into a hold and the payment waits for approval.</li>
                <li>As the <strong className="text-foreground">Approver</strong>, open the payment and approve it. It is captured, sent to the mock provider, and becomes Paid when the signed webhook arrives.</li>
                <li>As the <strong className="text-foreground">Platform admin</strong>, run reconciliation. The payment is Matched; the ledger, webhooks and audit log are all there to inspect.</li>
              </ol>

              <H2 id="architecture">Architecture</H2>
              <p className="mt-3 text-muted-foreground">A Next.js web app talks to a NestJS API backed by PostgreSQL. State changes write follow-up work to a transactional outbox in the same database transaction; workers (BullMQ on Redis, or a Postgres-only driver on serverless) process it with retries and a dead-letter queue. External dependencies — KYB, sanctions, FX rates and the payout provider — sit behind interfaces and are implemented as deterministic mocks.</p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {[['State machines', 'Payment, KYB and quote transitions are explicit tables; anything else is rejected.'], ['Row locks, fixed order', 'Quote → payment → ledger accounts, so concurrent requests cannot deadlock or double-spend.'], ['Two gates', 'Compliance and maker-checker are independent; a payment needs both before it is approved.'], ['Three-way reconciliation', 'Internal payment, provider record and ledger are compared from a consistent snapshot.']].map(([t, d]) => (
                  <li key={t} className="rounded-lg border border-border bg-card p-4"><p className="font-semibold">{t}</p><p className="mt-1 text-[13px] text-muted-foreground">{d}</p></li>
                ))}
              </ul>

              <H2 id="ledger">Ledger model</H2>
              <p className="mt-3 text-muted-foreground">Funds are held when a payment is created, captured when it is submitted, settled when the provider confirms, and reversed in full — fee included — if the payout fails or is returned. The fee is charged on top of the amount sent.</p>
              <pre className="num mt-4 overflow-x-auto rounded-lg bg-navy-900 p-4 text-xs leading-relaxed text-white/90"><code>{`customer_rate    = truncate(mid × (1 − spread / 100), 6)   22.586500
recipient_amount = truncate(base × customer_rate, 2)      INR 225,865.00
fx_margin        = base − round(recipient / mid, 2)       AED 50.00
total_debit      = base + fee                             AED 10,025.00`}</code></pre>

              <H2 id="test-tokens">Test tokens</H2>
              <p className="mt-3 text-muted-foreground">Put one of these in a beneficiary’s name to steer the mocks. Amounts above AED 50,000 go to compliance review.</p>
              <div className="card mt-5 overflow-hidden">
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Token</th><th>Effect</th></tr></thead>
                    <tbody>{TOKENS.map(([t, e]) => <tr key={t}><td className="num whitespace-nowrap font-medium">{t}</td><td className="text-muted-foreground">{e}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>

              <H2 id="api">API</H2>
              <p className="mt-3 text-muted-foreground">The REST API lives under <code className="num rounded bg-muted px-1.5 py-0.5 text-foreground">/api/v1</code>. Amounts are decimal strings, timestamps are ISO 8601 UTC, and every response carries a request id. The full contract is in the <a href="/api/docs" className="link">interactive API reference</a>.</p>
            </div>
          </article>
        </Container>
      </main>
      <Footer />
    </>
  );
}
