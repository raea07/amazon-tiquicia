// The test ids are the contract between the phone apps and their journeys.
// Each list here (shop.json, seller.json, driver.json, warehouse.json,
// expo-kit.json) holds every testID written in that package's src/, sorted,
// with the files it is in. This check fails when an id in a list is no longer
// in the source: a rebuilt screen may add ids, but it may drop or rename one
// only by changing the list in the same commit (SISTEMA.md §20.5 rule 2).
//
//   node tools/native-e2e/testids/check.mjs            check (the runner calls this)
//   node tools/native-e2e/testids/check.mjs --write    rewrite the lists from the source
//
// An id is the literal text of a value given to `testID` or `testIDPrefix`:
// a string ("sign-out") or a template as written (`product-${slug}`). A value
// that only passes another variable on (`testID={testID}`) names no id.
// Test files (*.test.ts, *.test.tsx) are not read.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));

export const PACKAGES = {
  shop: "apps/shop-native/src",
  seller: "apps/seller-native/src",
  driver: "apps/driver-native/src",
  warehouse: "apps/warehouse-native/src",
  "expo-kit": "packages/expo-kit/src",
};

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** The end (exclusive) of a quoted string or template that starts at `i`. */
function endOfQuoted(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") j += 2;
    else if (c === quote) return j + 1;
    else if (quote === "`" && c === "$" && text[j + 1] === "{") j = endOfBraces(text, j + 1);
    else j += 1;
  }
  return j;
}

/** The end (exclusive) of a `{ … }` block that starts at `i`, skipping strings. */
function endOfBraces(text, i) {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === "'" || c === "`") {
      j = endOfQuoted(text, j);
      continue;
    }
    if (c === "{") depth += 1;
    if (c === "}") {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
    j += 1;
  }
  return j;
}

/** Every string and template literal inside an expression, as written. */
function literalsIn(expression) {
  const out = [];
  let j = 0;
  while (j < expression.length) {
    const c = expression[j];
    if (c === '"' || c === "'" || c === "`") {
      const end = endOfQuoted(expression, j);
      out.push(expression.slice(j + 1, end - 1));
      j = end;
    } else j += 1;
  }
  return out;
}

/** The ids written in one source text. */
export function idsIn(text) {
  const ids = [];
  const name = /\btestID(Prefix)?\b/g;
  for (let match = name.exec(text); match; match = name.exec(text)) {
    let i = match.index + match[0].length;
    while (/\s/.test(text[i] ?? "")) i += 1;
    // `testID=` (a prop or a default value) or `testID:` (an object key);
    // not `testID?:` (a type), `testID ===` or `testID =>`.
    const isProp = text[i] === "=" && text[i + 1] !== "=" && text[i + 1] !== ">";
    const isKey = text[i] === ":";
    if (!isProp && !isKey) continue;
    i += 1;
    while (/\s/.test(text[i] ?? "")) i += 1;
    const c = text[i];
    let value = "";
    if (c === '"' || c === "'" || c === "`") value = text.slice(i, endOfQuoted(text, i));
    else if (c === "{") value = text.slice(i + 1, endOfBraces(text, i) - 1);
    else {
      // An object value or a default: read to the end of the expression.
      const end = text.slice(i).search(/[,;\n})]/);
      value = text.slice(i, end === -1 ? undefined : i + end);
    }
    for (const id of literalsIn(value)) if (id !== "") ids.push(id);
  }
  return ids;
}

/** id → sorted list of files (relative to the repository root) for one package. */
export function measure(pkg) {
  const found = new Map();
  for (const file of sourceFiles(join(root, PACKAGES[pkg]))) {
    const rel = relative(root, file);
    for (const id of idsIn(readFileSync(file, "utf8"))) {
      if (!found.has(id)) found.set(id, new Set());
      found.get(id).add(rel);
    }
  }
  return new Map(
    [...found.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, files]) => [id, [...files].sort()]),
  );
}

export function listPath(pkg) {
  return join(here, `${pkg}.json`);
}

export function readList(pkg) {
  return JSON.parse(readFileSync(listPath(pkg), "utf8"));
}

function render(pkg, ids) {
  const list = {
    package: PACKAGES[pkg].replace(/\/src$/, ""),
    note: "Every testID in this package's src/. Generated by check.mjs --write; an id may be removed only in the same commit as the screen and the helper that change it.",
  };
  // Written the way the repository's formatter writes JSON, so --write leaves
  // nothing for lint to change: a list of files on one line when it fits.
  const entries = [...ids.entries()].map(([id, files]) => {
    const inline = `      "files": [${files.map((f) => JSON.stringify(f)).join(", ")}]`;
    const filesText =
      inline.length <= 100
        ? inline
        : `      "files": [\n${files.map((f) => `        ${JSON.stringify(f)}`).join(",\n")}\n      ]`;
    return `    {\n      "id": ${JSON.stringify(id)},\n${filesText}\n    }`;
  });
  return [
    "{",
    `  "package": ${JSON.stringify(list.package)},`,
    `  "note": ${JSON.stringify(list.note)},`,
    `  "ids": [\n${entries.join(",\n")}\n  ]`,
    "}",
    "",
  ].join("\n");
}

/** Problems for one package: ids in the list that the source no longer has. */
export function problems(pkg) {
  const now = measure(pkg);
  const listed = readList(pkg).ids;
  const missing = listed.filter((entry) => !now.has(entry.id)).map((entry) => entry.id);
  const added = [...now.keys()].filter((id) => !listed.some((entry) => entry.id === id));
  return { missing, added, now, listed };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const write = process.argv.includes("--write");
  let failed = false;
  for (const pkg of Object.keys(PACKAGES)) {
    if (write) {
      const ids = measure(pkg);
      writeFileSync(listPath(pkg), render(pkg, ids));
      const uses = [...ids.values()].reduce((n, files) => n + files.length, 0);
      console.info(`testids ${pkg}: wrote ${ids.size} ids (${uses} id-file pairs)`);
      continue;
    }
    const { missing, added, listed } = problems(pkg);
    if (missing.length > 0) {
      failed = true;
      console.error(
        `testids ${pkg}: ${missing.length} id(s) in ${pkg}.json are no longer in ${PACKAGES[pkg]}: ${missing.join(", ")}`,
      );
    } else {
      const extra =
        added.length > 0 ? `; ${added.length} new, not listed yet: ${added.join(", ")}` : "";
      console.info(`testids ${pkg}: all ${listed.length} listed ids are in the source${extra}`);
    }
  }
  if (failed) {
    console.error(
      "A testID was dropped or renamed. Keep it on the element that does the same job, or change the list, the screen and the app's helper in one commit.",
    );
    process.exit(1);
  }
}
