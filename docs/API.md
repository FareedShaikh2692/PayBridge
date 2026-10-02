# PayBridge — API Specification

> **Educational Sandbox — No Real Money Movement.** Every response carries `X-PayBridge-Sandbox: true`.

Base path `/api/v1`. JSON only. The live contract is the OpenAPI document served at `/api/docs` (Swagger UI) and `/api/docs-json`; this file is the design it is generated to match.

## 1. Conventions

**Authentication.** `Authorization: Bearer <access JWT>` (15 min). Refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth`. JWT claims: `sub`, `cid` (active company, absent for platform admins), `role`, `jti`, `exp`. Permissions are resolved server-side from the role, not read from the token.

**Tenant context.** Derived from the token and verified against `company_users`. Where a path contains a company id it must equal the caller's company unless the caller is a platform admin. A resource belonging to another tenant returns `404`, never `403`, so existence is not disclosed.

**Request id.** Send `X-Request-Id` or one is generated (`req_<ulid>`). Echoed in the response header, in error bodies and in every log line.

**Envelope**

```json
{ "success": true, "data": { } }
{ "success": true, "data": [ ], "meta": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 } }
{ "success": false, "error": { "code": "QUOTE_EXPIRED", "message": "The FX quote has expired.", "details": [] }, "requestId": "req_123" }
```

**Money and time.** Amounts and rates are decimal **strings** (`"10000.00"`, `"22.586500"`). Timestamps are ISO 8601 UTC.

**Pagination, filtering, sorting.** `?page=1&pageSize=20` (max 100) · `?sort=createdAt:desc` (whitelisted fields) · filters as named query parameters (`status`, `from`, `to`, …).

**Idempotency.** `POST /payments` requires `Idempotency-Key` (1–128 chars, `[A-Za-z0-9_-]`). Scope is the company. Records are kept 24 hours.

| Situation | Response |
|---|---|
| First request | Processed; response stored |
| Same key, same body | Stored response replayed with `Idempotent-Replayed: true` |
| Same key, different body | `409 IDEMPOTENCY_CONFLICT` |
| Same key, first still running | `409 IDEMPOTENCY_IN_PROGRESS`, `Retry-After: 1` |
| Header missing | `400 IDEMPOTENCY_KEY_REQUIRED` |

Only successful outcomes are stored. The idempotency row is written in the same database transaction as the payment, so any failure (4xx or 5xx) rolls it back and releases the key; a retry is then evaluated afresh. `POST /sandbox/wallet/topup` accepts the header too.

**Rate limits.** Auth endpoints 10/min per IP; quotes 30/min per user; general 300/min per user. `429 RATE_LIMITED` with `Retry-After`.

## 2. Endpoints

`perm` = required permission. ★ = added beyond the brief's list.

### Auth
| Method | Path | perm | Notes |
|---|---|---|---|
| POST | `/auth/register` ★ | public | `{ email, password, fullName }` → user |
| POST | `/auth/login` ★ | public | `{ email, password }` → `{ accessToken, user }` + refresh cookie |
| POST | `/auth/refresh` ★ | cookie | Rotates refresh token |
| POST | `/auth/logout` ★ | auth | Revokes token family |
| GET | `/auth/me` ★ | auth | User, company, role, permissions |

### Companies and users
| Method | Path | perm | Notes |
|---|---|---|---|
| POST | `/companies` | auth, no company | Creator becomes `COMPANY_ADMIN`; KYB `DRAFT` created |
| GET | `/companies/:id` | company.read | |
| PATCH | `/companies/:id` | company.update | Restricted fields after KYB submission |
| GET | `/companies/:id/users` ★ | user.manage | |
| POST | `/companies/:id/users` ★ | user.manage | `{ email, fullName, role }` |
| PATCH | `/companies/:id/users/:userId` ★ | user.manage | Role or status |
| GET | `/admin/companies` ★ | PLATFORM_ADMIN | All tenants, filter by KYB status |

### KYB
| Method | Path | perm | Notes |
|---|---|---|---|
| POST | `/kyb/submit` | kyb.submit | Company from context |
| GET | `/kyb/:companyId` | kyb.read | |
| POST | `/kyb/:id/approve` | kyb.review | `{ riskLevel, note? }` |
| POST | `/kyb/:id/reject` | kyb.review | `{ reason }` required |

### Beneficiaries
| Method | Path | perm | Notes |
|---|---|---|---|
| POST | `/beneficiaries` | beneficiary.create | |
| GET | `/beneficiaries` | beneficiary.read | Filters: `status`, `q` (name) |
| GET | `/beneficiaries/:id` | beneficiary.read | Masked account number |
| PATCH | `/beneficiaries/:id` | beneficiary.update | Bank details frozen after first payment |

### FX
| Method | Path | perm | Notes |
|---|---|---|---|
| GET | `/fx/rates` ★ | quote.read | Indicative mid rate, spread, fee |
| POST | `/fx/quotes` | quote.create | `{ baseAmount, baseCurrency: "AED", quoteCurrency: "INR" }` |
| GET | `/fx/quotes` ★ | quote.read | History for the `/quotes` page |
| GET | `/fx/quotes/:id` | quote.read | Includes `secondsRemaining` |

### Payments
| Method | Path | perm | Notes |
|---|---|---|---|
| POST | `/payments` | payment.create | `Idempotency-Key` required |
| GET | `/payments` | payment.read | Filters: `status`, `beneficiaryId`, `from`, `to`, `minAmount`, `maxAmount` |
| GET | `/payments/:id` | payment.read | With timeline, checks, approvals, ledger |
| POST | `/payments/:id/cancel` | payment.cancel | `{ reason? }` |
| POST | `/payments/:id/approve` ★ | payment.approve | Not own payment |
| POST | `/payments/:id/reject` ★ | payment.approve | `{ reason }` required |

### Compliance
| Method | Path | perm | Notes |
|---|---|---|---|
| POST | `/compliance/preview` ★ | payment.create | `{ beneficiaryId, baseAmount }` → predicted outcome, nothing persisted |
| GET | `/compliance/checks/:paymentId` | compliance.read | |
| GET | `/admin/compliance-queue` | compliance.review | Payments in `COMPLIANCE_REVIEW` |
| POST | `/admin/compliance/:id/decision` | compliance.review | `:id` = payment id; `{ decision: "CLEAR" \| "REJECT", reason }` |
| GET / PATCH | `/admin/compliance/rules[/:id]` ★ | compliance.review | View and tune rules (P1) |

### Ledger
| Method | Path | perm | Notes |
|---|---|---|---|
| GET | `/ledger/accounts` | ledger.read | Own accounts; all for platform admin |
| GET | `/ledger/accounts/:id` | ledger.read | With paginated entries |
| GET | `/ledger/:companyId/balance` | ledger.read | `{ available, reserved, currency }` |
| GET | `/ledger/transactions` ★ | ledger.read | Filters: `paymentId`, `type`, date |
| GET | `/admin/ledger/trial-balance` ★ | PLATFORM_ADMIN | Per-currency debit/credit totals |
| POST | `/sandbox/wallet/topup` ★ | wallet.topup | `{ amount }` AED; simulated funding |

### Webhooks
| Method | Path | perm | Notes |
|---|---|---|---|
| POST | `/webhooks/provider` | signature | No JWT |
| GET | `/admin/webhook-events` ★ | webhook.read | Filters: `status`, `paymentId`, `eventType` |

### Reports and audit
| Method | Path | perm | Notes |
|---|---|---|---|
| POST | `/reports/reconciliation/run` | reconciliation.run | `{ from?, to? }` → `202` with run id |
| GET | `/reports/reconciliation` | reconciliation.read | Filters: `date`/`from`/`to`, `status`, `paymentId`, `companyId`, `currency`, `runId` |
| GET | `/audit-logs` | audit.read | Own company; all for platform admin. Filters: `action`, `entityType`, `entityId`, `userId`, date |
| GET | `/dashboard/summary` ★ | payment.read | Aggregates for the dashboard |

### Health (outside `/api/v1`)
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Summary |
| GET | `/health/live` | Process is up |
| GET | `/health/ready` | Postgres and Redis reachable; `503` if Postgres is down, `200` with `degraded` if only Redis is |

## 3. Key schemas

### Create quote
```http
POST /api/v1/fx/quotes
{ "baseCurrency": "AED", "quoteCurrency": "INR", "baseAmount": "10000.00" }
```
```json
{ "success": true, "data": {
  "id": "0199a7c2-…", "companyId": "0199a7b0-…",
  "baseCurrency": "AED", "quoteCurrency": "INR",
  "baseAmount": "10000.00", "midMarketRate": "22.700000",
  "spreadPercentage": "0.5000", "customerRate": "22.586500",
  "feeAmount": "25.00", "totalDebitAmount": "10025.00",
  "recipientAmount": "225865.00",
  "status": "ACTIVE",
  "createdAt": "2026-10-02T11:40:00.000Z", "expiresAt": "2026-10-02T11:41:00.000Z",
  "secondsRemaining": 60
} }
```

### Create payment
```http
POST /api/v1/payments
Idempotency-Key: 6f1c0f2e-4a7b-4d3e-9b1a-1c2d3e4f5a6b
{ "quoteId": "0199a7c2-…", "beneficiaryId": "0199a7b8-…", "purpose": "Supplier invoice INV-1042",
  "sourceAmount": "10000.00" }
```
`sourceAmount` is optional; if present it must equal the quote's `baseAmount` or the request fails with `AMOUNT_MISMATCH`. All monetary values on the payment are copied from the quote server-side.

```json
{ "success": true, "data": {
  "id": "0199a7c9-…", "reference": "PB-20261002-000123",
  "companyId": "0199a7b0-…", "beneficiaryId": "0199a7b8-…", "quoteId": "0199a7c2-…",
  "sourceCurrency": "AED", "sourceAmount": "10000.00",
  "destinationCurrency": "INR", "destinationAmount": "225865.00",
  "feeAmount": "25.00", "totalDebitAmount": "10025.00", "exchangeRate": "22.586500",
  "status": "CREATED", "complianceStatus": "CLEAR", "approvalStatus": "PENDING",
  "beneficiary": { "id": "0199a7b8-…", "name": "Rahul Sharma", "accountNumberMasked": "XXXXXX1234", "ifsc": "TEST0001234" },
  "createdAt": "2026-10-02T11:40:20.000Z", "updatedAt": "2026-10-02T11:40:20.000Z"
} }
```

### Beneficiary
```json
{ "name": "Rahul Sharma", "country": "IN", "bankName": "Test Bank",
  "accountNumber": "000111222333", "ifsc": "TEST0001234", "accountHolderName": "Rahul Sharma" }
```
The response never includes `accountNumber`; it includes `accountNumberMasked`.

### Company
```json
{ "name": "Acme Trading LLC", "country": "AE", "tradeLicenseNumber": "TEST-TL-000001",
  "tradeLicenseExpiry": "2027-12-31", "registrationNumber": "TEST-REG-000001",
  "businessType": "General Trading", "registeredAddress": "Test Tower, Dubai",
  "contactEmail": "ops@acme.test", "contactPhone": "+971500000000", "website": "https://acme.test" }
```

## 4. Webhook contract

```http
POST /api/v1/webhooks/provider
Content-Type: application/json
X-PayBridge-Signature: t=1791200000,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd

{ "event_id": "evt_01JB…", "event_type": "payment.paid",
  "provider_payment_id": "pp_01JB…", "payment_id": "0199a7c9-…",
  "sequence": 3, "timestamp": "2026-10-02T11:41:05.000Z",
  "data": { "amount": "225865.00", "currency": "INR", "failure_reason": null } }
```

- **Signature:** `v1 = HMAC_SHA256(secret, t + "." + rawBody)`, hex. Compared in constant time. `|now − t| > 300 s` is rejected.
- **Event types:** `payment.created`, `payment.compliance_review`, `payment.processing`, `payment.paid`, `payment.failed`.
- **Responses:** `200 { "success": true, "data": { "received": true, "duplicate": false } }` for new events; the same with `duplicate: true` for a repeated `event_id`; `401 INVALID_WEBHOOK` for a bad signature or stale timestamp; `400 INVALID_WEBHOOK` for a malformed body.
- **Delivery semantics the receiver assumes:** at-least-once, any order. The mock provider retries non-2xx responses with backoff.

## 5. Error codes

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | DTO validation failed (`details` lists fields) |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Header missing on `POST /payments` |
| 400/401 | `INVALID_WEBHOOK` | Malformed body / bad signature or timestamp |
| 401 | `UNAUTHENTICATED` | Missing or invalid token |
| 401 | `INVALID_CREDENTIALS` | Login failed (same message for unknown user and wrong password) |
| 403 | `FORBIDDEN` | Missing permission |
| 403 | `KYB_NOT_APPROVED` | Company not eligible to transact |
| 403 | `SELF_APPROVAL_FORBIDDEN` | Maker approving own payment |
| 404 | `COMPANY_NOT_FOUND` · `BENEFICIARY_NOT_FOUND` · `QUOTE_NOT_FOUND` · `PAYMENT_NOT_FOUND` · `NOT_FOUND` | Missing, or belongs to another tenant |
| 409 | `COMPANY_ALREADY_EXISTS` · `BENEFICIARY_ALREADY_EXISTS` · `EMAIL_ALREADY_REGISTERED` | Uniqueness |
| 409 | `QUOTE_EXPIRED` · `QUOTE_ALREADY_USED` · `QUOTE_NOT_ACTIVE` | Quote unusable |
| 409 | `IDEMPOTENCY_CONFLICT` · `IDEMPOTENCY_IN_PROGRESS` | See §1 |
| 409 | `INVALID_STATE_TRANSITION` | Illegal KYB/payment transition |
| 409 | `PAYMENT_ALREADY_PROCESSED` | Cancel or decide on a payment past `APPROVED` |
| 409 | `COMPLIANCE_REVIEW_REQUIRED` | Action blocked while compliance is open |
| 422 | `INSUFFICIENT_FUNDS` | Wallet below total debit |
| 422 | `AMOUNT_MISMATCH` | Client amount differs from quote |
| 422 | `BENEFICIARY_NOT_ACTIVE` | Inactive or blocked beneficiary |
| 422 | `AMOUNT_OUT_OF_RANGE` | Below min or above max quote amount |
| 429 | `RATE_LIMITED` | |
| 500 | `LEDGER_IMBALANCE` | Posting did not balance — a bug; alerts |
| 500 | `INTERNAL_ERROR` | Unhandled |
| 503 | `SERVICE_UNAVAILABLE` | Dependency down |

Messages are safe for end users; stack traces and SQL never leave the server.
