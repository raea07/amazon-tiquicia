/**
 * Error reports from the browser. Each website's `src/instrumentation-client.ts`
 * calls `startBrowserErrorReports()`, which the framework runs before the page
 * becomes interactive.
 *
 * Off unless the website was built with a tracker's public address: then
 * this does nothing at all, and the SDK's code is never downloaded.
 *
 * When it is on, the SDK is not part of the page's first load: it is fetched
 * once the page has loaded and the browser is idle, so it never delays a
 * shopper (docs/07-deployment/error-tracking.md has the measurements).
 * Errors that happen before it arrives are kept in memory and sent once it
 * has started.
 */
import { type BuildValues, sdkOptions, type TrackerSettings, trackerSettings } from "./settings";
import { buildValues } from "./values";

type Sdk = typeof import("@sentry/nextjs");

let settings: TrackerSettings | null = null;
let sdk: Sdk | null = null;
let startedFor: string | null = null;
const waiting: unknown[] = [];
/** Errors kept while the SDK is on its way; more than this are not kept. */
const MAX_WAITING = 20;

const keep = (error: unknown) => {
  if (waiting.length < MAX_WAITING) waiting.push(error);
};
const onError = (event: ErrorEvent) => keep(event.error ?? new Error(event.message));
const onRejection = (event: PromiseRejectionEvent) => keep(event.reason);

/** Loads and starts the SDK, then hands it the errors kept so far. */
async function load(current: TrackerSettings, importSdk: () => Promise<Sdk>) {
  const loaded = await importSdk();
  loaded.init(sdkOptions(current));
  sdk = loaded;
  window.removeEventListener("error", onError);
  window.removeEventListener("unhandledrejection", onRejection);
  for (const error of waiting.splice(0)) loaded.captureException(error);
}

/**
 * Starts the browser's error reports, if this build has a tracker. `values`
 * and `importSdk` are for the tests; the websites call it with nothing.
 */
export function startBrowserErrorReports(
  values: BuildValues = buildValues(),
  importSdk: () => Promise<Sdk> = () => import("@sentry/nextjs"),
): boolean {
  if (typeof window === "undefined") return false;
  const current = trackerSettings(values);
  if (!current) return false;
  if (startedFor === current.dsn) return true;
  startedFor = current.dsn;
  settings = current;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const start = () => {
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1));
    idle(() => {
      load(current, importSdk).catch(() => {
        // The tracker could not be loaded (offline, blocked): the page goes
        // on as if it were off.
        startedFor = null;
      });
    });
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
  return true;
}

/**
 * Reports an error an error page caught. Errors that came from the server
 * (they carry a `digest`) were reported there already, with more detail, so
 * they are not sent twice. Does nothing when the tracker is off.
 */
export function reportError(error: unknown): void {
  if (!settings) return;
  if (error && typeof error === "object" && "digest" in error && error.digest) return;
  if (sdk) sdk.captureException(error);
  else keep(error);
}

/** Whether this build reports errors: the error pages say so only when it is true. */
export const reportsErrors = (values: BuildValues = buildValues()): boolean =>
  trackerSettings(values) !== null;

/** For the tests: forget what was started. */
export function resetBrowserErrorReports(): void {
  settings = null;
  sdk = null;
  startedFor = null;
  waiting.splice(0);
}
