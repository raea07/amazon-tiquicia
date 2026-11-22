import "server-only";
import { checkSecret } from "../guard";

/**
 * Tells the shop that its catalogue changed (an edit was approved, a listing
 * was archived), so shoppers see it now instead of when the shop's cache next
 * expires. See apps/web/src/app/api/catalogo/refrescar.
 *
 * Best effort on purpose: the change is already saved in the database, and
 * the shop catches up by itself if this call is lost. It therefore never
 * throws and never waits long. It needs NEXT_PUBLIC_SHOP_URL and the
 * server-only SHOP_REFRESH_KEY that the shop also has; without them it does
 * nothing. Outside a local run a short or example key is refused here too,
 * and logged, exactly as the shop refuses it (WEB-8).
 *
 * Only the shop's own answer, 204, counts as done. Redirects are not followed:
 * in front of a deployment that sits behind a login (Vercel Authentication on
 * the preview) the call is redirected to a login page that answers 200, and
 * following it would report a refresh that never happened. Anything else is
 * logged, so a lost refresh shows in the logs instead of passing in silence.
 */
export async function refreshShopCatalog(options: { categories?: boolean } = {}): Promise<void> {
  const shop = process.env.NEXT_PUBLIC_SHOP_URL;
  if (!shop || !process.env.SHOP_REFRESH_KEY) return;
  const check = checkSecret("SHOP_REFRESH_KEY", process.env.SHOP_REFRESH_KEY, process.env);
  if (!check.ok) {
    console.error(`The shop was not asked to refresh its catalogue: ${check.reason}.`);
    return;
  }
  const key = check.value;
  try {
    const response = await fetch(new URL("/api/catalogo/refrescar", shop), {
      method: "POST",
      // The category menu sits in every page's prepared shell, so it is dropped
      // only when categories changed (asked for here), not with every refresh.
      headers: options.categories
        ? { "x-refresh-key": key, "x-refresh-scope": "categories" }
        : { "x-refresh-key": key },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });
    if (response.status !== 204) {
      console.error(`The shop did not refresh its catalogue: ${describe(response)}`);
    }
    await response.body?.cancel();
  } catch (error) {
    console.error("The shop could not be told that its catalogue changed", error);
  }
}

/** The status, and where a redirect pointed (host only: the rest may carry tokens). */
function describe(response: Response): string {
  const location = response.headers.get("location");
  if (!location) return `HTTP ${response.status}`;
  let host = "another address";
  try {
    host = new URL(location, "http://relative.invalid").host;
  } catch {
    // An unreadable Location header is still a redirect, and still a failure.
  }
  return `HTTP ${response.status}, redirected to ${host}`;
}
