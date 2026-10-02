#!/usr/bin/env bash
# Build step for the API on Vercel. Builds the workspace packages the API imports, then applies database
# migrations and reference data. With ALLOW_SEED=true it also loads the fictional demo data (idempotent).
set -euo pipefail
cd "$(dirname "$0")/../.."

pnpm --filter @paybridge/shared build
pnpm --filter @paybridge/database build

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set: skipping migrations. The API will not start until a database is connected."
  exit 0
fi

# Migrations need a direct (unpooled) connection; the running app uses the pooled one.
DIRECT_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"
(cd packages/database && DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy && DATABASE_URL="$DIRECT_URL" node dist/bootstrap-cli.js)

if [ "${ALLOW_SEED:-false}" = "true" ]; then
  (cd apps/api && npx nest build && DATABASE_URL="$DIRECT_URL" QUEUE_DRIVER=inline node dist/seed.js && rm -rf dist) || echo "Seeding failed; continuing without demo data."
fi
