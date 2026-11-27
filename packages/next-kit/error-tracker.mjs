// @ts-check
// The error tracker's address rules, in plain JavaScript with no Node.js
// import, because both next.config (through config.mjs) and the browser code
// (src/error-reports/settings.ts) use them.

/**
 * Where the error tracker (Sentry) receives this app's reports, read from its
 * public address, the DSN (`NEXT_PUBLIC_SENTRY_DSN`, set per website when it
 * is built). The DSN is public by design: it only says where to send and
 * holds no secret. An old-style DSN that carries a secret key, anything that
 * is not http(s), and plain http to anything but this machine are refused, so
 * the tracker then stays off (docs/07-deployment/error-tracking.md).
 *
 * Returns null when nothing usable is set: nothing is then started, loaded or
 * sent, and the security headers do not mention the tracker.
 *
 * @param {string | undefined | null} dsn
 * @returns {{ dsn: string, origin: string, projectId: string, connectSource: string } | null}
 */
export function errorTrackerIngest(dsn) {
  if (!dsn || typeof dsn !== "string") return null;
  /** @type {URL} */
  let url;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol === "http:" && !loopback) return null;
  // The public key sits where a user name would; a password there is a secret.
  if (!url.username || url.password) return null;
  if (url.search || url.hash) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const projectId = parts.pop() ?? "";
  if (!/^\d+$/.test(projectId)) return null;
  const prefix = parts.length > 0 ? `/${parts.join("/")}` : "";
  return {
    dsn: url.href,
    origin: url.origin,
    projectId,
    // The one address the browser posts reports to (the SDK adds its public
    // key as a query, which a source expression does not look at).
    connectSource: `${url.origin}${prefix}/api/${projectId}/envelope/`,
  };
}
