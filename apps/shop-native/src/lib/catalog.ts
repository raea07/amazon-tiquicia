import { useApiQuery } from "@yuntera/expo-kit/data";
import { useCart } from "./cart-context";
import { CATEGORY_MENU_CACHE } from "./freshness";

/**
 * The category menu. Staff hide and rename categories at any time (decision
 * 40), so it is kept for minutes, not an hour, and read again whenever the
 * app comes back to the screen (see lib/freshness.ts): no request on every
 * screen, and a hidden category gone at the latest a few minutes later.
 */
export const useCategories = () =>
  useApiQuery(["categories"], (api) => api.listCategories(), CATEGORY_MENU_CACHE);

/** The 494 districts change by deploy: kept for a day. */
export const useDistricts = () =>
  useApiQuery(["districts"], (api) => api.listDistricts(), { staleTime: 24 * 60 * 60_000 });

/** The name of the district the shopper chose, or null if they have not chosen one. */
export function useDistrictName(): string | null {
  const { postalCode, locationChosen } = useCart();
  const districts = useDistricts();
  if (!locationChosen) return null;
  return districts.data?.find((d) => d.postal_code === postalCode)?.district ?? null;
}
