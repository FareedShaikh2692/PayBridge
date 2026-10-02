# PayBridge — Security Design

> **Educational Sandbox — No Real Money Movement.** These controls demonstrate good practice. The system has not been penetration-tested or certified and must not hold real financial data.

## 1. Authentication

- **Passwords:** scrypt from `node:crypto` (N = 2^15, r = 8, p = 3 — an OWASP-listed parameter set), per-password 128-bit salt, stored as `scrypt$N$r$p$salt$hash`. scrypt was chosen over Argon2id so that no native add-on has to be compiled or shipped; the hash format carries its parameters so they can be raised later. Minimum 12 characters, rejected if in a common-password list. Never logged, never returned.
- **Access token:** JWT, HS256 with a secret of at least 32 characters from the environment (asymmetric keys are a P2 upgrade), carrying only the user id (`sub`), 15-minute lifetime, held in memory by the web app — not in `localStorage`.
- **Refresh token:** 256-bit random, opaque, stored hashed (SHA-256), 7-day lifetime, rotated on every use, delivered as `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. Presenting an already-rotated token revokes the entire family.
- **Login protection:** 10 attempts/min per IP; identical error and comparable timing for unknown user and wrong password (a dummy hash is verified when the user does not exist). Per-account lockout is not implemented (P1).
- **Logout:** revokes the refresh family; access tokens expire naturally.
- MFA is out of scope (P2).

## 2. Authorisation

- Roles map to permissions in the database (`role_permissions`); endpoints declare `@RequirePermissions(...)`.
- A global guard is **deny-by-default**: an endpoint without a declaration or an explicit `@Public()` fails closed.
- Permissions are loaded server-side per request (cached briefly), so a role change takes effect without waiting for token expiry.
- Object-level rules beyond RBAC: a maker cannot approve their own payment; a maker can cancel only payments they created; company admins cannot grant platform roles.

## 3. Tenant isolation

1. `TenantContext` is built from the verified token and a `company_users` lookup; `companyId` in a body is ignored, and in a path is compared with the context.
2. Repositories take `TenantContext` as a required argument and always include `company_id` in the `WHERE` clause. There is no "find by id" without it for tenant tables.
3. Composite foreign keys make cross-tenant references impossible at the database level.
4. Cross-tenant requests return `404`.
5. An automated test walks every tenant-scoped route with another company's token (TESTING.md §4).
6. P1: Postgres row-level security as a second barrier.

Platform admin access to tenant data is explicit (`*.read` at platform scope) and audited.

## 4. Encryption and data protection

| Data | Protection |
|---|---|
| Passwords | scrypt hash |
| Refresh tokens | SHA-256 hash |
| Beneficiary account number | AES-256-GCM, random 96-bit IV per value, key from `DATA_ENCRYPTION_KEY`; stored as `v1:iv:tag:ciphertext` so keys can be rotated |
| Account-number duplicate check | HMAC-SHA256 fingerprint with a separate key |
| In transit | TLS terminated at the proxy in any deployed environment; HSTS |
| Display | Last four digits only (`XXXXXX1234`); full number is decrypted only inside the provider-submission path |

## 5. Secrets

All secrets come from environment variables, validated at boot (the process refuses to start with a missing or weak secret). `.env` is git-ignored; `.env.example` contains placeholders only. Separate values per environment. CI uses throwaway values. Secret scanning (gitleaks) runs in CI.

Secrets: `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `FINGERPRINT_HMAC_KEY`, `WEBHOOK_SIGNING_SECRET`, `DATABASE_URL`, `REDIS_URL`.

## 6. Webhook verification (simulated)

`X-PayBridge-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC_SHA256(WEBHOOK_SIGNING_SECRET, t + "." + rawBody)`.

- Verified against the **raw** request bytes, before JSON parsing.
- Constant-time comparison (`timingSafeEqual`).
- Timestamp tolerance 300 s to limit replay; `event_id` uniqueness stops replay inside the window.
- The endpoint is excluded from JWT auth and from CSRF, has its own rate limit and a 64 KB body cap.
- Failed verifications are logged and audited (`WEBHOOK_REJECTED`) without the payload.

## 7. Transport and HTTP hardening

- `helmet`: CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`, HSTS.
- **CORS:** explicit allow-list from config; credentials allowed only for the web origin.
- **CSRF:** the API authenticates with a bearer header, which browsers do not attach automatically. The one cookie-authenticated route (`/auth/refresh`) is protected by `SameSite=Strict` plus an `Origin` check.
- **Rate limiting:** `@nestjs/throttler`, per IP, held in process memory: 300 requests/min by default, 10/min on register and login, 30/min on quotes. In-memory counters are per instance, so on a multi-instance or serverless deployment the effective limit is looser; a Redis-backed store is the documented next step (P1).
- **Validation:** DTO schemas on every input with `whitelist` and `forbidNonWhitelisted` (blocks mass assignment); size limits on bodies and strings.
- **SQL injection:** Prisma parameterises queries; the few raw queries use tagged templates (`$queryRaw`), never string concatenation. `$queryRawUnsafe` is banned by lint.
- **Output:** React escapes by default; no `dangerouslySetInnerHTML`.

## 8. Logging and audit

Structured JSON logs (pino) with `requestId`, `userId`, `companyId`, `route`, `method`, `status`, `duration`. A redaction list removes `password`, `passwordHash`, `accountNumber`, `authorization`, `cookie`, `token`, `refreshToken`, `secret`, `signature` at any depth. Request bodies are not logged for auth and beneficiary routes.

Audit logs are append-only (DB trigger), written in the same transaction as the change, and store redacted before/after values. No API exists to modify or delete them.

## 9. Threat model (STRIDE)

| # | Threat | Category | Mitigation |
|---|---|---|---|
| T1 | User of Company A reads or pays using Company B's beneficiary, quote or payment (IDOR) | Information disclosure / Elevation | Tenant-scoped repositories, composite FKs, `404` on foreign ids, isolation test suite |
| T2 | Maker approves own payment, or colludes via a second account they control | Elevation | `actor ≠ creator` check; only company admin assigns roles; role changes audited |
| T3 | Company admin grants themselves platform admin | Elevation | Assignable roles restricted to company scope; platform role is a separate column not reachable from company APIs |
| T4 | Forged webhook marks a payment paid | Spoofing | HMAC signature, timestamp tolerance, no JWT fallback |
| T5 | Replayed genuine webhook | Tampering | Unique `event_id`, state guard, unique posting key |
| T6 | Client tampers with amount or rate at payment creation | Tampering | Amounts copied from the stored quote; client value only asserted; quote immutable by trigger |
| T7 | Double-spend via concurrent requests | Tampering | Row locks, unique constraints, non-negative balance `CHECK` |
| T8 | Replay of a payment request | Tampering | `Idempotency-Key` with body hash |
| T9 | Stolen access token | Spoofing | 15-minute lifetime, in-memory storage, CSP |
| T10 | Stolen refresh token | Spoofing | HttpOnly/SameSite cookie, rotation with reuse detection |
| T11 | Credential stuffing / brute force | Spoofing | Rate limits, uniform errors, scrypt cost |
| T12 | Account numbers leak through logs, errors or API | Information disclosure | Encryption at rest, masking, log redaction, no bodies logged for beneficiary routes |
| T13 | Insider edits ledger or audit rows | Tampering / Repudiation | Immutability triggers, restricted DB role (P1), reconciliation and trial balance detect drift |
| T14 | Actor denies an action | Repudiation | Audit log with user, IP, user agent, request id, in-transaction |
| T15 | Flooding quotes or payments | Denial of service | Rate limits, pagination caps, body size limits, queue concurrency limits |
| T16 | Malicious job payload / poison message | Denial of service | Bounded retries, dead-letter queue, payload validation in processors |
| T17 | Secrets committed to git | Information disclosure | `.gitignore`, `.env.example`, gitleaks in CI |
| T18 | Vulnerable dependency | Various | `pnpm audit` in CI, pinned lockfile, Dependabot |
| T19 | System mistaken for a real product and given real data | Misuse | Sandbox banner and header everywhere, fictional seed data, explicit disclaimers in docs and UI |

## 10. Per-feature security review checklist

Used at the end of each phase: inputs validated · permission declared · tenant scope verified by test · no sensitive data in logs or responses · state change audited · errors do not leak internals · new secrets documented in `.env.example`.

## 11. As built — known gaps

- Rate limiting is in-memory (see §7). Postgres row-level security and a restricted database role for ledger/audit tables are designed (DATABASE.md §5) but not implemented; tenant isolation rests on scoped queries, composite foreign keys and the isolation test suite.
- No MFA, no per-account lockout, no password reset flow, no email verification.
- gitleaks runs in CI only; there is no pre-commit hook.
- The hosted demo publishes its seeded test credentials on the sign-in page by design. Anyone can sign in and change the fictional data. Do not put anything real into it.
