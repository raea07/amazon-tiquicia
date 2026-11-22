#!/usr/bin/env bash
# Proves that the database suites hold on a USED database, not only on a
# freshly seeded one: the hosted preview, where people place, cancel and
# return orders, file reports and delete accounts, and which was seeded
# before invoicing existed. Runs on a lane's own local database only.
#
#   used-db-check.sh <lane> [prepare|imitate|check|all|quick]   (default: all)
#
#   prepare  tools/dev/stack.sh up <lane> (which resets the lane's database),
#            the browser journeys against it WITHOUT a reset between them
#            (E2E_KEEP_DATA=1), so orders, cancellations, returns, refunds,
#            reports and deleted accounts pile up; then stops the lane's
#            stack, so no worker changes the database during the check.
#            A journey that fails here (some assume a fresh seed) is reported
#            and the warm-up goes on: it only has to leave data behind.
#   imitate  makes it look like the preview: the seed's own payments lose
#            their invoice jobs, the issuer is not set up and simulated money
#            is not documented, payments are simulated, and the network
#            extension's grants (schema net) are made by a role of their own
#            that the suites' role is not a member of, as the platform's
#            supabase_admin made them there.
#   check    runs every suite on it twice WITHOUT a reset, and compares the
#            row count of every table before, between and after: the suites
#            must leave nothing behind. Every suite must pass or end its part
#            with a visible "skipped" row. Then breaks one suite on purpose,
#            in a copy, and requires the run to fail.
#   quick    a fresh seed instead of the journeys (local-db.sh reset), then
#            imitate and check: what CI runs, in a minute, without the apps.
#
# Lanes 1 to 19 only (database yuntera_lane<N>, from tools/dev/stack.sh);
# lane 0, any other database name and any server not on this machine are
# refused. Each skipped row it prints is listed in the report it ends with.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LANE="${1:-}"
STEP="${2:-all}"
[[ "$LANE" =~ ^(1[0-9]|[1-9])$ ]] || {
  echo "Refusing: give a lane from 1 to 19 (never 0): $0 <lane> [prepare|imitate|check|all|quick]" >&2
  exit 2
}
case "$STEP" in prepare | imitate | check | all | quick) ;; *) echo "Unknown step: $STEP" >&2; exit 2 ;; esac

eval "$("$ROOT/tools/dev/stack.sh" env "$LANE")"
EXPECTED="yuntera_lane${LANE}"
[ "$PG_DB_NAME" = "$EXPECTED" ] && [ "${DATABASE_URL##*/}" = "$EXPECTED" ] || {
  echo "Refusing: the database must be $EXPECTED, not ${DATABASE_URL##*/}." >&2
  exit 1
}
HOST="$(node -e 'const u = new URL(process.argv[1]); console.log(u.hostname || "/socket")' "$DATABASE_URL")"
case "$HOST" in
  127.0.0.1 | localhost | "[::1]" | ::1 | /socket) ;;
  *) echo "Refusing: $HOST is not this machine. This check rewrites a lane's local database." >&2; exit 1 ;;
esac

PLATFORM_ROLE="yuntera_lane${LANE}_platform"
STATE="$ROOT/.lane/$LANE/used-db"
mkdir -p "$STATE"
sql() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

prepare() {
  "$ROOT/tools/dev/stack.sh" up "$LANE"
  echo "used-db: the journeys, one after another, on the same database"
  if ! E2E_KEEP_DATA=1 "$ROOT/tools/dev/stack.sh" e2e "$LANE" > "$STATE/warm-up.log" 2>&1; then
    echo "used-db: some journeys failed on the used database (they assume a fresh seed); the data they left stays:"
    grep -E '^FAILED|^All ' "$STATE/warm-up.log" | sed 's/^/        /' || true
  fi
  "$ROOT/tools/dev/stack.sh" down "$LANE"
  sql -t -A -c "select format('used-db: %s orders, %s cancelled, %s refunds, %s returns, %s reports, %s deleted accounts',
    (select count(*) from public.orders), (select count(*) from public.orders where status in ('cancelled', 'refunded')),
    (select count(*) from private.refunds), (select count(*) from public.return_requests),
    (select count(*) from public.content_reports), (select count(*) from auth.users where deleted_at is not null))"
}

imitate() {
  sql -c "do \$\$ begin
            if not exists (select 1 from pg_roles where rolname = '$PLATFORM_ROLE') then
              create role $PLATFORM_ROLE nologin;
            end if;
          end \$\$;"
  sql <<SQL
begin;
-- Seeded before invoicing: the seed's own payments never got invoice jobs,
-- nor documents (here the local worker made them when the stack started).
create temporary table seed_documents on commit drop as
select e.id from public.electronic_invoices e join public.orders o on o.id = e.order_id
where o.idempotency_key like 'seed-%';
set local session_replication_role = replica; -- the files are immutable by trigger
update public.electronic_invoices set original_invoice_id = null, replaces_id = null, replaced_by_id = null
where id in (select id from seed_documents);
delete from private.electronic_invoice_files where invoice_id in (select id from seed_documents);
delete from public.electronic_invoices where id in (select id from seed_documents);
delete from private.outbox_jobs j
using private.outbox_events e, public.orders o
where j.event_id = e.id and j.consumer = 'invoice'
  and e.payload ->> 'order_id' = o.id::text and o.idempotency_key like 'seed-%';
-- Nor the demo issuer's settings: not set up, simulated money not documented.
update public.app_settings set value = jsonb_set(value, '{ready}', 'false') where key = 'invoicing_issuer';
update public.app_settings set value = jsonb_set(value, '{simulated_payments}', 'false')
where key = 'invoicing_policy';
update public.app_settings set value = '"sandbox"' where key = 'payments_mode';
-- The network extension's grants, made by the platform's own role.
alter schema net owner to $PLATFORM_ROLE;
alter table net._http_response owner to $PLATFORM_ROLE;
alter function net.http_post(text, jsonb, jsonb, jsonb, integer) owner to $PLATFORM_ROLE;
set local role $PLATFORM_ROLE;
grant usage on schema net to public, anon, authenticated;
grant all on all tables in schema net to public;
grant execute on all functions in schema net to public;
commit;
SQL
  echo "used-db: made to look like the preview (seeded before invoicing, issuer not set up, net granted by $PLATFORM_ROLE)"
}

# Every table's row count, one "schema.table count" line each.
counts() {
  sql -t -A -F ' ' -c "
    select format('%I.%I', n.nspname, c.relname),
           (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname),
                                                false, true, '')))[1]::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'private', 'auth', 'storage', 'net', 'vault')
    order by 1"
}

run_suites() { # label [tests dir]
  local label="$1" dir="${2:-}" status=0
  YUNTERA_TESTS_DIR="$dir" CI= bash "$ROOT/supabase/scripts/local-db.sh" test > "$STATE/$label.log" 2>&1 || status=$?
  return "$status"
}

check() {
  local failed=0
  counts > "$STATE/counts-0.txt"
  for round in 1 2; do
    if run_suites "round-$round"; then
      echo "used-db: round $round: every suite passed or skipped visibly"
    else
      echo "used-db: round $round: FAILED"
      grep -A40 '^FAIL' "$STATE/round-$round.log" | sed 's/^/        /' | head -80
      failed=1
    fi
    counts > "$STATE/counts-$round.txt"
    if ! diff -u "$STATE/counts-0.txt" "$STATE/counts-$round.txt" > "$STATE/counts-$round.diff"; then
      echo "used-db: round $round left rows behind or took rows away:"
      sed 's/^/        /' "$STATE/counts-$round.diff" | head -40
      failed=1
    else
      echo "used-db: round $round: the row count of every table is as before ($(wc -l < "$STATE/counts-0.txt") tables)"
    fi
  done
  echo "used-db: skipped parts, as a run on the preview shows them:"
  grep 'skipped:' "$STATE/round-1.log" | sed 's/^ */        /' || echo "        (none)"

  # A suite broken on purpose, in a copy, must make the run fail.
  local copy
  copy="$(mktemp -d "${TMPDIR:-/tmp}/yuntera-used-db.XXXXXX")"
  cp "$ROOT"/supabase/tests/*.sql "$copy/"
  sed -i 's/^rollback;$/do $$ begin assert false, '"'"'broken on purpose'"'"'; end $$;\nrollback;/' "$copy/060_search.sql"
  if run_suites "broken" "$copy"; then
    echo "used-db: a suite broken on purpose PASSED: the check cannot see failures"
    failed=1
  elif grep -q '^FAIL  060_search.sql' "$STATE/broken.log" && [ "$(grep -c '^FAIL' "$STATE/broken.log")" = 1 ]; then
    echo "used-db: a suite broken on purpose fails, and only that one"
  else
    echo "used-db: the broken copy failed in an unexpected way:"
    grep '^FAIL' "$STATE/broken.log" | sed 's/^/        /'
    failed=1
  fi
  rm -rf "$copy"
  counts > "$STATE/counts-3.txt"
  diff -q "$STATE/counts-0.txt" "$STATE/counts-3.txt" > /dev/null || { echo "used-db: the broken run left rows behind"; failed=1; }
  return "$failed"
}

case "$STEP" in
  prepare) prepare ;;
  imitate) imitate ;;
  check) check ;;
  all) prepare; imitate; check ;;
  quick) bash "$ROOT/supabase/scripts/local-db.sh" reset > "$STATE/reset.log" 2>&1 || {
           cat "$STATE/reset.log" >&2; exit 1; }
         imitate; check ;;
esac
