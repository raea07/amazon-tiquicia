/**
 * The address an e-mail link may point at, as Auth decides it
 * (`isRedirectURLValid`): the requested `redirect_to` when it is on the site
 * URL's own host or matches an entry of `uri_allow_list` (`*` matches within a
 * host label or path segment, `**` matches anything), otherwise the site URL.
 * So `{{ .RedirectTo }}` is never empty, and a disallowed address never
 * reaches an e-mail.
 */
export function redirectFor(
  requested: string | null | undefined,
  siteUrl: string,
  allowList: readonly string[],
): string {
  if (!requested) return siteUrl;
  let target: URL;
  try {
    target = new URL(requested);
  } catch {
    return siteUrl;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return siteUrl;
  if (target.hostname === new URL(siteUrl).hostname) return requested;
  const allowed = allowList
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((pattern) => globToRegExp(pattern).test(requested));
  return allowed ? requested : siteUrl;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/.]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`);
}
