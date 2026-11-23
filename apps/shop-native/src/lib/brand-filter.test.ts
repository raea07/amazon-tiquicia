import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_EMPTY,
  brandOptions,
  brandSummary,
  currentBrand,
  parseBrand,
  settledTotal,
  showBrandFilter,
} from "./brand-filter";

const webListing = readFileSync(
  join(__dirname, "../../../web/src/components/catalog-listing.tsx"),
  "utf8",
).replace(/\s+/g, " ");

const webSearchPage = readFileSync(join(__dirname, "../../../web/src/app/buscar/page.tsx"), "utf8");

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

  it("states no count until the search for these options has answered", () => {
    const page = (total: number) => [{ total_count: total }];
    // The first page of a new filter is pending: no data at all.
    expect(settledTotal({ isSuccess: false })).toBeNull();
    // Another filter's results standing in while this one loads.
    expect(
      settledTotal({ isSuccess: true, isPlaceholderData: true, data: { pages: [page(9)] } }),
    ).toBeNull();
    // Answered: the count of the first page, and 0 only when truly empty.
    expect(settledTotal({ isSuccess: true, data: { pages: [page(5), page(5)] } })).toBe(5);
    expect(settledTotal({ isSuccess: true, data: { pages: [[]] } })).toBe(0);
    // A failed search states no count either.
    expect(settledTotal({ isSuccess: false, data: undefined })).toBeNull();

    expect(brandSummary(null, "Nimbo")).toBe("Cargando productos de Nimbo…");
    expect(brandSummary(null, undefined)).toBe("Cargando productos de esa marca…");
    expect(brandSummary(null, "Nimbo")).not.toMatch(/\d/);
    expect(brandSummary(0, "Nimbo")).toBe("Mostrando 0 productos de Nimbo");
    // The same word for loading as the website's search page.
    expect(webSearchPage).toContain("Cargando productos…");
  });
});
