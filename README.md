# PayBridge

> **Educational Sandbox — No Real Money Movement.**
> PayBridge is a simulation built for learning and portfolio purposes. It does not move money, connects to no bank or payment rail, is not a licensed financial product and claims no regulatory compliance. All providers are mocks and all data is fictional. Never enter real financial or identity data.

A simulated UAE → India SME cross-border payments platform. A UAE company onboards, passes simulated KYB, funds a simulated AED wallet, locks an AED → INR quote and sends a payment that travels through compliance rules, maker-checker approval, a double-entry ledger, a mock payout provider with signed webhooks, three-way reconciliation and an immutable audit trail.

**Live demo:** https://paybridge-web-red.vercel.app · **API docs (Swagger):** https://paybridge-api.vercel.app/api/docs

## What it demonstrates

| Area | How |
|---|---|
| Financial correctness | No floating-point money (`NUMERIC` + `decimal.js`, strings on the wire); quote formulas with a property test; margin computed as a residual so the books always balance |
| Double-entry ledger | Hold → capture → settle, release and reversal; balanced per currency; enforced by the service **and** by a deferred database trigger; append-only by trigger |
| Idempotency | `Idempotency-Key` on payment creation, unique webhook `event_id`, unique ledger posting keys — proven under concurrency |
| Transaction integrity | One database transaction per state change, explicit row locks in a fixed order, non-negative balance `CHECK` |
| Explicit state machines | Payment, KYB and quote transitions are tables; every other transition is rejected (exhaustively tested) |
| Compliance workflow | Configurable rules (threshold, velocity, country, mock sanctions, mock PEP), review queue, final decisions with reasons |
| Maker-checker | Separate approval gate; a creator can never approve their own payment |
| Multi-tenancy and RBAC | Tenant-scoped queries, composite foreign keys, deny-by-default permission guard, a route-coverage isolation test |
| Event-driven processing | Transactional outbox; BullMQ workers or a Postgres-only inline driver; retries with backoff; dead letters |
| Reconciliation | Internal payment ↔ provider record ↔ ledger, with ledger-wide controls |
| Auditability | Append-only audit log written in the same transaction as each change |

## Run it locally

Requires Node.js 22+, pnpm 10 and PostgreSQL 16+ binaries. Redis is optional.

```bash
pnpm install
pnpm db:local:start
cp .env.example .env
```

Edit `.env`: set `DATABASE_URL=postgresql://paybridge@localhost:54329/paybridge` and `QUEUE_DRIVER=inline`, then:

```bash
pnpm build && pnpm db:migrate && pnpm db:seed
pnpm --filter @paybridge/api start
pnpm --filter @paybridge/web dev
```

| | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:4000/api/v1 |
| Swagger | http://localhost:4000/api/docs |
| Health | http://localhost:4000/health/ready |

With Docker instead: `cp .env.example .env && docker compose up`. **The Docker path has not been run** — Docker was not available on the development machine; the images are built in CI. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Test logins (seeded, fictional)

Password for all: `PayBridge-Demo-2026!`

| Email | Role | Company |
|---|---|---|
| `platform.admin@paybridge.test` | Platform admin | — |
| `admin@acme.test` | Company admin | Acme Trading LLC (KYB approved) |
| `maker@acme.test` | Maker | Acme Trading LLC |
| `approver@acme.test` | Approver | Acme Trading LLC |
| `viewer@acme.test` | Viewer | Acme Trading LLC |
| `admin@dubaitech.test` | Company admin | Dubai Tech Supplies LLC (KYB under review) |
| `admin@gulfimports.test` | Company admin | Gulf Imports LLC (KYB approved) |

These are published on purpose: it is a sandbox. On the hosted demo anyone can sign in and change the fictional data.

### Try the demo scenario

1. Sign in as the **Maker** → *New payment* → pick a beneficiary → AED 10,000 → quote shows rate `22.586500`, fee `25.00`, recipient `INR 225,865.00` and a 60-second countdown → submit.
2. Sign in as the **Approver** → open the payment → *Approve*. Watch it move to *Processing* and then *Paid* as the mock provider's webhooks arrive, with hold, capture and settlement in the ledger panel.
3. Sign in as the **Platform admin** → *Reconciliation* → *Run reconciliation*: the payment is `MATCHED`. Inspect webhooks, the trial balance and the audit log.

Test tokens in a beneficiary name change the outcome: `TEST-FAIL` (payout fails and is refunded), `TEST-PEP` (compliance review), `TEST-SANCTION` (blocked), `TEST-DUPLICATE-WEBHOOK`, `TEST-OUT-OF-ORDER`, `TEST-TIMEOUT`. An amount above AED 50,000 goes to compliance review.

## Tests

| Suite | Count | Command |
|---|---:|---|
| Shared domain (unit + property) | 30 | `pnpm --filter @paybridge/shared test` |
| API unit | 26 | `pnpm --filter @paybridge/api test:unit` |
| API integration (real PostgreSQL) | 146 | `pnpm test:int` |
| Browser end-to-end (Playwright) | 6 | `pnpm test:e2e` |

All pass locally. The integration suite covers the eight mandatory invariants: every ledger transaction balances; debits equal credits; no expired quote can be used; no quote is used twice; no payment is processed twice; a duplicate webhook does not duplicate ledger entries; a duplicate `Idempotency-Key` does not create a second payment; Company A cannot reach Company B's data. Details in [docs/TESTING.md](docs/TESTING.md).

## Known limitations

- The Docker Compose path and the GitHub Actions workflow are written but have not been run.
- Rate limiting is in-memory (per instance). Row-level security and a restricted database role are designed, not built.
- `RunComplianceChecks` as an asynchronous re-screening job is not built; rules run synchronously at payment creation.
- KYB documents (metadata) and the refund-after-paid flow are schema-only.
- No MFA, password reset or email. No dark mode. No load testing.
- On Vercel there are no BullMQ workers; the Postgres-backed inline queue is used instead.

## Repository

```
apps/api        NestJS API, worker entry point, seed, unit and integration tests
apps/web        Next.js dashboard and Playwright end-to-end tests
packages/shared money, FX formulas, state machines, permissions, ledger templates
packages/database  Prisma schema, migrations (incl. triggers and checks), reference data
infra           Dockerfiles, scripts, environment examples
docs            design documents
```

## Documents

| Document | Contents |
|---|---|
| [00-REQUIREMENTS-ANALYSIS](docs/00-REQUIREMENTS-ANALYSIS.md) | Ambiguities, gaps, risks and the defaults chosen |
| [BRD](docs/BRD.md) · [PRD](docs/PRD.md) | Business and product requirements, user stories, acceptance criteria, permission matrix |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Components, domain model, state machines, outbox and webhook flow, queue drivers |
| [DATABASE](docs/DATABASE.md) | ERD, constraints, indexes, money precision, transaction strategy |
| [API](docs/API.md) | Endpoints, schemas, errors, idempotency, webhook contract |
| [LEDGER](docs/LEDGER.md) | Chart of accounts, FX formulas, posting rules, invariants |
| [COMPLIANCE](docs/COMPLIANCE.md) | Rules engine, mock KYB/sanctions/PEP, review workflow |
| [SECURITY](docs/SECURITY.md) | Authentication, authorisation, tenant isolation, threat model, known gaps |
| [RECONCILIATION](docs/RECONCILIATION.md) | Three-way matching and reason codes |
| [TESTING](docs/TESTING.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) | What is tested and how to run and deploy it |
| [IMPLEMENTATION-PLAN](docs/IMPLEMENTATION-PLAN.md) · [BACKLOG](docs/BACKLOG.md) | Original plan and prioritised backlog |

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind CSS · TanStack Query · React Hook Form · Zod — NestJS 11 · Prisma 6 · PostgreSQL · Redis · BullMQ · Swagger — Jest · Supertest · Playwright — Docker Compose · GitHub Actions · Vercel.
