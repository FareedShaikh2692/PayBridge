# PayBridge — Deployment and Operations

> **Educational Sandbox — No Real Money Movement.** There is no production deployment and none is intended. "Production" below means a production-*style* configuration example.

Status: design. Commands marked *(Phase 1)* do not exist until the foundation phase is built.

## 1. Local development *(Phase 1)*

Prerequisites: Docker Desktop (or Docker Engine + Compose v2), Node.js 22 LTS or newer, pnpm 10.

```bash
git clone <repo-url> paybridge && cd paybridge
cp .env.example .env
docker compose up
```

Compose starts four services with health checks and ordered start-up:

| Service | Image | Port | Health check | Depends on |
|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | `pg_isready` | — |
| `redis` | `redis:7-alpine` | 6379 | `redis-cli ping` | — |
| `api` | `infra/docker/api.Dockerfile` | 4000 | `GET /health/ready` | postgres, redis (healthy) |
| `web` | `infra/docker/web.Dockerfile` | 3000 | `GET /` | api (healthy) |

The `api` container runs `prisma migrate deploy` on start. The BullMQ worker runs in the same container in development (`WORKER_INLINE=true`) and as a separate `worker` service in the staging/production examples.

| What | Where |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:4000/api/v1 |
| Swagger | http://localhost:4000/api/docs |
| Health | http://localhost:4000/health/ready |
| Migrate | `pnpm db:migrate` |
| Seed | `pnpm db:seed` |
| Reset | `pnpm db:reset` |

Seeded test credentials are listed in the README once the seed script exists. They are fictional and valid only for the local sandbox.

## 2. Configuration

12-factor: everything from environment variables, validated at boot with a schema; the process exits on invalid config.

| Variable | Example (development) | Notes |
|---|---|---|
| `NODE_ENV` | `development` | |
| `APP_ENV` | `development` \| `staging` \| `production` | Selects defaults |
| `API_PORT` / `WEB_PORT` | `4000` / `3000` | |
| `DATABASE_URL` | `postgresql://paybridge:paybridge@postgres:5432/paybridge` | |
| `REDIS_URL` | `redis://redis:6379` | |
| `JWT_SECRET` | *(generate)* | ≥ 32 bytes |
| `JWT_ACCESS_TTL` / `REFRESH_TTL` | `15m` / `7d` | |
| `DATA_ENCRYPTION_KEY` | *(generate, 32 bytes base64)* | AES-256-GCM |
| `FINGERPRINT_HMAC_KEY` | *(generate)* | |
| `WEBHOOK_SIGNING_SECRET` | *(generate)* | |
| `CORS_ORIGINS` | `http://localhost:3000` | |
| `FX_MID_RATE_AED_INR` | `22.70` | Mock rate |
| `FX_SPREAD_PCT` / `FX_FEE_AED` | `0.50` / `25.00` | |
| `QUOTE_TTL_SECONDS` | `60` | |
| `KYB_AUTO_APPROVE` | `true` (dev) / `false` | |
| `MOCK_PROVIDER_DELAY_MS` | `3000` | Delay before webhooks |
| `LOG_LEVEL` | `debug` | |

Three example files ship: `.env.example` (development), `infra/env/staging.env.example`, `infra/env/production.env.example`. The latter two contain placeholders only and differ in: `KYB_AUTO_APPROVE=false`, `LOG_LEVEL=info`, stricter rate limits, `Secure` cookies, separate worker process, no seed data.

Generate a secret: `openssl rand -base64 32`.

## 3. CI/CD

GitHub Actions, `.github/workflows/ci.yml`, on push and pull request:

```
install (pnpm, cached) → lint → typecheck → unit tests
  → integration tests (postgres + redis service containers)
  → build (api, web) → docker build (api, web; not pushed)
```

Plus gitleaks and `pnpm audit --prod`. Playwright E2E on pull requests to `main`. There is **no** automatic deployment job. A manually triggered workflow can build and tag images; promoting them anywhere is a deliberate human action.

## 4. Database migrations

- Development: `prisma migrate dev` creates a migration per schema change; hand-written SQL (triggers, checks, partial indexes — DATABASE.md §5) is appended to the generated file.
- Deployed environments: `prisma migrate deploy` only; never `migrate dev` or `db push`.
- Migrations are forward-only and backwards-compatible with the previous application version (expand → migrate → contract) so a rollback of code does not require a rollback of schema.
- Seed runs only where `APP_ENV=development`; the script refuses otherwise.

## 5. Observability and operations

- Logs: JSON to stdout, one line per request and per job, correlated by `requestId` (propagated into jobs as `correlationId`).
- Health: `/health/live` for restarts, `/health/ready` for traffic.
- Queues: failed and dead-letter counts exposed on an admin endpoint; Bull Board mounted in development only.
- Shutdown: on `SIGTERM` the API stops accepting requests, finishes in-flight ones, and workers finish or release the current job.
- Backups (production-style note): daily logical backup and point-in-time recovery would be required for any system of record; not configured for the sandbox.

## 6. Runbook pointers

| Symptom | Look at |
|---|---|
| Payment stuck `APPROVED` or `PROCESSING` | Dead-letter queue; `outbox_events` with `status = PENDING`; reconciliation `STUCK_*` |
| Webhook not applied | `GET /admin/webhook-events?paymentId=…` — status and error |
| Balance looks wrong | `GET /admin/ledger/trial-balance`; reconciliation ledger-wide findings |
| Readiness degraded | Redis connectivity |
