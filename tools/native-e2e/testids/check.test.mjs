// node --test tools/native-e2e/testids/check.test.mjs
// The extractor reads every form a testID is written in and skips comments,
// a missing id is reported and makes the command exit 1, and no listed id has
// gone from the source.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compare, idsIn, PACKAGES, problems } from "./check.mjs";

const checkScript = fileURLToPath(new URL("./check.mjs", import.meta.url));

// Source text is written with #{…} for ${…}, so that no string here looks like
// a template by mistake; `js` turns it back.
const js = (text) => text.replaceAll("#{", "${");

test("reads every form a testID is written in", () => {
  const source = [
    '<Button testID="sign-out" />',
    js("<View testID={`order-#{order.number}`} />"),
    '<Text testID={creating ? "show-sign-in" : "show-sign-up"} />',
    js("<Text testID={testID ? `#{testID}-retry` : undefined} />"),
    "<Row testID={testID} />",
    'function Box({ testID = "search-input" }) {}',
    'const notice = { testID: "order-kept", text };',
    "type Props = { testID?: string; testIDPrefix?: string };",
    'if (testID === "nope") {}',
    '<ProductGrid testIDPrefix="home-product" />',
  ].join("\n");
  assert.deepEqual(idsIn(source), [
    "sign-out",
    js("order-#{order.number}"),
    "show-sign-in",
    "show-sign-up",
    js("#{testID}-retry"),
    "search-input",
    "order-kept",
    "home-product",
  ]);
});

test("an id written only in a comment is not read", () => {
  const source = [
    '<Button testID="kept" />',
    '// was testID="line-comment"',
    '/* testID="block-comment" */',
    '{/* <View testID="jsx-comment" /> */}',
    '<Text testID="after-comment" /> // testID="trailing"',
    'const url = "https://example.test"; <View testID="after-url-string" />',
  ].join("\n");
  assert.deepEqual(idsIn(source), ["kept", "after-comment", "after-url-string"]);
});

test("a listed id that the source no longer has is reported as missing", () => {
  const listed = [{ id: "stays" }, { id: "gone" }];
  const now = new Map([
    ["stays", ["a.tsx"]],
    ["fresh", ["b.tsx"]],
  ]);
  assert.deepEqual(compare(listed, now), { missing: ["gone"], added: ["fresh"] });
});

/** A checkout with one source file per package and a list for each, under a temp folder. */
function scratchCheckout(sources) {
  const dir = mkdtempSync(join(tmpdir(), "testids-"));
  const lists = join(dir, "lists");
  mkdirSync(lists);
  for (const [pkg, src] of Object.entries(PACKAGES)) {
    mkdirSync(join(dir, src), { recursive: true });
    writeFileSync(join(dir, src, "screen.tsx"), sources[pkg] ?? `<View testID="${pkg}-a" />\n`);
    const ids = [{ id: `${pkg}-a`, files: [`${src}/screen.tsx`] }];
    writeFileSync(join(lists, `${pkg}.json`), JSON.stringify({ ids }));
  }
  const run = () =>
    spawnSync(process.execPath, [checkScript, "--root", dir, "--lists", lists], {
      encoding: "utf8",
    });
  return { dir, run };
}

test("the command exits 0 when every listed id is in the source", () => {
  const { dir, run } = scratchCheckout({});
  try {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /testids shop: all 1 listed ids are in the source/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the command exits 1 and names the id when a listed id was renamed", () => {
  const { dir, run } = scratchCheckout({ shop: '<View testID="shop-a-renamed" />\n' });
  try {
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /testids shop: 1 id\(s\) in shop\.json .*: shop-a$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the command exits 1 when a listed id survives only in a comment", () => {
  const { dir, run } = scratchCheckout({
    seller: '<View testID="seller-b" />\n// was testID="seller-a"\n',
  });
  try {
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /testids seller: .*: seller-a$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const pkg of Object.keys(PACKAGES)) {
  test(`every listed testID of ${pkg} is still in its source`, () => {
    assert.deepEqual(problems(pkg).missing, []);
  });
}
