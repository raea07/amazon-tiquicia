import { describe, expect, it } from "vitest";
import { cartHasNothingToBuy, NOTHING_TO_BUY_NOTE } from "./cart-summary";

describe("cartHasNothingToBuy", () => {
  it("is true only when every line of a cart with lines cannot be bought", () => {
    expect(cartHasNothingToBuy([{ buyable: false }])).toBe(true);
    expect(cartHasNothingToBuy([{ buyable: false }, { buyable: false }])).toBe(true);
    expect(cartHasNothingToBuy([{ buyable: false }, { buyable: true }])).toBe(false);
    expect(cartHasNothingToBuy([{ buyable: true }])).toBe(false);
    expect(cartHasNothingToBuy([])).toBe(false);
  });

  it("says what to do, with no amount and no date", () => {
    expect(NOTHING_TO_BUY_NOTE).toContain("quítelo");
    expect(NOTHING_TO_BUY_NOTE).not.toMatch(/₡|\d/);
  });
});
