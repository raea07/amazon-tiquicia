// Run with `pnpm --filter @yuntera/seller-native test` (Node's test runner through tsx).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createdFlash, flashFor } from "./flash";

describe("flashFor", () => {
  it("shows a message only in the shop it belongs to", () => {
    const flash = { shopId: "ferreteria", value: "Paquete YT500017: listo." };
    assert.equal(flashFor(flash, "ferreteria"), "Paquete YT500017: listo.");
    assert.equal(flashFor(flash, "tecnocasa"), null);
    assert.equal(flashFor(null, "ferreteria"), null);
  });
});

describe("createdFlash", () => {
  it("needs the outcome and the shop it was created in", () => {
    assert.deepEqual(createdFlash("revision", "ferreteria"), {
      shopId: "ferreteria",
      value: "revision",
    });
    assert.equal(flashFor(createdFlash("revision", "ferreteria"), "tecnocasa"), null);
    // A link without the shop (or an old one) shows nothing rather than a message about another shop.
    assert.equal(createdFlash("revision", undefined), null);
    assert.equal(createdFlash("otra-cosa", "ferreteria"), null);
  });
});
