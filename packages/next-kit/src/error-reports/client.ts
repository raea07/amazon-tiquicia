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
 * Errors that happen before it arrives are kept in memory (up to 20) and
 * sent, as unhandled, once it has started. An error thrown before this file
 * runs (while the page's own script is still arriving) is not caught.
 */
import { type BuildValues, type TrackerSettings, trackerSettings } from "./settings";
import { buildValues } from "./values";

/** What is fetched once the page is ready: the SDK and the options it is started with. */
export type Loaded = Pick<
  typeof import("./browser-sdk"),
  "init" | "captureException" | "sdkOptions"
>;
type Sdk = Pick<Loaded, "init" | "captureException">;

/** One download, after the page; not part of its first load. */
const loadSdk = (): Promise<Loaded> => import("./browser-sdk");

let settings: TrackerSettings | null = null;
let sdk: Sdk | null = null;
let startedFor: string | null = null;
/** The SDK could not be loaded (offline, blocked): nothing from this page will be sent. */
let failed = false;

/**
 * How an error reached us, told to the tracker as the SDK's own handlers
 * would tell it: none of these was handled by the page's code, so each is
 * sent as unhandled, whether it was kept while the SDK loaded or not.
 */
type Source = "onerror" | "onunhandledrejection" | "error_page";
const MECHANISMS: Record<Source, { type: string; handled: false }> = {
  onerror: { type: "auto.browser.global_handlers.onerror", handled: false },
  onunhandledrejection: {
    type: "auto.browser.global_handlers.onunhandledrejection",
    handled: false,
  },
  error_page: { type: "auto.browser.error_page", handled: false },
};

interface Kept {
  error: unknown;
  source: Source;
  /** Told whether the error was handed to the SDK once it has started. */
  done?: (sent: boolean) => void;
}
const waiting: Kept[] = [];
/** Errors kept while the SDK is on its way; more than this are not kept. */
const MAX_WAITING = 20;

const keep = (kept: Kept): boolean => {
  if (failed || waiting.length >= MAX_WAITING) return false;
  waiting.push(kept);
  return true;
};
const onError = (event: ErrorEvent) => {
  keep({ error: event.error ?? new Error(event.message), source: "onerror" });
};
const onRejection = (event: PromiseRejectionEvent) => {
  keep({ error: event.reason, source: "onunhandledrejection" });
};

const send = (loaded: Sdk, kept: Kept) =>
  loaded.captureException(kept.error, { mechanism: MECHANISMS[kept.source] });

const stopListening = () => {
  window.removeEventListener("error", onError);
  window.removeEventListener("unhandledrejection", onRejection);
};

/** Loads and starts the SDK, then hands it the errors kept so far. */
async function load(current: TrackerSettings, importSdk: () => Promise<Loaded>) {
  const loaded = await importSdk();
  loaded.init(loaded.sdkOptions(current));
  sdk = loaded;
  stopListening();
  for (const kept of waiting.splice(0)) {
    send(loaded, kept);
    kept.done?.(true);
  }
}

/**
 * Starts the browser's error reports, if this build has a tracker. `values`
 * and `importSdk` are for the tests; the websites call it with nothing.
 */
export function startBrowserErrorReports(
  values: BuildValues = buildValues(),
  importSdk: () => Promise<Loaded> = loadSdk,
): boolean {
  if (typeof window === "undefined") return false;
  const current = trackerSettings(values);
  if (!current) return false;
  if (startedFor === current.dsn) return true;
  startedFor = current.dsn;
  settings = current;
  failed = false;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const start = () => {
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1));
    idle(() => {
      load(current, importSdk).catch(() => {
        // The tracker could not be loaded (offline, blocked): the page goes
        // on as if it were off, and the error pages do not say the team
        // was told.
        failed = true;
        stopListening();
        for (const kept of waiting.splice(0)) kept.done?.(false);
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
 *
 * Resolves to whether the report was handed to a running SDK (or, for an
 * error from the server, whether this build reports errors): the error page
 * says the team was told only then. Whether the tracker then accepted it
 * (a disabled key, a blocked address) cannot be known in the page.
 */
export function reportError(error: unknown): Promise<boolean> {
  if (!settings) return Promise.resolve(false);
  if (error && typeof error === "object" && "digest" in error && error.digest) {
    return Promise.resolve(true);
  }
  if (sdk) {
    send(sdk, { error, source: "error_page" });
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    if (!keep({ error, source: "error_page", done: resolve })) resolve(false);
  });
}

/** Whether this build reports errors: the error pages say so only when it is true. */
export const reportsErrors = (values: BuildValues = buildValues()): boolean =>
  trackerSettings(values) !== null;

/** For the tests: forget what was started. */
export function resetBrowserErrorReports(): void {
  settings = null;
  sdk = null;
  startedFor = null;
  failed = false;
  waiting.splice(0);
}
