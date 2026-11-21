import { useApiQuery } from "@yuntera/expo-kit/data";
import { useCart } from "./cart-context";

/** Categories change by staff action: kept for an hour. */
export const useCategories = () =>
  useApiQuery(["categories"], (api) => api.listCategories(), { staleTime: 60 * 60_000 });

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
