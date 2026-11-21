import { publicEnv } from "@yuntera/expo-kit/supabase";

/**
 * The public settings this app was built with. Written out literally because
 * Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle only in this form.
 */
export const env = publicEnv({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

/** Where product pictures live (the shop website). Empty: the same origin (web export). */
export const shopUrl = (process.env.EXPO_PUBLIC_SHOP_URL ?? "").replace(/\/$/, "");

/** A picture path from the API ("/demo/products/x.svg") as a full address. */
export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${shopUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
