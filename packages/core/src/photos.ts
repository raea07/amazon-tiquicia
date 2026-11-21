/**
 * Product photos: the rules a photo must meet, where its files live, and how
 * the shop asks for the right size.
 *
 * Mirrored in SQL by `private.photo_rules()` and `private.photo_path()` in
 * supabase/migrations/20261121082700_product_photos.sql; `photos.test.ts` reads
 * that migration and fails if the two disagree. Pure: no browser, no I/O, so
 * the seller centre, the shop, the console and a phone app all use the same
 * numbers.
 *
 * How a photo is stored. The seller's device resizes the picture and uploads
 * three copies (renditions), each named by the longest side it was scaled to:
 *
 *   <seller id>/<product id>/<photo id>/400.jpg     thumbnails, cart, lists
 *   <seller id>/<product id>/<photo id>/800.jpg     product page on a phone
 *   <seller id>/<product id>/<photo id>/1600.jpg    product page, larger screens
 *
 * The same path is used in the private bucket (waiting for review) and in the
 * public bucket (approved). Promotion does not copy the seller's files: the
 * console decodes the largest waiting copy (the one staff looked at) and makes
 * the three public sizes from it, so a client that uploaded three different
 * pictures, or left location data in them, cannot get either into the shop.
 * The free plan has no image transformation and the web host's optimiser is
 * billed per image, so these copies are the only sizes there are.
 */

export const PHOTO_RULES = {
  /** Longest side of each rendition, smallest first. */
  sizes: [400, 800, 1600],
  /** Photos a listing may have, counting those waiting for review. */
  maxPhotos: 8,
  /** Largest accepted file, per rendition, in bytes (the buckets enforce it too). */
  maxBytes: 2 * 1024 * 1024,
  /** The longest side of the largest rendition must be at least this. */
  minEdge: 500,
  /** Alternative text, in characters after trimming. */
  altMin: 5,
  altMax: 250,
  /** Minutes a reserved photo may stay without its files before it is abandoned. */
  uploadWindowMinutes: 120,
  /**
   * Photos a shop may have waiting at once, over all its listings. Files of
   * removed or abandoned photos count until they are deleted.
   */
  maxWaitingPerShop: 40,
  /** New photos a shop may start in a day. */
  maxNewPerDay: 100,
} as const;

/** Largest original file the browser will try to open, in bytes. Not a server rule. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export const PHOTO_BUCKETS = {
  /** Private: what sellers upload, until staff decide. */
  pending: "product-photos-pending",
  /** Public: approved photos, served to anyone. */
  public: "product-photos",
} as const;

export type PhotoFormat = "jpeg" | "png" | "webp";

export const PHOTO_CONTENT_TYPE: Record<PhotoFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const PHOTO_EXTENSION: Record<PhotoFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

export type PhotoSize = (typeof PHOTO_RULES.sizes)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where one rendition of a photo lives inside either bucket. */
export function photoPath(
  sellerId: string,
  productId: string,
  photoId: string,
  size: PhotoSize,
  format: PhotoFormat = "jpeg",
): string {
  for (const id of [sellerId, productId, photoId]) {
    if (!UUID.test(id)) throw new RangeError(`not an id: ${id}`);
  }
  if (!PHOTO_RULES.sizes.includes(size)) throw new RangeError(`not a photo size: ${size}`);
  return `${sellerId}/${productId}/${photoId}/${size}.${PHOTO_EXTENSION[format]}`;
}

/**
 * A photo as the database hands it to the shop: its path with `{w}` where the
 * size goes, for example `…/…/…/{w}.jpg`. Placeholder drawings come as plain
 * site paths (`/demo/products/x.svg`) and are not templates.
 */
export function isPhotoTemplate(path: string): boolean {
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/\{w\}\.(jpg|png|webp)$/.test(path);
}

/** The public address of one rendition of an approved photo. */
export function photoUrl(apiUrl: string, template: string, size: PhotoSize): string {
  if (!isPhotoTemplate(template)) throw new RangeError(`not a photo template: ${template}`);
  const base = apiUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${PHOTO_BUCKETS.public}/${template.replace("{w}", String(size))}`;
}

/**
 * `srcset` for an approved photo. Each rendition is described by its longest
 * side, which is exact for a square frame that shows the whole photo
 * (`object-fit: contain`), the way the shop shows them.
 */
export function photoSrcSet(
  apiUrl: string,
  template: string,
  sizes: readonly PhotoSize[] = PHOTO_RULES.sizes,
): string {
  return sizes.map((size) => `${photoUrl(apiUrl, template, size)} ${size}w`).join(", ");
}

/**
 * Pixel size of a rendition made from a picture of `width` × `height`: scaled
 * down so its longest side is at most `edge`, never scaled up, rounded to
 * whole pixels and never below one.
 */
export function fitWithin(
  width: number,
  height: number,
  edge: number,
): { width: number; height: number } {
  if (!(width > 0 && height > 0 && edge > 0)) throw new RangeError("sizes must be positive");
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Every rendition of a picture. The largest is made from the original; the
 * smaller ones from the largest, so that anyone who knows only the largest
 * size (it is what the database stores) can work out the others exactly.
 */
export function renditionSizes(
  width: number,
  height: number,
): { size: PhotoSize; width: number; height: number }[] {
  const sizes = [...PHOTO_RULES.sizes].sort((a, b) => b - a);
  const [largestEdge, ...rest] = sizes;
  if (largestEdge === undefined) return [];
  const largest = fitWithin(width, height, largestEdge);
  return [
    { size: largestEdge, ...largest },
    ...rest.map((size) => ({ size, ...fitWithin(largest.width, largest.height, size) })),
  ].sort((a, b) => a.size - b.size);
}

/** Why a chosen file cannot become a photo, before anything is uploaded. */
export type PhotoProblem =
  | "not_an_image" // the bytes are not a JPEG, PNG or WebP picture
  | "vector_image" // SVG and other drawings that can carry scripts
  | "too_large" // the original is bigger than the browser will open
  | "too_small" // fewer pixels than a product photo needs
  | "too_many"; // the listing already has as many photos as it may

/**
 * What a file really is, from its first bytes rather than its name or the
 * type the browser guessed from the name. A text file renamed to .jpg is not
 * a JPEG here.
 */
export function sniffImage(bytes: Uint8Array): PhotoFormat | "svg" | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return "png";
  }
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(from, to)));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  // Drawings are text. Skip a byte-order mark and white space, then look for markup.
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 512))
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

/**
 * Checks a chosen file before the browser spends time opening it. `bytes`
 * are its first bytes (16 are enough for the formats, 512 for drawings).
 */
export function checkSourceFile(file: {
  size: number;
  type: string;
  bytes: Uint8Array;
}): PhotoProblem | null {
  const kind = sniffImage(file.bytes);
  if (kind === "svg" || /svg/i.test(file.type)) return "vector_image";
  if (file.size > MAX_SOURCE_BYTES) return "too_large";
  if (kind === null) return "not_an_image";
  return null;
}

/** Checks a picture's pixel size once it has been opened. */
export function checkDimensions(width: number, height: number): PhotoProblem | null {
  return Math.max(width, height) < PHOTO_RULES.minEdge ? "too_small" : null;
}

/** Why the console will not publish a waiting photo, once it has decoded it. */
export type DecodedPhotoProblem =
  | "not_an_image" // the bytes do not decode as a picture at all
  | "wrong_format" // a picture, but not the format the photo was recorded with
  | "wrong_size"; // larger than the largest rendition, too small, or not the recorded size

/**
 * Checks what the largest waiting copy really is, as decoded on the server,
 * against what was recorded for the photo when it was finished. A client that
 * skipped the browser's resizing can declare any type and any size; this is
 * where that stops mattering.
 */
export function checkDecodedPhoto(
  decoded: { format: string | undefined; width: number | undefined; height: number | undefined },
  recorded: { format: PhotoFormat; width: number | null; height: number | null },
): DecodedPhotoProblem | null {
  const { format, width, height } = decoded;
  if (!format || !width || !height) return "not_an_image";
  if (format !== recorded.format) return "wrong_format";
  const largest = Math.max(...PHOTO_RULES.sizes);
  const edge = Math.max(width, height);
  if (edge > largest || edge < PHOTO_RULES.minEdge) return "wrong_size";
  if (
    recorded.width === null ||
    recorded.height === null ||
    Math.abs(width - recorded.width) > 1 ||
    Math.abs(height - recorded.height) > 1
  ) {
    return "wrong_size";
  }
  return null;
}

/** Alternative text as it will be stored, or null when it is not acceptable. */
export function normaliseAlt(alt: string): string | null {
  const trimmed = alt.replace(/\s+/g, " ").trim();
  return trimmed.length >= PHOTO_RULES.altMin && trimmed.length <= PHOTO_RULES.altMax
    ? trimmed
    : null;
}
