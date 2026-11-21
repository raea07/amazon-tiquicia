#!/usr/bin/env bash
# Runs the whole local stack — database, API stand-in and the web apps — in a
# numbered "lane", so several checkouts (git worktrees, CI jobs, two people on
# one machine) can each have their own without colliding.
#
#   tools/dev/stack.sh up [lane]              database + API + build + start the apps
#   tools/dev/stack.sh api [lane]             database + API only (enough for most tests)
#   tools/dev/stack.sh env [lane]             print the lane's settings as `export` lines
#   tools/dev/stack.sh e2e [lane] [journey…]  run browser journeys against the lane
#   tools/dev/stack.sh down [lane]            stop what `up`/`api` started
#   tools/dev/stack.sh status [lane]
#   tools/dev/stack.sh native [lane] [app…]          web export of the native apps, served
#   tools/dev/stack.sh native-e2e [lane] [journey…]  run the native journeys against them
#
# Lane 0 (the default) is the usual setup: database yuntera_local, API on
# :54321, apps on :3000–:3003. Lane N (1–9) uses database yuntera_lane<N>, API
# on :544<N>0 and apps on :3<N>00–:3<N>03. Lanes 10–19 use database
# yuntera_lane<N>, API on :546<N-10>0 and apps on :4<N-10>00–:4<N-10>03.
#
# The apps read the API address when they are BUILT, so each lane builds its own
# copy; `up` writes apps/*/.env.local for the lane before building.
#
# `native` builds the WEB EXPORT of the native apps (apps/*-native) for the
# lane, into .lane/<lane>/native/<app>, and serves each on the lane's first app
# port plus 10 to 13 (shop +10, seller +11, driver +12, warehouse +13: lane 0
# :3010–:3013, lane 5 :3510–:3513, lane 12 :4210–:4213).
# It starts the database and the API first if the lane's API is not answering
# (which resets that lane's database), and leaves them alone if it is.
# `native-e2e` runs tools/native-e2e/journeys against those exports. `down`
# stops them with everything else.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMAND="${1:-}"
LANE="${2:-0}"
[[ "$LANE" =~ ^1?[0-9]$ ]] || { echo "Lane must be a number from 0 to 19." >&2; exit 2; }

if [ "$LANE" = "0" ]; then
  DB_NAME="yuntera_local"; API_PORT=54321; APP_BASE=3000
elif [ "$LANE" -le 9 ]; then
  DB_NAME="yuntera_lane${LANE}"; API_PORT="544${LANE}0"; APP_BASE="3${LANE}00"
else
  DB_NAME="yuntera_lane${LANE}"; API_PORT="546${LANE#1}0"; APP_BASE="4${LANE#1}00"
fi
ADMIN_URL="${PG_ADMIN_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
DB_URL="${ADMIN_URL%/*}/${DB_NAME}"
API_URL="http://127.0.0.1:${API_PORT}"
API_KEY="sb_publishable_local_development_only"
# Lets the seller centre, the console and the journeys ask the shop to drop its cached
# catalogue (apps/web/src/app/api/catalogo/refrescar). A local value, not a secret.
REFRESH_KEY="local-refresh-key-lane-${LANE}"
STATE="$ROOT/.lane/$LANE"
APPS=(web seller ops field)
NATIVE_APPS=(shop seller driver warehouse)
NATIVE_BASE=$((APP_BASE + 10))

app_port() { # app name → port
  local index=0
  for app in "${APPS[@]}"; do
    [ "$app" = "$1" ] && { echo $((APP_BASE + index)); return; }
    index=$((index + 1))
  done
}

native_port() { # native app name → port
  local index=0
  for app in "${NATIVE_APPS[@]}"; do
    [ "$app" = "$1" ] && { echo $((NATIVE_BASE + index)); return; }
    index=$((index + 1))
  done
}

print_native_env() {
  for app in "${NATIVE_APPS[@]}"; do
    echo "export NATIVE_$(echo "$app" | tr '[:lower:]' '[:upper:]')_URL=http://127.0.0.1:$(native_port "$app")"
  done
}

print_env() {
  cat <<ENV
export PG_DB_NAME=$DB_NAME
export DATABASE_URL=$DB_URL
export DEV_API_PORT=$API_PORT
export API_URL=$API_URL
export API_KEY=$API_KEY
export SHOP_REFRESH_KEY=$REFRESH_KEY
export NEXT_PUBLIC_SUPABASE_URL=$API_URL
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$API_KEY
export EXPO_PUBLIC_SUPABASE_URL=$API_URL
export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$API_KEY
export WEB_URL=http://127.0.0.1:$(app_port web)
export DEV_SITE_URL=http://localhost:$(app_port web)
export SELLER_URL=http://127.0.0.1:$(app_port seller)
export OPS_URL=http://127.0.0.1:$(app_port ops)
export FIELD_URL=http://127.0.0.1:$(app_port field)
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

case "$COMMAND" in
  env)
    print_env
    print_native_env
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
        echo "SHOP_REFRESH_KEY=$REFRESH_KEY"
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
    ;;

  e2e)
    shift; [ $# -gt 0 ] && shift
    eval "$(print_env)"
    ( cd "$ROOT" && pnpm --filter @yuntera/e2e journeys "$@" )
    ;;

  native)
    shift; [ $# -gt 0 ] && shift
    chosen=("$@"); [ ${#chosen[@]} -gt 0 ] || chosen=("${NATIVE_APPS[@]}")
    mkdir -p "$STATE/native"
    eval "$(print_env)"
    curl -sf -o /dev/null "$API_URL/health" || start_api
    for app in "${chosen[@]}"; do
      [ -n "$(native_port "$app")" ] && [ -d "$ROOT/apps/$app-native" ] || {
        echo "No native app called \"$app\" (choose from: ${NATIVE_APPS[*]})." >&2; exit 2; }
      if [ -e "$STATE/native-$app.pid" ]; then
        kill -- "-$(cat "$STATE/native-$app.pid")" 2>/dev/null || true
        rm -f "$STATE/native-$app.pid"
      fi
      echo "lane $LANE: exporting $app-native for the web (log: $STATE/native-$app-export.log)"
      # EXPO_PUBLIC_SHOP_URL is left empty: product pictures then come from
      # the same origin, where the server below reads them from apps/web/public.
      ( cd "$ROOT/apps/$app-native" && CI=1 EXPO_PUBLIC_SUPABASE_URL="$API_URL" \
          EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$API_KEY" EXPO_PUBLIC_SHOP_URL="" \
          pnpm exec expo export --platform web --clear --output-dir "$STATE/native/$app" \
          > "$STATE/native-$app-export.log" 2>&1 ) || { tail -40 "$STATE/native-$app-export.log" >&2; exit 1; }
      start "native-$app" "$ROOT" node tools/native-e2e/serve.mjs "$STATE/native/$app" "$(native_port "$app")"
      wait_for "http://127.0.0.1:$(native_port "$app")/" 20
      echo "lane $LANE: $app-native (web export) on http://127.0.0.1:$(native_port "$app")"
    done
    ;;

  native-e2e)
    shift; [ $# -gt 0 ] && shift
    eval "$(print_env)"
    eval "$(print_native_env)"
    export NATIVE_SHOTS="${NATIVE_SHOTS:-$ROOT/tools/native-e2e/screenshots}"
    ( cd "$ROOT" && pnpm --filter @yuntera/native-e2e journeys "$@" )
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
    sed -n '2,/^set -e/{/^set -e/!p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
