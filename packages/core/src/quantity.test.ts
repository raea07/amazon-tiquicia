import { describe, expect, it } from "vitest";
import { COUNTED_NOUNS, formatNumber, formatQuantity, QUANTITY_UNITS } from "./quantity";

const show = (text: string) => text.replaceAll(" ", "⍽").replaceAll(" ", "⎵");
const same = (actual: string, expected: string) => {
  expect(show(actual)).toBe(show(expected));
  expect([...actual].map((c) => c.codePointAt(0))).toEqual(
    [...expected].map((c) => c.codePointAt(0)),
  );
};

describe("formatQuantity: the examples of §3 rule 8, character by character", () => {
  it("joins a number and its unit with U+00A0", () => {
    same(formatQuantity(340, "g"), "340 g");
    same(formatQuantity(1.8, "L"), "1,8 L");
    same(formatQuantity(12, "%"), "12 %");
    same(formatQuantity(24, "hour"), "24 horas");
    same(formatQuantity(3, "unit"), "3 unidades");
    same(formatQuantity(8, "workingDay"), "8 días hábiles");
  });

  it("writes the same in English, with the English decimal point and words", () => {
    same(formatQuantity(340, "g", { locale: "en" }), "340 g");
    same(formatQuantity(1.8, "L", { locale: "en" }), "1.8 L");
    same(formatQuantity(12, "%", { locale: "en" }), "12 %");
    same(formatQuantity(24, "hour", { locale: "en" }), "24 hours");
    same(formatQuantity(3, "unit", { locale: "en" }), "3 units");
    same(formatQuantity(8, "workingDay", { locale: "en" }), "8 working days");
  });

  it("uses the singular for exactly one and the plural otherwise", () => {
    same(formatQuantity(1, "unit"), "1 unidad");
    same(formatQuantity(0, "unit"), "0 unidades");
    same(formatQuantity(1.5, "hour"), "1,5 horas");
    same(formatQuantity(1, "workingDay"), "1 día hábil");
    same(formatQuantity(2, "time"), "2 veces");
    same(formatQuantity(1, "time"), "1 vez");
    same(formatQuantity(3, "month"), "3 meses");
    same(formatQuantity(1, "unit", { locale: "en" }), "1 unit");
    same(formatQuantity(0, "parcel", { locale: "en" }), "0 parcels");
  });

  it("takes a noun that is not in the list", () => {
    same(formatQuantity(2, { one: "caja", other: "cajas" }), "2 cajas");
    same(formatQuantity(1, { one: "caja", other: "cajas" }), "1 caja");
  });

  it("knows every unit of the rule: g, kg, ml, L, cm, mm, m, km, W, %", () => {
    expect([...QUANTITY_UNITS]).toEqual(["g", "kg", "ml", "L", "cm", "mm", "m", "km", "W", "%"]);
    for (const unit of QUANTITY_UNITS) same(formatQuantity(5, unit), `5 ${unit}`);
  });

  it("has a singular and a plural for every counted noun in both languages", () => {
    for (const forms of Object.values(COUNTED_NOUNS)) {
      for (const [one, other] of [forms.es, forms.en]) {
        expect(one.length).toBeGreaterThan(0);
        expect(other).not.toBe(one);
      }
    }
  });

  it("refuses a unit it does not know", () => {
    expect(() => formatQuantity(1, "lb" as never)).toThrow(RangeError);
  });
});

describe("formatNumber", () => {
  it("groups thousands with U+202F, as money does", () => {
    same(formatNumber(12500), "12 500");
    same(formatNumber(1234567.5), "1 234 567,5");
    same(formatNumber(1234567.5, { locale: "en" }), "1 234 567.5");
    same(formatNumber(999), "999");
  });

  it("rounds to two decimals by default and drops trailing zeros", () => {
    same(formatNumber(1.005), "1,01");
    same(formatNumber(2.5), "2,5");
    same(formatNumber(2.0), "2");
    same(formatNumber(0.333333, { maxDecimals: 3 }), "0,333");
    same(formatNumber(2.6, { maxDecimals: 0 }), "3");
  });

  it("writes a real minus sign", () => {
    same(formatNumber(-3), "−3");
    same(formatNumber(-0.001), "0");
  });

  it("refuses what is not a finite number", () => {
    expect(() => formatNumber(Number.NaN)).toThrow(RangeError);
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatNumber(1, { maxDecimals: 7 })).toThrow(RangeError);
  });
});
