#!/usr/bin/env bash
# Deploys the notification Edge Functions to a hosted Supabase project and sets
# their non-secret settings, through Supabase's Management API. No Supabase
# command line is needed.
#
#   deploy-notifications.sh check  <project-ref>   which settings and secrets the project still lacks
#   deploy-notifications.sh config <project-ref>   set the non-secret settings from the environment (below)
#   deploy-notifications.sh deploy <project-ref>   upload notify-worker, bird-webhook and auth-email
#
# Authentication: set SUPABASE_ACCESS_TOKEN to a personal access token of an
# account that can reach the project (as for remote-db.sh).
#
# `config` reads these from the environment and sends only those that are set:
#   NOTIFY_ENV NOTIFY_API_URL NOTIFY_SHOP_URL NOTIFY_SELLER_URL NOTIFY_OPS_URL
#   NOTIFY_FIELD_URL NOTIFY_SENDING_DOMAIN NOTIFY_REPLY_TO NOTIFY_LEGAL_NAME
#   NOTIFY_LEGAL_ID NOTIFY_POSTAL_ADDRESS NOTIFY_QUIET_HOURS BIRD_API_URL
#   BIRD_WHATSAPP_FROM BIRD_WHATSAPP_LANGUAGE BIRD_SMS_FROM EXPO_PUSH_URL
#
# Secrets are never handled by this script and never belong in the repository.
# Set them in the dashboard (Settings > Edge Functions > Secrets):
#   NOTIFY_SECRET_KEY NOTIFY_WORKER_TOKEN BIRD_API_KEY BIRD_WEBHOOK_SECRETS
#   SEND_EMAIL_HOOK_SECRETS EXPO_ACCESS_TOKEN
# See docs/06-operations/notifications.md for every step before the first send.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMAND="${1:-}"
REF="${2:-}"
API="https://api.supabase.com/v1/projects/$REF"
FUNCTIONS=(notify-worker bird-webhook auth-email)
SETTINGS=(NOTIFY_ENV NOTIFY_API_URL NOTIFY_SHOP_URL NOTIFY_SELLER_URL NOTIFY_OPS_URL
  NOTIFY_FIELD_URL NOTIFY_SENDING_DOMAIN NOTIFY_REPLY_TO NOTIFY_LEGAL_NAME NOTIFY_LEGAL_ID
  NOTIFY_POSTAL_ADDRESS NOTIFY_QUIET_HOURS BIRD_API_URL BIRD_WHATSAPP_FROM
  BIRD_WHATSAPP_LANGUAGE BIRD_SMS_FROM EXPO_PUSH_URL)
SECRETS=(NOTIFY_SECRET_KEY NOTIFY_WORKER_TOKEN BIRD_API_KEY BIRD_WEBHOOK_SECRETS
  SEND_EMAIL_HOOK_SECRETS EXPO_ACCESS_TOKEN)

[ -n "$COMMAND" ] && [ -n "$REF" ] || { sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || { echo "That does not look like a project ref." >&2; exit 2; }

AUTH=()
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")

# Prints the response body; fails with the API's message on an error status.
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
      if grep -qx "$name" <<<"$present"; then echo "set      $name"; else echo "MISSING  $name"; missing=1; fi
    done
    [ "$missing" = 0 ] || echo "Optional settings fall back to the defaults in packages/notifications/src/config.ts." >&2
    ;;

  config)
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
    # Each function is its entry file plus the notifications package it imports,
    # uploaded with paths relative to the repository root so the relative
    # import ../../../packages/notifications/src/index.ts resolves.
    cd "$ROOT"
    mapfile -t shared < <(find packages/notifications/src -name '*.ts' ! -name '*.test.ts' | sort)
    for fn in "${FUNCTIONS[@]}"; do
      entry="supabase/functions/$fn/index.ts"
      [ -f "$entry" ] || { echo "Missing $entry" >&2; exit 1; }
      form=(-F "metadata={\"name\":\"$fn\",\"entrypoint_path\":\"$entry\",\"verify_jwt\":false};type=application/json")
      for file in "$entry" "${shared[@]}"; do
        form+=(-F "file=@$file;filename=$file;type=application/typescript")
      done
      call POST "/functions/deploy?slug=$fn" "${form[@]}" >/dev/null
      echo "deployed $fn (verify_jwt off: its token or signature is the authentication)"
    done
    echo "Functions at https://$REF.supabase.co/functions/v1/{notify-worker,bird-webhook,auth-email}"
    ;;

  *)
    sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
