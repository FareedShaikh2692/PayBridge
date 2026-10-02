# PayBridge — Testing Strategy

> **Educational Sandbox — No Real Money Movement.**

## Status — what runs today

| Suite | Count | Command | Last result |
|---|---:|---|---|
| Shared domain unit tests (incl. 1,000-case property test) | 30 | `pnpm --filter @paybridge/shared test` | pass |
| API unit tests | 26 | `pnpm --filter @paybridge/api test:unit` | pass |
| API integration tests against real PostgreSQL | 146 | `pnpm test:int` | pass |
| Browser end-to-end (Playwright, Chromium) | 6 | `pnpm test:e2e` | pass locally; the demo scenario also passes against the Vercel deployment |

Integration suites: `lifecycle` (demo path, I5, I6, failure and webhook cases, compliance and maker-checker), `payments` (I3, I4, I7, funds, atomicity), `ledger` (I1, I2, immutability, double entry), `tenant-isolation` (I8), `auth` (authentication, RBAC sweep, conventions), `reconciliation` (one fixture per reason code), `onboarding` (company, KYB, beneficiaries, quotes).

Not covered: load/performance testing, the Docker images (built in CI only; Docker is not installed on the development machine), database- and Redis-outage tests at the HTTP level (error mapping is unit-tested; the readiness endpoint and outbox retry are exercised), accessibility scanning with axe, and coverage thresholds (not enforced).

The sections below were written as the plan and remain the reference for what each suite is for.

## 1. Test levels

| Level | Tooling | Scope | Runs against |
|---|---|---|---|
| Unit | Jest | Pure domain: `Money`, quote formulas, state machines, compliance rules, ledger validation, signature verification, masking | Nothing external |
| Integration | Jest + Supertest | HTTP → service → real PostgreSQL; transactions, constraints, triggers, locks (inline queue driver, so no Redis) | A disposable `paybridge_test` database |
| Invariant | Jest (+ fast-check) | The eight mandatory financial invariants, under concurrency and random inputs | Real PostgreSQL |
| E2E | Playwright | Browser flows through the web app | Full stack, seeded |
| Static | TypeScript strict, ESLint, `prisma validate`, gitleaks, `pnpm audit` | Whole repo | — |

Database tests use the real engine, never a mock or SQLite: the guarantees under test (row locks, deferred triggers, unique constraints, `NUMERIC`) are properties of PostgreSQL. Each integration test file gets a fresh schema; time is controlled by an injected `Clock`, never `sleep`.

## 2. Unit tests

| Area | Cases |
|---|---|
| Quote engine | Canonical vector (10,000 → 22.586500 / 225,865.00 / margin 50.00 / debit 10,025.00); awkward amounts (0.01 edge, 3333.33); truncation direction; margin + payout cost = base for random inputs (property); min/max bounds |
| `Money` | No float construction; scale enforcement; currency mismatch throws; string round-trip |
| Payment state machine | Every legal transition accepted; every other pair rejected (exhaustive 7×7 table); gate logic for `→ APPROVED` |
| KYB / quote state machines | Exhaustive transition tables |
| Compliance rules | Threshold at, below, above boundary; velocity at 5 and 6; country allow-list; sanctions and PEP tokens; aggregation precedence |
| Ledger validation | Unbalanced rejected; single-entry rejected; zero/negative amount rejected; mixed-currency balanced per currency; each posting template balances |
| Webhook signature | Valid; wrong secret; altered body; stale timestamp; malformed header |
| Beneficiary | IFSC and account-number validators; masking; encryption round-trip; fingerprint stability |
| RBAC | Role → permission matrix matches PRD §5 exactly |

## 3. Integration tests

Per module: happy path, validation errors, permission denied for each role lacking the permission, tenant isolation, audit record written, error envelope shape. Plus:

- **Payment creation transaction:** induced failure after quote update but before commit leaves quote `ACTIVE`, no payment, no ledger rows, no idempotency row.
- **Outbox:** payment succeeds with Redis stopped; job runs after Redis returns.
- **Provider timeout:** `TEST-TIMEOUT` scenario retries with the same idempotency key and creates one provider record.
- **Triggers:** direct `UPDATE`/`DELETE` on `ledger_entries`, `ledger_transactions`, `audit_logs` raise; unbalanced raw insert fails at commit.

## 4. Mandatory financial invariant tests

| # | Invariant | Test |
|---|---|---|
| I1 | Every ledger transaction balances | After a randomised scenario run (creates, approvals, cancels, paid, failed), query all transactions: Σ debit − Σ credit = 0 per transaction and currency |
| I2 | Debit total = credit total | Global trial balance per currency is zero; cached balance = Σ entries for every account |
| I3 | No payment can use an expired quote | Advance the clock 61 s, create payment → `QUOTE_EXPIRED`; boundary at exactly 60 s; stale `ACTIVE` status with past `expires_at` still rejected |
| I4 | No quote can be used twice | Sequential reuse → `QUOTE_ALREADY_USED`; 20 concurrent creates on one quote with distinct idempotency keys → exactly one `201`, one payment row, one hold |
| I5 | No payment can be processed twice | Run `ProcessPayment` twice and concurrently for one payment → one capture transaction, one provider record |
| I6 | Duplicate webhook does not duplicate ledger entries | Deliver `payment.paid` ×5 sequentially and ×10 concurrently → one settlement posting, status `PAID`, all responses 200 |
| I7 | Duplicate `Idempotency-Key` does not create another payment | Same key + body ×2 → same payment id, one row, replay header; concurrent ×10 → one row; same key, different body → `IDEMPOTENCY_CONFLICT` |
| I8 | Company A cannot access Company B's data | Route-table-driven: for every tenant-scoped endpoint, Company A's token against Company B's resource ids → `404` and no data; list endpoints return only own rows; body/path `companyId` spoofing ignored |

Supporting invariants: wallet never negative under 50 concurrent payments exceeding balance; hold account equals the sum of open payments (the reconciliation control, asserted directly); after every terminal payment the hold attributable to it is zero.

I8's route table is generated from the controllers' metadata, so adding a tenant-scoped endpoint without isolation coverage fails the suite.

## 5. Failure scenario tests

| Scenario | Expectation |
|---|---|
| Database unavailable | `503 SERVICE_UNAVAILABLE`, readiness fails, no partial writes |
| Redis unavailable | Payment creation succeeds; readiness `degraded`; outbox drains on recovery |
| Provider timeout | Bounded retries → dead-letter; payment stays `PROCESSING`; reconciliation `REVIEW_REQUIRED` |
| Duplicate webhook | No effect, 200 |
| Out-of-order webhook (`paid` then `processing`) | `PAID`; second event `IGNORED` |
| Conflicting webhook (`failed` after `paid`) | Stays `PAID`; event `IGNORED`; reconciliation `MISMATCH` |
| Expired quote / duplicate request / insufficient funds | Correct domain error; no side effects |
| Compliance rejection | `CANCELLED`, no ledger rows, quote `CANCELLED` |
| KYB rejected or not approved | `KYB_NOT_APPROVED` on quote and payment |
| Invalid beneficiary (blocked, inactive, other tenant) | `BENEFICIARY_NOT_ACTIVE` / `BENEFICIARY_NOT_FOUND` |
| Ledger posting failure (forced imbalance) | `LEDGER_IMBALANCE`; enclosing transaction rolled back |
| Bad webhook signature / stale timestamp | `401 INVALID_WEBHOOK`; nothing stored as processable |

## 6. Reconciliation tests

One fixture per reason code in RECONCILIATION.md §3.2 and §3.4, each built by writing inconsistent rows directly, asserting the item status and reason code. A clean demo run asserts `MATCHED` and zero ledger-wide findings.

## 7. E2E (Playwright)

1. **Demo scenario** — the 21 steps of the brief, across four logins, ending with reconciliation `MATCHED` and the admin inspecting payment, compliance, ledger, webhooks, reconciliation and audit.
2. Quote countdown expires in the wizard → re-quote path.
3. Compliance path: AED 60,000 → review → admin clears → approver approves → `PAID`.
4. Maker cannot see approve controls; self-approval blocked for a company admin who created the payment.
5. Failure path: `TEST-FAIL` beneficiary → `FAILED`, balance restored.
6. Sandbox banner present on every route; axe accessibility scan on key pages.

## 8. Security tests

Permission matrix sweep (every role × every endpoint → expected allow/deny); JWT tampering and expiry; refresh rotation and reuse detection; rate limit on login; mass-assignment attempt (`companyId`, `status`, `role` in bodies); log-capture test asserting no password, token or full account number appears in output; SQL-injection strings in filters and sort parameters.

## 9. CI gates

`install → lint → typecheck → unit → integration (Postgres + Redis services) → build → docker build`. E2E runs on pull requests to `main`. Coverage thresholds: 90 % lines on `ledger`, `fx`, `payments`, `webhooks` domain code; 80 % overall for the API. A feature is done only when the checklist in the brief §47 is satisfied; nothing is described as working unless its tests have run green.
