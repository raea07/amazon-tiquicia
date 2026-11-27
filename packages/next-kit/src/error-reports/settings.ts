/**
 * The error tracker's settings for one website, and the options its SDK is
 * started with. Pure: the callers hand in the values the build inlined
 * (`process.env.NEXT_PUBLIC_SENTRY_DSN`, `YUNTERA_APP`, `YUNTERA_COMMIT`,
 * `YUNTERA_ENVIRONMENT`, set by next-kit/config), so the same rules are
 * tested here and applied in the browser and on the server.
 */
import { errorTrackerIngest } from "../../config.mjs";
import { dropBreadcrumb, type ReportingApp, scrubEvent, type TrackerEvent } from "./scrub";

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

/**
 * Integrations kept from the SDK's defaults, by name: the ones that catch
 * errors and shape the stack. Everything else is left out, among them the
 * breadcrumbs (clicks, typing, console, visited addresses), the request
 * data, the session tracking, the tracing, local variables, the page's
 * language and time zone, and any integration a later SDK version adds.
 * Session replay, screenshots, profiling and the feedback widget are never
 * added.
 */
export const KEPT_INTEGRATIONS: ReadonlySet<string> = new Set([
  // Both sides
  "InboundFilters",
  "EventFilters",
  "FunctionToString",
  "LinkedErrors",
  "Dedupe",
  // Browser: uncaught errors and rejections, errors inside timers and events,
  // and file names made comparable across builds.
  "GlobalHandlers",
  "BrowserApiErrors",
  "NextjsClientStackFrameNormalization",
  // Server: uncaught errors and rejections, and file names made comparable
  // across builds.
  "OnUncaughtException",
  "OnUnhandledRejection",
  "DistDirRewriteFrames",
]);

/** Nothing collected automatically, in every category the SDK knows. */
export const NO_DATA_COLLECTION: NonNullable<SdkOptions["dataCollection"]> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

type SdkOptions = NonNullable<Parameters<typeof import("@sentry/nextjs").init>[0]>;

/**
 * The options both SDKs (browser and server) are started with; checked
 * against the real SDK in standin.test.ts.
 */
export function sdkOptions(settings: TrackerSettings): SdkOptions {
  return {
    dsn: settings.dsn,
    environment: settings.environment,
    release: settings.release,
    initialScope: { tags: { app: settings.app } },
    dataCollection: NO_DATA_COLLECTION,
    // Errors only: no tracing (tracesSampleRate stays unset), no profiling,
    // no replay, no session tracking, no reports about
    // dropped events, no breadcrumbs, no server name.
    sendClientReports: false,
    maxBreadcrumbs: 0,
    includeServerName: false,
    // Leave the app's own error messages alone; the tracker sees them as thrown.
    enhanceFetchErrorMessages: false,
    integrations: (defaults) =>
      defaults.filter((integration) => KEPT_INTEGRATIONS.has(integration.name)),
    beforeBreadcrumb: dropBreadcrumb,
    beforeSend: (event, hint) =>
      scrubEvent(event as TrackerEvent, {
        app: settings.app,
        environment: settings.environment,
        release: settings.release,
        original: hint?.originalException,
      }) as typeof event | null,
  };
}
