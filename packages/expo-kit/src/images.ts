/**
 * Where a product picture the API names is read from, for every app that
 * shows one (the shopper app, the sellers' app). An approved photo comes as a
 * template ("<shop>/<listing>/<photo>/{w}.jpg") and is read from the public
 * photo bucket at the API's address, in the smallest size that is at least
 * `width` points wide, doubled for sharp screens; the demo drawings
 * ("/demo/products/x.svg") come from the shop website (`shopUrl`, empty in
 * the web export, which serves them from its own origin). Pure, so
 * `images.test.ts` runs in Node.
 */

import { isPhotoTemplate, photoUrl } from "@yuntera/core";

export function imageUrlFor(where: { apiUrl: string; shopUrl: string }) {
  const shop = where.shopUrl.replace(/\/$/, "");
  return (path: string | null | undefined, width = 400): string | null => {
    if (!path) return null;
    if (/^https?:\/\//.test(path)) return path;
    if (isPhotoTemplate(path)) {
      const wanted = width * 2;
      const size = wanted <= 400 ? 400 : wanted <= 800 ? 800 : 1600;
      return photoUrl(where.apiUrl, path, size);
    }
    return `${shop}${path.startsWith("/") ? path : `/${path}`}`;
  };
}
