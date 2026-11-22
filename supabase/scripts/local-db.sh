#!/usr/bin/env bash
# Builds and tests the database on a plain PostgreSQL 16 (local machine or CI).
#
#   local-db.sh up      start the system PostgreSQL if it is not running (dev machines)
#   local-db.sh reset   drop and recreate the database, apply shim + migrations + seed
#   local-db.sh test    run every file in supabase/tests against the database
#   local-db.sh psql    open a shell on the database
#
# Connection settings come from the environment so CI can point at a service container:
#   PG_ADMIN_URL  superuser connection to the maintenance database
#   PG_DB_NAME    database to (re)create
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_URL="${PG_ADMIN_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
DB_NAME="${PG_DB_NAME:-yuntera_local}"
DB_URL="${ADMIN_URL%/*}/${DB_NAME}"

run() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

# `reset` drops the database. It is for a server on this machine (or CI's
# service container): refuse any other host, so a PG_ADMIN_URL copied from a
# hosted project can never be wiped by mistake. The host is worked out the way
# psql would: `host`/`hostaddr` in the URL's query, else the URL's host, else
# PGHOSTADDR/PGHOST, else the local socket. Anything that is not a
# postgres:// URL (a libpq keyword string, say) is refused rather than guessed.
local_only() {
  local hosts host
  hosts="$(node -e '
    let url;
    try { url = new URL(process.argv[1]); } catch { process.exit(3); }
    if (!/^postgres(ql)?:$/.test(url.protocol)) process.exit(3);
    const query = url.searchParams.get("hostaddr") || url.searchParams.get("host");
    const named = query || decodeURIComponent(url.hostname)
      || process.env.PGHOSTADDR || process.env.PGHOST || "/socket";
    console.log(named.split(",").map((h) => h.trim()).join("\n"));
  ' "$ADMIN_URL")" || {
    echo "Refusing: PG_ADMIN_URL must be a postgres:// URL for local-db.sh reset." >&2
    exit 1
  }
  while IFS= read -r host; do
    case "$host" in
      127.0.0.1 | localhost | "[::1]" | ::1 | /*) continue ;;
    esac
    if [ -n "$host" ] && [ "${YUNTERA_LOCAL_DB_HOST_OK:-}" = "$host" ]; then continue; fi
    echo "Refusing: ${host:-an unnamed host} is not this machine. local-db.sh drops and rebuilds databases;" >&2
    echo "it is for a local server only. For a disposable server elsewhere, set YUNTERA_LOCAL_DB_HOST_OK=$host." >&2
    exit 1
  done <<< "$hosts"
}

case "${1:-}" in
  up)
    if pg_isready -q -d "$ADMIN_URL"; then
      echo "PostgreSQL is already accepting connections."
    elif command -v pg_ctlcluster >/dev/null 2>&1; then
      pg_ctlcluster 16 main start
      echo "Started the local PostgreSQL 16 cluster."
    else
      echo "PostgreSQL is not reachable at $ADMIN_URL and no local cluster was found." >&2
      exit 1
    fi
    ;;

  reset)
    local_only
    psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 \
      -c "drop database if exists \"$DB_NAME\" with (force)" \
      -c "create database \"$DB_NAME\""
    run -f "$ROOT/scripts/local-shim.sql"
    for file in "$ROOT"/migrations/*.sql; do
      echo "migrate  $(basename "$file")"
      run -f "$file"
    done
    if [ -f "$ROOT/seed.sql" ]; then
      echo "seed     seed.sql"
      run -f "$ROOT/seed.sql"
    fi
    echo "Database $DB_NAME is ready."
    ;;

  test)
    failed=0
    # One log per run, so lanes testing at the same time never read each other's output.
    log="$(mktemp "${TMPDIR:-/tmp}/yuntera-db-test.XXXXXX")"
    # A suite that could not run part of itself ends with a row named
    # "skipped". It is shown; in CI (CI=true) it fails the run, so nothing that
    # runs here today can quietly stop running.
    for file in "$ROOT"/tests/[0-9]*.sql; do
      if run -f "$file" >"$log" 2>&1; then
        skipped="$(awk '/^ *skipped *$/ { getline; getline; print }' "$log" | sed 's/^ *//' | grep -v '^(0 rows)$' || true)"
        if [ -n "$skipped" ] && [ "${CI:-}" = "true" ]; then
          echo "FAIL  $(basename "$file") (skipped in CI: $skipped)"
          failed=1
        elif [ -n "$skipped" ]; then
          echo "pass  $(basename "$file")"
          echo "      skipped: $skipped"
        else
          echo "pass  $(basename "$file")"
        fi
      else
        echo "FAIL  $(basename "$file")"
        sed 's/^/      /' "$log"
        failed=1
      fi
    done
    rm -f "$log"
    exit "$failed"
    ;;

  psql)
    shift
    psql "$DB_URL" "$@"
    ;;

  *)
    echo "usage: $0 {up|reset|test|psql}" >&2
    exit 2
    ;;
esac
