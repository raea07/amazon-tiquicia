// Follow-ups journey: what migration 083200 changes on screen.
//
//   1. A shopper opens a claim on a delivered product; a second request for
//      the same unit, from a page left open before, gets its own message
//      (not the cart's); the shopper then withdraws the claim opened by
//      mistake, and the order page says it is withdrawn.
//   2. The drivers' field app shows each stop's district and cantón, in the
//      day's list and on the stop.
//   3. Picking refuses another product's code, also when the screen is
//      skipped (the database checks it), and accepts the right one typed in
//      lower case with spaces.
//   4. The console's list of offers paused by a fee change opens for finance.
//   Every screen is looked at 390 px wide, with no sideways scrolling.
//
// Like every journey it runs against a freshly seeded database and fails on a
// step that does not arrive, a console error or any 5xx response.

const { chromium, request } = require("playwright");
const web = require("../lib/web.cjs");
const ops = require("../lib/ops.cjs");
const fieldApp = require("../lib/field.cjs");
const kit = require("../lib/kit.cjs");
const { word } = require("../lib/words.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Calls API functions as a user, the way an app does. `attempt` gives back
// the refusal instead of throwing.
async function as(email) {
  const ctx = await request.newContext();
  const t = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await t.json();
  const attempt = async (fn, args = {}) => {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: args,
    });
    const body = await r.text();
    return { status: r.status(), value: body ? JSON.parse(body) : null };
  };
  const rpc = async (fn, args = {}) => {
    const { status, value } = await attempt(fn, args);
    if (status >= 400) throw new Error(`${fn}: ${status} ${JSON.stringify(value).slice(0, 200)}`);
    return value;
  };
  return { rpc, attempt, dispose: () => ctx.dispose() };
}

(async () => {
  const shopper = await as("comprador@yuntera.example");
  const driver = await as("repartidor@yuntera.example");
  const bodega = await as("bodega@yuntera.example");

  // A line of a delivered order with nothing returned yet.
  let target = null;
  for (const o of (await shopper.rpc("my_orders")).filter((x) => x.status === "delivered")) {
    const detail = await shopper.rpc("get_order", { p_order_number: o.order_number });
    const item = detail.items.find((i) => i.returned_quantity === 0);
    if (item) {
      target = { number: o.order_number, item };
      break;
    }
  }
  check(target, "a delivered order with a line to return");
  log("order:", target.number, "| line:", target.item.title, "×", target.item.quantity);

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  const phone = (extra = {}) =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
      ...extra,
    });
  const noSideways = async (page, label) => {
    const overflow = await kit.overflowPx(page);
    log(`${label}: overflow px`, overflow);
    check(overflow <= 0, `${label} scrolls sideways at 390 px`);
  };

  // ── 1. Returns: a second request, and withdrawing one ───────────────────
  const shop = await phone();
  const a = await shop.newPage();
  watch(a);
  await web.signIn(a, "comprador@yuntera.example");
  await web.openOrder(a, target.number, "load");
  // A second tab, left open on the same page from before.
  const b = await shop.newPage();
  watch(b);
  await web.openOrder(b, target.number, "load");

  await web.waitForOrderHeading(a);
  await web.waitForOrderHeading(b);
  log("order page open in two tabs");
  const title = target.item.title;
  // Tab A: a claim for every unit of the line.
  await web.requestReturn(a, title, {
    kind: "damaged",
    quantity: target.item.quantity,
    reason: "La caja llegó abierta y aplastada.",
  });
  log("claim:", await web.returnReceived(a));

  // Tab B, stale: asking again for the same unit is refused with its own words.
  await web.requestReturn(b, title, {
    kind: "damaged",
    reason: "La caja llegó abierta y aplastada.",
  });
  const second = await web.firstAlert(b);
  log("second request:", second);
  check(
    /ya están en otra solicitud de devolución/.test(second) && !/carrito|máximo/.test(second),
    "the second request says the units are already in a return",
  );
  await b.screenshot({ path: SHOTS + "/fu1-second-request.png", fullPage: true });
  await noSideways(b, "order page with the refusal");
  await b.close();

  // Tab A, reloaded: the claim waits for a decision and can be withdrawn.
  await web.openOrder(a, target.number, "load");
  // A return request is named as a return, not as a complaint (wave 9: the
  // word «Reclamo» belongs to the complaint form).
  const before = await web.returnRequestText(a, title);
  check(
    /Devolución por producto dañado/.test(before) && !/Reclamo por/.test(before),
    "the request is named «Devolución por producto dañado»",
  );
  // The return's case on the same page gives the day it is resolved by, and
  // never a second answer time beside the line's «2 horas hábiles».
  const cases = await web.orderCasesText(a);
  const card =
    /Devolución [0-9A-F]{8}.*?(?= (?:Reclamo|Devolución|Reporte|Consulta) [0-9A-F]{8}|$)/.exec(
      cases,
    )?.[0] ?? "";
  check(
    card.includes("lo resolvemos a más tardar el") && !card.includes("respondemos"),
    `the return's case says when it is resolved, not a second answer time (${card})`,
  );
  const opener = web.withdrawOpener(a, title);
  const box = await opener.boundingBox();
  check(box && box.height >= 44, `the withdraw opener is at least 44 px tall (${box?.height})`);
  await opener.click();
  await a.screenshot({ path: SHOTS + "/fu2-withdraw-offer.png", fullPage: true });
  await web.withdrawReturn(a, title);
  await web.openOrder(a, target.number, "load");
  const after = await web.returnRequestText(a, title);
  log("after withdrawing:", after);
  check(/Retirada: usted retiró esta solicitud/.test(after), "the order says it was withdrawn");
  check((await web.withdrawOffers(a)) === 0, "nothing left to withdraw");
  // Its units are free again: the return form is back on the line.
  check(
    (await web.returnableLines(a, title)) === 1,
    "the line can be returned again once the request is withdrawn",
  );
  await a.screenshot({ path: SHOTS + "/fu3-withdrawn.png", fullPage: true });
  await noSideways(a, "order page after withdrawing");

  // Asked again and approved in Atención without a note: the case card says
  // it is under review and shows the decision, as the order line does, never
  // «Por responder» (second outside check of wave 9 part 3).
  await web.requestReturn(a, title, {
    kind: "damaged",
    quantity: 1,
    reason: "La caja llegó abierta y aplastada.",
  });
  await web.returnReceived(a);
  const staff = await as("central@yuntera.example");
  const queued = (await staff.rpc("ops_care_queues")).returns.find(
    (r) => r.order_number === target.number && r.status === "requested",
  );
  check(queued, "the new request waits in Atención");
  check(
    (await staff.rpc("ops_decide_return", { p_return_id: queued.id, p_approve: true })) === true,
    "approved without a note",
  );
  await staff.dispose();
  await web.openOrder(a, target.number, "load");
  const decided = await web.orderCasesText(a);
  const decidedCard =
    /Devolución [0-9A-F]{8}.*?(?= (?:Reclamo|Devolución|Reporte|Consulta) [0-9A-F]{8}|$)/.exec(
      decided,
    )?.[0] ?? "";
  const shopperSees = { viewer: "shopper" };
  check(
    decidedCard.includes(word("cases", "open", { ...shopperSees, answered: true })) &&
      decidedCard.includes(`${word("return_requests", "approved", shopperSees)} (desde el`) &&
      !decidedCard.includes(word("cases", "open", shopperSees)) &&
      !decidedCard.includes("Todavía no hay respuesta."),
    `the approved return's case reads as answered, with the decision (${decidedCard})`,
  );
  await noSideways(a, "order page after the approval");
  await shop.close();

  // ── 2. The district of each stop, in the field app ──────────────────────
  const day = await driver.rpc("driver_today");
  const stop = day.routes.flatMap((r) => r.stops).find((s) => s.status === "pending");
  check(stop?.district && stop?.canton, "driver_today says each stop's district and cantón");
  log("first pending stop:", stop.sequence, stop.district, stop.canton);
  const field = await phone({
    geolocation: { latitude: 9.9336, longitude: -84.0513 },
    permissions: ["geolocation"],
  });
  const f = await field.newPage();
  watch(f);
  await fieldApp.signIn(f, "repartidor@yuntera.example");
  await fieldApp.open(f, "/ruta");
  const rowText = await fieldApp.stopFor(f, stop.recipient_name);
  log("stop in the list:", rowText.slice(0, 160));
  check(rowText.includes(`${stop.district}, ${stop.canton}`), "the list shows the district");
  await f.screenshot({ path: SHOTS + "/fu4-route-district.png", fullPage: true });
  await noSideways(f, "route with districts");
  const routeOfStop = day.routes.find((r) => r.stops.some((s) => s.stop_id === stop.stop_id));
  if (routeOfStop.status === "in_progress") {
    await fieldApp.open(f, `/ruta/${stop.stop_id}`);
    const header = await fieldApp.stopHeader(f);
    log("stop page header:", header);
    check(header.includes(`${stop.district}, ${stop.canton}`), "the stop shows its district");
    await f.screenshot({ path: SHOTS + "/fu5-stop-district.png", fullPage: true });
    await noSideways(f, "stop with district");
  }
  await field.close();

  // ── 3. Picking refuses another product's code ───────────────────────────
  const w = await (await phone()).newPage();
  watch(w);
  await fieldApp.signIn(w, "bodega@yuntera.example");
  await fieldApp.open(w, "/bodega");
  await fieldApp.openParcelToPickNow(w);
  const shipmentId = new URL(w.url()).pathname.split("/").pop();
  await fieldApp.startPicking(w);
  const parcel = await bodega.rpc("wms_shipment", { p_shipment_id: shipmentId });
  const task = parcel.tasks.find((t) => t.status !== "done");
  const others = ["YT-DA4ED076", "YT-64D3BDF4", "YT-4C4384BC", "YT-1BFC5FE2"];
  const otherCode = others.find((code) => !parcel.tasks.some((t) => t.sku_code === code));

  // Past the screen, straight to the API: no code, then another product's.
  const noScan = await bodega.attempt("wms_confirm_pick", {
    p_task_id: task.task_id,
    p_quantity: task.quantity,
  });
  const wrongScan = await bodega.attempt("wms_confirm_pick", {
    p_task_id: task.task_id,
    p_quantity: task.quantity,
    p_code: otherCode,
  });
  log(
    "API without a scan:",
    noScan.value?.message,
    "| with another product's:",
    wrongScan.value?.message,
  );
  check(noScan.value?.message === "scan_required", "the database wants the scan");
  check(wrongScan.value?.message === "scanned_wrong_item", "the database refuses another product");

  // On the screen: another product's real code, then the right one in lower case.
  const refusal = await fieldApp.scanWrong(w, otherCode);
  log("wrong product on screen:", refusal);
  check(/no es el de este producto/.test(refusal), "the screen says it is another product");
  await w.screenshot({ path: SHOTS + "/fu6-pick-wrong.png", fullPage: true });
  await noSideways(w, "picking with a wrong scan");
  const sku = /(YT-[A-Z0-9]+)/.exec(await fieldApp.firstOpenSku(w))[1];
  await fieldApp.pickFirstWith(w, `  ${sku.toLowerCase()} `);
  log("right product, typed in lower case: line confirmed");
  await w.screenshot({ path: SHOTS + "/fu7-pick-right.png", fullPage: true });

  // ── 4. Offers paused by a fee change, for finance ───────────────────────
  const o = await (await phone()).newPage();
  watch(o);
  await ops.signIn(o, "central@yuntera.example");
  await ops.open(o, "/tarifas");
  const page4 = await ops.mainText(o);
  log("console list:", page4.slice(0, 200));
  check(/Ofertas en pausa por tarifas/.test(page4), "the console page opens");
  await o.screenshot({ path: SHOTS + "/fu8-fee-floor.png", fullPage: true });
  await noSideways(o, "offers paused by a fee change");

  for (const api of [shopper, driver, bodega]) await api.dispose();
  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
