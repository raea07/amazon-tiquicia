import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkDecodedPhoto,
  checkDimensions,
  checkSourceFile,
  fitWithin,
  isPhotoTemplate,
  MAX_SOURCE_BYTES,
  normaliseAlt,
  PHOTO_BUCKETS,
  PHOTO_RULES,
  photoPath,
  photoSrcSet,
  photoUrl,
  renditionSizes,
  sniffImage,
} from "./photos";

const SELLER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const PHOTO = "33333333-3333-4333-8333-333333333333";
const TEMPLATE = `${SELLER}/${PRODUCT}/${PHOTO}/{w}.jpg`;

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("photo paths", () => {
  it("puts each size under the shop, the listing and the photo", () => {
    expect(photoPath(SELLER, PRODUCT, PHOTO, 800)).toBe(`${SELLER}/${PRODUCT}/${PHOTO}/800.jpg`);
    expect(photoPath(SELLER, PRODUCT, PHOTO, 400, "webp")).toBe(
      `${SELLER}/${PRODUCT}/${PHOTO}/400.webp`,
    );
    expect(photoPath(SELLER, PRODUCT, PHOTO, 1600, "png")).toBe(
      `${SELLER}/${PRODUCT}/${PHOTO}/1600.png`,
    );
  });

  it("refuses anything that is not an id or a known size", () => {
    expect(() => photoPath("../otra-tienda", PRODUCT, PHOTO, 400)).toThrow(RangeError);
    expect(() => photoPath(SELLER, PRODUCT, `${PHOTO}/..`, 400)).toThrow(RangeError);
    // @ts-expect-error: 500 is not a rendition size
    expect(() => photoPath(SELLER, PRODUCT, PHOTO, 500)).toThrow(RangeError);
  });

  it("tells photo templates from placeholder drawings", () => {
    expect(isPhotoTemplate(TEMPLATE)).toBe(true);
    expect(isPhotoTemplate("/demo/products/licuadora.svg")).toBe(false);
    expect(isPhotoTemplate(`${SELLER}/${PRODUCT}/${PHOTO}/400.jpg`)).toBe(false);
    expect(isPhotoTemplate(`https://evil.example/${TEMPLATE}`)).toBe(false);
    expect(isPhotoTemplate(`${SELLER}/${PRODUCT}/${PHOTO}/{w}.svg`)).toBe(false);
  });

  it("builds the public address and the srcset of an approved photo", () => {
    expect(photoUrl("https://abc.supabase.co/", TEMPLATE, 400)).toBe(
      `https://abc.supabase.co/storage/v1/object/public/${PHOTO_BUCKETS.public}/${SELLER}/${PRODUCT}/${PHOTO}/400.jpg`,
    );
    const set = photoSrcSet("http://127.0.0.1:54410", TEMPLATE);
    expect(set.split(", ")).toHaveLength(3);
    expect(set).toMatch(/400\.jpg 400w, .*800\.jpg 800w, .*1600\.jpg 1600w$/);
    expect(() => photoUrl("https://abc.supabase.co", "/demo/x.svg", 400)).toThrow(RangeError);
  });
});

describe("rendition sizes", () => {
  it("scales the longest side down to each size and never up", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 800)).toEqual({ width: 600, height: 800 });
    expect(fitWithin(700, 500, 1600)).toEqual({ width: 700, height: 500 });
    expect(fitWithin(10000, 10, 400)).toEqual({ width: 400, height: 1 });
    expect(() => fitWithin(0, 10, 400)).toThrow(RangeError);
  });

  it("derives the smaller sizes from the largest, so the stored size is enough", () => {
    const sizes = renditionSizes(4032, 3024);
    expect(sizes).toEqual([
      { size: 400, width: 400, height: 300 },
      { size: 800, width: 800, height: 600 },
      { size: 1600, width: 1600, height: 1200 },
    ]);
    // An odd ratio: the small sizes follow from 1600 × 1067, not from the original.
    const odd = renditionSizes(3000, 2001);
    const largest = odd.find((r) => r.size === 1600);
    expect(largest).toEqual({ size: 1600, width: 1600, height: 1067 });
    expect(odd.find((r) => r.size === 400)).toEqual(
      largest && { size: 400, ...fitWithin(largest.width, largest.height, 400) },
    );
  });

  it("refuses pictures that are too small for a product photo", () => {
    expect(checkDimensions(499, 300)).toBe("too_small");
    expect(checkDimensions(300, 500)).toBeNull();
  });
});

describe("what a file really is", () => {
  it("recognises JPEG, PNG and WebP from their first bytes", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffImage(text("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("webp");
  });

  it("recognises drawings, which may carry scripts", () => {
    expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
    expect(sniffImage(text('﻿  <?xml version="1.0"?>\n<svg></svg>'))).toBe("svg");
  });

  it("does not believe a file's name", () => {
    expect(sniffImage(text("Esto es texto, aunque el archivo se llame foto.jpg"))).toBeNull();
    expect(
      checkSourceFile({ size: 120, type: "image/jpeg", bytes: text("solo texto plano") }),
    ).toBe("not_an_image");
  });

  it("checks the original before opening it", () => {
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xdb);
    expect(checkSourceFile({ size: 3_000_000, type: "image/jpeg", bytes: jpeg })).toBeNull();
    expect(checkSourceFile({ size: MAX_SOURCE_BYTES + 1, type: "image/jpeg", bytes: jpeg })).toBe(
      "too_large",
    );
    expect(checkSourceFile({ size: 400, type: "image/svg+xml", bytes: text("<svg/>") })).toBe(
      "vector_image",
    );
    // An SVG renamed to .png is still a drawing.
    expect(checkSourceFile({ size: 400, type: "image/png", bytes: text("<svg></svg>") })).toBe(
      "vector_image",
    );
  });
});

describe("what the console publishes", () => {
  const recorded = { format: "jpeg" as const, width: 1600, height: 1200 };

  it("accepts the picture that was recorded", () => {
    expect(checkDecodedPhoto({ format: "jpeg", width: 1600, height: 1200 }, recorded)).toBeNull();
    // Rounding in a browser may differ by a pixel.
    expect(checkDecodedPhoto({ format: "jpeg", width: 1600, height: 1199 }, recorded)).toBeNull();
  });

  it("refuses what does not decode, another format, or another size", () => {
    expect(
      checkDecodedPhoto({ format: undefined, width: undefined, height: undefined }, recorded),
    ).toBe("not_an_image");
    expect(checkDecodedPhoto({ format: "png", width: 1600, height: 1200 }, recorded)).toBe(
      "wrong_format",
    );
    // A huge picture declared as 1600 px, served to phones as the small size.
    expect(checkDecodedPhoto({ format: "jpeg", width: 20000, height: 15000 }, recorded)).toBe(
      "wrong_size",
    );
    expect(checkDecodedPhoto({ format: "jpeg", width: 1200, height: 900 }, recorded)).toBe(
      "wrong_size",
    );
    expect(
      checkDecodedPhoto(
        { format: "jpeg", width: 400, height: 300 },
        { format: "jpeg", width: 400, height: 300 },
      ),
    ).toBe("wrong_size");
    expect(
      checkDecodedPhoto(
        { format: "jpeg", width: 1600, height: 1200 },
        { format: "jpeg", width: null, height: null },
      ),
    ).toBe("wrong_size");
  });
});

describe("alternative text", () => {
  it("collapses spaces and keeps it within the limits", () => {
    expect(normaliseAlt("  Licuadora   vista de frente ")).toBe("Licuadora vista de frente");
    expect(normaliseAlt("abc")).toBeNull();
    expect(normaliseAlt("x".repeat(PHOTO_RULES.altMax + 1))).toBeNull();
    expect(normaliseAlt("x".repeat(PHOTO_RULES.altMax))).toHaveLength(PHOTO_RULES.altMax);
  });
});

// ── The database must agree ────────────────────────────────────────────────

const migration = readFileSync(
  fileURLToPath(
    new URL("../../../supabase/migrations/20261121082700_product_photos.sql", import.meta.url),
  ),
  "utf8",
);
const between = (name: string) => {
  const match = new RegExp(`-- BEGIN ${name}\\n([\\s\\S]*?)-- END ${name}`).exec(migration);
  if (!match?.[1]) throw new Error(`markers ${name} not found`);
  return match[1];
};

describe("photo rules in the database", () => {
  const rules = between("photo_rules");
  const number = (key: string) => Number(new RegExp(`'${key}', (\\d+)`).exec(rules)?.[1]);

  it("are the same numbers", () => {
    expect(
      /'sizes', jsonb_build_array\(([\d, ]+)\)/.exec(rules)?.[1]?.split(", ").map(Number),
    ).toEqual([...PHOTO_RULES.sizes]);
    expect(number("max_photos")).toBe(PHOTO_RULES.maxPhotos);
    expect(number("max_bytes")).toBe(PHOTO_RULES.maxBytes);
    expect(number("min_edge")).toBe(PHOTO_RULES.minEdge);
    expect(number("alt_min")).toBe(PHOTO_RULES.altMin);
    expect(number("alt_max")).toBe(PHOTO_RULES.altMax);
    expect(number("upload_window_minutes")).toBe(PHOTO_RULES.uploadWindowMinutes);
    expect(number("max_waiting_per_shop")).toBe(PHOTO_RULES.maxWaitingPerShop);
    expect(number("max_new_per_day")).toBe(PHOTO_RULES.maxNewPerDay);
  });

  it("create the buckets with the same names and size limit", () => {
    for (const bucket of Object.values(PHOTO_BUCKETS)) {
      expect(migration).toContain(
        `('${bucket}', '${bucket}', ${bucket === PHOTO_BUCKETS.public}, ${PHOTO_RULES.maxBytes},`,
      );
    }
  });

  it("lay out paths the same way", () => {
    const path = between("photo_path");
    expect(path).toContain(
      "p_seller_id::text || '/' || p_product_id::text || '/' || p_photo_id::text || '/'",
    );
    expect(path).toContain("|| p_size::text || '.' || private.photo_extension(p_format)");
  });
});
