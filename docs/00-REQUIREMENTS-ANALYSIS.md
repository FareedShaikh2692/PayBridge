# PayBridge — Requirements Analysis (Step 1)

> **Educational Sandbox — No Real Money Movement.** PayBridge is a simulation. It is not a licensed financial product and claims no regulatory compliance.

This document records what was ambiguous, missing or risky in the source brief, and the default chosen for each. Every default is reversible before the phase that depends on it; the ones marked **CONFIRM** change business behaviour and are worth a second look.

## 1. Ambiguities and resolutions

| # | Ambiguity in the brief | Resolution (default) | Affects |
|---|---|---|---|
| A1 **CONFIRM** | The quote example prices the fee **on top** (AED 10,000 × 22.5865 = INR 225,865, fee AED 25 separate), but the ledger example carves the fee **out of** the AED 10,000 debit. | **Fee on top.** `base_amount` is the amount converted; the wallet is debited `base_amount + fee` (AED 10,025). The quote example is numerically explicit, so it wins. | FX, ledger, UI |
| A2 **CONFIRM** | Maker-checker and compliance review are both "approval", but the payment lifecycle has a single `APPROVED` state and no `PENDING_APPROVAL`. | Keep the seven spec states. Add two orthogonal gate fields, `compliance_status` and `approval_status`. A payment reaches `APPROVED` only when **both** gates are closed. No backward transitions. | Payments, UI |
| A3 | No `REJECTED` payment state, yet payments can be rejected by approver or compliance. | Rejection → `CANCELLED` with a typed `cancellation_reason` (`APPROVER_REJECTED`, `COMPLIANCE_REJECTED`, `USER_CANCELLED`, `KYB_REVOKED`). | Payments |
| A4 | KYB state machine omits the path out of `REJECTED`. | `REJECTED → DRAFT` (resubmission) and `APPROVED → EXPIRED` when the trade licence expiry passes. | KYB |
| A5 | "Sufficient simulated balance" — nothing says how a wallet is funded. | Add sandbox-only `POST /sandbox/wallet/topup` (ledger-posted, audited, labelled as simulated). Seed funds each approved company. | Ledger, API |
| A6 | When is revenue recognised and when are funds reserved? | **Hold** at creation, **capture** on entering `PROCESSING`, **settle** on `PAID`, **reverse** on `FAILED`. Fee is refunded on failure. | Ledger |
| A7 | Reconciliation needs a "provider payment" record but no table is listed. | Add `provider_payments`, owned by the mock provider module and never read by payment business logic — only by reconciliation. | DB, recon |
| A8 | Compliance: synchronous or asynchronous? Both "payment creation must validate compliance" and a `RunComplianceChecks` job are specified. | Rules run **synchronously** inside payment creation (mock providers are in-process and deterministic). The job handles re-screening and provider-timeout retries. | Compliance |
| A9 | A compliance `REJECT` at creation — error response or persisted payment? | Persist the payment as `CANCELLED` (no ledger hold posted), return `201` with the result. An audit trail matters more than a terse 4xx. | Payments |
| A10 | Can one user belong to several companies? | Schema supports it (`company_users`); MVP UI assumes one active company per session, carried in the token. | Auth |
| A11 | "Webhook updates payment: processing → paid" vs. internal `PROCESSING` set at submission. | Internal `PROCESSING` is set when the payment is submitted to the provider. The provider's `payment.processing` webhook is recorded but is a no-op on status. | Webhooks |
| A12 | Rounding is unspecified. | Rates to 6 dp; recipient amount rounded **down** to 2 dp; margin derived as the residual so the AED side always sums exactly. See LEDGER.md §3. | FX, ledger |
| A13 | Velocity rule: "> 5 payments within 24 hours → flag". Flag = review or informational? | `REVIEW`. Each rule has a configurable `outcome` (`REVIEW` or `REJECT`). | Compliance |
| A14 | Who decides a compliance review — SME approver or platform admin? Both are mentioned. | **Platform admin** makes the binding decision (`compliance.review`). SME approvers can *see* flags on their own payments (`compliance.read`) but cannot clear them. | RBAC |

## 2. Missing requirements added

- `idempotency_keys`, `outbox_events`, `refresh_tokens`, `provider_payments` tables.
- `/auth/*`, `/payments/:id/approve|reject`, `/companies/:id/users`, `/admin/webhook-events`, `/sandbox/wallet/topup`, `/fx/rates`.
- Extra permissions: `user.manage`, `kyb.read`, `kyb.review`, `quote.create`, `quote.read`, `payment.cancel`, `compliance.read`, `webhook.read`, `reconciliation.run`, `wallet.topup`.
- Explicit rounding and currency precision rules.
- A transactional outbox so a Redis outage cannot lose a job that the database has already committed to.

## 3. Technical risks

| Risk | Mitigation |
|---|---|
| Dual write between Postgres and BullMQ loses or duplicates jobs | Transactional outbox; all job handlers idempotent |
| Concurrent payments overdraw a wallet | `SELECT … FOR UPDATE` on the wallet account row inside the posting transaction; DB `CHECK (balance >= 0)` on customer accounts |
| Quote double-spend under concurrency | Row lock on quote + `UNIQUE (quote_id)` on `payment_orders` |
| Webhook duplicates and reordering | `UNIQUE (event_id)`, state-machine guard, ledger posting keys unique per `(payment, step)` |
| Provider timeout leaves state unknown | Idempotent provider submission keyed by payment id; never auto-fail on timeout; reconciliation flags `REVIEW_REQUIRED` |
| Prisma `Decimal` silently coerced to JS `number` | Lint rule + shared `Money` type; API serialises amounts as strings |
| Scope: 12 phases is large for one portfolio project | Strict P0/P1/P2 backlog; P0 path is the 21-step demo scenario |
| **Docker is not installed on this machine** | Needed for Phase 1's one-command start. Install Docker Desktop, or run Postgres and Redis natively in the interim |

## 4. Security risks

Tenant data leakage (IDOR), privilege escalation via role assignment, forged webhooks, replayed webhooks, token theft, account-number exposure in logs, mass assignment through DTOs, audit-log tampering. Each is treated in SECURITY.md §9 (threat model).

## 5. Financial and accounting risks

- Floating-point money → forbidden; `NUMERIC` in Postgres, `decimal.js` in code, strings on the wire.
- Unbalanced postings → rejected in the service **and** by a deferred constraint trigger at commit.
- Mutated history → `UPDATE`/`DELETE` blocked by trigger on ledger and audit tables; corrections are reversal transactions.
- Cached balance drift → invariant test and reconciliation both compare cached balance with `SUM(entries)`.
- Multi-currency transactions → must balance **per currency**; FX position accounts bridge AED and INR.

## 6. Domain assumptions

1. Corridor is AED → INR only; currency and country are still modelled as data, not constants.
2. Mid-market rate comes from a mock rate provider (default `22.70`, configurable, deterministic).
3. One AED wallet per company. No INR wallets for customers.
4. Fee is flat AED 25 per payment (configurable); tiered pricing is P2.
5. All timestamps are stored and compared in UTC (`timestamptz`); the UI localises.
6. KYB documents are metadata only — no real file storage of identity documents.
7. All names, licences, IFSC codes and account numbers in seed data are fictional.
