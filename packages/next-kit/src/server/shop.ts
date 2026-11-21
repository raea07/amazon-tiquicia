import "server-only";

/**
 * Tells the shop that a product's page may have changed, so shoppers see the
 * change now instead of when the shop's cache next expires (about a minute).
 *
 * Best effort on purpose: the change is already saved in the database, and
 * the shop catches up by itself if this call is lost. It therefore never
 * throws and never waits long.
 */
export async function refreshShopProduct(slug: string): Promise<void> {
  const shop = process.env.NEXT_PUBLIC_SHOP_URL;
  if (!shop) return;
  try {
    await fetch(new URL("/api/catalogo/refrescar", shop), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    console.error("The shop could not be told about a changed product", error);
  }
}
