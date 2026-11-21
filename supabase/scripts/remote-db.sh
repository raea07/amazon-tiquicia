#!/usr/bin/env bash
# Applies and checks the database on a hosted Supabase project, through
# Supabase's Management API. No database password is needed.
#
#   remote-db.sh status <project-ref>             which migrations are applied, which are pending
#   remote-db.sh push   <project-ref>             apply pending migrations in order; stops at the first error
#   remote-db.sh sql    <project-ref> <file.sql>  run one SQL file
#   remote-db.sh test   <project-ref>             run supabase/tests against the project (each rolls itself back;
#                                                 a part that cannot run there is reported as skipped)
#   remote-db.sh seed   <project-ref>             load supabase/seed.sql: demo accounts and orders (PREVIEW ONLY)
#
# Authentication: set SUPABASE_ACCESS_TOKEN to a personal access token of an
# account that can reach the project. (Where a network proxy already adds the
# credential for api.supabase.com, leave it unset.)
#
# Each migration runs in one transaction together with its entry in
# supabase_migrations.schema_migrations, the same table the Supabase command
# line uses, so `supabase db push` later agrees about what has been applied.
#
# `seed` refuses unless the project's payments_mode is "sandbox" and
# YUNTERA_SEED_CONFIRM is set to the project reference. The demo accounts'
# password comes from YUNTERA_SEED_PASSWORD (24 or more letters and digits);
# only its bcrypt hash goes into the seed.
#
# Never apply supabase/scripts/local-shim.sql to a hosted project: it imitates
# roles and schemas that Supabase already provides.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-}"
REF="${2:-}"
API="https://api.supabase.com/v1/projects/$REF/database/query"
USAGE_LINES='2,26p'

[ -n "$COMMAND" ] && [ -n "$REF" ] || { sed -n "$USAGE_LINES" "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

# curl reads the token from a config on a file descriptor, so it never appears
# in the process list. Prints nothing when the variable is unset.
auth_config() {
  [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_ACCESS_TOKEN"
}

# The suites and the seed are written for psql. Inlines `\ir` includes; refuses
# any other psql command, which the API would reject with a confusing error.
psql_to_plain() {
  local file="$1" dir
  dir="$(dirname "$file")"
  if grep -nE '^\\' "$file" | grep -vE '^[0-9]+:\\ir [A-Za-z0-9_./-]+\.sql$' >&2; then
    echo "$(basename "$file") uses psql commands the API cannot run (lines above)." >&2
    return 1
  fi
  awk -v dir="$dir" '
    /^\\ir / { path = dir "/" $2; while ((getline line < path) > 0) print line; close(path); next }
    { print }' "$file"
}

# Runs the SQL on stdin. Prints the JSON result; fails with the database's message on error.
# Optional arguments name environment variables whose values are sent as the
# query parameters $1, $2, … (so a secret never appears in the statement text,
# a command line or the shell history).
run_sql() {
  local body status
  body="$(node -e '
    const params = process.argv.slice(1).map((name) => {
      const value = process.env[name];
      if (value === undefined) { console.error(`${name} is not set`); process.exit(1); }
      return value;
    });
    let sql = ""; process.stdin.on("data", (c) => (sql += c));
    process.stdin.on("end", () =>
      process.stdout.write(JSON.stringify(params.length ? { query: sql, parameters: params } : { query: sql })));
  ' "$@")"
  local response
  response="$(curl -sS -m 180 -X POST "$API" --config <(auth_config) -H "content-type: application/json" \
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
    log="$(mktemp)"
    trap 'rm -f "$log"' EXIT
    # A suite that cannot run part of itself here ends with a row named
    # "skipped" saying what and why; it is shown, never swallowed.
    for file in "$ROOT"/tests/[0-9]*.sql; do
      if result="$({ psql_to_plain "$file" | run_sql; } 2> "$log")"; then
        echo "pass  $(basename "$file")"
        node -e '
          let rows; try { rows = JSON.parse(process.argv[1]); } catch { process.exit(0); }
          for (const row of Array.isArray(rows) ? rows : [])
            if (row && row.skipped) console.log("      skipped: " + row.skipped);
        ' "$result"
      else
        echo "FAIL  $(basename "$file")"
        sed 's/^/      /' "$log"
        failed=1
      fi
    done
    exit "$failed"
    ;;

  seed)
    # Demo accounts share one password and the orders are fictional: preview only.
    if [ "${YUNTERA_SEED_CONFIRM:-}" != "$REF" ]; then
      echo "Refusing: this loads demo accounts into $REF. If that project is a preview," >&2
      echo "set YUNTERA_SEED_CONFIRM=$REF and run again." >&2
      exit 1
    fi
    if ! [[ "${YUNTERA_SEED_PASSWORD:-}" =~ ^[A-Za-z0-9]{24,}$ ]]; then
      echo "Refusing: set YUNTERA_SEED_PASSWORD to a random password of 24 or more letters and digits" >&2
      echo "(read it from a file, e.g. YUNTERA_SEED_PASSWORD=\"\$(cat file)\", not typed on the command line)." >&2
      exit 1
    fi
    state="$(run_sql <<'SQL'
select json_build_object(
  'mode', private.setting('payments_mode') #>> '{}',
  'seeded', exists (select 1 from public.sellers)
       or exists (select 1 from auth.users where email like '%@yuntera.example')
) as s;
SQL
)"
    mode="$(node -e 'console.log(JSON.parse(process.argv[1])[0].s.mode ?? "")' "$state")"
    seeded="$(node -e 'console.log(JSON.parse(process.argv[1])[0].s.seeded)' "$state")"
    if [ "$mode" != "sandbox" ]; then
      echo "Refusing: payments_mode on $REF is \"$mode\", not \"sandbox\". Never seed a live project." >&2
      exit 1
    fi
    if [ "$seeded" = "true" ]; then
      echo "Refusing: $REF already has sellers or demo accounts. The seed runs only on a fresh database." >&2
      exit 1
    fi

    # Hash the password in the database, sent as a query parameter; the seed gets only the hash.
    hash="$(run_sql YUNTERA_SEED_PASSWORD <<<"select extensions.crypt(\$1, extensions.gen_salt('bf', 10)) as h" |
      node -e 'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>console.log(JSON.parse(r)[0].h))')"
    [[ "$hash" =~ ^\$2[aby]\$10\$[./A-Za-z0-9]{53}$ ]] || { echo "Could not hash the password." >&2; exit 1; }

    # The seed is one transaction (begin … commit) in one request: it is applied
    # whole or not at all. The hash is set for that transaction only.
    echo "seed     seed.sql"
    if ! psql_to_plain "$ROOT/seed.sql" |
      SEED_HASH="$hash" awk '!done && /^begin;$/ { print; print "select set_config('\''app.seed_password_hash'\'', '\''" ENVIRON["SEED_HASH"] "'\'', true);"; done = 1; next } { print }' |
      run_sql > /dev/null; then
      echo "The seed failed or the request timed out. It is one transaction, so it either finished or" >&2
      echo "left nothing; run this command again: it refuses if the demo data is already there." >&2
      exit 1
    fi
    run_sql <<'SQL' | node -e 'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>console.log(JSON.parse(r)[0].s))'
select format('Seeded: %s demo accounts, %s sellers, %s products, %s orders.',
  (select count(*) from auth.users where email like '%@yuntera.example'),
  (select count(*) from public.sellers), (select count(*) from public.products),
  (select count(*) from public.orders)) as s;
SQL
    ;;

  *)
    sed -n "$USAGE_LINES" "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
