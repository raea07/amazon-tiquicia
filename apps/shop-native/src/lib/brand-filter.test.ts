import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_EMPTY,
  brandOptions,
  brandSummary,
  currentBrand,
  parseBrand,
  showBrandFilter,
} from "./brand-filter";

const webListing = readFileSync(
  join(__dirname, "../../../web/src/components/catalog-listing.tsx"),
  "utf8",
).replace(/\s+/g, " ");

const nimbo = { slug: "nimbo", name: "Nimbo", product_count: 5, former_slugs: ["nimbo-cr"] };
const volcan = { slug: "volcan", name: "Volcán", product_count: 1, former_slugs: [] };

describe("the brand filter", () => {
  it("reads a brand's address and ignores anything else", () => {
    expect(parseBrand("nimbo")).toBe("nimbo");
    expect(parseBrand(" Nimbo ")).toBe("nimbo");
    expect(parseBrand("dos-palabras")).toBe("dos-palabras");
    for (const bad of [undefined, "", "a b", "-nimbo", "nimbo-", "ñandú", "x".repeat(81)]) {
      expect(parseBrand(bad)).toBeUndefined();
    }
  });

  it("takes an old address to the brand that has it now", () => {
    expect(currentBrand([nimbo, volcan], "volcan")).toBe(volcan);
    expect(currentBrand([nimbo, volcan], "nimbo-cr")).toBe(nimbo);
    expect(currentBrand([nimbo, volcan], "otra")).toBeUndefined();
    expect(currentBrand([nimbo, volcan], undefined)).toBeUndefined();
  });

  it("shows only when there is a choice, or a filter to take off", () => {
    expect(showBrandFilter([nimbo], undefined)).toBe(false);
    expect(showBrandFilter([nimbo], "nimbo")).toBe(true);
    expect(showBrandFilter([nimbo, volcan], undefined)).toBe(true);
  });

  it("lists every brand with its count after «Todas las marcas»", () => {
    expect(brandOptions([nimbo, volcan])).toEqual([
      { value: "", label: "Todas las marcas" },
      { value: "nimbo", label: "Nimbo (5)" },
      { value: "volcan", label: "Volcán (1)" },
    ]);
  });

  it("uses the website's words", () => {
    expect(brandSummary(1, "Volcán")).toBe("Mostrando 1 producto de Volcán");
    expect(brandSummary(3, undefined)).toBe("Mostrando 3 productos de esa marca");
    for (const phrase of [
      BRAND_EMPTY.title,
      BRAND_EMPTY.body,
      BRAND_EMPTY.clear,
      "Todas las marcas",
      "Mostrando",
      '"esa marca"',
    ]) {
      expect(webListing, phrase).toContain(phrase);
    }
  });
});
