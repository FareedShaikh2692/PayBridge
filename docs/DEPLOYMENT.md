# PayBridge — Deployment and Operations

> **Educational Sandbox — No Real Money Movement.** There is no production deployment and none is intended. "Production" below means a production-*style* configuration example.

Three ways to run it. Only the first and third were exercised during development; the Docker path is written and built in CI but **was not run locally**, because Docker is not installed on the development machine.

## 1. Running it

### 1a. Local, without Docker (how it was developed and tested)

Prerequisites: Node.js 22 or newer, pnpm 10, PostgreSQL 16+ binaries on the PATH (`initdb`, `pg_ctl`). Redis is optional.

```bash
pnpm install
pnpm db:local:start        # project-local PostgreSQL on port 54329, data in .local/pg
cp .env.example .env       # then set DATABASE_URL=postgresql://paybridge@localhost:54329/paybridge and QUEUE_DRIVER=inline
pnpm build
pnpm db:migrate
pnpm db:seed               # fictional demo data and test logins
pnpm --filter @paybridge/api start    # http://localhost:4000
pnpm --filter @paybridge/web dev      # http://localhost:3000
```

With `QUEUE_DRIVER=inline` no Redis is needed. Set `QUEUE_DRIVER=bullmq` and `REDIS_URL` to run the BullMQ workers instead (verified against a local Redis).

### 1b. Docker Compose (not run locally)

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
| `web` | `infra/docker/web.Dockerfile` | 3000 | `GET /login` | api (healthy) |

The `api` container applies migrations, installs reference data and — because `SEED_ON_START=true` and `APP_ENV=development` — loads the demo data on first start. It uses the BullMQ driver with the worker in-process (`WORKER_INLINE=true`); `api-entrypoint.sh worker` runs a standalone worker.

### 1c. Vercel (deployed)

Two projects from this one repository: `paybridge-api` (root `apps/api`, NestJS preset) and `paybridge-web` (root `apps/web`, Next.js preset), plus a Neon Postgres database attached to the API project through the Vercel Marketplace.

- The web app proxies `/api/*` to the API (`API_URL`), so the browser talks to one origin and the refresh cookie stays first-party.
- Vercel has no long-lived worker, so the API uses `QUEUE_DRIVER=inline`: work is drained after each request with `waitUntil`, and a daily cron calls `/api/v1/internal/cron`. Redis and BullMQ are not used there.
- `infra/scripts/vercel-build-api.sh` builds the workspace packages, applies migrations over the unpooled connection, installs reference data and (with `ALLOW_SEED=true`) seeds the demo data. The seed is idempotent.
- Environment variables are listed in `infra/env/vercel.env.example`.

```bash
VERCEL_ORG_ID=<team id> VERCEL_PROJECT_ID=<api project id> vercel deploy --prod
VERCEL_ORG_ID=<team id> VERCEL_PROJECT_ID=<web project id> vercel deploy --prod
```

Deploys are manual. Nothing deploys automatically.

| What | Local | Vercel deployment |
|---|---|---|
| Web | http://localhost:3000 | https://paybridge-web-red.vercel.app |
| API | http://localhost:4000/api/v1 | https://paybridge-api.vercel.app/api/v1 |
| Swagger | http://localhost:4000/api/docs | https://paybridge-api.vercel.app/api/docs |
| Health | http://localhost:4000/health/ready | https://paybridge-api.vercel.app/health/ready |

| Task | Command |
|---|---|
| Migrate | `pnpm db:migrate` |
| Seed | `pnpm db:seed` |
| Reset and reseed | `pnpm db:reset` |

## 2. Configuration

12-factor: everything from environment variables, validated at boot with a schema; the process exits on invalid config.

| Variable | Example (development) | Notes |
|---|---|---|
| `NODE_ENV` | `development` | |
| `APP_ENV` | `development` \| `staging` \| `production` | Selects defaults |
| `PORT` | `4000` | API port |
| `QUEUE_DRIVER` | `inline` \| `bullmq` | See ARCHITECTURE.md §5.1a |
| `WORKER_INLINE` | `true` | Run the worker inside the API process |
| `WEBHOOK_TARGET_URL` | `http://localhost:4000` | Where the mock provider sends webhooks |
| `ALLOW_SEED` | unset | Allow seeding outside `APP_ENV=development` |
| `CRON_SECRET` | *(generate)* | Protects `/api/v1/internal/cron` |
| `API_URL` | `http://localhost:4000` | Web only: where `/api/*` is proxied |
| `DATABASE_URL` | `postgresql://paybridge:paybridge@postgres:5432/paybridge` | |
| `REDIS_URL` | `redis://redis:6379` | |
| `JWT_SECRET` | *(generate)* | ≥ 32 bytes |
| `JWT_ACCESS_TTL_SECONDS` / `REFRESH_TTL_DAYS` | `900` / `7` | |
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

Four example files ship: `.env.example` (development), `infra/env/staging.env.example`, `infra/env/production.env.example` and `infra/env/vercel.env.example`. The latter two contain placeholders only and differ in: `KYB_AUTO_APPROVE=false`, `LOG_LEVEL=info`, stricter rate limits, `Secure` cookies, separate worker process, no seed data.

Generate a secret: `openssl rand -base64 32`.

## 3. CI/CD

GitHub Actions, `.github/workflows/ci.yml`, on push and pull request:

```
install (pnpm, cached) → lint → typecheck → unit tests
  → integration tests (postgres + redis service containers)
  → build (api, web) → docker build (api, web; not pushed)
```

Plus Playwright end-to-end tests and a gitleaks secret scan. There is **no** deployment job: releasing is a deliberate human action. The workflow has not yet run on GitHub, because the repository had not been pushed when this was written.

## 4. Database migrations

- Development: `prisma migrate dev` creates a migration per schema change; hand-written SQL (triggers, checks, partial indexes — DATABASE.md §5) is appended to the generated file.
- Deployed environments: `prisma migrate deploy` only; never `migrate dev` or `db push`.
- Migrations are forward-only and backwards-compatible with the previous application version (expand → migrate → contract) so a rollback of code does not require a rollback of schema.
- Seed runs only where `APP_ENV=development`; the script refuses otherwise.

## 5. Observability and operations

- Logs: JSON to stdout, one line per request and per job, correlated by `requestId` (propagated into jobs as `correlationId`).
- Health: `/health/live` for restarts, `/health/ready` for traffic.
- Queues: job counts and dead letters at `GET /api/v1/admin/jobs` and on the Webhooks & jobs screen.
- Shutdown: on `SIGTERM` the API stops accepting requests, finishes in-flight ones, and workers finish or release the current job.
- Backups (production-style note): daily logical backup and point-in-time recovery would be required for any system of record; not configured for the sandbox.

## 6. Runbook pointers

| Symptom | Look at |
|---|---|
| Payment stuck `APPROVED` or `PROCESSING` | Dead-letter queue; `outbox_events` with `status = PENDING`; reconciliation `STUCK_*` |
| Webhook not applied | `GET /admin/webhook-events?paymentId=…` — status and error |
| Balance looks wrong | `GET /admin/ledger/trial-balance`; reconciliation ledger-wide findings |
| Readiness degraded | Redis connectivity |
