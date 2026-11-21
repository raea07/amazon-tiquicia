import {
  color,
  contrastRatio,
  fontSize as css,
  radius as cssRadius,
  semantic,
} from "@yuntera/brand";
import { describe, expect, it } from "vitest";
import {
  colors,
  fontSize,
  lineHeight,
  px,
  radius,
  rem,
  textPairs,
  tone,
  touchTarget,
  uiPairs,
} from "./tokens";

describe("unit conversion", () => {
  it("reads pixel and rem lengths", () => {
    expect(px("10px")).toBe(10);
    expect(px("9999px")).toBe(9999);
    expect(rem("1.125rem")).toBe(18);
    expect(rem("0.875rem")).toBe(14);
  });

  it("refuses units it does not understand, so a brand change cannot slip through as NaN", () => {
    expect(() => px("1rem")).toThrow();
    expect(() => rem("12px")).toThrow();
    expect(() => px("")).toThrow();
  });
});

describe("tokens derived from @yuntera/brand", () => {
  it("has one numeric size for every CSS size, at 16 px to the rem", () => {
    expect(Object.keys(fontSize)).toEqual(Object.keys(css));
    for (const [key, value] of Object.entries(css)) {
      expect(fontSize[key as keyof typeof css]).toBe(Number.parseFloat(value) * 16);
    }
    expect(fontSize.base).toBe(16);
    expect(fontSize["3xl"]).toBe(30);
  });

  it("has one numeric radius for every CSS radius", () => {
    expect(Object.keys(radius)).toEqual(Object.keys(cssRadius));
    expect(radius.md).toBe(10);
    expect(radius.lg).toBe(16);
  });

  it("keeps the 44 pt touch target", () => {
    expect(touchTarget).toBe(44);
  });

  it("gives body copy room and never a line shorter than its text", () => {
    expect(lineHeight.base).toBe(24);
    for (const key of Object.keys(fontSize) as Array<keyof typeof fontSize>) {
      expect(lineHeight[key]).toBeGreaterThanOrEqual(fontSize[key]);
    }
  });

  it("passes the semantic colours through unchanged", () => {
    expect(colors.brand).toBe(semantic.brand);
    expect(colors.ink).toBe(semantic.ink);
    expect(colors.palette.celeste[600]).toBe(color.celeste[600]);
  });

  it("draws every tone from the brand palette", () => {
    const palette = new Set<string>(
      Object.values(color).flatMap((scale) =>
        typeof scale === "string" ? [scale] : Object.values(scale),
      ),
    );
    for (const pair of Object.values(tone)) {
      expect(palette.has(pair.bg) && palette.has(pair.fg) && palette.has(pair.border)).toBe(true);
    }
  });
});

describe("contrast of what the native components draw (WCAG 2.2 AA)", () => {
  it.each(textPairs)("text: %s is at least 4.5:1", (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(uiPairs)("control: %s is at least 3:1", (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
