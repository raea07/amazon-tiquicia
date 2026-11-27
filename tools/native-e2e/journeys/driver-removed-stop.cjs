// Yuntera Ruta, the drivers' app: a stop Central took off the route
// (20261121084000_console_operations.sql, ops_remove_route_stop). Web export,
// at phone size, on a freshly seeded database.
//
// Two cases, as the web field app's journey (tools/e2e/journeys/console-followups.cjs):
//
//   Started route. Central removes the first stop of the demo driver's route
//   R-1003 through the API, as the console does. The stop reads "Omitida"
//   with the sentence that tells them to bring the parcel back, and the
//   route's header counts only the stops still on it ("0 de 1 entregadas ·
//   1 omitida").
//
//   Assigned route (not started yet). A route of the journey's own
//   (tools/e2e/lib/own-route.cjs, two parcels, left assigned) loses its first
//   stop. The driver reads that the stop was removed and that the parcel must
//   not be collected (it went back to dispatch), the header and "Recoja …"
//   leave it out, and the stop cannot be opened from the list; its own
//   screen, opened by its address, says the same. Once the driver starts the
//   route, the removed stop still says not to collect it (the driver never
//   had it), not to bring it back.
//
// Fails on any console error, uncaught exception or 5xx.

const { chromium, request } = require("playwright");
const { ownRoute } = require("../../e2e/lib/own-route.cjs");
const driverApp = require("../lib/driver.cjs");
const { overflow, screenText } = require("../lib/screen.cjs");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const URL_ = process.env.NATIVE_DRIVER_URL || "http://127.0.0.1:3012";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DRIVER = "repartidor@yuntera.example";
const log = (...args) => console.log(...args);

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

/** Signs in through the API and returns a function that calls database functions as that person. */
async function as(email) {
  const ctx = await request.newContext();
  const token = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await token.json();
  const rpc = async (fn, args = {}) => {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: args,
    });
    const body = await r.json().catch(() => null);
    if (r.status() >= 400)
      throw new Error(`${fn} as ${email}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  rpc.dispose = () => ctx.dispose();
  return rpc;
}

(async () => {
  // ── 1. Central takes the first stop of R-1003 off the route ──
  const central = await as("central@yuntera.example");
  const routes = await central("ops_open_routes");
  const route = routes.find((r) => r.code === "R-1003");
  const stop = route?.stops.find((s) => s.tracking_code === "YT500011");
  check(Boolean(stop), "the seed's route R-1003 has the stop of YT500011");
  const removed = await central("ops_remove_route_stop", {
    p_stop_id: stop.stop_id,
    p_reason: "La moto se dañó y no puede seguir.",
  });
  check(removed.open_stops === 1, "one stop is left on the route");
  await central.dispose();

  // ── 1b. A route that is only assigned loses its first stop ──
  const own = await ownRoute(2, { start: false });
  log("own route:", own.code, own.stops.map((x) => x.tracking).join(", "));
  check(own.stops.length === 2, "the journey's own route has two stops");
  const central2 = await as("central@yuntera.example");
  const early = await central2("ops_remove_route_stop", {
    p_stop_id: own.stops[0].stopId,
    p_reason: "Este paquete va en otra ruta.",
  });
  check(early.shipment_status === "packed", "the parcel went straight back to dispatch");
  await central2.dispose();

  // ── 2. The driver sees it ──
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const byId = (id) => page.getByTestId(id).filter({ visible: true }).first();
  const routeCard = (code) => driverApp.routeCard(page, code);
  const flat = async (locator) => (await locator.innerText()).replace(/\s+/g, " ");

  await page.goto(`${URL_}/`, { waitUntil: "networkidle" });
  await driverApp.signIn(page, DRIVER, PASSWORD);
  await byId("driver-route").waitFor();
  await byId("stop-R-1003-1").waitFor();
  const card = await flat(routeCard("R-1003"));
  log("route card:", card.slice(0, 200));
  check(
    card.includes("Ruta R-1003") && card.includes("0 de 1 entregadas · 1 omitida"),
    "the header leaves the removed stop out of the total and says one was removed",
  );
  const removedStop = (await byId("stop-R-1003-1").innerText()).replace(/\s+/g, " ");
  log("removed stop:", removedStop);
  check(
    removedStop.includes("Omitida") &&
      removedStop.includes(
        "Central quitó esta parada de la ruta. Si lleva el paquete, devuélvalo a la bodega.",
      ),
    "the removed stop says it was skipped and to bring the parcel back",
  );
  const other = (await byId("stop-R-1003-2").innerText()).replace(/\s+/g, " ");
  check(!other.includes("Central quitó"), "the stop still on the route says nothing of the kind");
  check((await overflow(page)) <= 0, "no sideways scrolling at 390 px");
  await page.screenshot({ path: `${SHOTS}/native-driver-removed-stop.png`, fullPage: true });

  // ── 3. The assigned route: the removed parcel is not collected ──
  await byId(`stop-${own.code}-1`).waitFor();
  const ownCard = await flat(routeCard(own.code));
  log("assigned route card:", ownCard.slice(0, 260));
  check(
    ownCard.includes("0 de 1 entregadas · 1 omitida"),
    "the assigned route's header leaves the removed stop out of the total",
  );
  check(
    ownCard.includes("Recoja 1 bulto en") && !ownCard.includes("Recoja 2 bultos"),
    "the driver is sent to collect only the parcel still on the route",
  );
  const earlyStop = byId(`stop-${own.code}-1`);
  const earlyText = await flat(earlyStop);
  log("removed stop (assigned):", earlyText);
  check(
    earlyText.includes("Omitida") &&
      earlyText.includes(
        "Central quitó esta parada de la ruta. No recoja este paquete: volvió a Despacho.",
      ) &&
      !earlyText.includes("devuélvalo"),
    "the removed stop says it was removed and not to collect the parcel",
  );
  check(
    (await earlyStop.getAttribute("role")) !== "link" &&
      (await driverApp.linksTo(page, own.stops[0].stopId).count()) === 0,
    "the removed stop does not open as a stop to deliver",
  );
  const keptStop = await flat(byId(`stop-${own.code}-2`));
  check(!keptStop.includes("Central quitó"), "the other stop of that route says nothing of it");
  await routeCard(own.code).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/native-driver-removed-assigned.png`, fullPage: true });

  // Its own screen, opened by its address (a link kept from before), says the same.
  await page.goto(`${URL_}/parada/${own.stops[0].stopId}`, { waitUntil: "networkidle" });
  const closed = await flat(byId("stop-closed"));
  log("removed stop screen:", closed);
  check(
    closed.includes("Central quitó esta parada") &&
      closed.includes("No recoja este paquete: volvió a Despacho."),
    "the removed stop's screen says not to collect the parcel",
  );
  check(
    (await page.getByTestId("stop-arrive").count()) === 0 &&
      !(await screenText(page)).includes("Inicie la ruta para poder entregar"),
    "the removed stop's screen offers nothing to do at the door",
  );
  const stopScreen = await screenText(page);
  check(
    !stopScreen.includes("Cómo llegar") && !stopScreen.includes("Llamar"),
    "the removed stop's screen offers no directions and no call to the customer",
  );
  await page.screenshot({
    path: `${SHOTS}/native-driver-removed-assigned-stop.png`,
    fullPage: true,
  });

  // The driver starts the route (here through the API): the removed parcel was
  // never collected, so it is still not to be brought back.
  const driver = await as(DRIVER);
  await driver("driver_start_route", { p_route_id: own.routeId });
  await driver.dispose();
  await page.goto(`${URL_}/`, { waitUntil: "networkidle" });
  await byId(`stop-${own.code}-1`).waitFor();
  const afterStart = await flat(byId(`stop-${own.code}-1`));
  log("removed stop after the start:", afterStart);
  check(
    afterStart.includes("No recoja este paquete: volvió a Despacho.") &&
      !afterStart.includes("devuélvalo"),
    "after the start, the stop removed before it still says not to collect the parcel",
  );
  const startedCard = await flat(routeCard(own.code));
  check(
    startedCard.includes("0 de 1 entregadas · 1 omitida"),
    "the started route still counts only the stop on it",
  );

  await browser.close();
  if (errors.length > 0) {
    console.error("ERRORS:", errors);
    process.exit(1);
  }
  log("\nThe removed stop journey passed.");
})().catch((error) => {
  console.error("FAILED:", error.message.slice(0, 700));
  process.exit(1);
});
