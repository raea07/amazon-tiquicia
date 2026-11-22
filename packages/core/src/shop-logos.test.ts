import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPhotoTemplate } from "./photos";
import {
  isLogoTemplate,
  logoPath,
  logoUrl,
  normaliseShopDescription,
  SHOP_DESCRIPTION_MAX,
} from "./shop-logos";

const SELLER = "11111111-1111-4111-8111-111111111111";
const LOGO = "22222222-2222-4222-8222-222222222222";

describe("logo paths", () => {
  it("live under the shop, in a folder of their own", () => {
    expect(logoPath(SELLER, LOGO, 400)).toBe(`${SELLER}/logo/${LOGO}/400.jpg`);
    expect(logoPath(SELLER, LOGO, 1600, "webp")).toBe(`${SELLER}/logo/${LOGO}/1600.webp`);
  });

  it("refuse anything that is not an id or a size", () => {
    expect(() => logoPath("x", LOGO, 400)).toThrow();
    expect(() => logoPath(SELLER, LOGO, 300 as 400)).toThrow();
  });

  it("are never taken for a listing's photo, nor the other way round", () => {
    const template = `${SELLER}/logo/${LOGO}/{w}.jpg`;
    expect(isLogoTemplate(template)).toBe(true);
    expect(isPhotoTemplate(template)).toBe(false);
    expect(isLogoTemplate(`${SELLER}/${LOGO}/${LOGO}/{w}.jpg`)).toBe(false);
    expect(logoUrl("http://api.example/", template, 400)).toBe(
      `http://api.example/storage/v1/object/public/product-photos/${SELLER}/logo/${LOGO}/400.jpg`,
    );
  });

  it("are built the same way in the database", () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL("../../../supabase/migrations/20261121083600_seller_listings.sql", import.meta.url),
      ),
      "utf8",
    );
    const block = /-- BEGIN logo_path\n([\s\S]*?)-- END logo_path/.exec(sql)?.[1] ?? "";
    expect(block).toContain("p_seller_id::text || '/logo/' || p_logo_id::text || '/'");
    expect(block).toContain("|| p_size::text || '.' || private.photo_extension(p_format)");
  });
});

describe("a shop's description", () => {
  it("keeps the text as typed, without markup being anything but text", () => {
    expect(normaliseShopDescription("  <b>Café</b>   de altura  ")).toBe("<b>Café</b> de altura");
  });

  it("keeps paragraphs, at most one empty line between them", () => {
    expect(normaliseShopDescription("Uno\r\n\r\n\r\n\r\nDos\nTres")).toBe("Uno\n\nDos\nTres");
  });

  it("drops control characters and is null when nothing is left", () => {
    expect(normaliseShopDescription("a\u0000b\u0007c")).toBe("abc");
    expect(normaliseShopDescription(" \n\t ")).toBeNull();
  });

  it("has the database's limit", () => {
    expect(SHOP_DESCRIPTION_MAX).toBe(1000);
  });
});
