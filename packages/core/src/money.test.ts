import { describe, expect, it } from "vitest";
import {
  add,
  addTax,
  allocate,
  format,
  fromMajor,
  IVA,
  money,
  multiply,
  parseColones,
  parseWholeColones,
  percentage,
  splitTaxInclusive,
  subtract,
  sum,
  toMajor,
} from "./money";

describe("money", () => {
  it("rejects non-integer minor units", () => {
    expect(() => money(10.5)).toThrow(RangeError);
    expect(() => money(Number.NaN)).toThrow(RangeError);
  });

  it("converts from major units without binary drift", () => {
    expect(fromMajor(12500).amountMinor).toBe(1_250_000);
    expect(fromMajor(1.005, "USD").amountMinor).toBe(101);
    expect(fromMajor(-1.005, "USD").amountMinor).toBe(-101);
    expect(toMajor(money(1_250_050))).toBe(12500.5);
  });

  it("does arithmetic in one currency only", () => {
    expect(add(money(100), money(250)).amountMinor).toBe(350);
    expect(subtract(money(100), money(250)).amountMinor).toBe(-150);
    expect(multiply(money(199_900), 3).amountMinor).toBe(599_700);
    expect(sum([money(1), money(2), money(3)]).amountMinor).toBe(6);
    expect(() => add(money(1, "CRC"), money(1, "USD"))).toThrow(TypeError);
  });

  it("computes percentages in basis points", () => {
    expect(percentage(money(1_000_000), 1300).amountMinor).toBe(130_000);
    expect(percentage(money(999), 1250).amountMinor).toBe(125); // 124.875 → 125
  });
});

describe("allocate", () => {
  it("never loses or invents a céntimo", () => {
    const parts = allocate(money(100), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([34, 33, 33]);
    expect(sum(parts).amountMinor).toBe(100);
  });

  it("is proportional to the weights", () => {
    const parts = allocate(money(1_000_00), [70, 20, 10]);
    expect(parts.map((p) => p.amountMinor)).toEqual([70_000, 20_000, 10_000]);
  });

  it("handles zero weights and negative totals", () => {
    expect(allocate(money(500), [0, 1]).map((p) => p.amountMinor)).toEqual([0, 500]);
    const refund = allocate(money(-100), [1, 2]);
    expect(refund.map((p) => p.amountMinor)).toEqual([-33, -67]);
    expect(sum(refund).amountMinor).toBe(-100);
  });

  it("holds the invariant across many random splits", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let i = 0; i < 500; i++) {
      const total = Math.floor(rand() * 10_000_000);
      const weights = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => rand() * 100 + 0.01);
      const parts = allocate(money(total), weights);
      expect(sum(parts).amountMinor).toBe(total);
      expect(parts.every((p) => p.amountMinor >= 0)).toBe(true);
    }
  });

  it("rejects unusable weights", () => {
    expect(() => allocate(money(100), [])).toThrow(RangeError);
    expect(() => allocate(money(100), [0, 0])).toThrow(RangeError);
    expect(() => allocate(money(100), [-1, 2])).toThrow(RangeError);
  });
});

describe("IVA", () => {
  it("splits a tax-inclusive price at the general rate", () => {
    // ₡11 300 with 13% IVA is ₡10 000 net + ₡1 300 tax.
    const r = splitTaxInclusive(fromMajor(11_300), IVA.general);
    expect(r.net.amountMinor).toBe(1_000_000);
    expect(r.tax.amountMinor).toBe(130_000);
  });

  it("always satisfies net + tax = gross, for every rate", () => {
    for (const rate of Object.values(IVA)) {
      for (const gross of [1, 99, 100, 12_345, 999_999, 1_250_000, 87_654_321]) {
        const r = splitTaxInclusive(money(gross), rate);
        expect(r.net.amountMinor + r.tax.amountMinor).toBe(gross);
        expect(r.tax.amountMinor).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("leaves exempt goods untouched", () => {
    const r = splitTaxInclusive(money(50_000), IVA.exempt);
    expect(r.tax.amountMinor).toBe(0);
    expect(r.net.amountMinor).toBe(50_000);
  });

  it("adds tax on top of a net fee", () => {
    const r = addTax(fromMajor(1_000), IVA.general);
    expect(r.tax.amountMinor).toBe(13_000);
    expect(r.gross.amountMinor).toBe(113_000);
  });

  it("rejects invalid rates", () => {
    expect(() => splitTaxInclusive(money(100), -1)).toThrow(RangeError);
    expect(() => splitTaxInclusive(money(100), 12.5)).toThrow(RangeError);
  });
});

describe("format", () => {
  it("writes colones the way Costa Rica does", () => {
    expect(format(fromMajor(12_500))).toBe("₡12 500");
    expect(format(fromMajor(1_250_000))).toBe("₡1 250 000");
    expect(format(fromMajor(950))).toBe("₡950");
  });

  it("shows céntimos only when present, unless asked", () => {
    expect(format(money(1_250_050))).toBe("₡12 500,50");
    expect(format(fromMajor(12_500), { showMinor: "always" })).toBe("₡12 500,00");
    expect(format(money(1_250_050), { showMinor: "never" })).toBe("₡12 500");
  });

  it("formats dollars and negatives", () => {
    expect(format(fromMajor(1234.5, "USD"))).toBe("$1 234.50");
    expect(format(fromMajor(-500))).toBe("−₡500");
  });
});

describe("parseColones", () => {
  it.each([
    ["12500", 1_250_000],
    ["12 500", 1_250_000],
    ["12.500", 1_250_000],
    ["12,500", 1_250_000],
    ["₡12 500", 1_250_000],
    ["1.250.000", 125_000_000],
    ["12500,50", 1_250_050],
    ["12 500,5", 1_250_050],
    ["12.500,75", 1_250_075],
    ["950", 95_000],
    ["0", 0],
  ])("reads %s", (text, expected) => {
    expect(parseColones(text)).toBe(expected);
  });

  it.each(["", "abc", "-500", "12,5,0", "1.2.3", "12.5000", "1e5", "₡", "12 500 colones"])(
    "refuses %s",
    (text) => {
      expect(parseColones(text)).toBeNull();
    },
  );
});

describe("parseWholeColones", () => {
  it.each([
    ["150,00", 15_000],
    ["150", 15_000],
    ["1.500", 150_000],
    ["1 500", 150_000],
    ["₡1.500", 150_000],
    ["1.500,00", 150_000],
    ["0", 0],
  ])("reads %s", (text, expected) => {
    expect(parseWholeColones(text)).toBe(expected);
  });

  it.each(["150,50", "1500,5", "", "-5", "1,5", "abc"])("refuses %s", (text) => {
    expect(parseWholeColones(text)).toBeNull();
  });
});
