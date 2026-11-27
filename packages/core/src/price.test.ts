import { describe, expect, it } from "vitest";
import { format, money } from "./money";
import { formatPrice } from "./price";

const show = (text: string) => text.replaceAll(" ", "⍽").replaceAll(" ", "⎵");
const same = (actual: string, expected: string) => {
  expect(show(actual)).toBe(show(expected));
  expect([...actual].map((c) => c.codePointAt(0))).toEqual(
    [...expected].map((c) => c.codePointAt(0)),
  );
};

describe("formatPrice (§3 rule 5, §19.1)", () => {
  it("writes the colon sign and U+202F between thousands", () => {
    same(formatPrice(1_950_000), "₡19 500");
    same(formatPrice(2_650_000), "₡26 500");
    same(formatPrice(150_000), "₡1 500");
    same(formatPrice(125_000_000), "₡1 250 000");
    same(formatPrice(95_000), "₡950");
    same(formatPrice(0), "₡0");
  });

  it("writes a decimal comma only when there are céntimos", () => {
    same(formatPrice(1_725_664), "₡17 256,64");
    same(formatPrice(238_740), "₡2 387,40");
    same(formatPrice(5), "₡0,05");
  });

  it("writes a real minus sign before the symbol", () => {
    same(formatPrice(-50_000), "−₡500");
    same(formatPrice(-1_250_050), "−₡12 500,50");
  });

  it("never puts U+00A0 inside an amount", () => {
    for (const amount of [0, 99, 100_000, 123_456_789, -987_654_321]) {
      expect(formatPrice(amount)).not.toContain(" ");
      expect(formatPrice(amount)).not.toContain(" ");
    }
  });

  it("is the same in Spanish and English", () => {
    for (const amount of [1_950_000, 1_725_664, -50_000]) {
      same(formatPrice(amount, { locale: "en" }), formatPrice(amount, { locale: "es" }));
    }
  });

  it("gives today's callers exactly what they get now: format(money(amountMinor))", () => {
    // The amounts of packages/expo-kit/src/format.test.ts and a spread of others.
    const amounts = [0, 1, 99, 100, 1_250_000, 238_740, 28_900_000, -1, -100, 999_999_999_99];
    for (let i = 1; i < 2_000_000_000; i = i * 7 + 13) amounts.push(i, -i);
    for (const amount of amounts) expect(formatPrice(amount)).toBe(format(money(amount)));
  });

  it("refuses a float or an unsafe number", () => {
    expect(() => formatPrice(12.5)).toThrow(RangeError);
    expect(() => formatPrice(Number.NaN)).toThrow(RangeError);
    expect(() => formatPrice(2 ** 53)).toThrow(RangeError);
  });
});
