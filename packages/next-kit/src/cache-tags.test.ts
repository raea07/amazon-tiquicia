import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CATALOG_TAG,
  productPageTags,
  suggestionTags,
  tagsForOffers,
  tagsForProducts,
} from "./cache-tags";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const OFFER = "8c1f2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

describe("WEB-3: a shopper's action drops only what it changed", () => {
  it("drops the pages of the offers bought, never the whole catalogue", () => {
    const tags = tagsForOffers([OFFER, OFFER.toUpperCase()]);
    expect(tags).toEqual([`offer:${OFFER}`]);
    expect(tags).not.toContain(CATALOG_TAG);
  });

  it("drops the pages of an order's products, never the whole catalogue", () => {
    expect(tagsForProducts(["licuadora-nimbo", null, "licuadora-nimbo", "../catalog"])).toEqual([
      "product:licuadora-nimbo",
    ]);
  });

  it("bounds what one action can drop", () => {
    const many = Array.from(
      { length: 100 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(tagsForOffers(many).length).toBeLessThanOrEqual(40);
  });

  it("no shop action drops the catalogue tag", () => {
    const actions = read("../../../apps/web/src/app/actions.ts");
    expect(actions).not.toMatch(/updateTag\(\s*["']catalog["']/);
    expect(actions).not.toMatch(/revalidateTag\(/);
    expect(actions).not.toContain("CATALOG_TAG");
  });
});

describe("WEB-6: what a take-down refreshes", () => {
  it("tags a product page with the catalogue, the product and its offers", () => {
    expect(productPageTags("licuadora-nimbo", [OFFER, "not-an-id"])).toEqual([
      CATALOG_TAG,
      "product:licuadora-nimbo",
      `offer:${OFFER}`,
    ]);
  });

  it("tags the search suggestions, so the catalogue refresh drops them too", () => {
    expect(suggestionTags()).toContain(CATALOG_TAG);
    const data = read("../../../apps/web/src/lib/data.ts");
    const suggestions = data.slice(data.indexOf("export async function getSuggestions"));
    expect(suggestions).toContain("cacheTag(...suggestionTags())");
  });

  it("refreshes the shop after a take-down, a suspension and a rejection", () => {
    const actions = read("../../../apps/ops/src/app/actions.ts");
    const status = actions.slice(actions.indexOf("export async function setSellerStatus"));
    expect(status.slice(0, status.indexOf("\n}\n"))).toContain("refreshShopCatalog()");
    const report = actions.slice(actions.indexOf("export async function resolveReport"));
    expect(report.slice(0, report.indexOf("\n}\n"))).toContain("refreshShopCatalog()");
    const photos = read("../../../apps/ops/src/app/photo-actions.ts");
    const review = photos.slice(photos.indexOf("export async function reviewNewListing"));
    const body = review.slice(0, review.indexOf("\n}\n"));
    expect(body.match(/refreshShopCatalog\(\)/g)?.length).toBe(2);
  });
});

describe("nothing per person enters a shared cache", () => {
  it("reads only through the public client inside 'use cache'", () => {
    for (const path of [
      "../../../apps/web/src/lib/data.ts",
      "../../../apps/seller/src/lib/data.ts",
    ]) {
      const source = read(path);
      expect(source, path).toContain('"use cache"');
      expect(source, path).not.toMatch(/sessionApi|sessionClient|cookies\(|headers\(/);
    }
  });
});
