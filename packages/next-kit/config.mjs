// @ts-check
/**
 * Next.js settings shared by every Yuntera web app, so a security header or a
 * build option is changed once and applies everywhere.
 *
 * Plain JavaScript on purpose: next.config.ts is loaded by Node before the
 * framework's compiler is running, so it cannot import TypeScript source.
 */

/**
 * @typedef {object} AppSecurity
 * @property {boolean} [camera]       The app scans barcodes with the camera.
 * @property {boolean} [geolocation]  The app asks for the device's position.
 */

/**
 * Security headers applied to every response.
 *
 * The Content-Security-Policy is static (no per-request nonce) on purpose: a
 * nonce would force every page to render at request time and give up the
 * prerendered shell. `'unsafe-inline'` for scripts is required by the
 * framework's inline bootstrap; the policy still blocks third-party script
 * origins, framing, plugins and form posts to other sites.
 *
 * @param {AppSecurity} [options]
 */
export function securityHeaders(options = {}) {
  const apiOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321")
    .origin;
  const isDev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}${isDev ? " ws: http://127.0.0.1:* http://localhost:*" : ""}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const permissions = [
    `geolocation=(${options.geolocation ? "self" : ""})`,
    `camera=(${options.camera ? "self" : ""})`,
    "microphone=()",
    "payment=()",
  ].join(", ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: permissions },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}

/**
 * The base configuration. Apps spread it and add what is theirs.
 *
 * @param {AppSecurity & { internal?: boolean }} [options]
 *   `internal` marks a staff-only app: search engines are told to stay out.
 * @returns {import("next").NextConfig}
 */
export function baseConfig(options = {}) {
  const headers = securityHeaders(options);
  if (options.internal) headers.push({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  return {
    cacheComponents: true,
    partialPrefetching: true,
    typedRoutes: true,
    poweredByHeader: false,
    turbopack: {
      rules: {
        "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
      },
    },
    async headers() {
      return [{ source: "/:path*", headers }];
    },
  };
}
