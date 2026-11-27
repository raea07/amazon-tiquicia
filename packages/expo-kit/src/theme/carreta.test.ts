import {
  spacing as brandSpacing,
  type as brandType,
  dark,
  light,
  palette,
  radii,
  typeface,
} from "@yuntera/brand";
import { describe, expect, it } from "vitest";
import {
  colors,
  elevation,
  em,
  fontFamily,
  fontWeights,
  motion,
  space,
  spacing,
  target,
  theme,
  themeDark,
  touchTarget,
  type,
} from "./tokens";

/*
 * The Carreta names added beside today's (SISTEMA.md §2.1, §2.5 phase A,
 * §5.23). Today's names keep their values; tokens.test.ts holds those.
 */

describe("Carreta theme for the phone apps", () => {
  it("carries the brand's light and dark semantic colours unchanged", () => {
    expect(theme.scheme).toBe("light");
    expect(themeDark.scheme).toBe("dark");
    expect(theme.colors).toEqual(light);
    expect(themeDark.colors).toEqual(dark);
    expect(Object.keys(themeDark.colors).sort()).toEqual(Object.keys(theme.colors).sort());
    expect(theme.palette).toEqual(palette);
    expect(theme.radii).toEqual(radii);
  });

  it("names the spacing steps, so an old index of space cannot mean a new value", () => {
    expect(spacing).toEqual(brandSpacing);
    expect(spacing).toEqual({
      none: 0,
      hair: 4,
      tight: 8,
      snug: 12,
      base: 16,
      loose: 24,
      wide: 32,
      section: 48,
      page: 64,
    });
    // Today's space keeps its keys and values (20 and 40 included).
    expect(space).toEqual({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 });
  });

  it("draws every type step at its phone size, in its face and weight", () => {
    expect(Object.keys(type).sort()).toEqual(Object.keys(brandType).sort());
    for (const [name, step] of Object.entries(brandType)) {
      const native = type[name as keyof typeof type];
      expect(native.fontFamily, name).toBe(step.face === "title" ? "Epilogue" : "Fira Sans");
      expect(native.fontWeight, name).toBe(String(step.weight));
      expect(native.fontSize, name).toBe(step.phone.size);
      expect(native.lineHeight, name).toBe(step.phone.line);
      expect(native.letterSpacing, name).toBeCloseTo(em(step.tracking) * step.phone.size, 2);
      const weights: readonly number[] =
        step.face === "title" ? typeface.titleWeights : typeface.textWeights;
      expect(weights, name).toContain(step.weight);
    }
    expect(type.bodyApp).toMatchObject({ fontSize: 17, lineHeight: 24, fontWeight: "400" });
    expect(type.fine.fontSize).toBe(13);
    expect(Math.min(...Object.values(type).map((step) => step.fontSize))).toBe(13);
  });

  it("names the font families as the files do, and keeps today's names pointing at them", () => {
    expect(fontFamily.text).toBe("Fira Sans");
    expect(fontFamily.title).toBe("Epilogue");
    expect(fontFamily.body).toBe(fontFamily.text);
    expect(fontFamily.display).toBe(fontFamily.title);
    // The weights of today's names do not change: Inter 400–700 → Fira Sans
    // 400–700, Bricolage 600–800 → Epilogue 600–800.
    expect(fontWeights.body).toEqual([400, 500, 600, 700]);
    expect(fontWeights.display).toEqual([600, 700, 800]);
    expect(theme.fontFamily).toEqual({ text: "Fira Sans", title: "Epilogue" });
  });

  it("has the phone targets, beside today's 44", () => {
    expect(target).toEqual({ app: 48, driverAction: 56, driverPrimary: 64 });
    expect(touchTarget).toBe(44);
  });

  it("gives only overlays a shadow, and motion in ms", () => {
    expect(elevation.rest.elevation).toBe(0);
    expect(elevation.rest.shadowOpacity).toBe(0);
    expect(elevation.overlay).toMatchObject({
      shadowColor: palette.noche,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.25,
      elevation: 8,
    });
    expect(motion).toEqual({ fast: 100, panel: 200, none: 0 });
  });

  it("leaves today's colours as they were", () => {
    expect(colors.ink).not.toBe(theme.colors.ink);
    expect(colors).not.toHaveProperty("page");
  });

  it("reads em lengths and refuses anything else", () => {
    expect(em("-0.01em")).toBe(-0.01);
    expect(em("0")).toBe(0);
    expect(() => em("2px")).toThrow();
  });
});
