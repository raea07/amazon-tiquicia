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
// The size checks (rule 20.5.3) are counted too, so a change that drops one
// shows up: `scrollWidth` (sideways scroll at a width) and `boundingBox`
// (the size of a control) in the journey files.

import { readdirSync, readFileSync } from "node:fs";
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

const TEXT = /text=|:has-text\(|:text\(|:text-is\(|:text-matches\(|getByText\(|hasText|hasNotText/g;
// A selector string handed to Playwright or to the DOM: the first argument
// (a literal '…', "…" or `…`) of a call that takes one.
const SELECTOR_CALL =
  /\b(locator|waitForSelector|click|dblclick|fill|check|uncheck|selectOption|inputValue|innerText|innerHTML|textContent|isVisible|isHidden|isChecked|isEnabled|isDisabled|getAttribute|\$|\$\$|\$eval|\$\$eval|hover|press|setInputFiles|dispatchEvent|focus|tap|type|querySelector|querySelectorAll|closest|matches)\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
// A class inside a CSS selector: a dot right after a tag, a combinator, the
// start of the string, a bracket or a parenthesis, followed by a name.
const CLASS =
  /(?:^|[\s>+~,([\]]|\b[a-z][a-z0-9]*)\.(?!example\b|png\b|jpe?g\b|webp\b|cjs\b|mjs\b|js\b|json\b|html\b|pdf\b|xml\b|svg\b|txt\b|csv\b|md\b|css\b)[a-zA-Z_-][\w-]*/;

const stripComments = (source) =>
  source
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line))
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
  const role = (source.match(/getByRole\(/g) ?? []).length;
  const testid = (source.match(/data-testid|getByTestId\(/g) ?? []).length;
  const scroll = file.startsWith("journeys/") ? (source.match(/scrollWidth/g) ?? []).length : 0;
  const box = file.startsWith("journeys/") ? (source.match(/boundingBox\(/g) ?? []).length : 0;
  rows.push({ file, classes, text, role, testid, scroll, box });
}

const total = rows.reduce(
  (sum, r) => {
    for (const key of Object.keys(sum)) sum[key] += r[key];
    return sum;
  },
  { classes: 0, text: 0, role: 0, testid: 0, scroll: 0, box: 0 },
);

const pad = (value, width) => String(value).padStart(width);
console.log(`${"file".padEnd(34)} class  text  role  testid  scrollWidth  boundingBox`);
for (const r of rows) {
  console.log(
    `${r.file.padEnd(34)} ${pad(r.classes, 5)} ${pad(r.text, 5)} ${pad(r.role, 5)} ${pad(r.testid, 7)} ${pad(r.scroll, 12)} ${pad(r.box, 12)}`,
  );
}
console.log(
  `${"total".padEnd(34)} ${pad(total.classes, 5)} ${pad(total.text, 5)} ${pad(total.role, 5)} ${pad(total.testid, 7)} ${pad(total.scroll, 12)} ${pad(total.box, 12)}`,
);

if (process.argv.includes("--check") && (total.classes > 0 || total.text > 0)) {
  console.error(
    `\n${total.classes} class selector(s) and ${total.text} text selector(s) left: find elements by role and name, [name=…] or data-testid.`,
  );
  process.exit(1);
}
