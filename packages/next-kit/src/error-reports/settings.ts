/**
 * The error tracker's settings for one website. Pure and small, because the
 * browser runs it on every page before anything else: the callers hand in
 * the values the build inlined
 * (`process.env.NEXT_PUBLIC_SENTRY_DSN`, `YUNTERA_APP`, `YUNTERA_BUILD_COMMIT`,
 * `YUNTERA_ENVIRONMENT`, set by next-kit/config), so the same rules are
 * tested here and applied in the browser and on the server.
 */
import { errorTrackerIngest } from "../../error-tracker.mjs";
import type { ReportingApp } from "./scrub";

export interface BuildValues {
  dsn?: string | null;
  app?: string | null;
  commit?: string | null;
  environment?: string | null;
}

export interface TrackerSettings {
  dsn: string;
  app: ReportingApp;
  environment: string;
  /** `yuntera-<app>@<first 12 characters of the commit>`. */
  release: string;
}

const APPS: readonly ReportingApp[] = ["web", "seller", "ops", "field"];

/**
 * Null, and so nothing started, loaded or sent, unless a usable public DSN
 * was set when the website was built and the website is one of the four.
 */
export function trackerSettings(values: BuildValues): TrackerSettings | null {
  const ingest = errorTrackerIngest(values.dsn);
  const app = APPS.find((name) => name === values.app);
  if (!ingest || !app) return null;
  const commit = /^[0-9a-f]{7,40}$/.test(values.commit ?? "")
    ? (values.commit ?? "").slice(0, 12)
    : "unknown";
  const environment = /^[a-z][a-z-]{0,30}$/.test(values.environment ?? "")
    ? (values.environment ?? "")
    : "unknown";
  return { dsn: ingest.dsn, app, environment, release: `yuntera-${app}@${commit}` };
}
