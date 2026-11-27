/**
 * The stand-in tracker test, run once per website (standin.<app>.test.ts,
 * each in its own process because the SDK can be started once per process).
 *
 * It starts the real SDK the way a website's instrumentation.ts does, points
 * it at the stand-in, and makes errors happen the way they happen on the
 * pages closest to personal data: the checkout, an order page, a sign-in and
 * a staff page showing a customer. Before each error the scope is filled the
 * way instrumentation would fill it (a signed-in user, the request with its
 * cookies, headers, body and query, breadcrumbs with typed text and console
 * lines, extra data), so the test proves that what arrives carries none of
 * it, and still says which website, environment and commit it came from.
 */
import { expect } from "vitest";
import { databaseError, FORBIDDEN, PERSON } from "./fixtures";
import type { ReportingApp } from "./scrub";
import { onRequestError, register } from "./server";
import { startStandIn } from "./standin";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const requestHeaders = {
  cookie: `sb-access-token=${PERSON.jwt}; sb-refresh-token=${PERSON.refreshToken}`,
  "user-agent": "Mozilla/5.0 (iPhone)",
  "x-forwarded-for": PERSON.ip,
  authorization: `Bearer ${PERSON.jwt}`,
};

export async function serverScenarios(app: ReportingApp) {
  const standIn = await startStandIn();
  const sdk = await import("@sentry/nextjs");
  const started = await register(
    {
      dsn: `http://publickey@127.0.0.1:${standIn.port}/42`,
      app,
      commit: COMMIT,
      environment: "preview",
    },
    async () => sdk,
  );
  expect(started).toBe(true);
  // The options the real SDK runs with: nothing collected, nothing traced,
  // no breadcrumbs, no source lines and no local variables.
  const options = sdk.getClient()?.getOptions() as Record<string, unknown> | undefined;
  expect(options?.dataCollection).toMatchObject({
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    urlQueryParams: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  });
  expect(options?.sendDefaultPii).toBeFalsy();
  expect(options?.tracesSampleRate).toBeUndefined();
  expect(options?.maxBreadcrumbs).toBe(0);
  const beforeBreadcrumb = options?.beforeBreadcrumb as ((b: unknown) => unknown) | undefined;
  expect(beforeBreadcrumb?.({ message: PERSON.phone })).toBe(null);

  /** Fills the scope as instrumentation would, then lets `fail` throw. */
  const onPage = async (
    path: string,
    routePath: string,
    routeType: "render" | "action" | "route",
    fail: () => never,
  ) => {
    await sdk.withIsolationScope(async (scope) => {
      scope.setUser({
        id: PERSON.userId,
        email: PERSON.email,
        ip_address: PERSON.ip,
        username: PERSON.name,
      });
      scope.setTag("customer", PERSON.name);
      scope.setExtra("form", {
        phone: PERSON.phone,
        address: PERSON.address,
        password: PERSON.password,
      });
      scope.setContext("customer", {
        name: PERSON.name,
        cedula: PERSON.cedula,
      });
      scope.addBreadcrumb({
        category: "console",
        message: `Dirección ${PERSON.address}`,
      });
      scope.addBreadcrumb({ category: "ui.input", message: PERSON.phone });
      scope.setSDKProcessingMetadata({
        normalizedRequest: {
          url: `https://yuntera.example${path}?correo=${PERSON.email}`,
          method: routeType === "render" ? "GET" : "POST",
          headers: requestHeaders,
          cookies: { "sb-access-token": PERSON.jwt },
          query_string: `correo=${PERSON.email}`,
          data: {
            phone: PERSON.phone,
            address: PERSON.address,
            password: PERSON.password,
          },
        },
      });
      try {
        fail();
      } catch (error) {
        await onRequestError(
          error,
          {
            path: `${path}?correo=${encodeURIComponent(PERSON.email)}&tel=${PERSON.phone}`,
            method: routeType === "render" ? "GET" : "POST",
            headers: requestHeaders,
          },
          { routerKind: "App Router", routePath, routeType },
        );
      }
    });
  };

  // The checkout: a Server Action fails while placing an order.
  await onPage("/pagar", "/pagar", "action", () => {
    throw new Error(
      `No se pudo validar "${PERSON.address}" para ${PERSON.email}, tel. ${PERSON.phone} / ${PERSON.phoneIntl}`,
    );
  });
  // An order page: the delivery code ends up in an error's text.
  await onPage("/pedidos/YT-100123", "/pedidos/[numero]", "render", () => {
    throw new TypeError(
      `No se pudo mostrar el código de entrega ${PERSON.deliveryCode} (code ${PERSON.deliveryCode6})`,
    );
  });
  // A sign-in: the e-mail and the password are in the form.
  await onPage("/ingresar", "/ingresar", "action", () => {
    throw new Error(
      `Invalid login for ${PERSON.email} password=${PERSON.password} token ${PERSON.jwt}`,
    );
  });
  // A staff page showing a customer.
  await onPage("/pedidos/YT-100123", "/pedidos/[numero]", "render", () => {
    throw new Error(
      `Cliente "${PERSON.name}" («${PERSON.district}»), cédula ${PERSON.cedula}, ${PERSON.cedulaPlain}, ${PERSON.juridica}, IBAN ${PERSON.iban}, ${PERSON.ip}, ${PERSON.userId}`,
    );
  });
  // A database error: its short code may go, its detail may not.
  await onPage("/carrito", "/carrito", "action", () => {
    throw databaseError();
  });

  await sdk.flush(5000);
  const events = standIn.events();
  await standIn.close();
  await sdk.close(2000);

  expect(events).toHaveLength(5);
  const sent = standIn.arrivals.map((arrival) => arrival.body).join("\n");
  for (const word of FORBIDDEN) expect(sent, `"${word}" reached the tracker`).not.toContain(word);
  // Nothing but error events: no sessions, no transactions, no client reports.
  const types = new Set(
    standIn.arrivals.flatMap((arrival) => arrival.items.map((item) => String(item.header.type))),
  );
  expect([...types]).toEqual(["event"]);

  for (const event of events) {
    expect(event.environment).toBe("preview");
    expect(event.release).toBe(`yuntera-${app}@0123456789ab`);
    expect((event.tags as Record<string, string>).app).toBe(app);
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.extra).toBeUndefined();
    const request = event.request as Record<string, unknown> | undefined;
    if (request) expect(Object.keys(request).sort()).not.toContain("headers");
  }
  const database = events[4] as { tags: Record<string, string> };
  expect(database.tags.db_code).toBe("insufficient_stock");
  // The route's shape stays, so the error can be found.
  expect(JSON.stringify(events[1])).toContain("/pedidos/[numero]");
  // SHOW_EVENTS=1 prints what reached the stand-in, to read it by eye.
  if (process.env.SHOW_EVENTS) console.info(JSON.stringify(events, null, 1));
  return events;
}
