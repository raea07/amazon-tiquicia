// Keeps rules 1 and 2 of tools/native-e2e/README.md (SISTEMA.md §20.5.4):
// a journey file holds the flow and the checks and finds no element itself
// (the helpers in lib/ do, by testID or by role), and nothing in the native
// journeys finds an element by a bare text match.
//
//   node --test tools/native-e2e/lib/journeys.test.cjs

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");
const read = (dir) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".cjs") && !f.endsWith(".test.cjs"))
    .map((f) => ({ file: `${dir}/${f}`, text: readFileSync(join(ROOT, dir, f), "utf8") }));

/** Playwright's own ways to find an element. */
const LOOKUP =
  /\.(?:getByRole|getByTestId|getByLabel|getByText|getByPlaceholder|getByAltText|getByTitle|locator|waitForSelector|\$\$?|\$\$?eval)\(/;
/** Finding by words: never in a journey, and in a helper only on an element already found. */
const TEXT_LOOKUP = /\bgetByText\(|text=|:has-text\(|:text\(|:text-is\(|:text-matches\(|xpath=/;

/** Lines that are code, with their numbers (comments left out). */
function codeLines(text) {
  return text
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

/** What a line of code breaks, if anything. */
function offences(file, text, pattern) {
  return codeLines(text)
    .filter(({ line }) => pattern.test(line))
    .map(({ line, n }) => `${file}:${n}: ${line.trim().slice(0, 100)}`);
}

test("the guard finds what it looks for", () => {
  assert.equal(offences("x", `  await page.getByTestId("a").click();`, LOOKUP).length, 1);
  assert.equal(offences("x", `  await page.locator('[data-testid^="a"]');`, LOOKUP).length, 1);
  assert.equal(offences("x", `  await testIds(page, "a").click();`, LOOKUP).length, 0);
  assert.equal(offences("x", `  // page.getByTestId("a") in a comment`, LOOKUP).length, 0);
  assert.equal(offences("x", `  await page.getByText("hola").waitFor();`, TEXT_LOOKUP).length, 1);
  assert.equal(offences("x", `  .filter({ hasText: "hola" })`, TEXT_LOOKUP).length, 0);
});

test("journey files find no element themselves", () => {
  const found = read("journeys").flatMap(({ file, text }) => offences(file, text, LOOKUP));
  assert.deepEqual(found, [], "move these lookups into lib/<app>.cjs or lib/screen.cjs");
});

test("nothing finds an element by a bare text match", () => {
  const found = [...read("journeys"), ...read("lib")].flatMap(({ file, text }) =>
    offences(file, text, TEXT_LOOKUP),
  );
  assert.deepEqual(found, [], "find the element by testID or role, then check its words");
});
