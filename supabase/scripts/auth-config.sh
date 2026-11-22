#!/usr/bin/env bash
# Applies the sign-in configuration of an environment to a hosted Supabase
# project, through Supabase's Management API: the e-mail templates and their
# subjects (supabase/templates), and the sign-in settings
# (supabase/auth/<environment>.json). Configuration as code: what the project
# runs is what this repository says.
#
#   auth-config.sh plan  <project-ref> <preview|production>   print what would change; sends nothing
#   auth-config.sh apply <project-ref> <preview|production>   send it, then read it back and compare
#
# Authentication: SUPABASE_ACCESS_TOKEN, as for remote-db.sh. (Where a network
# proxy already adds the credential for api.supabase.com, leave it unset.)
# Settings files may name environment variables as ${NAME}; the script stops if
# one is unset.
#
# `apply` reads the current configuration first and prints only the names of
# the fields it changes (the full object holds secrets such as SMTP passwords;
# nothing is printed from it). Templates are sent as the layout
# (_layout.html) with each template's content in place of its CONTENT marker,
# exactly as the local stand-in renders them. After sending, it reads the
# configuration back and lists any field that did not take the value sent:
# a field name the API does not know is ignored rather than refused.
#
# `apply` with "preview" weakens a project on purpose (e-mail confirmation may
# be off, the redirect list allows preview addresses), so it asks for
# YUNTERA_PREVIEW_CONFIRM set to the project reference, as `remote-db.sh seed`
# does: preview settings can never land on production by a mistyped reference.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-}"
REF="${2:-}"
ENVIRONMENT="${3:-}"
API="https://api.supabase.com/v1/projects/$REF/config/auth"

usage() { sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }
[ -n "$COMMAND" ] && [ -n "$REF" ] && [ -n "$ENVIRONMENT" ] || usage
[[ "$COMMAND" =~ ^(plan|apply)$ ]] || usage
[ -f "$ROOT/auth/$ENVIRONMENT.json" ] || { echo "No settings file supabase/auth/$ENVIRONMENT.json" >&2; exit 2; }
if [ "$COMMAND" = "apply" ] && [ "$ENVIRONMENT" = "preview" ] && [ "${YUNTERA_PREVIEW_CONFIRM:-}" != "$REF" ]; then
  echo "Refusing: this applies the PREVIEW sign-in settings to $REF. If that project is a preview," >&2
  echo "set YUNTERA_PREVIEW_CONFIRM=$REF and run again." >&2
  exit 1
fi

auth_config() {
  [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_ACCESS_TOKEN"
}

# The PATCH body: settings with ${NAME} resolved, plus every template.
body="$(node - "$ROOT" "$ENVIRONMENT" <<'NODE'
const { readFileSync } = require("node:fs");
const [root, environment] = process.argv.slice(2);
const file = JSON.parse(readFileSync(`${root}/auth/${environment}.json`, "utf8"));
const resolve = (value) =>
  typeof value !== "string"
    ? value
    : value.replace(/\$\{(\w+)\}/g, (_, name) => {
        const found = process.env[name];
        if (!found) {
          console.error(`${name} is not set (needed by supabase/auth/${environment}.json)`);
          process.exit(1);
        }
        return found;
      });
const body = {};
for (const [key, value] of Object.entries(file.settings)) body[key] = resolve(value);

const catalogue = JSON.parse(readFileSync(`${root}/templates/templates.json`, "utf8"));
const layout = readFileSync(`${root}/templates/${catalogue.layout}`, "utf8");
for (const [name, entry] of Object.entries(catalogue.templates)) {
  const content = layout.replace("<!-- CONTENT -->", readFileSync(`${root}/templates/${entry.file}`, "utf8"));
  // "recovery" → mailer_*_recovery; "password_changed_notification" → mailer_*_password_changed_notification
  body[`mailer_subjects_${name}`] = entry.subject;
  body[`mailer_templates_${name}_content`] = content;
  const notification = /^(.*)_notification$/.exec(name);
  if (notification) body[`mailer_notifications_${notification[1]}_enabled`] = Boolean(file.notifications);
}
process.stdout.write(JSON.stringify(body));
NODE
)"

fetch_current() {
  curl -sS -m 60 --fail-with-body "$API" --config <(auth_config)
}

# Names of the fields whose current value differs from the body.
changed_fields() { # current-json
  node -e '
    const [current, wanted] = [JSON.parse(process.argv[1]), JSON.parse(process.argv[2])];
    const differs = Object.keys(wanted).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(wanted[k]));
    console.log(differs.length ? differs.join("\n") : "(nothing)");
  ' "$1" "$body"
}

# Supabase refuses any change to the e-mail templates or subjects while a
# project sends with its built-in sender on the free plan ("Email template
# modification is not available for free tier projects using the default email
# provider"), and refuses the whole request with them. Until custom SMTP is
# set (here or already on the project), send the settings alone and say so.
fit_to_project() { # current-json
  local fitted
  fitted="$(node -e '
    const [current, wanted] = [JSON.parse(process.argv[1]), JSON.parse(process.argv[2])];
    if (current.smtp_host || wanted.smtp_host) { process.stdout.write(JSON.stringify(wanted)); process.exit(0); }
    const kept = Object.fromEntries(Object.entries(wanted).filter(([k]) => !/^mailer_(subjects|templates)_/.test(k)));
    process.stdout.write(JSON.stringify(kept));
  ' "$1" "$body")"
  if [ "$fitted" != "$body" ]; then
    echo "NOT SENT: the e-mail templates and subjects. This project uses Supabase's built-in sender,"
    echo "which on the free plan does not allow changing them; they are applied once custom SMTP is set."
  fi
  body="$fitted"
}

case "$COMMAND" in
  plan)
    if current="$(fetch_current 2>/dev/null)"; then
      fit_to_project "$current"
      echo "Fields that would change on $REF ($ENVIRONMENT):"
      changed_fields "$current"
    else
      echo "Could not read the project's configuration; fields that would be sent:"
      node -e 'console.log(Object.keys(JSON.parse(process.argv[1])).join("\n"))' "$body"
    fi
    ;;

  apply)
    current="$(fetch_current)"
    fit_to_project "$current"
    echo "Changing on $REF ($ENVIRONMENT):"
    changed_fields "$current"
    # On a refusal, show the API's message (an error answer carries no settings).
    if ! response="$(curl -sS -m 120 --fail-with-body -X PATCH "$API" --config <(auth_config) \
      -H "content-type: application/json" --data-binary @- <<<"$body")"; then
      node -e 'try { const e = JSON.parse(process.argv[1]); console.error(e.message ?? e.msg ?? process.argv[1]); } catch { console.error(process.argv[1].slice(0, 500)); }' "$response" >&2
      exit 1
    fi
    after="$(fetch_current)"
    echo "Fields that still differ after applying (unknown to the API, or refused):"
    changed_fields "$after"
    ;;
esac
