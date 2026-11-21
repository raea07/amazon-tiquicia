import "server-only";

/**
 * Tells the shop that its catalogue changed (an edit was approved, a listing
 * was archived), so shoppers see it now instead of when the shop's cache next
 * expires (about a minute). See apps/web/src/app/api/catalogo/refrescar.
 *
 * Best effort on purpose: the change is already saved in the database, and
 * the shop catches up by itself if this call is lost. It therefore never
 * throws and never waits long. It needs NEXT_PUBLIC_SHOP_URL and the
 * server-only SHOP_REFRESH_KEY that the shop also has; without them it does
 * nothing.
 */
export async function refreshShopCatalog(): Promise<void> {
  const shop = process.env.NEXT_PUBLIC_SHOP_URL;
  const key = process.env.SHOP_REFRESH_KEY;
  if (!shop || !key) return;
  try {
    const response = await fetch(new URL("/api/catalogo/refrescar", shop), {
      method: "POST",
      headers: { "x-refresh-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok)
      console.error(`The shop refused to refresh its catalogue (${response.status})`);
  } catch (error) {
    console.error("The shop could not be told that its catalogue changed", error);
  }
}
