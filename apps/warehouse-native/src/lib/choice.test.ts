import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readChoice, writeChoice } from "./choice";

describe("the saved warehouse choice", () => {
  it("is read back for the account that made it", () => {
    assert.equal(readChoice(writeChoice("user-a", "wh-1"), "user-a"), "wh-1");
  });

  it("is ignored for another account on the same phone, or when it is not ours", () => {
    assert.equal(readChoice(writeChoice("user-a", "wh-1"), "user-b"), null);
    assert.equal(readChoice(null, "user-a"), null);
    assert.equal(readChoice("wh-1", "user-a"), null);
    assert.equal(readChoice("null", "user-a"), null);
    assert.equal(readChoice('{"userId":"user-a","warehouseId":7}', "user-a"), null);
  });
});
