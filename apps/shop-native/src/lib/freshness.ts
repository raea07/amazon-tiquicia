/**
 * How long the shopper app trusts what staff can change at any time.
 *
 * The category menu used to be kept for an hour, so a category staff had
 * just hidden could show for that long. The website drops its copy the
 * moment staff act (a tagged cache); the app cannot be told, so it does both
 * of the cheap things instead:
 *
 *   - a short life: after 5 minutes the menu is read again the next time a
 *     screen that shows it is opened or drawn, so moving between screens
 *     costs no request in between;
 *   - a refresh whenever the app comes back to the foreground, fresh or not
 *     (`"always"`), because that is when a shopper who left the app open for
 *     hours looks at it again. The kit tells the cache when that happens
 *     (wireAppLifecycle: AppState on a phone, the page's visibility on the
 *     web export).
 *
 * A hidden category's products stay on sale and in search (decision 40), so
 * a menu at most minutes old shows nothing that cannot be bought.
 */

export const CATEGORY_MENU_STALE_MS = 5 * 60_000;

export const CATEGORY_MENU_CACHE = {
  staleTime: CATEGORY_MENU_STALE_MS,
  refetchOnWindowFocus: "always",
} as const;
