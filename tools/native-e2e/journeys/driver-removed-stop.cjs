// Yuntera Ruta, the drivers' app: a stop Central took off the route
// (20261121084000_console_operations.sql, ops_remove_route_stop). Web export,
// at phone size, on a freshly seeded database.
//
// Central removes the first stop of the demo driver's route R-1003 through the
// API, as the console does. The driver signs in: the stop reads "Omitida" with
// the sentence that tells them to bring the parcel back, and the route's
// header counts only the stops still on it ("0 de 1 entregadas · 1 omitida").
// Fails on any console error, uncaught exception or 5xx.

const { chromium, request } = require("playwright");

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

  await page.goto(`${URL_}/`, { waitUntil: "networkidle" });
  await byId("sign-in-email").fill(DRIVER);
  await byId("sign-in-password").fill(PASSWORD);
  await byId("sign-in-submit").click();
  await byId("driver-route").waitFor();
  await byId("stop-R-1003-1").waitFor();
  const card = (await byId("driver-route").innerText()).replace(/\s+/g, " ");
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
  check(
    (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
    "no sideways scrolling at 390 px",
  );
  await page.screenshot({ path: `${SHOTS}/native-driver-removed-stop.png`, fullPage: true });

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
