// Yuntera Ruta, the drivers' app: web export, at phone size, on a freshly seeded database.
//
// The seed leaves the demo driver with route R-1003 in progress (a cash stop
// and a card stop). Before the browser starts, this journey packs two more
// orders as the warehouse and gives the driver a second route of three stops
// as Central, through the API, the way the apps do it.
//
// The driver signs in and sees the day; starts the new route (our explanation
// comes before the location prompt, then the position is shared); arrives at
// the cash stop, types a wrong code (refused, with the attempts left) and the
// right one (read from the shopper's order through the API), with the change
// counted; marks the other stop as failed with a reason. Then the API is
// stopped: the screens say so; an arrival and a failed delivery are queued
// ("2 acciones por enviar"), a delivery against the code is refused plainly
// and the code is not stored; the route stays readable after a reload; a
// position report waits too. The API comes back: the queue drains once, in
// order, and nothing is sent twice. The driver finishes the route; sharing
// stops. Fails on any console error, uncaught exception or 5xx, except the
// browser's "could not connect" errors while the API is stopped.
//
// What this cannot prove (it is a browser, not a phone): the Android
// foreground service and its notification, the iOS background mode, the real
// permission prompts, keep-awake, the hand-off to a maps app, and what happens
// when the phone sleeps or the app is killed.

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

/** The delivery code, as the shopper sees it on their order. */
async function pinFor(email, tracking) {
  const shopper = await as(email);
  try {
    for (const order of await shopper("my_orders")) {
      const detail = await shopper("get_order", { p_order_number: order.order_number });
      if (detail.shipments?.some((s) => s.tracking_code === tracking)) return detail.delivery_pin;
    }
    return null;
  } finally {
    await shopper.dispose();
  }
}

/** The code for a parcel whose shopper is one of the demo shoppers. */
async function pinForAnyone(tracking) {
  for (const email of ["comprador@", "comprador2@", "comprador3@"]) {
    const pin = await pinFor(`${email}yuntera.example`, tracking);
    if (pin) return pin;
  }
  return null;
}

/** Packs the two orders waiting to be picked and puts them, with the packed one, on a new route. */
async function newRoute() {
  const bodega = await as("bodega@yuntera.example");
  const roles = await bodega("my_roles");
  const warehouse = roles.warehouses[0].id;
  const board = await bodega("wms_board", { p_warehouse_id: warehouse });
  const toPick = board.shipments.filter((s) => s.status === "pending" && !s.short);
  for (const shipment of toPick.slice(0, 2)) {
    await bodega("wms_start_picking", { p_shipment_id: shipment.shipment_id });
    const detail = await bodega("wms_shipment", { p_shipment_id: shipment.shipment_id });
    for (const task of detail.tasks) {
      await bodega("wms_confirm_pick", {
        p_task_id: task.task_id,
        p_quantity: task.quantity,
        p_location_id: task.location_id,
      });
    }
    await bodega("wms_pack_shipment", {
      p_shipment_id: shipment.shipment_id,
      p_weight_grams: detail.expected_weight_grams || 1000,
      p_package_count: 1,
    });
  }
  await bodega.dispose();

  const central = await as("central@yuntera.example");
  const dispatch = await central("ops_dispatch_board");
  const drivers = await central("ops_drivers");
  const carlos = drivers.find((d) => d.full_name.startsWith("Carlos"));
  await central("ops_create_route", {
    p_service_date: dispatch.date,
    p_depot_warehouse_id: dispatch.depots[0].id,
    p_stops: dispatch.ready.map((s, i) => ({
      shipment_id: s.shipment_id,
      sequence: i + 1,
      eta_minute: (i + 1) * 15,
    })),
    p_driver_id: carlos.id,
    p_planned_km: 12,
    p_planned_minutes: 70,
  });
  await central.dispose();

  const driver = await as(DRIVER);
  const day = await driver("driver_today");
  await driver.dispose();
  return day.routes.find((r) => r.status === "assigned");
}

(async () => {
  const routeB = await newRoute();
  check(
    routeB && routeB.stops.length === 3,
    `a second route of 3 stops is assigned (${routeB?.code})`,
  );
  const B = routeB.code;

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    // A position is there, but the permission is not granted until the driver agrees.
    geolocation: { latitude: 9.9336, longitude: -84.0513, accuracy: 15 },
  });
  // The maps, Waze and WhatsApp buttons hand off to another app: record where to.
  await context.addInitScript(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(String(url));
      return null;
    };
  });
  const page = await context.newPage();
  const errors = [];
  let apiDown = false;
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (
      apiDown &&
      /ERR_CONNECTION_REFUSED|ERR_FAILED|Failed to fetch|Failed to load resource/.test(m.text())
    )
      return;
    errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  // How many times the app called each database function.
  const calls = {};
  page.on("request", (r) => {
    const fn = /\/rest\/v1\/rpc\/(\w+)/.exec(r.url())?.[1];
    if (fn && r.method() === "POST") calls[fn] = (calls[fn] ?? 0) + 1;
  });
  // The stack keeps the screens below the current one in the page, hidden: use the visible one.
  const byId = (id) => page.getByTestId(id).filter({ visible: true }).first();
  const textOf = async (id) => (await byId(id).innerText()).replace(/\s+/g, " ").trim();
  const shot = (name) =>
    page.screenshot({ path: `${SHOTS}/native-driver-${name}.png`, fullPage: true });
  const noSideways = async () =>
    (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0;
  const goHome = async () => {
    await byId("driver-route").waitFor();
  };

  // ── 1. Sign in and see the day ──
  await page.goto(`${URL_}/`, { waitUntil: "networkidle" });
  await byId("sign-in-email").fill(DRIVER);
  await byId("sign-in-password").fill(PASSWORD);
  await byId("sign-in-submit").click();
  await goHome();
  await byId(`stop-${B}-3`).waitFor();
  const home = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check(/Hola, Carlos/.test(home), "the driver is greeted by name");
  check(
    home.includes("Ruta R-1003") && home.includes(`Ruta ${B}`),
    "both of today's routes are listed",
  );
  check(
    /María Fernández Solís/.test(home) && /Cobrar ₡23\s?400/.test(home),
    "stops show the recipient and the cash to collect",
  );
  check(/PRÓXIMA PARADA/.test(home), "the next stop is marked");
  check(/Recoja 3 bultos/.test(home), "the new route says how many parcels to pick up");
  check(!/código de entrega: \d{4}/i.test(home), "no delivery code is shown to the driver");
  check(await noSideways(), "no sideways scrolling at 390 px");
  await shot("01-day");

  // ── 2. Start the new route: explanation first, then the prompt, then sharing ──
  await byId(`start-route-${B}`).click();
  await byId("location-continue").waitFor();
  const explain = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    /Antes de salir: su ubicación/.test(explain),
    "an explanation comes before the location prompt",
  );
  check(
    /Mientras se usa la app/.test(explain) &&
      /No le pedimos permiso para usarla siempre/.test(explain),
    "it asks for 'while using the app' only",
  );
  await shot("02-location");
  await context.grantPermissions(["geolocation"], { origin: URL_ });
  await byId("location-continue").click();
  await byId(`stop-${B}-1`).waitFor();
  await page.waitForFunction(
    () => /Compartiendo su ubicación/.test(document.body.innerText),
    null,
    { timeout: 15_000 },
  );
  check(calls.driver_start_route === 1, "the route was started once");
  check(true, "position sharing is shown as on");
  for (let i = 0; i < 20 && !calls.driver_report_position; i++) await page.waitForTimeout(250);
  check(calls.driver_report_position >= 1, "a position report was sent");
  await shot("03-started");

  // ── 3. The cash stop: arrive, a wrong code, then the right one ──
  await byId("stop-R-1003-1").click();
  await byId("stop-title").waitFor();
  check(
    (await textOf("stop-cash")).includes("Cobrar ₡23 400 en efectivo"),
    "the stop says how much cash to collect",
  );
  await byId("stop-directions").click();
  await byId("stop-waze").click();
  const opened = await page.evaluate(() => window.__opened);
  check(
    /google\.com\/maps\/dir\/\?api=1&destination=9\.93/.test(opened[0] ?? ""),
    "'Cómo llegar' hands the stop's point to a maps app",
  );
  check(/waze\.com\/ul\?ll=9\.93/.test(opened[1] ?? ""), "'Abrir en Waze' hands it to Waze");
  await shot("04-stop");
  await byId("stop-arrive").click();
  await byId("stop-arrived").waitFor();
  check(/Llegada registrada/.test(await textOf("stop-arrived")), "arrival is recorded");

  const tracking1 = /paquete (YT\d+)/.exec(await page.locator("body").innerText())[1];
  const pin1 = await pinFor("comprador@yuntera.example", tracking1);
  check(/^\d{4}$/.test(pin1 ?? ""), "the shopper's order has a 4-digit code");
  await byId("deliver-cash").fill("25000");
  check(
    (await textOf("deliver-change")) === "Dé ₡1 600 de vuelto.",
    "the change is counted for the driver",
  );
  await byId("deliver-name").fill("María Fernández");
  await byId("deliver-pin").fill(pin1 === "0000" ? "1111" : "0000");
  await byId("deliver-submit").click();
  await byId("deliver-message").waitFor();
  const refusal = await textOf("deliver-message");
  log("   ", refusal);
  check(
    /Ese código no es\. Quedan 4 intentos/.test(refusal),
    "a wrong code is refused with the attempts left",
  );
  check((await byId("deliver-pin").inputValue()) === "", "the wrong code is cleared");
  check((await byId("deliver-name").inputValue()) === "María Fernández", "the name is kept");
  await shot("05-wrong-code");
  await byId("deliver-pin").fill(pin1);
  await byId("deliver-submit").click();
  await byId("flash").waitFor();
  check(/Entrega registrada/.test(await textOf("flash")), "the right code delivers");

  // ── 4. The other stop fails; R-1003 is finished, with the cash to hand in ──
  await byId("stop-R-1003-2").click();
  await byId("fail-open").click();
  await byId("fail-submit").click();
  check(/Elija por qué/.test(await textOf("fail-message")), "a reason is required");
  await byId("fail-reason-nobody_home").click();
  await byId("fail-submit").click();
  await byId("route-done-R-1003").waitFor();
  check(/Terminó la ruta/.test(await textOf("flash")), "the last stop finishes the route");
  check(
    /Ruta terminada\. Regrese a .+ y entregue el efectivo\./.test(
      await textOf("route-done-R-1003"),
    ),
    "and says to hand in the cash",
  );
  check(/₡23\s?400/.test(await textOf("cash-R-1003")), "the cash to hand in is ₡23 400");
  await shot("06-route-finished");

  // ── 5. The API stops ──
  await page.route(`${API}/**`, (route) => route.abort("connectionrefused"));
  apiDown = true;
  for (const fn of Object.keys(calls)) calls[fn] = 0;

  await byId(`stop-${B}-1`).click();
  await byId("stop-arrive").click();
  await byId("stop-arrived").waitFor();
  check(
    /guardada en el teléfono/.test(await textOf("stop-arrived")),
    "offline, an arrival is kept on the phone",
  );
  await byId("offline-banner").waitFor();
  check(
    /Sin conexión/.test(await textOf("offline-banner")),
    "the screen says there is no connection",
  );
  check(
    (await textOf("outbox")).startsWith("1 acción por enviar"),
    "the queue shows 1 action to send",
  );

  const tracking2 = /paquete (YT\d+)/.exec(await page.locator("body").innerText())[1];
  await byId("deliver-name").fill("Quien recibe");
  await byId("deliver-pin").fill("4821");
  await byId("deliver-submit").click();
  await byId("deliver-offline").waitFor();
  check(
    /necesita señal/.test(await textOf("deliver-offline")),
    "a delivery without signal says plainly it needs the connection",
  );
  const stored = await page.evaluate(() => Object.values(localStorage).join("\n"));
  check(!stored.includes("4821"), "the code typed is not stored on the phone");
  await shot("07-offline-delivery");
  await byId("deliver-later").click();
  await byId(`stop-${B}-2`).waitFor();
  check(/PARA DESPUÉS/.test(await textOf(`stop-${B}-1`)), "the stop is left for later");

  await byId(`stop-${B}-2`).click();
  await byId("fail-open").click();
  await byId("fail-reason-wrong_address").click();
  await byId("fail-submit").click();
  await byId("flash").waitFor();
  check(
    /guardado en el teléfono/.test(await textOf("flash")),
    "offline, a failed delivery is kept on the phone",
  );
  check(
    (await textOf("outbox")).startsWith("2 acciones por enviar"),
    "the queue shows '2 acciones por enviar'",
  );
  await shot("08-queue");

  // Reloaded with no API: the route is still readable, and the queue still there.
  await page.reload({ waitUntil: "domcontentloaded" });
  await byId(`stop-${B}-1`).waitFor({ timeout: 30_000 });
  check(
    /ruta guardada/.test(await textOf("offline-banner")),
    "after a reload offline, the saved route is shown",
  );
  check(
    (await textOf("outbox")).startsWith("2 acciones por enviar"),
    "the queue survived the reload",
  );
  check(
    /En la puerta/.test(await textOf(`stop-${B}-1`)) &&
      /Por enviar/.test(await textOf(`stop-${B}-1`)),
    "a queued arrival reads as done, 'Por enviar'",
  );
  check(/No entregado/.test(await textOf(`stop-${B}-2`)), "a queued failure reads as done");
  // Sharing stopped with the reload; the driver turns it back on, and a position waits too.
  await byId("tracking-share").click();
  await page.waitForFunction(() => /Su última ubicación/.test(document.body.innerText), null, {
    timeout: 15_000,
  });
  check(true, "a position report made offline waits in the queue");
  log("    calls while the API was down:", JSON.stringify(calls));
  check(
    calls.driver_arrive > 0 && !calls.driver_fail_stop,
    "the phone kept retrying the arrival, and never sent the failure ahead of it",
  );
  await shot("09-offline-reload");

  // ── 6. The API is back: the queue drains once ──
  for (const fn of Object.keys(calls)) calls[fn] = 0;
  await page.unroute(`${API}/**`);
  apiDown = false;
  await byId("outbox-send").click();
  await byId("outbox-sent").waitFor({ timeout: 30_000 });
  check(
    calls.driver_arrive === 1 && calls.driver_fail_stop === 1,
    "each queued action was sent once",
  );
  check(calls.driver_report_position >= 1, "the waiting position was sent");
  const driver = await as(DRIVER);
  const after = (await driver("driver_today")).routes.find((r) => r.code === B);
  check(
    after.stops[0].status === "arrived" && after.stops[1].status === "failed",
    "the server has the arrival and the failure",
  );
  check(after.stops[1].failure_reason === "wrong_address", "with the reason chosen offline");
  await page.waitForTimeout(16_000);
  check(
    calls.driver_arrive === 1 && calls.driver_fail_stop === 1,
    "nothing was sent a second time",
  );
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="offline-banner"]'),
    null,
    {
      timeout: 20_000,
    },
  );
  check(true, "the offline notice is gone");
  await shot("10-drained");

  // ── 7. Finish the route ──
  await byId(`stop-${B}-1`).click();
  await byId("stop-arrived").waitFor();
  const pin2 = await pinForAnyone(tracking2);
  check(
    /^\d{4}$/.test(pin2 ?? ""),
    "the code of the stop left for later is read from its shopper's order",
  );
  await byId("deliver-name").fill("Quien recibe");
  await byId("deliver-pin").fill(pin2);
  await byId("deliver-submit").click();
  await byId("flash").waitFor();
  check(/Entrega registrada/.test(await textOf("flash")), "the stop left for later is delivered");
  await byId(`stop-${B}-3`).click();
  await byId("stop-arrive").click();
  await byId("stop-arrived").waitFor();
  await byId("fail-open").click();
  await byId("fail-reason-refused").click();
  await byId("fail-submit").click();
  await byId(`route-done-${B}`).waitFor();
  check(/Terminó la ruta/.test(await textOf("flash")), "the route is finished");
  check(
    /Ruta terminada\. Regrese a .+\./.test(await textOf(`route-done-${B}`)),
    "and says where to go back to",
  );
  check(
    !(await page.getByTestId("tracking").filter({ visible: true }).count()),
    "position sharing is no longer shown",
  );
  for (const fn of Object.keys(calls)) calls[fn] = 0;
  await context.setGeolocation({ latitude: 9.91, longitude: -84.03 });
  await page.waitForTimeout(16_000);
  await context.setGeolocation({ latitude: 9.92, longitude: -84.04 });
  await page.waitForTimeout(1_000);
  check(!calls.driver_report_position, "and no position is sent after the route ended");
  await shot("11-finished");

  const central = await as("central@yuntera.example");
  const board = await central("ops_dispatch_board");
  const settlements = await central("ops_settlements", { p_status: "open" });
  check(
    board.routes.some((r) => r.code === "R-1003" && r.status === "completed"),
    "Central sees R-1003 completed",
  );
  check(
    settlements.some((s) => s.cod_expected_minor === 2_340_000),
    "and expects ₡23 400 in cash from it",
  );
  await central.dispose();
  await driver.dispose();

  // ── 8. Sign out: nothing of the day stays on the phone ──
  await byId("sign-out").click();
  await byId("sign-in-email").waitFor();
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check(
    !keys.some((k) => k.startsWith("sb-") || k.includes(".day.")),
    "signed out: no session and no saved route left",
  );

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
