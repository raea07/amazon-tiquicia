import { publicEnv } from "@yuntera/expo-kit/supabase";

/**
 * The public settings this app was built with. Written out literally because
 * Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle only in this form.
 */
export const env = publicEnv({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

/**
 * The shop's website, where the link of a password-reset e-mail lands. Not
 * secret. Unset: the planned public address (the kit's DEFAULT_WEBSITE).
 */
export const shopUrl = (process.env.EXPO_PUBLIC_SHOP_URL ?? "").replace(/\/$/, "") || undefined;
