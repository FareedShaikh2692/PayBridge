#!/usr/bin/env bash
# Project-local PostgreSQL for development without Docker (port 54329, trust auth, data in .local/pg).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGDATA="$ROOT/.local/pg"
PORT=54329
case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA" ]; then
      mkdir -p "$ROOT/.local"
      initdb -D "$PGDATA" -U paybridge --auth=trust -E UTF8 >/dev/null
      printf "port = %s\nlisten_addresses = 'localhost'\nunix_socket_directories = '/tmp'\n" "$PORT" >> "$PGDATA/postgresql.conf"
    fi
    pg_ctl -D "$PGDATA" -l "$ROOT/.local/pg.log" -w start || true
    for db in paybridge paybridge_test; do
      psql -h localhost -p "$PORT" -U paybridge -d postgres -Atc "select 1 from pg_database where datname='$db'" | grep -q 1 \
        || psql -h localhost -p "$PORT" -U paybridge -d postgres -c "create database $db"
    done
    ;;
  stop) pg_ctl -D "$PGDATA" stop ;;
  *) echo "usage: $0 start|stop"; exit 1 ;;
esac
