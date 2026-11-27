// @ts-check
/**
 * Next.js settings shared by every Yuntera web app, so a security header or a
 * build option is changed once and applies everywhere.
 *
 * Plain JavaScript on purpose: next.config.ts is loaded by Node before the
 * framework's compiler is running, so it cannot import TypeScript source.
 */

import { execFileSync } from "node:child_process";
import { errorTrackerIngest } from "./error-tracker.mjs";

export { errorTrackerIngest };

/**
 * @typedef {object} AppSecurity
 * @property {boolean} [camera]       The app scans barcodes with the camera.
 * @property {boolean} [geolocation]  The app asks for the device's position.
 * @property {boolean} [photoUpload]  The browser uploads product photos to the
 *   signed upload addresses of the project's storage (the seller centre).
 */

/**
 * The optional human check on the sign-in forms (Cloudflare Turnstile, which
 * Supabase Auth verifies once CAPTCHA protection is switched on there). Off
 * unless its public site key is set when the app is built.
 */
export const CAPTCHA_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Which commit and which environment this build is, for the error reports
 * (and anything else that wants to say which version is running). A commit is
 * not a secret. On Vercel both come from the build's own settings; elsewhere
 * the commit is asked of git, and the environment is "local" for the lanes'
 * production builds (YUNTERA_LOCAL_RUN) or "development".
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ commit: string, environment: string }}
 */
export function buildInfo(env = process.env) {
  let commit = env.VERCEL_GIT_COMMIT_SHA || "";
  if (!commit) {
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
    } catch {
      commit = "";
    }
  }
  if (!/^[0-9a-f]{7,40}$/.test(commit)) commit = "unknown";
  const vercel = env.VERCEL_ENV;
  const environment =
    vercel === "production" || vercel === "preview" || vercel === "development"
      ? vercel
      : env.YUNTERA_LOCAL_RUN === "1"
        ? "local"
        : "development";
  return { commit, environment };
}

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
  const captcha = process.env.NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY ? ` ${CAPTCHA_ORIGIN}` : "";
  // Error reports go from the browser to the tracker's one ingest address,
  // and only when a tracker is configured for this build.
  const tracker = errorTrackerIngest(process.env.NEXT_PUBLIC_SENTRY_DSN);
  const reports = tracker ? ` ${tracker.connectSource}` : "";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${captcha}`,
    "style-src 'self' 'unsafe-inline'",
    // Pictures: the app itself (icons, placeholder drawings), previews of a
    // photo being chosen (blob:), and the project's own storage, nothing else.
    `img-src 'self' data: blob: ${apiOrigin}/storage/v1/object/`,
    "font-src 'self'",
    // Only the app itself (WEB-9): every API call is made on the server. The
    // one exception is the seller centre's photo upload, which sends the
    // resized files straight to storage, to a signed address only (useless
    // without the token in it). The development server adds its reload socket.
    `connect-src 'self'${options.photoUpload ? ` ${apiOrigin}/storage/v1/object/upload/sign/` : ""}${isDev ? " ws: http://127.0.0.1:* http://localhost:*" : ""}${captcha}${reports}`,
    `frame-src ${captcha ? CAPTCHA_ORIGIN : "'none'"}`,
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
 * @param {AppSecurity & { internal?: boolean, app: "web" | "seller" | "ops" | "field" }} options
 *   `internal` marks a staff-only app: search engines are told to stay out.
 *   `app` says which app this is, for its session lifetime (guard.ts).
 * @returns {import("next").NextConfig}
 */
export function baseConfig(options) {
  const headers = securityHeaders(options);
  if (options.internal) headers.push({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  const build = buildInfo();
  return {
    // Inlined at build time into the server code, the proxy and the browser
    // code alike. The commit and the environment name the version in error
    // reports (src/error-reports); neither is a secret.
    env: {
      YUNTERA_APP: options.app,
      YUNTERA_COMMIT: build.commit,
      YUNTERA_ENVIRONMENT: build.environment,
    },
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
