/**
 * A shop's logo goes through the product-photo pipeline (photos.ts and
 * 20261121082700_product_photos.sql): the seller's browser makes the same
 * three sizes, they wait in the private bucket, catalogue staff review the
 * largest one, and the console writes the public sizes from that copy. Only
 * the path differs, so a logo can never be mistaken for a listing's photo:
 *
 *   <seller id>/logo/<logo id>/<size>.<ext>
 *
 * The database builds the same in private.logo_path
 * (20261121083600_seller_listings.sql, between `-- BEGIN logo_path` and
 * `-- END logo_path`); shop-logos.test.ts compares the two.
 */

import {
  PHOTO_BUCKETS,
  PHOTO_EXTENSION,
  PHOTO_RULES,
  type PhotoFormat,
  type PhotoSize,
} from "./photos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where one rendition of a logo lives inside either bucket. */
export function logoPath(
  sellerId: string,
  logoId: string,
  size: PhotoSize,
  format: PhotoFormat = "jpeg",
): string {
  for (const id of [sellerId, logoId]) {
    if (!UUID.test(id)) throw new RangeError(`not an id: ${id}`);
  }
  if (!PHOTO_RULES.sizes.includes(size)) throw new RangeError(`not a logo size: ${size}`);
  return `${sellerId}/logo/${logoId}/${size}.${PHOTO_EXTENSION[format]}`;
}

/** A logo as the database hands it to the shop: its path with `{w}` where the size goes. */
export function isLogoTemplate(path: string): boolean {
  return /^[0-9a-f-]{36}\/logo\/[0-9a-f-]{36}\/\{w\}\.(jpg|png|webp)$/.test(path);
}

/** The public address of one rendition of a published logo. */
export function logoUrl(apiUrl: string, template: string, size: PhotoSize): string {
  if (!isLogoTemplate(template)) throw new RangeError(`not a logo template: ${template}`);
  const base = apiUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${PHOTO_BUCKETS.public}/${template.replace("{w}", String(size))}`;
}

/** Longest description a shop may show, in characters (the database checks the same). */
export const SHOP_DESCRIPTION_MAX = 1000;

/**
 * A description as the database stores it: line breaks kept (at most two in
 * a row), other control characters dropped, spaces collapsed, trimmed; null
 * when nothing is left. It is always shown as text, never as markup.
 */
export function normaliseShopDescription(text: string): string | null {
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned === "" ? null : cleaned;
}
