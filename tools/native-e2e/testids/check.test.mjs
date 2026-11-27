// node --test tools/native-e2e/testids/check.test.mjs
// The extractor reads every form a testID is written in, and no listed id has
// gone from the source.

import assert from "node:assert/strict";
import { test } from "node:test";
import { idsIn, PACKAGES, problems } from "./check.mjs";

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

for (const pkg of Object.keys(PACKAGES)) {
  test(`every listed testID of ${pkg} is still in its source`, () => {
    assert.deepEqual(problems(pkg).missing, []);
  });
}
