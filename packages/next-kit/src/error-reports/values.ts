import type { BuildValues } from "./settings";

/**
 * The values the build inlined. Each is written out as `process.env.NAME` so
 * the framework replaces it with the value at build time, in the browser code
 * as well as on the server: NEXT_PUBLIC_SENTRY_DSN from the website's
 * settings, the other three from next-kit/config. Unset means off.
 */
export const buildValues = (): BuildValues => ({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  app: process.env.YUNTERA_APP,
  commit: process.env.YUNTERA_BUILD_COMMIT,
  environment: process.env.YUNTERA_ENVIRONMENT,
});
