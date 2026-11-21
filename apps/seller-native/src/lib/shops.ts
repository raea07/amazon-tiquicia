import { useSession } from "@yuntera/expo-kit/auth";

/** The shops this account belongs to, as the database reports them (never from the token). */
export function useAccessibleShops() {
  return useSession().roles?.sellers ?? [];
}
