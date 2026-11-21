import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderTokensCss } from "./css";
import { color, contrastRatio, semantic } from "./tokens";

describe("tokens.css", () => {
  it("is in sync with tokens.ts", () => {
    const committed = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
    expect(committed).toBe(renderTokensCss());
  });
});

describe("contrast (WCAG 2.2 AA)", () => {
  const AA_TEXT = 4.5;
  const AA_LARGE_OR_UI = 3;

  const textPairs: Array<[name: string, fg: string, bg: string]> = [
    ["body text on page", semantic.ink, semantic.bg],
    ["body text on surface", semantic.ink, semantic.surface],
    ["muted text on page", semantic.inkMuted, semantic.bg],
    ["muted text on muted surface", semantic.inkMuted, semantic.surfaceMuted],
    ["white on brand button", semantic.onBrand, semantic.brand],
    ["white on brand hover", semantic.onBrand, semantic.brandHover],
    ["link on page", semantic.link, semantic.bg],
    ["link on brand-soft", semantic.link, semantic.brandSoft],
    ["white on promo badge", color.white, semantic.promo],
    ["white on success", color.white, semantic.success],
    ["white on danger", color.white, semantic.danger],
    ["warning text on page", semantic.warning, semantic.bg],
    ["ink on rating yellow", semantic.ink, semantic.rating],
    ["white on dark surface", color.white, color.anil[900]],
    ["celeste on dark surface", color.celeste[300], color.anil[900]],
  ];

  it.each(textPairs)("%s is at least 4.5:1", (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("focus ring is visible against page and surface", () => {
    expect(contrastRatio(semantic.focus, semantic.bg)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
    expect(contrastRatio(semantic.focus, semantic.surface)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
  });

  it("computes known ratios correctly", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});
