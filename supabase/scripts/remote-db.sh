#!/usr/bin/env bash
# Applies and checks the database on a hosted Supabase project, through
# Supabase's Management API. No database password is needed.
#
#   remote-db.sh status <project-ref>             which migrations are applied, which are pending
#   remote-db.sh push   <project-ref>             apply pending migrations in order; stops at the first error
#   remote-db.sh sql    <project-ref> <file.sql>  run one SQL file
#   remote-db.sh test   <project-ref>             run supabase/tests against the project (each rolls itself back)
#
# Authentication: set SUPABASE_ACCESS_TOKEN to a personal access token of an
# account that can reach the project. (Where a network proxy already adds the
# credential for api.supabase.com, leave it unset.)
#
# Each migration runs in one transaction together with its entry in
# supabase_migrations.schema_migrations, the same table the Supabase command
# line uses, so `supabase db push` later agrees about what has been applied.
#
# Never apply supabase/scripts/local-shim.sql to a hosted project: it imitates
# roles and schemas that Supabase already provides.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-}"
REF="${2:-}"
API="https://api.supabase.com/v1/projects/$REF/database/query"

[ -n "$COMMAND" ] && [ -n "$REF" ] || { sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

AUTH=()
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")

# Runs the SQL on stdin. Prints the JSON result; fails with the database's message on error.
run_sql() {
  local body status
  body="$(node -e '
    let sql = ""; process.stdin.on("data", (c) => (sql += c));
    process.stdin.on("end", () => process.stdout.write(JSON.stringify({ query: sql })));
  ')"
  local response
  response="$(curl -sS -m 180 -X POST "$API" "${AUTH[@]}" -H "content-type: application/json" \
    --data-binary @- -w $'\n%{http_code}' <<<"$body")"
  status="${response##*$'\n'}"
  response="${response%$'\n'*}"
  if [ "$status" != "200" ] && [ "$status" != "201" ]; then
    echo "$response" | node -e '
      let raw = ""; process.stdin.on("data", (c) => (raw += c));
      process.stdin.on("end", () => {
        try { const e = JSON.parse(raw); console.error(e.message ?? raw); } catch { console.error(raw.slice(0, 2000)); }
      });' >&2
    return 1
  fi
  printf '%s' "$response"
}

applied_versions() {
  run_sql <<'SQL' | node -e 'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>{for(const row of JSON.parse(r||"[]"))console.log(row.version)})'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
select version from supabase_migrations.schema_migrations order by version;
SQL
}

case "$COMMAND" in
  status | push)
    applied="$(applied_versions)"
    pending=0
    for file in "$ROOT"/migrations/*.sql; do
      base="$(basename "$file" .sql)"
      version="${base%%_*}"
      name="${base#*_}"
      if grep -qx "$version" <<<"$applied"; then
        [ "$COMMAND" = "status" ] && echo "applied  $base"
        continue
      fi
      pending=$((pending + 1))
      if [ "$COMMAND" = "status" ]; then
        echo "PENDING  $base"
        continue
      fi
      echo "apply    $base"
      {
        echo "begin;"
        cat "$file"
        echo
        echo "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');"
        echo "commit;"
      } | run_sql > /dev/null || { echo "FAILED   $base — nothing from this file was kept" >&2; exit 1; }
    done
    [ "$pending" -eq 0 ] && echo "Up to date." || true
    ;;

  sql)
    file="${3:?usage: remote-db.sh sql <project-ref> <file.sql>}"
    run_sql < "$file"
    echo
    ;;

  test)
    failed=0
    for file in "$ROOT"/tests/[0-9]*.sql; do
      # The suites are written for psql: inline the shared helpers they include.
      if sed -e "/^\\\\ir _helpers.sql/{r $ROOT/tests/_helpers.sql" -e 'd}' "$file" | run_sql > /dev/null 2> /tmp/yuntera-remote-test.log; then
        echo "pass  $(basename "$file")"
      else
        echo "FAIL  $(basename "$file")"
        sed 's/^/      /' /tmp/yuntera-remote-test.log
        failed=1
      fi
    done
    exit "$failed"
    ;;

  *)
    sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
