// Counts how the browser journeys find things on screen (rule 20.5.1 of
// docs/brand/system/SISTEMA.md), so the count can be checked and kept at 0:
//
//   node tools/e2e/selectors.mjs           counts per file and in total
//   node tools/e2e/selectors.mjs --list    also prints every class and text selector found
//   node tools/e2e/selectors.mjs --check   exits 1 if any class or text selector is left
//
// A "class selector" is a CSS class inside a selector string (`ul.grid`,
// `.grid > div`). A "text selector" is any way of finding an element by the
// words it contains: `text=…`, `:has-text(…)`, `:text(…)`, `:text-is(…)`,
// `:text-matches(…)`, `getByText(…)`, `hasText` / `hasNotText`. Neither is
// allowed: an element is found by its role and accessible name
// (`getByRole(role, { name })`, the only place product words may be used to
// find something), by `[name=…]` for a form field, or by a `data-testid`.
//
// `xpath=` counts as a text selector too (XPath finds by words with contains()).
//
// Two more columns guard what a selector count cannot see:
// - "jsText": an element picked in JavaScript by its words (its texts read
//   with allInnerTexts/innerText/textContent, then .find/.findIndex/.some/
//   .filter with .includes/.startsWith/.endsWith). Today only the helpers
//   that read packages/ui's Alert do this (kit messageWith, findMessage…),
//   because Alert takes no data-testid; --check fails when the count goes
//   above JS_TEXT_CEILING, and the ceiling goes down as those helpers go.
// - "status": a status word of tools/e2e/lib/words.cjs written as a whole
//   string literal outside words.cjs (a role name in a helper — button(…,
//   "Empacado"), link(…), name: … — is allowed, and so is a line marked
//   `// not a status word`, where the same word labels something else), or
//   as a whole regular expression (`/^Entregado$/`). --check fails above 0.
//
// --check also fails when a journey file finds an element itself
// (getByRole, locator, waitForSelector…): screen steps live in lib/.
//
// The size checks (rule 20.5.3) are counted too, so a change that drops one
// shows up: `scrollWidth` or `overflowPx(` (sideways scroll at a width,
// measured through lib/kit.cjs against the context's screen) and
// `boundingBox` (the size of a control) in the journey files.

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const files = [
  ...readdirSync(`${here}journeys`)
    .filter((f) => f.endsWith(".cjs"))
    .map((f) => `journeys/${f}`),
  ...readdirSync(`${here}lib`)
    .filter((f) => f.endsWith(".cjs"))
    .map((f) => `lib/${f}`),
].sort();

const TEXT =
  /text=|:has-text\(|:text\(|:text-is\(|:text-matches\(|getByText\(|hasText|hasNotText|xpath=/g;
// Texts read, then searched for words to pick one (see "jsText" above).
const JS_TEXT =
  /(?:allInnerTexts|innerText|textContent)[\s\S]{0,240}?\.(?:find|findIndex|some|filter)\(\s*\(?\w+\)?\s*=>[^;]*?\.(?:includes|startsWith|endsWith)\(/g;
// What the helpers that read Alert need today (kit.cjs, web.cjs, field.cjs).
const JS_TEXT_CEILING = 12;
const STATUS_WORDS = new Set(createRequire(import.meta.url)("./lib/words.cjs").allWords());
// A whole string literal, with what comes before it on its line.
const LITERAL = /(^|[^\w])(["'`])((?:(?!\2)[^\\\n]|\\.)*)\2/g;
// A whole regular expression literal (`/^Entregado$/`), anchors and \b left out.
const REGEX_LITERAL = /(?:^|[=(,:!&|?{}[;]|return)\s*\/((?:[^/\\\n]|\\.)+)\/[dgimsuy]*/g;
const regexWord = (body) =>
  body
    .replace(/^\^|\$$/g, "")
    .replace(/\\b/g, "")
    .replace(/\\(.)/g, "$1");
const ROLE_NAME = /(?:\bbutton\(|\blink\(|name:\s*)[^"'`]*$/;
// A selector string handed to Playwright or to the DOM: the first argument
// (a literal '…', "…" or `…`) of a call that takes one.
const SELECTOR_CALL =
  /\b(locator|waitForSelector|click|dblclick|fill|check|uncheck|selectOption|inputValue|innerText|innerHTML|textContent|isVisible|isHidden|isChecked|isEnabled|isDisabled|getAttribute|\$|\$\$|\$eval|\$\$eval|hover|press|setInputFiles|dispatchEvent|focus|tap|type|querySelector|querySelectorAll|closest|matches)\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
// A class inside a CSS selector: a dot right after a tag, a combinator, the
// start of the string, a bracket or a parenthesis, followed by a name.
const CLASS =
  /(?:^|[\s>+~,([\]]|\b[a-z][a-z0-9]*)\.(?!example\b|png\b|jpe?g\b|webp\b|cjs\b|mjs\b|js\b|json\b|html\b|pdf\b|xml\b|svg\b|txt\b|csv\b|md\b|css\b)[a-zA-Z_-][\w-]*/;

// kit.withValue is the one sanctioned text match (a data value, never a
// product word); its own definition is not counted.
const SANCTIONED = /^const withValue = \(/;

const stripComments = (source) =>
  source
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) || SANCTIONED.test(line) ? "" : line))
    .join("\n");

const list = process.argv.includes("--list");
const rows = [];
for (const file of files) {
  const source = stripComments(readFileSync(`${here}${file}`, "utf8"));
  const text = (source.match(TEXT) ?? []).length;
  let classes = 0;
  for (const call of source.matchAll(SELECTOR_CALL)) {
    // Interpolations and quoted attribute values are data, not selector syntax.
    const selector = call[2]
      .slice(1, -1)
      .replace(/\$\{[^}]*\}/g, "x")
      .replace(/"[^"]*"|'[^']*'/g, '""');
    if (CLASS.test(selector)) {
      classes += 1;
      if (list) console.log(`${file}: class  ${call[2].slice(0, 100)}`);
    }
  }
  if (list) {
    for (const line of source.split("\n")) {
      if (TEXT.test(line)) console.log(`${file}: text   ${line.trim().slice(0, 100)}`);
      TEXT.lastIndex = 0;
    }
  }
  const jsText = (source.match(JS_TEXT) ?? []).length;
  let status = 0;
  if (file !== "lib/words.cjs") {
    for (const line of source.split("\n")) {
      for (const m of line.matchAll(LITERAL)) {
        if (!STATUS_WORDS.has(m[3])) continue;
        const before = line.slice(0, m.index + m[1].length);
        if (file.startsWith("lib/") && ROLE_NAME.test(before)) continue;
        // The same word used for something that is not a state (a tile's label).
        if (line.includes("// not a status word")) continue;
        status += 1;
        if (list) console.log(`${file}: status ${line.trim().slice(0, 100)}`);
      }
      for (const m of line.matchAll(REGEX_LITERAL)) {
        if (!STATUS_WORDS.has(regexWord(m[1]))) continue;
        if (line.includes("// not a status word")) continue;
        status += 1;
        if (list) console.log(`${file}: status ${line.trim().slice(0, 100)}`);
      }
    }
  }
  const role = (source.match(/getByRole\(/g) ?? []).length;
  const testid = (source.match(/data-testid|getByTestId\(|\btestid\(/g) ?? []).length;
  const scroll = file.startsWith("journeys/")
    ? (source.match(/scrollWidth|overflowPx\(/g) ?? []).length
    : 0;
  const box = file.startsWith("journeys/") ? (source.match(/boundingBox\(/g) ?? []).length : 0;
  // An element found in a journey file instead of a helper (rule 1 of README.md).
  const lookup = file.startsWith("journeys/")
    ? (
        source.match(
          /getByRole\(|\.locator\(|getBy(?:Label|Text|TestId|Placeholder)\(|waitForSelector\(|\$\$?\(/g,
        ) ?? []
      ).length
    : 0;
  rows.push({ file, classes, text, jsText, status, role, testid, scroll, box, lookup });
}

const total = rows.reduce(
  (sum, r) => {
    for (const key of Object.keys(sum)) sum[key] += r[key];
    return sum;
  },
  { classes: 0, text: 0, jsText: 0, status: 0, role: 0, testid: 0, scroll: 0, box: 0 },
);

const pad = (value, width) => String(value).padStart(width);
const line = (name, r) =>
  `${name.padEnd(34)} ${pad(r.classes, 5)} ${pad(r.text, 5)} ${pad(r.jsText, 6)} ${pad(r.status, 6)} ${pad(r.role, 5)} ${pad(r.testid, 7)} ${pad(r.scroll, 12)} ${pad(r.box, 12)}`;
console.log(
  `${"file".padEnd(34)} class  text jsText status  role  testid  scrollWidth  boundingBox`,
);
for (const r of rows) console.log(line(r.file, r));
console.log(line("total", total));

if (process.argv.includes("--check")) {
  const problems = [];
  if (total.classes > 0 || total.text > 0) {
    problems.push(
      `${total.classes} class selector(s) and ${total.text} text selector(s) left: find elements by role and name, [name=…] or data-testid.`,
    );
  }
  if (total.jsText > JS_TEXT_CEILING) {
    problems.push(
      `${total.jsText} element(s) picked by their words in JavaScript, more than the ${JS_TEXT_CEILING} the Alert helpers need: find them by role and name or data-testid.`,
    );
  }
  const lookups = rows.filter((r) => r.file.startsWith("journeys/") && r.lookup > 0);
  for (const r of lookups) {
    problems.push(
      `${r.file} finds ${r.lookup} element(s) itself: move each screen step into the app's helper in lib/.`,
    );
  }
  if (total.status > 0) {
    problems.push(
      `${total.status} status word(s) written as a literal: ask tools/e2e/lib/words.cjs for them (word(kind, value, { viewer })).`,
    );
  }
  if (problems.length > 0) {
    console.error(`\n${problems.join("\n")}`);
    process.exit(1);
  }
}
