/**
 * The browser's part of the SDK, fetched after the page is ready (client.ts).
 *
 * The SDK's own `init` for Next.js always brings its tracing code, and its
 * size options work only with webpack, not with Turbopack, which builds these
 * websites. So the client is put together here from named parts: the
 * bundler then keeps only what error reports need (catching errors, linking
 * causes, dropping duplicates, sending) and leaves out tracing, session
 * replay, the feedback widget, breadcrumbs and the rest.
 */
import {
  BrowserClient,
  browserApiErrorsIntegration,
  captureException,
  dedupeIntegration,
  defaultStackParser,
  eventFiltersIntegration,
  functionToStringIntegration,
  getCurrentScope,
  globalHandlersIntegration,
  linkedErrorsIntegration,
  makeFetchTransport,
} from "@sentry/nextjs";
import { sdkOptions } from "./options";

export { captureException, sdkOptions };

type Options = ReturnType<typeof sdkOptions>;

export function init(options: Options) {
  // No tunnel: reports go straight to the tracker's ingest address (its CSP entry).
  const { integrations: _defaults, initialScope, tunnel: _tunnel, ...rest } = options;
  const client = new BrowserClient({
    ...rest,
    stackParser: defaultStackParser,
    transport: makeFetchTransport,
    integrations: [
      eventFiltersIntegration(),
      functionToStringIntegration(),
      browserApiErrorsIntegration(),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
    ],
  });
  const scope = getCurrentScope();
  if (initialScope && typeof initialScope === "object" && "tags" in initialScope) {
    scope.setTags(initialScope.tags ?? {});
  }
  scope.setClient(client);
  // Which page failed: its address without the query or fragment (the
  // server's reports carry the same). Set before beforeSend, which keeps
  // only the path (scrubEvent, pathOnly).
  client.addEventProcessor((event) => {
    event.request = { url: pageAddress(window.location) };
    return event;
  });
  client.init();
  return client;
}

/** The page's address without its query string and fragment. */
export const pageAddress = (location: Pick<Location, "origin" | "pathname">): string =>
  `${location.origin}${location.pathname}`;
