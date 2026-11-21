import { publicEnv } from "@yuntera/expo-kit/supabase";

/**
 * The public settings this app was built with. Written out literally because
 * Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle only in this form.
 */
export const env = publicEnv({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});
