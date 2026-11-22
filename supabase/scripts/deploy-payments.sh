#!/usr/bin/env bash
# Deploys the payments Edge Functions to a hosted Supabase project and sets
# their non-secret settings, through Supabase's Management API. No Supabase
# command line is needed. Same shape as deploy-notifications.sh.
#
#   deploy-payments.sh check  <project-ref>   which settings and secrets the project still lacks
#   deploy-payments.sh config <project-ref>   set the non-secret settings from the environment (below)
#   deploy-payments.sh deploy <project-ref>   upload payments-worker and payments-webhook
#
# Authentication: set SUPABASE_ACCESS_TOKEN to a personal access token of an
# account that can reach the project (as for remote-db.sh).
#
# `config` reads these from the environment and sends only those that are set:
#   PAYMENTS_ENV PAYMENTS_API_URL PAYMENTS_SHOP_URL PAYMENTS_APP_SCHEME
#   ONVO_API_URL ONVO_ACCOUNT_ID ONVO_SINPE_NUMBER PAYMENTS_PROVIDER_TIMEOUT_MS
#
# Secrets are never handled by this script and never belong in the repository.
# Set them in the dashboard (Settings > Edge Functions > Secrets):
#   PAYMENTS_SECRET_KEY PAYMENTS_WORKER_TOKEN ONVO_SECRET_KEY ONVO_WEBHOOK_SECRETS
# See docs/06-operations/payments.md for every step before the first charge.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMAND="${1:-}"
REF="${2:-}"
API="https://api.supabase.com/v1/projects/$REF"
FUNCTIONS=(payments-worker payments-webhook)
SETTINGS=(PAYMENTS_ENV PAYMENTS_API_URL PAYMENTS_SHOP_URL PAYMENTS_APP_SCHEME ONVO_API_URL
  ONVO_ACCOUNT_ID ONVO_SINPE_NUMBER PAYMENTS_PROVIDER_TIMEOUT_MS)
SECRETS=(PAYMENTS_SECRET_KEY PAYMENTS_WORKER_TOKEN ONVO_SECRET_KEY ONVO_WEBHOOK_SECRETS)
# Without these the functions do not start; the others fall back to defaults.
REQUIRED=(PAYMENTS_ENV PAYMENTS_API_URL PAYMENTS_SECRET_KEY PAYMENTS_WORKER_TOKEN
  ONVO_SECRET_KEY ONVO_WEBHOOK_SECRETS)

[ -n "$COMMAND" ] && [ -n "$REF" ] || { sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || { echo "That does not look like a project ref." >&2; exit 2; }

AUTH=()
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")

call() { # method, path, curl arguments…
  local method="$1" path="$2"; shift 2
  local response status
  response="$(curl -sS -m 180 -X "$method" "$API$path" "${AUTH[@]}" "$@" -w $'\n%{http_code}')"
  status="${response##*$'\n'}"
  response="${response%$'\n'*}"
  if [ "${status:0:1}" != "2" ]; then
    echo "$method $path → $status: ${response:0:500}" >&2
    return 1
  fi
  printf '%s' "$response"
}

secret_names() {
  call GET /secrets | node -e '
    let raw = ""; process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => { for (const s of JSON.parse(raw || "[]")) console.log(s.name); });'
}

case "$COMMAND" in
  check)
    present="$(secret_names)"
    missing=0
    for name in "${SECRETS[@]}" "${SETTINGS[@]}"; do
      if grep -qx "$name" <<<"$present"; then
        echo "set      $name"
      elif printf '%s\n' "${REQUIRED[@]}" | grep -qx "$name"; then
        echo "MISSING  $name (required)"; missing=1
      else
        echo "default  $name"
      fi
    done
    [ "$missing" = 0 ] || exit 1
    ;;

  config)
    if [ -n "${PAYMENTS_ENV:-}" ] && [ "$PAYMENTS_ENV" != "test" ] && [ "$PAYMENTS_ENV" != "live" ]; then
      echo "PAYMENTS_ENV must be test or live." >&2; exit 2
    fi
    body="$(node -e '
      const names = process.argv.slice(1);
      const out = names.filter((n) => process.env[n]).map((n) => ({ name: n, value: process.env[n] }));
      process.stdout.write(JSON.stringify(out));' "${SETTINGS[@]}")"
    [ "$body" != "[]" ] || { echo "None of the settings is set in the environment." >&2; exit 1; }
    for name in "${SECRETS[@]}"; do
      grep -q "\"$name\"" <<<"$body" && { echo "Refusing to send the secret $name from here." >&2; exit 1; }
    done
    call POST /secrets -H "content-type: application/json" --data-binary "$body" >/dev/null
    node -e 'for (const s of JSON.parse(process.argv[1])) console.log(`set      ${s.name}`);' "$body"
    ;;

  deploy)
    # Each function is its entry file plus the payments package it imports,
    # uploaded with paths relative to the repository root so the relative
    # import ../../../packages/payments/src/index.ts resolves.
    cd "$ROOT"
    mapfile -t shared < <(find packages/payments/src -name '*.ts' ! -name '*.test.ts' | sort)
    for fn in "${FUNCTIONS[@]}"; do
      entry="supabase/functions/$fn/index.ts"
      [ -f "$entry" ] || { echo "Missing $entry" >&2; exit 1; }
      form=(-F "metadata={\"name\":\"$fn\",\"entrypoint_path\":\"$entry\",\"verify_jwt\":false};type=application/json")
      for file in "$entry" "${shared[@]}"; do
        form+=(-F "file=@$file;filename=$file;type=application/typescript")
      done
      call POST "/functions/deploy?slug=$fn" "${form[@]}" >/dev/null
      echo "deployed $fn (verify_jwt off: its signature or token is the authentication)"
    done
    echo "Webhook address for ONVO's Dashboard: https://$REF.supabase.co/functions/v1/payments-webhook"
    ;;

  *)
    sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
