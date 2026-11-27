/**
 * Error reports from the server. Each website's `src/instrumentation.ts`
 * re-exports `register` and `onRequestError` from here: the framework calls
 * `register` once when the server starts, and `onRequestError` for every
 * error thrown while rendering a page, running a Server Action or a route
 * handler, or in the proxy.
 *
 * Off unless the website was built with a tracker's public address: then
 * the SDK is not even loaded, and `onRequestError` returns at once.
 *
 * The request handed to the SDK is the page's path (without its query) and
 * the method, and nothing else: no headers, so no cookies. A Server Action's
 * arguments are never given to the SDK. Everything is then filtered again by
 * `scrubEvent` before it is sent.
 */
import { sdkOptions } from "./options";
import { pathOnly } from "./scrub";
import { type BuildValues, trackerSettings } from "./settings";
import { buildValues } from "./values";

type Sdk = typeof import("@sentry/nextjs");
type CaptureRequestError = Sdk["captureRequestError"];

let capture: CaptureRequestError | null = null;

/**
 * Starts the server's error reports, if this build has a tracker. `values`
 * and `importSdk` are for the tests; the websites call it with nothing.
 */
export async function register(
  values: BuildValues = buildValues(),
  importSdk: () => Promise<Sdk> = () => import("@sentry/nextjs"),
): Promise<boolean> {
  // Only the Node.js runtime: no page of these websites runs on the edge.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return false;
  const settings = trackerSettings(values);
  if (!settings) return false;
  const sdk = await importSdk();
  sdk.init(sdkOptions(settings));
  capture = sdk.captureRequestError;
  return true;
}

type Request = Parameters<CaptureRequestError>[1];
type Context = Parameters<CaptureRequestError>[2];

export async function onRequestError(error: unknown, request: Request, context: Context) {
  if (!capture) return;
  capture(error, { path: pathOnly(request.path), method: request.method, headers: {} }, context);
}

/** For the tests: forget what was started. */
export function resetServerErrorReports(): void {
  capture = null;
}
