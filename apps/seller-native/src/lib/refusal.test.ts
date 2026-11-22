import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@yuntera/db";
import { withPriceFloor } from "./refusal";

const message = new ApiError("price_below_fees").userMessage("es-CR");

describe("withPriceFloor", () => {
  it("adds the lowest price the database would accept", () => {
    const error = new ApiError("price_below_fees", { detail: "250000", status: 400 });
    const text = withPriceFloor(error, message);
    assert.ok(text.startsWith(message));
    assert.match(text, /El precio mínimo para este producto es ₡\s?2[\s.]?500\./);
  });

  it("leaves every other refusal, and one without a usable amount, as it is", () => {
    assert.equal(withPriceFloor(new ApiError("price_below_fees"), message), message);
    assert.equal(
      withPriceFloor(new ApiError("price_below_fees", { detail: "mucho" }), message),
      message,
    );
    const other = new ApiError("package_over_limit", { detail: "999" });
    assert.equal(withPriceFloor(other, "texto"), "texto");
    assert.equal(withPriceFloor(new Error("x"), "texto"), "texto");
  });

  it("never shows a code", () => {
    for (const code of ["price_below_fees", "package_over_limit", "too_large_for_warehouse"]) {
      const text = new ApiError(code as ApiError["code"]).userMessage("es-CR");
      assert.doesNotMatch(text, /[a-z]+_[a-z_]+/);
    }
  });
});
