#!/usr/bin/env sh
# Container entry point for the API image. "api" runs migrations then the HTTP server; "worker" runs the
# background worker only.
set -eu
cd /repo
case "${1:-api}" in
  api)
    pnpm --filter @paybridge/database migrate:deploy
    pnpm --filter @paybridge/database bootstrap
    if [ "${SEED_ON_START:-false}" = "true" ]; then
      (cd apps/api && node dist/seed.js) || echo "Seeding failed or was refused; continuing."
    fi
    cd apps/api && exec node dist/main.js
    ;;
  worker)
    cd apps/api && exec node dist/worker.js
    ;;
  *)
    exec "$@"
    ;;
esac
