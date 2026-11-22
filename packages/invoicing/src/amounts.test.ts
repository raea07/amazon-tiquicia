import { describe, expect, it } from "vitest";
import {
  divRound,
  formatAmount,
  fromMinor,
  lineTotal,
  netOfGross,
  parseAmount,
  parseQuantity,
  taxOn,
  toMinor,
} from "./amounts.ts";

/** Net, tax and line total of an IVA-inclusive amount in céntimos, at 13 %. */
const split = (grossMinor: number) => {
  const net = netOfGross(grossMinor, 1300);
  const tax = taxOn(net, 1300);
  return [formatAmount(net), formatAmount(tax), formatAmount(net + tax)];
};

describe("amounts with five decimals (research note 3.11)", () => {
  it("rounds half up, as the annex's example does (20.203518 → 20.20352)", () => {
    // 20.203518 at six decimals, to five.
    expect(formatAmount(divRound(20_203_518n, 10n))).toBe("20.20352");
    expect(formatAmount(divRound(20_203_514n, 10n))).toBe("20.20351");
    expect(formatAmount(divRound(20_203_515n, 10n))).toBe("20.20352");
  });

  it("takes the net out of an IVA-inclusive ₡2 500 exactly as the validated tiquete", () => {
    expect(split(250_000)).toEqual(["2212.38938", "287.61062", "2500.00000"]);
  });

  it("keeps the formula-exact values where net + tax is one unit off the gross", () => {
    // The pitfall measured in the note: ₡100 and ₡333.
    expect(split(10_000)).toEqual(["88.49558", "11.50443", "100.00001"]);
    expect(split(33_300)).toEqual(["294.69027", "38.30974", "333.00001"]);
  });

  it("puts 13 % on a net fee: ₡2 400 commission → 312.00000 (the factura sample)", () => {
    const net = fromMinor(240_000);
    expect(formatAmount(net)).toBe("2400.00000");
    expect(formatAmount(taxOn(net, 1300))).toBe("312.00000");
    expect(formatAmount(net + taxOn(net, 1300))).toBe("2712.00000");
    // A fee in céntimos: ₡1 234.57 × 13 % = 160.4941 exactly.
    expect(formatAmount(taxOn(fromMinor(123_457), 1300))).toBe("160.49410");
  });

  it("reads and writes amounts and quantities, refusing anything else", () => {
    expect(parseAmount("2212.38938")).toBe(221_238_938n);
    expect(parseAmount("7")).toBe(700_000n);
    expect(formatAmount(parseAmount("0.00001"))).toBe("0.00001");
    expect(() => parseAmount("-1")).toThrow();
    expect(() => parseAmount("1e3")).toThrow();
    expect(() => parseAmount("1.000001")).toThrow();
    expect(parseQuantity("1.000")).toBe(1000n);
    expect(lineTotal(parseQuantity("2.500"), parseAmount("10.00001"))).toBe(
      parseAmount("25.00003"),
    );
    expect(toMinor(parseAmount("287.61062"))).toBe(28_761n);
    expect(toMinor(parseAmount("287.61500"))).toBe(28_762n);
  });

  it("never does arithmetic on negative amounts", () => {
    expect(() => divRound(-1n, 3n)).toThrow();
    expect(() => formatAmount(-1n)).toThrow();
  });
});
