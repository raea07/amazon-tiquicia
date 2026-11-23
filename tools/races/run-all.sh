#!/usr/bin/env bash
# Runs every race family against one lane's local database, one family after another.
#   tools/races/run-all.sh <database-url> [rounds] [tag] [out-dir]
# Writes <out-dir>/<tag>-<family>.txt (one line per scenario) and .jsonl.
# <out-dir> defaults to tools/races/results (ignored by git). Set ONLY to a
# scenario regex to run part of each family, FAMILIES to a list of family
# letters (e.g. "C E") to run only those.
set -euo pipefail
cd "$(dirname "$0")"
URL="${1:?database url}"
ROUNDS="${2:-100}"
TAG="${3:-$(basename "$URL")}"
OUT="${4:-results}"
mkdir -p "$OUT"
for f in race-a-known-deadlocks race-b-sweep race-c-sort-keys race-d-confirm-table \
  race-e-product-rows race-f-stale-summary race-g-recall-route; do
  letter="${f#race-}"
  letter="${letter:0:1}"
  letter="${letter^^}"
  if [ -n "${FAMILIES:-}" ] && [[ " $FAMILIES " != *" $letter "* ]]; then continue; fi
  RACE_JSON="$OUT/$TAG-$f.jsonl" node "$f.cjs" "$URL" "$ROUNDS" ${ONLY:+"$ONLY"} >"$OUT/$TAG-$f.txt" 2>&1 \
    || echo "$f exited with $?" >>"$OUT/$TAG-$f.txt"
done
