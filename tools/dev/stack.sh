#!/usr/bin/env bash
# Runs the whole local stack — database, API stand-in and the web apps — in a
# numbered "lane", so several checkouts (git worktrees, CI jobs, two people on
# one machine) can each have their own without colliding.
#
#   tools/dev/stack.sh up [lane]              database + API + build + start the apps,
#                                             plus the notification worker against the local fake providers
#   tools/dev/stack.sh notify [lane]          (re)start only the notification worker and the fake providers
#   tools/dev/stack.sh api [lane]             database + API only (enough for most tests)
#   tools/dev/stack.sh env [lane]             print the lane's settings as `export` lines
#   tools/dev/stack.sh e2e [lane] [journey…]  run browser journeys against the lane
#   tools/dev/stack.sh down [lane]            stop what `up`/`api` started
#   tools/dev/stack.sh status [lane]
#
# Lane 0 (the default) is the usual setup: database yuntera_local, API on
# :54321, apps on :3000–:3003. Lane N (1–9) uses database yuntera_lane<N>, API
# on :544<N>0 and apps on :3<N>00–:3<N>03. The notification
# functions listen on the API port + 1, the fake providers on the API port + 2.
#
# The apps read the API address when they are BUILT, so each lane builds its own
# copy; `up` writes apps/*/.env.local for the lane before building.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMAND="${1:-}"
LANE="${2:-0}"
[[ "$LANE" =~ ^[0-9]$ ]] || { echo "Lane must be a single digit 0–9." >&2; exit 2; }

if [ "$LANE" = "0" ]; then
  DB_NAME="yuntera_local"; API_PORT=54321; APP_BASE=3000
else
  DB_NAME="yuntera_lane${LANE}"; API_PORT="544${LANE}0"; APP_BASE="3${LANE}00"
fi
ADMIN_URL="${PG_ADMIN_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
DB_URL="${ADMIN_URL%/*}/${DB_NAME}"
API_URL="http://127.0.0.1:${API_PORT}"
FUNCTIONS_PORT=$((API_PORT + 1)); FAKE_PORT=$((API_PORT + 2))
API_KEY="sb_publishable_local_development_only"
STATE="$ROOT/.lane/$LANE"
APPS=(web seller ops field)

app_port() { # app name → port
  local index=0
  for app in "${APPS[@]}"; do
    [ "$app" = "$1" ] && { echo $((APP_BASE + index)); return; }
    index=$((index + 1))
  done
}

print_env() {
  cat <<ENV
export PG_DB_NAME=$DB_NAME
export DATABASE_URL=$DB_URL
export DEV_API_PORT=$API_PORT
export API_URL=$API_URL
export API_KEY=$API_KEY
export NEXT_PUBLIC_SUPABASE_URL=$API_URL
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$API_KEY
export EXPO_PUBLIC_SUPABASE_URL=$API_URL
export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$API_KEY
export WEB_URL=http://127.0.0.1:$(app_port web)
export SELLER_URL=http://127.0.0.1:$(app_port seller)
export OPS_URL=http://127.0.0.1:$(app_port ops)
export FIELD_URL=http://127.0.0.1:$(app_port field)
export DEV_FUNCTIONS_PORT=$FUNCTIONS_PORT
export DEV_FAKE_PROVIDERS_PORT=$FAKE_PORT
export FUNCTIONS_URL=http://127.0.0.1:$FUNCTIONS_PORT
export FAKE_PROVIDERS_URL=http://127.0.0.1:$FAKE_PORT
ENV
}

wait_for() { # url, seconds
  for _ in $(seq 1 "$2"); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "Timed out waiting for $1" >&2
  return 1
}

stop_all() {
  [ -d "$STATE" ] || return 0
  for pidfile in "$STATE"/*.pid; do
    [ -e "$pidfile" ] || continue
    pid="$(cat "$pidfile")"
    # Each service runs in its own process group, so its children stop with it.
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  done
}

start() { # name, working dir, command…
  local name="$1" dir="$2"; shift 2
  mkdir -p "$STATE"
  # Detached from this script's terminal and pipes, so the script can return
  # while the service keeps running; `setsid` gives it its own process group.
  ( cd "$dir" && exec setsid nohup "$@" ) > "$STATE/$name.log" 2>&1 < /dev/null &
  echo $! > "$STATE/$name.pid"
}

start_api() {
  eval "$(print_env)"
  bash "$ROOT/supabase/scripts/local-db.sh" up
  bash "$ROOT/supabase/scripts/local-db.sh" reset > "$STATE/db.log" 2>&1 || {
    cat "$STATE/db.log" >&2; exit 1; }
  start api "$ROOT/tools/dev-api" pnpm exec tsx src/server.ts
  wait_for "$API_URL/auth/v1/.well-known/jwks.json" 40
  echo "lane $LANE: database $DB_NAME, API $API_URL"
}

# The notification worker (served as the Edge Functions would be) and the fake
# providers it sends to. Nothing here can reach a real provider.
start_notify() {
  eval "$(print_env)"
  for name in fake functions; do
    [ -e "$STATE/$name.pid" ] && { kill -- "-$(cat "$STATE/$name.pid")" 2>/dev/null || true; rm -f "$STATE/$name.pid"; }
  done
  start fake "$ROOT/tools/dev-notify" pnpm exec tsx src/fake-providers.ts
  start functions "$ROOT/tools/dev-notify" pnpm exec tsx src/functions-host.ts
  wait_for "$FAKE_PROVIDERS_URL/_fake/messages" 40
  wait_for "$FUNCTIONS_URL/health" 40
  echo "lane $LANE: notifications $FUNCTIONS_URL, fake providers $FAKE_PROVIDERS_URL"
}

case "$COMMAND" in
  env)
    print_env
    ;;

  api)
    mkdir -p "$STATE"; stop_all
    start_api
    ;;

  up)
    mkdir -p "$STATE"; stop_all
    start_api
    for app in "${APPS[@]}"; do
      [ -d "$ROOT/apps/$app" ] || continue
      {
        echo "# Written by tools/dev/stack.sh for lane $LANE. Local values only; nothing here is secret."
        echo "NEXT_PUBLIC_SUPABASE_URL=$API_URL"
        echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$API_KEY"
        echo "NEXT_PUBLIC_SITE_URL=http://localhost:$(app_port "$app")"
        echo "NEXT_PUBLIC_SHOP_URL=http://localhost:$(app_port web)"
      } > "$ROOT/apps/$app/.env.local"
    done
    echo "lane $LANE: building the apps (log: $STATE/build.log)"
    ( cd "$ROOT" && pnpm build > "$STATE/build.log" 2>&1 ) || { tail -40 "$STATE/build.log" >&2; exit 1; }
    for app in "${APPS[@]}"; do
      [ -d "$ROOT/apps/$app" ] || continue
      start "$app" "$ROOT/apps/$app" pnpm exec next start --port "$(app_port "$app")"
    done
    for app in "${APPS[@]}"; do
      [ -d "$ROOT/apps/$app" ] || continue
      wait_for "http://127.0.0.1:$(app_port "$app")/ingresar" 60
      echo "lane $LANE: $app on http://127.0.0.1:$(app_port "$app")"
    done
    start_notify
    ;;

  notify)
    mkdir -p "$STATE"
    start_notify
    ;;

  e2e)
    shift; [ $# -gt 0 ] && shift
    eval "$(print_env)"
    ( cd "$ROOT" && pnpm --filter @yuntera/e2e journeys "$@" )
    ;;

  down)
    stop_all
    echo "lane $LANE: stopped"
    ;;

  status)
    print_env | sed 's/^export /  /'
    for pidfile in "$STATE"/*.pid; do
      [ -e "$pidfile" ] || continue
      name="$(basename "$pidfile" .pid)"
      if kill -0 "$(cat "$pidfile")" 2>/dev/null; then echo "  $name: running"; else echo "  $name: stopped"; fi
    done
    ;;

  *)
    sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
