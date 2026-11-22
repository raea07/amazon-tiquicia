import { imageUrlFor } from "@yuntera/expo-kit/images";
import { publicEnv } from "@yuntera/expo-kit/supabase";

/**
 * The public settings this app was built with. Written out literally because
 * Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle only in this form.
 */
export const env = publicEnv({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

/** The shop website (demo drawings, the help page). Empty: the same origin (web export). */
export const shopUrl = (process.env.EXPO_PUBLIC_SHOP_URL ?? "").replace(/\/$/, "");

/**
 * A picture path from the API as a full address: an approved photo from the
 * public photo bucket, a demo drawing from the shop (packages/expo-kit/src/images.ts).
 */
export const imageUrl = imageUrlFor({ apiUrl: env.supabaseUrl, shopUrl });
