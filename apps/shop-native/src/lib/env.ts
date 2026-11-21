import { isPhotoTemplate, photoUrl } from "@yuntera/core";
import { publicEnv } from "@yuntera/expo-kit/supabase";

/**
 * The public settings this app was built with. Written out literally because
 * Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle only in this form.
 */
export const env = publicEnv({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

/** Where product pictures and the website's pages live. Empty: the same origin (web export). */
export const shopUrl = (process.env.EXPO_PUBLIC_SHOP_URL ?? "").replace(/\/$/, "");

/**
 * A picture path from the API as a full address. An approved product photo
 * comes as a template ("<shop>/<listing>/<photo>/{w}.jpg") and is read from the
 * public photo bucket at the API's address, in the smallest size that is at
 * least `width` points wide (doubled for sharp screens); the demo drawings
 * ("/demo/products/x.svg") come from the shop.
 */
export function imageUrl(path: string | null | undefined, width = 400): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  if (isPhotoTemplate(path)) {
    const wanted = width * 2;
    const size = wanted <= 400 ? 400 : wanted <= 800 ? 800 : 1600;
    return photoUrl(env.supabaseUrl, path, size);
  }
  return `${shopUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
