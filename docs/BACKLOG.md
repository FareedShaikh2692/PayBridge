# PayBridge — Development Backlog

> **Educational Sandbox — No Real Money Movement.**

Structure: **EPIC → STORY → TASK → ACCEPTANCE CRITERIA**. Priorities: **P0** must have · **P1** important · **P2** nice to have. Story ids (`US-xx`) refer to PRD §6. Every story also carries the definition of done from the brief §47 (validation, authorisation, tenant isolation, migration, API docs, tests, error handling, audit, security review, docs).

---

## EPIC 1 — Foundation (Phase 1)

### S1.1 Monorepo and tooling — P0
- T1.1.1 pnpm workspaces + Turborepo; `apps/api`, `apps/web`, `packages/{database,shared,types,config}`
- T1.1.2 TypeScript strict base config, ESLint (ban `Number()`/`parseFloat` on money, ban `$queryRawUnsafe`), Prettier
- T1.1.3 Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `db:seed`, `db:reset`

**AC:** `pnpm install && pnpm build && pnpm lint && pnpm typecheck` succeed on a clean clone.

### S1.2 Runtime and containers — P0
- T1.2.1 NestJS app skeleton with validated config module
- T1.2.2 Next.js app skeleton with Tailwind and sandbox banner in the root layout
- T1.2.3 Prisma package, initial migration, `citext` extension
- T1.2.4 Dockerfiles and `docker-compose.yml` with health checks and start ordering
- T1.2.5 `.env.example` plus staging/production examples

**AC:** `cp .env.example .env && docker compose up` brings up four healthy services; web shows the banner; API boot fails fast on a missing secret.

### S1.3 Observability and API conventions — P0
- T1.3.1 Request-id middleware; pino logger with redaction list
- T1.3.2 Response envelope interceptor; global exception filter; domain error base class and code catalogue
- T1.3.3 `/health`, `/health/live`, `/health/ready`
- T1.3.4 Swagger at `/api/docs`
- T1.3.5 Helmet, CORS allow-list, rate limiter

**AC:** every response has `X-Request-Id` and `X-PayBridge-Sandbox`; errors match the envelope; readiness returns 503 with Postgres stopped; a log-capture test finds no redacted field.

### S1.4 CI — P0
- T1.4.1 GitHub Actions: install → lint → typecheck → unit → integration → build → docker build
- T1.4.2 gitleaks and `pnpm audit`

**AC:** pipeline green on `main`; no deploy step exists.

---

## EPIC 2 — Identity, access and tenancy (Phase 2)

### S2.1 Registration and login — P0 (FR-AUTH-1..3)
- T2.1.1 `users`, `refresh_tokens` migration
- T2.1.2 Argon2id hashing; register, login, refresh (rotation + reuse detection), logout, `me`
- T2.1.3 Login rate limiting and uniform errors

**AC:** password never appears in a response or log; reused refresh token revokes the family; suspended user cannot log in.

### S2.2 RBAC — P0 (FR-AUTH-4)
- T2.2.1 Seed roles, permissions, role_permissions from the shared permission catalogue
- T2.2.2 `@RequirePermissions`, `@Public`, deny-by-default global guard
- T2.2.3 Matrix test: role × permission equals PRD §5

**AC:** an undecorated route returns 403; matrix test green.

### S2.3 Company and tenant context — P0 (US-01, US-14)
- T2.3.1 `companies`, `company_users`, `kyb_profiles` (draft) migration
- T2.3.2 `POST/GET/PATCH /companies`; creator becomes `COMPANY_ADMIN`
- T2.3.3 `TenantContext` provider; tenant-scoped repository base
- T2.3.4 Route-table-driven isolation test harness

**AC:** US-01 criteria; Company A token on Company B id → 404; body `companyId` ignored.

### S2.4 User management — P0 (US-03)
- T2.4.1 `GET/POST/PATCH /companies/:id/users`
- T2.4.2 Guard against assigning platform roles; cannot demote the last company admin

**AC:** US-03 criteria.

### S2.5 Audit module — P0 (US-12)
- T2.5.1 `audit_logs` migration with immutability trigger
- T2.5.2 `AuditService.record(tx, …)` with value redaction
- T2.5.3 `GET /audit-logs` with filters

**AC:** `UPDATE`/`DELETE` on `audit_logs` raises; company admin sees only own company's records.

---

## EPIC 3 — KYB (Phase 3)

### S3.1 KYB workflow — P0 (US-02)
- T3.1.1 KYB state machine in `packages/shared` with exhaustive tests
- T3.1.2 `KybProvider` port and `MockKYBProvider` with deterministic tokens
- T3.1.3 `POST /kyb/submit`, `GET /kyb/:companyId`, `POST /kyb/:id/approve|reject`
- T3.1.4 `KybApprovedGuard` reusable by FX and payments
- T3.1.5 `GET /admin/companies`

**AC:** US-02 criteria; illegal transitions return `INVALID_STATE_TRANSITION`; each transition audited.

### S3.2 KYB documents (metadata) — P1
### S3.3 KYB expiry job — P1
### S3.4 `KYB_AUTO_APPROVE` flag for the demo — P1

---

## EPIC 4 — Beneficiaries (Phase 4)

### S4.1 Beneficiary management — P0 (US-04)
- T4.1.1 Migration; `Ifsc` and account-number validators
- T4.1.2 AES-256-GCM field encryption service; HMAC fingerprint; masking serializer
- T4.1.3 `POST/GET/GET:id/PATCH /beneficiaries`; deactivate instead of delete
- T4.1.4 Screening hook on create and rename (wired to mock provider in Epic 8; stub returns `CLEAR` until then)

**AC:** US-04 criteria; no response or log contains a full account number; duplicate rejected.

### S4.2 Freeze bank details after first payment — P1

---

## EPIC 5 — FX quotes (Phase 5)

### S5.1 Quote engine — P0 (US-05)
- T5.1.1 `Money` value object and rounding helpers in `packages/shared`
- T5.1.2 `RateProvider` port and `MockRateProvider`
- T5.1.3 Pure `calculateQuote` implementing LEDGER.md §3, with canonical and property tests
- T5.1.4 `fx_quotes` migration with checks and immutability trigger
- T5.1.5 `POST /fx/quotes`, `GET /fx/quotes/:id`, `GET /fx/quotes`, `GET /fx/rates`
- T5.1.6 Injectable `Clock`; expiry evaluated by timestamp

**AC:** US-05 criteria; `margin + payout cost = base` for 1,000 random amounts; updating a priced column in SQL raises.

### S5.2 `ExpireQuotes` repeatable job — P1 (lands with BullMQ in Epic 9)

---

## EPIC 6 — Ledger (Phase 7; built before payments)

### S6.1 Chart of accounts — P0 (US-10)
- T6.1.1 `ledger_accounts`, `ledger_transactions`, `ledger_entries` migration with checks, triggers, partial unique index
- T6.1.2 Seed system accounts; provision company accounts on KYB approval

**AC:** each approved company has wallet and hold accounts; system accounts exist once.

### S6.2 Posting service — P0
- T6.2.1 `LedgerService.post(tx, transaction)` per LEDGER.md §7
- T6.2.2 Posting templates: top-up, hold, release, capture, settlement, reversal
- T6.2.3 Idempotency by `posting_key`
- T6.2.4 Ordered `FOR UPDATE` account locking; non-negative customer balances

**AC:** invariants L1–L9; unbalanced posting → `LEDGER_IMBALANCE`; raw unbalanced insert fails at commit; repeated key returns the original; 50 concurrent debits never overdraw.

### S6.3 Balances and read APIs — P0
- T6.3.1 `GET /ledger/accounts`, `/ledger/accounts/:id`, `/ledger/:companyId/balance`, `/ledger/transactions`
- T6.3.2 `POST /sandbox/wallet/topup`
- T6.3.3 `GET /admin/ledger/trial-balance`

**AC:** cached balance equals Σ entries after a randomised run; trial balance zero per currency; company sees only own accounts.

---

## EPIC 7 — Payments and approvals (Phase 6)

### S7.1 Idempotency infrastructure — P0
- T7.1.1 `idempotency_keys` migration; request hashing; in-transaction store and replay
- T7.1.2 Purge job (P1)

**AC:** all five rows of the idempotency table in API.md §1.

### S7.2 Payment creation — P0 (US-06)
- T7.2.1 `payment_orders`, `payment_status_history` migration with composite tenant FKs
- T7.2.2 Payment state machine in `packages/shared`, exhaustive test
- T7.2.3 `CreatePaymentUseCase`: single transaction, locks, nine validations, quote → `USED`, hold, history, audit, outbox row
- T7.2.4 `GET /payments`, `GET /payments/:id`, `POST /payments/:id/cancel`

**AC:** US-06 criteria; invariants I3, I4, I7 including concurrency; forced mid-transaction failure leaves no trace.

### S7.3 Maker-checker — P0 (US-07)
- T7.3.1 `approval_requests`, `approval_actions` migration
- T7.3.2 `POST /payments/:id/approve|reject`; self-approval check; gate evaluation → `APPROVED`
- T7.3.3 Reject and cancel release the hold

**AC:** US-07 criteria; every action recorded with actor, time, reason.

---

## EPIC 8 — Compliance (Phase 8)

### S8.1 Rules engine — P0 (US-08)
- T8.1.1 `compliance_rules`, `compliance_checks` migration; seed default rules
- T8.1.2 Rule interface and five rule classes; aggregation
- T8.1.3 `SanctionsProvider` port and mock with test tokens
- T8.1.4 Integrate into payment creation; `POST /compliance/preview`
- T8.1.5 `GET /compliance/checks/:paymentId`

**AC:** boundary tests per rule; a row per evaluated rule; `REJECT` cancels without ledger effect.

### S8.2 Review queue and decisions — P0
- T8.2.1 `GET /admin/compliance-queue`; `POST /admin/compliance/:id/decision`
- T8.2.2 Gate evaluation shared with approvals

**AC:** US-08 criteria; decision requires reason; decision is final.

### S8.3 Rule administration API and UI — P1
### S8.4 `RunComplianceChecks` re-screen job — P1

---

## EPIC 9 — Provider simulation and webhooks (Phase 9)

### S9.1 Outbox and queues — P0
- T9.1.1 `outbox_events` migration; relay with `SKIP LOCKED`
- T9.1.2 BullMQ module, queue definitions, retry/backoff defaults, dead-letter queue and listing endpoint
- T9.1.3 Worker entry point; graceful shutdown

**AC:** payment creation succeeds with Redis down and the job runs after recovery; exhausted job appears in dead-letter with payload and error.

### S9.2 Mock provider — P0
- T9.2.1 `PaymentProvider` port; `MockPaymentProvider` with `provider_payments`
- T9.2.2 Scenarios: success, `TEST-FAIL`, `TEST-TIMEOUT`, `TEST-DUPLICATE-WEBHOOK`, `TEST-OUT-OF-ORDER`
- T9.2.3 Signed webhook emitter with configurable delay and retry

### S9.3 Payment processing — P0 (US-09)
- T9.3.1 `ProcessPayment`: `APPROVED → PROCESSING` + capture in one transaction, then idempotent provider submission
- T9.3.2 `RetryFailedProviderRequest`

**AC:** invariant I5; one capture and one provider record under repeated and concurrent execution.

### S9.4 Webhook receiver — P0 (US-09)
- T9.4.1 `webhook_events` migration; raw-body capture; signature verification
- T9.4.2 Store-then-process; `ProcessWebhooks` job; settlement and reversal postings
- T9.4.3 `GET /admin/webhook-events`

**AC:** invariant I6; out-of-order and conflicting events `IGNORED`; bad signature → 401; unknown payment stored as `FAILED` with 200.

### S9.5 Webhook replay from admin — P1

---

## EPIC 10 — Reconciliation (Phase 10)

### S10.1 Engine — P0 (US-11)
- T10.1.1 `reconciliation_runs`, `reconciliation_items` migration
- T10.1.2 Snapshot read, matching, per-payment checks, ledger-wide checks
- T10.1.3 `RunReconciliation` job (manual + hourly)

### S10.2 Report API — P0
- T10.2.1 `POST /reports/reconciliation/run`, `GET /reports/reconciliation` with filters

**AC:** one fixture test per reason code; clean demo run → `MATCHED` and no ledger-wide findings; seeded mismatch and duplicate reported.

---

## EPIC 11 — Frontend (Phase 11)

### S11.1 Shell and auth — P0
- T11.1.1 App layout, navigation by permission, sandbox banner, API client with token refresh, TanStack Query setup
- T11.1.2 `/login`, `/register`; route protection
- T11.1.3 Component kit: status badges (payment, compliance, KYB), money display, data table, timeline, form fields

### S11.2 Company and KYB — P0 · `/company`, `/company/kyb`, `/company/users`
### S11.3 Beneficiaries — P0 · `/beneficiaries`, `/beneficiaries/new`, `/beneficiaries/:id`
### S11.4 Payment wizard — P0 · `/payments/new`
- T11.4.1 Six steps per brief §24; quote countdown; re-quote on expiry
- T11.4.2 Idempotency key generated once per wizard session and reused on retry

**AC:** double-clicking submit creates one payment; expired quote cannot be submitted.

### S11.5 Payments list and detail — P0 · `/payments`, `/payments/:id` with timeline, approve/reject controls by permission
### S11.6 Ledger — P0 · `/ledger`, `/ledger/accounts`
### S11.7 Admin: compliance queue — P0 · `/admin/compliance`
### S11.8 Admin: reconciliation, audit, webhooks — P0 · `/admin/reconciliation`, `/admin/audit-logs`
### S11.9 Dashboard — P1 (US-13) · tiles, volume chart, status distribution, recent activity, FX info, alerts
### S11.10 Quotes history `/quotes` — P1
### S11.11 Accessibility pass (axe, keyboard) — P1
### S11.12 Dark mode — P2

---

## EPIC 12 — Seed, testing and hardening (Phase 12)

### S12.1 Seed data — P0
- T12.1.1 Platform admin; Acme Trading LLC (approved, funded, admin/maker/approver/viewer); Dubai Tech Supplies LLC (KYB under review); Gulf Imports LLC (approved, second tenant for isolation demos)
- T12.1.2 Beneficiaries (Rahul Sharma, Priya Enterprises, Mumbai Supplies Pvt Ltd), payments in each status **created through the services**, one compliance alert
- T12.1.3 Reconciliation mismatch and duplicate inserted directly

**AC:** seed is idempotent; refuses to run unless `APP_ENV=development`; ledger trial balance is zero after seeding.

### S12.2 E2E suite — P0 · Playwright scenarios in TESTING.md §7
### S12.3 Security sweep — P0 · TESTING.md §8
### S12.4 Failure-scenario suite — P0 · TESTING.md §5
### S12.5 Documentation pass and README — P0 · docs match the build; README has verified commands and test credentials
### S12.6 Postgres row-level security — P1
### S12.7 Restricted DB role for ledger/audit — P1
### S12.8 Refund / `PAYOUT_RETURN` flow — P2
### S12.9 MFA, asymmetric JWT keys — P2
### S12.10 Tiered fee schedule — P2

---

## P0 summary — the demo path

S1.1–S1.4 → S2.1–S2.5 → S3.1 → S4.1 → S5.1 → S6.1–S6.3 → S7.1–S7.3 → S8.1–S8.2 → S9.1–S9.4 → S10.1–S10.2 → S11.1–S11.8 → S12.1–S12.5.
