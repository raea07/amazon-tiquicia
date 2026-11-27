/**
 * The options the SDK is started with, in the browser and on the server.
 * Loaded only when a tracker is configured, together with the SDK.
 */
import { dropBreadcrumb, scrubEvent, type TrackerEvent } from "./scrub";
import type { TrackerSettings } from "./settings";

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
