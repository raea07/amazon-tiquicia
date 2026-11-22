#!/usr/bin/env bash
# Deploys the electronic-invoice Edge Functions to a hosted Supabase project
# and sets their non-secret settings, through Supabase's Management API, in
# the same way as deploy-notifications.sh. No Supabase command line is needed.
# Never run as part of development or tests: it acts on a real project.
#
#   deploy-invoicing.sh check  <project-ref>   which settings and secrets the project still lacks
#   deploy-invoicing.sh config <project-ref>   set the non-secret settings from the environment (below)
#   deploy-invoicing.sh deploy <project-ref>   upload invoice-worker and hacienda-callback
#
# Authentication: set SUPABASE_ACCESS_TOKEN to a personal access token of an
# account that can reach the project (as for remote-db.sh).
#
# `config` reads these from the environment and sends only those that are set:
#   INVOICE_ENV (stag | prod) INVOICE_API_URL HACIENDA_TOKEN_URL HACIENDA_CLIENT_ID
#   HACIENDA_API_URL HACIENDA_CALLBACK_URL HACIENDA_TIMEOUT_MS INVOICE_CERT_DIGEST
#
# Secrets are never handled by this script and never belong in the repository.
# Set them in the dashboard (Settings > Edge Functions > Secrets):
#   INVOICE_SECRET_KEY INVOICE_WORKER_TOKEN HACIENDA_USERNAME HACIENDA_PASSWORD
#   HACIENDA_CALLBACK_TOKEN INVOICE_SIGNING_KEY INVOICE_SIGNING_PIN INVOICE_SIGNING_CERT
# See docs/06-operations/invoicing.md, "Before going live", for every step.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMAND="${1:-}"
REF="${2:-}"
API="https://api.supabase.com/v1/projects/$REF"
FUNCTIONS=(invoice-worker hacienda-callback)
SETTINGS=(INVOICE_ENV INVOICE_API_URL HACIENDA_TOKEN_URL HACIENDA_CLIENT_ID HACIENDA_API_URL
  HACIENDA_CALLBACK_URL HACIENDA_TIMEOUT_MS INVOICE_CERT_DIGEST)
SECRETS=(INVOICE_SECRET_KEY INVOICE_WORKER_TOKEN HACIENDA_USERNAME HACIENDA_PASSWORD
  HACIENDA_CALLBACK_TOKEN INVOICE_SIGNING_KEY INVOICE_SIGNING_PIN INVOICE_SIGNING_CERT)

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
    [ "$missing" = 0 ] || echo "Optional settings fall back to the defaults in packages/invoicing/src/config.ts." >&2
    ;;

  config)
    case "${INVOICE_ENV:-}" in
      ""|stag|prod) ;;
      *) echo "INVOICE_ENV must be stag or prod." >&2; exit 1 ;;
    esac
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
    # Each function is its entry file plus the invoicing package it imports
    # (without its tests and test helpers), uploaded with paths relative to the
    # repository root so the relative import ../../../packages/invoicing/src/index.ts resolves.
    cd "$ROOT"
    mapfile -t shared < <(find packages/invoicing/src -name '*.ts' ! -name '*.test.ts' ! -path '*/testing/*' | sort)
    for fn in "${FUNCTIONS[@]}"; do
      entry="supabase/functions/$fn/index.ts"
      [ -f "$entry" ] || { echo "Missing $entry" >&2; exit 1; }
      form=(-F "metadata={\"name\":\"$fn\",\"entrypoint_path\":\"$entry\",\"verify_jwt\":false};type=application/json")
      for file in "$entry" "${shared[@]}"; do
        form+=(-F "file=@$file;filename=$file;type=application/typescript")
      done
      call POST "/functions/deploy?slug=$fn" "${form[@]}" >/dev/null
      echo "deployed $fn (verify_jwt off: its token is the authentication)"
    done
    echo "Functions at https://$REF.supabase.co/functions/v1/{invoice-worker,hacienda-callback/<token>}"
    ;;

  *)
    sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
