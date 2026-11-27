/**
 * Not configured, nothing leaves: with no tracker address in the build (on
 * this machine, in the tests, the journeys and the lanes), the SDK is not
 * loaded, nothing listens for errors, and no request is made, while a
 * stand-in tracker waits on this machine to catch anything that would be.
 */
import http from "node:http";
import https from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { securityHeaders } from "../../config.mjs";
import { reportError, resetBrowserErrorReports, startBrowserErrorReports } from "./client";
import { sdkOptions } from "./options";
import { onRequestError, register, resetServerErrorReports } from "./server";
import { trackerSettings } from "./settings";
import { type StandIn, startStandIn } from "./standin";
import { buildValues } from "./values";

const NOT_CONFIGURED = [
  undefined,
  null,
  "",
  "   ",
  "not a url",
  // An old-style DSN that carries a secret key: refused, so never used.
  "https://publickey:secretkey@o1.ingest.sentry.io/42",
  // Plain http to anything but this machine.
  "http://publickey@ingest.example.com/42",
  // No key, no project, a query, another scheme.
  "https://o1.ingest.sentry.io/42",
  "https://publickey@o1.ingest.sentry.io/",
  "https://publickey@o1.ingest.sentry.io/42?x=1",
  "ftp://publickey@o1.ingest.sentry.io/42",
];

let standIn: StandIn;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(async () => {
  standIn = await startStandIn();
  spies.push(vi.spyOn(globalThis, "fetch"), vi.spyOn(http, "request"), vi.spyOn(https, "request"));
});

afterEach(async () => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetBrowserErrorReports();
  resetServerErrorReports();
  await standIn.close();
});

const noRequestLeft = () => {
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  expect(standIn.arrivals).toEqual([]);
};

describe("not configured, nothing is started", () => {
  it("has no settings for a missing, empty or unusable address", () => {
    for (const dsn of NOT_CONFIGURED) {
      expect(
        trackerSettings({
          dsn,
          app: "web",
          commit: "abc1234",
          environment: "preview",
        }),
        String(dsn),
      ).toBeNull();
    }
    // Nor for a usable address in something that is not one of the four websites.
    expect(
      trackerSettings({
        dsn: "https://k@o1.ingest.sentry.io/42",
        app: "shop-native",
      }),
    ).toBeNull();
  });

  it("reads the address from the build only, and finds none in the tests", () => {
    expect(buildValues().dsn).toBeUndefined();
    expect(trackerSettings(buildValues())).toBeNull();
  });

  it("the server never loads the SDK and reports nothing", async () => {
    for (const dsn of NOT_CONFIGURED) {
      const importSdk = vi.fn();
      expect(await register({ dsn, app: "web" }, importSdk)).toBe(false);
      expect(importSdk).not.toHaveBeenCalled();
    }
    // As the websites call it: from the build's values.
    const importSdk = vi.fn();
    expect(await register(undefined, importSdk)).toBe(false);
    expect(importSdk).not.toHaveBeenCalled();
    await onRequestError(
      new Error("Prueba: ana.prueba@example.com"),
      {
        path: "/pagar",
        method: "POST",
        headers: { cookie: "sb-access-token=x" },
      },
      { routerKind: "App Router", routePath: "/pagar", routeType: "action" },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    noRequestLeft();
  });

  it("the browser never loads the SDK, listens for nothing and reports nothing", async () => {
    const window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestIdleCallback: vi.fn(),
      setTimeout: vi.fn(),
    };
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", { readyState: "complete" });
    for (const dsn of NOT_CONFIGURED) {
      const importSdk = vi.fn();
      expect(startBrowserErrorReports({ dsn, app: "web" }, importSdk)).toBe(false);
      expect(importSdk).not.toHaveBeenCalled();
    }
    const importSdk = vi.fn();
    expect(startBrowserErrorReports(undefined, importSdk)).toBe(false);
    expect(importSdk).not.toHaveBeenCalled();
    reportError(new Error("Prueba: ana.prueba@example.com"));
    expect(window.addEventListener).not.toHaveBeenCalled();
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 200));
    noRequestLeft();
  });

  it("the security headers do not mention a tracker", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = securityHeaders().find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).not.toMatch(/sentry|ingest|envelope/);
  });
});

describe("configured, the browser waits for the page before loading the SDK", () => {
  it("loads it once the page has loaded and the browser is idle, and sends early errors then", async () => {
    let onLoad: (() => void) | undefined;
    let idle: (() => void) | undefined;
    const listeners = new Map<string, (event: unknown) => void>();
    const window = {
      addEventListener: vi.fn((name: string, run: (event: unknown) => void) => {
        if (name === "load") onLoad = run as () => void;
        else listeners.set(name, run);
      }),
      removeEventListener: vi.fn((name: string) => listeners.delete(name)),
      requestIdleCallback: vi.fn((run: () => void) => {
        idle = run;
      }),
    };
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", { readyState: "loading" });
    const sdk = { init: vi.fn(), captureException: vi.fn(), sdkOptions };
    const importSdk = vi.fn(async () => sdk as never);

    const dsn = `http://publickey@127.0.0.1:${standIn.port}/42`;
    expect(startBrowserErrorReports({ dsn, app: "web", commit: "abc1234" }, importSdk)).toBe(true);
    // Nothing is fetched while the page loads.
    expect(importSdk).not.toHaveBeenCalled();
    const early = new Error("antes de cargar");
    listeners.get("error")?.({ error: early });

    onLoad?.();
    expect(importSdk).not.toHaveBeenCalled();
    idle?.();
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    expect(sdk.init.mock.calls[0]?.[0]).toMatchObject({
      dsn,
      release: "yuntera-web@abc1234",
      sendClientReports: false,
      maxBreadcrumbs: 0,
    });
    expect(sdk.init.mock.calls[0]?.[0]).not.toHaveProperty("tracesSampleRate");
    expect(sdk.init.mock.calls[0]?.[0]).not.toHaveProperty("replaysSessionSampleRate");
    // Sent as the SDK's own handler would have sent it: unhandled.
    expect(sdk.captureException).toHaveBeenCalledWith(early, {
      mechanism: {
        type: "auto.browser.global_handlers.onerror",
        handled: false,
      },
    });
    expect(listeners.size).toBe(0);

    // An error the server already reported (it has a digest) is not sent twice.
    expect(await reportError(Object.assign(new Error("server"), { digest: "123" }))).toBe(true);
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    const onPage = new Error("en la página");
    expect(await reportError(onPage)).toBe(true);
    expect(sdk.captureException).toHaveBeenCalledTimes(2);
    expect(sdk.captureException).toHaveBeenLastCalledWith(onPage, {
      mechanism: { type: "auto.browser.error_page", handled: false },
    });
  });

  /** A configured browser whose page has loaded, with the idle callback held. */
  const configured = (importSdk: () => Promise<never>) => {
    let idle: (() => void) | undefined;
    const listeners = new Map<string, (event: unknown) => void>();
    vi.stubGlobal("window", {
      addEventListener: vi.fn((name: string, run: (event: unknown) => void) => {
        listeners.set(name, run);
      }),
      removeEventListener: vi.fn((name: string) => listeners.delete(name)),
      requestIdleCallback: vi.fn((run: () => void) => {
        idle = run;
      }),
    });
    vi.stubGlobal("document", { readyState: "complete" });
    const dsn = `http://publickey@127.0.0.1:${standIn.port}/42`;
    expect(startBrowserErrorReports({ dsn, app: "web", commit: "abc1234" }, importSdk)).toBe(true);
    return { listeners, runIdle: () => idle?.() };
  };

  it("an error page's report kept while the SDK loads counts as told once it is sent", async () => {
    const sdk = { init: vi.fn(), captureException: vi.fn(), sdkOptions };
    const { listeners, runIdle } = configured(async () => sdk as never);
    const rejection = { reason: new Error("promesa") };
    listeners.get("unhandledrejection")?.(rejection);
    let told: boolean | undefined;
    void reportError(new Error("en la página")).then((sent) => {
      told = sent;
    });
    await Promise.resolve();
    expect(told).toBeUndefined();
    runIdle();
    await vi.waitFor(() => expect(told).toBe(true));
    expect(sdk.captureException).toHaveBeenCalledWith(rejection.reason, {
      mechanism: {
        type: "auto.browser.global_handlers.onunhandledrejection",
        handled: false,
      },
    });
  });

  it("when the SDK cannot be loaded, the error page does not say the team was told", async () => {
    const { listeners, runIdle } = configured(async () => {
      throw new Error("blocked");
    });
    const kept = reportError(new Error("en la página"));
    runIdle();
    expect(await kept).toBe(false);
    // It stops listening, and later errors are not claimed either.
    expect(listeners.size).toBe(0);
    expect(await reportError(new Error("después"))).toBe(false);
  });

  it("keeps at most 20 errors while loading, and does not claim the rest", async () => {
    const sdk = { init: vi.fn(), captureException: vi.fn(), sdkOptions };
    const { listeners, runIdle } = configured(async () => sdk as never);
    for (let i = 0; i < 20; i += 1) listeners.get("error")?.({ error: new Error(`e${i}`) });
    expect(await reportError(new Error("la 21"))).toBe(false);
    runIdle();
    await vi.waitFor(() => expect(sdk.captureException).toHaveBeenCalledTimes(20));
  });
});
