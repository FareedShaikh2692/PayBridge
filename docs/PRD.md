# PayBridge — Product Requirements Document

> **Educational Sandbox — No Real Money Movement.**

Priorities: **P0** must have (demo scenario and mandatory invariants) · **P1** important · **P2** nice to have.

## 1. Product summary

A multi-tenant web application and REST API in which a UAE SME onboards, passes simulated KYB, funds a simulated AED wallet, and sends a simulated AED → INR payment that travels through compliance, approval, ledger posting, a mock provider, webhooks and reconciliation.

## 2. User journeys

**J1 — Onboarding (Company Admin).** Register → create company → fill KYB profile → submit → mock provider returns a result → platform admin approves → company becomes eligible → admin tops up the sandbox wallet and invites a maker and an approver.

**J2 — Payment (Maker → Approver).** Maker adds beneficiary → enters AED amount → receives quote with a 60 s countdown → reviews compliance preview → submits → payment is `CREATED` awaiting approval → approver approves → payment is captured and sent to the provider → webhook marks it `PAID` → both see the timeline.

**J3 — Compliance review (Platform Admin).** A payment over threshold lands in the compliance queue → admin opens it, sees which rules fired and why → records `CLEAR` or `REJECT` with a reason → payment continues or is cancelled with funds released.

**J4 — Operations (Platform Admin).** Runs reconciliation → filters to `MISMATCH` → opens an item to see internal vs provider vs ledger values → follows the audit trail and webhook history for that payment.

## 3. Functional requirements

### FR-AUTH — Authentication and authorisation (P0)
| ID | Requirement |
|---|---|
| FR-AUTH-1 | Register with email, name, password (≥ 12 chars, checked against a common-password list). Passwords hashed with Argon2id. |
| FR-AUTH-2 | Login returns a 15-minute access JWT and sets a rotating refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie. |
| FR-AUTH-3 | Logout revokes the refresh token family. Reuse of a rotated refresh token revokes the family. |
| FR-AUTH-4 | Every endpoint declares required permissions; a guard denies by default. |
| FR-AUTH-5 | Company context comes from the token and is re-verified against `company_users`; a `companyId` in the body or path is checked against it, never trusted. |
| FR-AUTH-6 | User status `ACTIVE / INVITED / SUSPENDED`; suspended users cannot authenticate. |
| FR-AUTH-7 | Company admins can invite users and assign `COMPANY_ADMIN / MAKER / APPROVER / VIEWER`. They cannot assign `PLATFORM_ADMIN`. |

### FR-CO — Company and KYB (P0)
| ID | Requirement |
|---|---|
| FR-CO-1 | Create a company with: name, country (`AE`), trade licence number and expiry, registration number, business type, registered address, contact email, phone, website. The creator becomes `COMPANY_ADMIN`. |
| FR-CO-2 | Company details are editable only while KYB is `DRAFT` or `REJECTED`; afterwards only contact fields. |
| FR-KYB-1 | KYB profile has status, submitted/reviewed timestamps, reviewer, risk level, verification result, rejection reason. |
| FR-KYB-2 | Submit moves `DRAFT → SUBMITTED`, calls `MockKYBProvider.verify`, stores the result and moves to `UNDER_REVIEW`. |
| FR-KYB-3 | Platform admin approves or rejects (rejection requires a reason). Approval provisions the company's ledger accounts. |
| FR-KYB-4 | A scheduled job moves `APPROVED → EXPIRED` when the trade licence expiry passes (P1). |
| FR-KYB-5 | KYB document records hold metadata only (type, filename, checksum); no real document storage (P1). |

### FR-BEN — Beneficiaries (P0)
| ID | Requirement |
|---|---|
| FR-BEN-1 | Create with name, country (`IN` only), bank name, account number (9–18 digits), IFSC (`^[A-Z]{4}0[A-Z0-9]{6}$`), account holder name. |
| FR-BEN-2 | Account number is encrypted at rest (AES-256-GCM); responses return only the masked form `XXXXXX1234`. |
| FR-BEN-3 | Duplicate (same company, IFSC, account number) is rejected via a keyed hash. |
| FR-BEN-4 | Status `ACTIVE / INACTIVE / BLOCKED`. Only `ACTIVE` beneficiaries can be paid. Beneficiaries are deactivated, never deleted. |
| FR-BEN-5 | Bank details are immutable after first use in a payment; only name/status may change (P1). |
| FR-BEN-6 | Creation screens the name against the mock sanctions/PEP providers; a `MATCH` sets `BLOCKED`. |

### FR-FX — Quotes (P0)
| ID | Requirement |
|---|---|
| FR-FX-1 | Quote AED → INR for a base amount between configurable min (AED 100) and max (AED 1,000,000). |
| FR-FX-2 | Formulas per LEDGER.md §3. Quote stores mid rate, spread %, customer rate, fee, recipient amount, total debit, FX margin. |
| FR-FX-3 | Expiry = creation + 60 s (configurable). States `ACTIVE / USED / EXPIRED / CANCELLED`. |
| FR-FX-4 | Quotes are immutable; no update endpoint exists. A DB trigger rejects changes to priced columns. |
| FR-FX-5 | Expiry is enforced at use time by timestamp comparison; the `ExpireQuotes` job only tidies status. |
| FR-FX-6 | Requires approved KYB. Creation is audited. |

### FR-PAY — Payments (P0)
| ID | Requirement |
|---|---|
| FR-PAY-1 | Create from `quote_id` + `beneficiary_id` + `Idempotency-Key` header. Amounts are copied from the quote; the client may send amounts only as an assertion that must match. |
| FR-PAY-2 | Nine validations of the brief (§9) run inside a single DB transaction with the quote and wallet rows locked. |
| FR-PAY-3 | On success: quote → `USED`, hold posted to ledger, status history written, audit written, outbox event emitted — atomically. |
| FR-PAY-4 | State machine per ARCHITECTURE.md §6; illegal transitions raise `INVALID_STATE_TRANSITION`. |
| FR-PAY-5 | Cancel allowed from `CREATED`, `COMPLIANCE_REVIEW`, `APPROVED`; releases the hold. |
| FR-PAY-6 | List with pagination, filter (status, beneficiary, date range, amount range), sort. |
| FR-PAY-7 | Detail returns timeline (status history), compliance checks, approval actions, ledger transactions. |

### FR-APR — Maker-checker (P0)
| ID | Requirement |
|---|---|
| FR-APR-1 | Company setting `maker_checker_enabled` (default on). When on, every payment creates an `approval_request`. |
| FR-APR-2 | Approve/reject requires `payment.approve` and `actor ≠ payment.created_by`. Reject requires a reason. |
| FR-APR-3 | Each action is recorded in `approval_actions` with actor, action, timestamp, reason. |

### FR-CMP — Compliance (P0)
| ID | Requirement |
|---|---|
| FR-CMP-1 | Configurable rules: amount threshold, velocity, destination country, sanctions, PEP. Each has parameters, outcome and enabled flag. |
| FR-CMP-2 | Result aggregation: any `REJECT` → `REJECT`; else any `REVIEW` → `REVIEW`; else `CLEAR`. |
| FR-CMP-3 | Every rule evaluation is stored in `compliance_checks` with inputs, outcome and rule version. |
| FR-CMP-4 | Platform admin queue lists payments in review; a decision (`CLEAR`/`REJECT`) needs a reason and is audited. |
| FR-CMP-5 | Compliance preview endpoint evaluates rules without persisting a payment (wizard step 4). |

### FR-LED — Ledger (P0)
| ID | Requirement |
|---|---|
| FR-LED-1 | Chart of accounts, posting rules and invariants per LEDGER.md. |
| FR-LED-2 | Posting is atomic, balanced per currency, idempotent by posting key. |
| FR-LED-3 | Balances are derived from entries; a cached balance is updated in the posting transaction. |
| FR-LED-4 | Company users see their own accounts and entries; platform admin sees all including system accounts. |

### FR-PRV — Provider and webhooks (P0)
| ID | Requirement |
|---|---|
| FR-PRV-1 | `PaymentProvider` interface with `createPayment` and `getPaymentStatus`; `MockPaymentProvider` implements it with deterministic scenarios. |
| FR-PRV-2 | Submission is idempotent on the provider side, keyed by payment id. |
| FR-PRV-3 | `POST /webhooks/provider` verifies an HMAC signature and timestamp tolerance, stores the event, and returns 200 for duplicates. |
| FR-PRV-4 | Events are processed exactly once; out-of-order or stale events are recorded as `IGNORED`. |

### FR-REC — Reconciliation (P0 engine, P1 UI polish)
| ID | Requirement |
|---|---|
| FR-REC-1 | Run on demand and on schedule; three-way compare per RECONCILIATION.md. |
| FR-REC-2 | Report endpoint with filters: date, status, payment id, company, currency. |

### FR-AUD — Audit (P0)
| ID | Requirement |
|---|---|
| FR-AUD-1 | Append-only log with actor, company, action, entity, old/new values, IP, user agent, timestamp, request id. |
| FR-AUD-2 | Written in the same transaction as the change it describes. |
| FR-AUD-3 | Sensitive fields are redacted from old/new values. |

### FR-UI — Frontend (P0 for demo pages, P1 for the rest)
Pages listed in the brief §22; dashboard widgets §23; six-step payment wizard §24; components §38. A persistent banner reads "Educational Sandbox — No Real Money Movement".

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| Correctness | No floating-point money. All monetary writes inside DB transactions. Mandatory invariants enforced by constraints and tests. |
| Security | OWASP ASVS L2 as a guide: Argon2id, RBAC, tenant isolation, validation, rate limiting, security headers, secrets via env. |
| Performance | p95 < 300 ms for reads and < 600 ms for payment creation at 50 rps on a laptop — indicative, not load-tested to SLA. |
| Reliability | Jobs retry with exponential backoff; outbox survives Redis outage; API degrades readiness when a dependency is down. |
| Observability | Structured JSON logs with `requestId`, `userId`, `companyId`, route, method, status, duration. Liveness and readiness endpoints. |
| Auditability | Every state transition attributable; history tables for payment status. |
| Maintainability | Module = controller / service / repository / DTO / tests. Business rules in services, never controllers. |
| Portability | 12-factor config; one-command start with Docker Compose. |
| Accessibility | WCAG 2.1 AA targets: keyboard operable, labelled controls, status not conveyed by colour alone. |
| Time | UTC everywhere internally. |

## 5. Permission matrix

| Permission | PLATFORM_ADMIN | COMPANY_ADMIN | MAKER | APPROVER | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| company.read | all | own | own | own | own |
| company.update | — | own | — | — | — |
| user.manage | — | own | — | — | — |
| kyb.submit | — | own | — | — | — |
| kyb.read | all | own | own | own | own |
| kyb.review | all | — | — | — | — |
| beneficiary.create | — | own | own | — | — |
| beneficiary.read | all | own | own | own | own |
| beneficiary.update | — | own | own | — | — |
| quote.create | — | own | own | — | — |
| quote.read | all | own | own | own | own |
| payment.create | — | own | own | — | — |
| payment.read | all | own | own | own | own |
| payment.approve | — | own¹ | — | own¹ | — |
| payment.cancel | — | own | own² | — | — |
| compliance.read | all | own | own | own | — |
| compliance.review | all | — | — | — | — |
| ledger.read | all | own | — | own | own |
| wallet.topup | — | own | — | — | — |
| webhook.read | all | — | — | — | — |
| reconciliation.read | all | — | — | — | — |
| reconciliation.run | all | — | — | — | — |
| audit.read | all | own | — | — | — |

¹ Never for a payment the actor created. ² Only payments the maker created.

Platform admins deliberately cannot create payments, quotes or beneficiaries: operators oversee tenants, they do not transact for them.

## 6. User stories and acceptance criteria

Format: **Given / When / Then**. Story IDs are referenced by the backlog.

**US-01 Company onboarding (P0)** — As a company administrator, I want to register my company so that I can use PayBridge.
- Given I am authenticated without a company, when I submit valid company details, then a company is created with KYB `DRAFT`, I hold `COMPANY_ADMIN`, and `COMPANY_CREATED` is audited.
- Given a trade licence number already registered, then I receive `409 COMPANY_ALREADY_EXISTS`.
- Given a trade licence expiry in the past, then validation fails.

**US-02 KYB (P0)** — As a company administrator, I want to submit KYB information so that my company becomes eligible for payments.
- Given KYB is `DRAFT` and required fields are complete, when I submit, then status becomes `UNDER_REVIEW`, `submitted_at` is set and the mock result is stored.
- Given KYB is `UNDER_REVIEW`, when a platform admin approves, then status is `APPROVED`, reviewer and time are recorded, and wallet accounts exist.
- Given KYB is not `APPROVED`, when I request a quote or payment, then I receive `403 KYB_NOT_APPROVED`.
- Given KYB is `APPROVED`, when I submit again, then I receive `409 INVALID_STATE_TRANSITION`.

**US-03 Users (P0)** — As a company administrator, I want to add users with roles so that duties are separated.
- When I invite a user as `MAKER`, then they can create payments but cannot approve.
- When I attempt to assign `PLATFORM_ADMIN`, then I receive `403`.

**US-04 Beneficiary (P0)** — As a maker, I want to add an Indian beneficiary so that I can send a simulated payment.
- Given valid details, then the beneficiary is created `ACTIVE` and the response shows only `XXXXXX1234`.
- Given IFSC `HDFC1234567` (fifth character not `0`), then validation fails with a field error.
- Given the name `TEST-SANCTION`, then the beneficiary is created `BLOCKED` and cannot be selected for payment.
- Given another company's beneficiary id, then I receive `404 BENEFICIARY_NOT_FOUND`.

**US-05 Quote (P0)** — As a maker, I want an FX quote so that I know how much INR the beneficiary will receive.
- Given AED 10,000, mid 22.70, spread 0.50 %, fee 25: then customer rate is `22.586500`, recipient amount `225865.00`, total debit `10025.00`, and the quote has a unique id, `created_at`, and `expires_at = created_at + 60 s`.
- Given the quote has expired, when I use it, then I receive `409 QUOTE_EXPIRED`.
- Given the quote was used, when I use it again, then I receive `409 QUOTE_ALREADY_USED`.
- There is no way to modify a quote's amount or rate.

**US-06 Payment (P0)** — As a maker, I want to create a payment from a locked quote.
- Given an active quote, an active beneficiary and sufficient balance, when I submit with an `Idempotency-Key`, then a payment is created, the quote is `USED`, and AED 10,025 moves from wallet to hold.
- Given the same key and body again, then I receive the original payment and no new ledger entries.
- Given the same key with a different body, then `409 IDEMPOTENCY_CONFLICT`.
- Given no key, then `400 IDEMPOTENCY_KEY_REQUIRED`.
- Given balance below total debit, then `422 INSUFFICIENT_FUNDS` and the quote remains `ACTIVE`.

**US-07 Approval (P0)** — As an approver, I want to review payments before they are processed.
- Given a payment awaiting approval created by someone else, when I approve, then the approval is recorded and, if compliance is clear, the payment becomes `APPROVED`.
- Given I created the payment, when I approve, then `403 SELF_APPROVAL_FORBIDDEN`.
- When I reject with a reason, then the payment is `CANCELLED` and the hold is released.

**US-08 Compliance (P0)** — As a compliance administrator, I want to review flagged payments.
- Given a payment of AED 60,000, then compliance result is `REVIEW` and the payment is `COMPLIANCE_REVIEW`.
- Given I decide `CLEAR` with a reason and the approval gate is closed, then the payment becomes `APPROVED`.
- Given I decide `REJECT`, then the payment is `CANCELLED` and funds are released.
- Every evaluation and decision appears in `compliance_checks` and the audit log.

**US-09 Processing (P0)** — As the system, I process an approved payment exactly once.
- When a payment becomes `APPROVED`, then it is captured in the ledger, submitted to the provider and becomes `PROCESSING`.
- When `payment.paid` arrives, then status is `PAID` and INR payable is settled.
- When the same event arrives again, then the response is 200 and nothing changes.
- When `payment.failed` arrives, then status is `FAILED` and the wallet is refunded AED 10,025.

**US-10 Ledger (P0)** — As an administrator, I want to see balanced financial transactions.
- Every ledger transaction shows equal debits and credits per currency.
- Wallet balance equals the sum of its entries.

**US-11 Reconciliation (P0)** — As an operations user, I want to identify mismatches between internal and provider records.
- When I run reconciliation after the demo payment, then the item is `MATCHED`.
- Given the seeded mismatch, then it is reported with the differing fields.

**US-12 Audit (P0)** — As a platform admin, I want an immutable trail of actions.
- Each action in the demo scenario yields one audit record.
- An attempt to `UPDATE` or `DELETE` an audit row fails at the database.

**US-13 Dashboard (P1)** — As an SME user, I want an overview of balance, volume and status.

**US-14 Tenant isolation (P0)** — As a company, my data is invisible to other companies.
- For every tenant-scoped endpoint, a Company A token against a Company B resource returns `404`.

## 7. Edge cases

| Case | Expected behaviour |
|---|---|
| Quote expires between wizard review and submit | `QUOTE_EXPIRED`; UI offers to re-quote with the same inputs |
| Two concurrent payments on one quote | Exactly one succeeds; the other gets `QUOTE_ALREADY_USED` |
| Two concurrent payments that together exceed balance | Second fails `INSUFFICIENT_FUNDS`; no negative balance |
| Same idempotency key while first request is still running | `409 IDEMPOTENCY_IN_PROGRESS` with `Retry-After` |
| Webhook `paid` arrives before `processing` | `paid` applied; later `processing` recorded as `IGNORED` |
| Webhook `failed` after `paid` | Not applied; event `IGNORED`; reconciliation raises `MISMATCH` |
| Webhook for unknown payment | Stored, marked `FAILED` with error, 200 returned (no retry storm); visible to admin |
| Provider times out on submission | Retried with same idempotency key; payment stays `PROCESSING`; recon flags if unresolved |
| Beneficiary blocked after quote but before payment | `BENEFICIARY_NOT_ACTIVE` |
| KYB expires with payments in flight | In-flight payments continue; new quotes and payments are refused |
| Approver's role removed after request raised | Permission is checked at action time |
| Redis down | Payment creation still succeeds (outbox); readiness reports degraded; jobs drain on recovery |
| Ledger posting fails mid-transaction | Whole DB transaction rolls back; no partial payment |

## 8. Mandatory financial invariants

1. Every ledger transaction balances.
2. Debit total = credit total (per transaction, per currency, and globally).
3. No payment can use an expired quote.
4. No quote can be used twice.
5. No payment can be processed twice.
6. A duplicate webhook does not duplicate ledger entries.
7. A duplicate `Idempotency-Key` does not create another payment.
8. Company A cannot access Company B's data.

Each is enforced at two levels — an application check and a database constraint — and has a dedicated test (TESTING.md §4).
