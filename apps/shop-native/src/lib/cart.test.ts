import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartUnits,
  isPostalCode,
  MAX_LINES,
  MAX_UNITS_PER_LINE,
  parseCart,
  serializeCart,
  setQuantity,
} from "./cart";

const offer = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("the cart", () => {
  it("adds, merges and caps a line at 10 units", () => {
    let result = addToCart([], offer(1), 3);
    expect(result.items).toEqual([{ offerId: offer(1), quantity: 3 }]);
    result = addToCart(result.items ?? [], offer(1), 9);
    expect(result.items).toEqual([{ offerId: offer(1), quantity: MAX_UNITS_PER_LINE }]);
  });

  it("refuses a 41st line with the website's words", () => {
    const full = Array.from({ length: MAX_LINES }, (_, i) => ({ offerId: offer(i), quantity: 1 }));
    expect(addToCart(full, offer(999), 1).error).toMatch(/carrito está lleno/);
    // More of something already in the cart is still fine.
    expect(addToCart(full, offer(0), 1).items?.[0]?.quantity).toBe(2);
  });

  it("refuses nonsense", () => {
    expect(addToCart([], "not-an-id", 1).error).toBeDefined();
    expect(addToCart([], offer(1), 0).error).toBeDefined();
    expect(addToCart([], offer(1), 1.5).error).toBeDefined();
  });

  it("sets and removes quantities", () => {
    const items = [
      { offerId: offer(1), quantity: 2 },
      { offerId: offer(2), quantity: 1 },
    ];
    expect(setQuantity(items, offer(1), 5)[0]?.quantity).toBe(5);
    expect(setQuantity(items, offer(1), 50)[0]?.quantity).toBe(MAX_UNITS_PER_LINE);
    expect(setQuantity(items, offer(1), 0)).toEqual([{ offerId: offer(2), quantity: 1 }]);
    expect(cartUnits(items)).toBe(3);
  });

  it("survives a round trip through storage", () => {
    const items = [{ offerId: offer(7), quantity: 4 }];
    expect(parseCart(serializeCart(items))).toEqual(items);
  });

  it("drops anything malformed in storage instead of trusting it", () => {
    expect(parseCart(null)).toEqual([]);
    expect(parseCart("not json")).toEqual([]);
    expect(parseCart('{"o":"x"}')).toEqual([]);
    expect(
      parseCart(
        JSON.stringify([
          { o: offer(1), q: 2 },
          { o: offer(1), q: 3 }, // duplicate line
          { o: "nope", q: 1 },
          { o: offer(2), q: 0 },
          { o: offer(3), q: 11 },
          { o: offer(4), q: "2" },
          { o: offer(5), q: 1, price: 1 }, // extra fields are ignored, not kept
        ]),
      ),
    ).toEqual([
      { offerId: offer(1), quantity: 2 },
      { offerId: offer(5), quantity: 1 },
    ]);
  });

  it("accepts only real district codes", () => {
    expect(isPostalCode("10101")).toBe(true);
    expect(isPostalCode("80101")).toBe(false);
    expect(isPostalCode("1010")).toBe(false);
    expect(isPostalCode(null)).toBe(false);
  });
});
