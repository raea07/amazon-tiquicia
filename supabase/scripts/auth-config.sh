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
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-}"
REF="${2:-}"
ENVIRONMENT="${3:-}"
API="https://api.supabase.com/v1/projects/$REF/config/auth"

usage() { sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }
[ -n "$COMMAND" ] && [ -n "$REF" ] && [ -n "$ENVIRONMENT" ] || usage
[[ "$COMMAND" =~ ^(plan|apply)$ ]] || usage
[ -f "$ROOT/auth/$ENVIRONMENT.json" ] || { echo "No settings file supabase/auth/$ENVIRONMENT.json" >&2; exit 2; }

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

case "$COMMAND" in
  plan)
    if current="$(fetch_current 2>/dev/null)"; then
      echo "Fields that would change on $REF ($ENVIRONMENT):"
      changed_fields "$current"
    else
      echo "Could not read the project's configuration; fields that would be sent:"
      node -e 'console.log(Object.keys(JSON.parse(process.argv[1])).join("\n"))' "$body"
    fi
    ;;

  apply)
    current="$(fetch_current)"
    echo "Changing on $REF ($ENVIRONMENT):"
    changed_fields "$current"
    curl -sS -m 120 --fail-with-body -X PATCH "$API" --config <(auth_config) \
      -H "content-type: application/json" --data-binary @- <<<"$body" > /dev/null
    after="$(fetch_current)"
    echo "Fields that still differ after applying (unknown to the API, or refused):"
    changed_fields "$after"
    ;;
esac
