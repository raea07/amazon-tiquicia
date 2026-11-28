// Driver and warehouse journey on a phone-sized screen: route, delivery code, cash, picking, packing, receiving.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const field = require("../lib/field.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = field.BASE;
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);

async function rpcAs(email, calls) {
  const ctx = await request.newContext();
  const t = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await t.json();
  const out = [];
  for (const [fn, args] of calls) {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: args,
    });
    out.push(await r.json());
  }
  await ctx.dispose();
  return out;
}
async function pinFor(email, tracking) {
  const [orders] = await rpcAs(email, [["my_orders", {}]]);
  for (const o of orders) {
    const [d] = await rpcAs(email, [["get_order", { p_order_number: o.order_number }]]);
    if (d.shipments?.some((s) => s.tracking_code === tracking)) return d.delivery_pin;
  }
  return null;
}

(async () => {
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
  const phone = () =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
      geolocation: { latitude: 9.9336, longitude: -84.0513 },
      permissions: ["geolocation"],
    });
  const signIn = (page, email) => field.signInToOwnPage(page, email);

  // 0. People who are neither drivers nor warehouse staff
  const c0 = await phone();
  const p0 = await c0.newPage();
  watch(p0);
  await field.open(p0, "/ruta");
  log("visitor on /ruta ->", p0.url().replace(BASE, ""));
  await signIn(p0, "comprador@yuntera.example");
  log("shopper lands on:", new URL(p0.url()).pathname);
  await c0.close();

  // ── Driver ──
  const c1 = await phone();
  const page = await c1.newPage();
  watch(page);
  await signIn(page, "repartidor@yuntera.example");
  log("driver lands on:", new URL(page.url()).pathname, "|", await field.heading(page));
  log("route card:", (await field.todaySummary(page)).slice(0, 170));
  const stops = await field.stopsShown(page);
  log("stops:", stops.count, "| first:", stops.first.slice(0, 150));
  log("overflow px:", await kit.overflowPx(page));
  await page.waitForTimeout(1500);
  log("position note:", await field.positionNote(page));
  await page.screenshot({ path: SHOTS + "/f1-route.png", fullPage: true });

  // Stop 1: cash on delivery
  await field.openFirstStop(page);
  const header = await field.stopHeader(page);
  const tracking1 = /paquete (YT\d+)/.exec(header)[1];
  log(
    "stop 1:",
    header,
    "| page shows a PIN:",
    /código de entrega: \d{4}/i.test(await field.mainText(page)),
  );
  log("links:", await field.stopContactLinks(page));
  await page.screenshot({ path: SHOTS + "/f2-stop.png", fullPage: true });
  await field.arrive(page);
  const pin1 = await pinFor("comprador@yuntera.example", tracking1);
  const wrong = pin1 === "0000" ? "1111" : "0000";
  const cashLabel = await field.cashLabel(page);
  const due = /debe ser ₡([\d\s  ]+)/.exec(cashLabel)[1].replace(/\D/g, "");
  await field.deliver(page, { collected: due, recipient: "María Fernández", pin: wrong });
  log(
    "wrong PIN:",
    await field.deliveryError(page),
    "| name kept:",
    await field.recipientTyped(page),
  );
  await field.deliver(page, { collected: "1000", pin: pin1 });
  log("short cash:", await field.cashError(page));
  await field.deliver(page, { collected: due, pin: pin1 });
  await field.deliveredNotice(page);
  log(
    "after delivery:",
    await field.statusText(page),
    "|",
    (await field.todaySummary(page)).slice(0, 120),
  );

  // Stop 2: nobody home
  await field.failFirstStop(page, "nobody_home");
  log("route finished:", (await field.todaySummary(page)).slice(0, 190));
  await page.screenshot({ path: SHOTS + "/f3-route-done.png", fullPage: true });
  await c1.close();

  const [ops] = await rpcAs("central@yuntera.example", [["ops_settlements", { p_status: "open" }]]);
  log(
    "open cash settlements for Central now:",
    ops.length,
    ops[0] ? `expects ${ops[0].cod_expected_minor / 100}` : "",
  );
  const [pos] = await rpcAs("central@yuntera.example", [["ops_dispatch_board", {}]]);
  log(
    "driver position seen by Central:",
    JSON.stringify(pos.drivers.find((d) => d.position)?.position ?? null).slice(0, 90),
  );

  // ── Warehouse ──
  const [roles] = await rpcAs("vendedor@yuntera.example", [["my_roles", {}]]);
  const tecno = roles.sellers.find((s) => s.slug === "tecnocasa");
  const [locs, listings] = await rpcAs("vendedor@yuntera.example", [
    ["seller_locations", { p_seller_id: tecno.id }],
    ["seller_listings", { p_seller_id: tecno.id }],
  ]);
  await rpcAs("vendedor@yuntera.example", [
    [
      "seller_create_inbound",
      {
        p_warehouse_id: locs.platform[0].id,
        p_seller_id: tecno.id,
        p_lines: [{ sku_id: listings[0].sku_id, quantity: 12 }],
      },
    ],
  ]);

  const c2 = await phone();
  const w = await c2.newPage();
  watch(w);
  await signIn(w, "bodega@yuntera.example");
  log("warehouse lands on:", new URL(w.url()).pathname, "|", await field.heading(w));
  log("board:", await field.boardSections(w));
  log("overflow px:", await kit.overflowPx(w));
  await w.screenshot({ path: SHOTS + "/f4-warehouse.png", fullPage: true });

  await field.openParcelToPick(w);
  log("parcel:", await field.parcelHeader(w));
  const lines = await field.startPicking(w);
  log("lines to pick:", lines);
  // wrong product first
  log("wrong scan:", await field.scanWrong(w, "YT-NOPE0000"));
  await field.pickAll(w);
  log("all lines:", await field.linesHeading(w));
  await w.screenshot({ path: SHOTS + "/f5-pick.png", fullPage: true });
  await field.pack(w);
  log("packed:", (await field.statusText(w)).slice(0, 120));

  // Receiving
  await field.open(w, "/bodega");
  log("inbound:", (await field.firstInboundText(w)).slice(0, 150));
  const received = await field.receiveFirst(w, { good: "10", damaged: "1" });
  log("received:", received.message, "|", received.line.slice(0, 110));

  // Lookup
  const skuCode = /(YT-[A-Z0-9]+|[A-Z0-9]+-[A-Z0-9-]+) · esperadas/.exec(
    await field.firstInboundRaw(w),
  )[1];
  await field.open(w, "/bodega/buscar?codigo=" + encodeURIComponent(skuCode));
  log("lookup", skuCode, "->", (await field.lookupResult(w)).slice(0, 170));
  await field.open(w, "/bodega/buscar?codigo=NOEXISTE");
  log("lookup unknown ->", await field.lookupMessage(w));
  // A driver cannot open the warehouse half
  await c2.close();
  const c3 = await phone();
  const d = await c3.newPage();
  watch(d);
  await signIn(d, "repartidor2@yuntera.example");
  await field.open(d, "/bodega");
  log("driver on /bodega ->", new URL(d.url()).pathname);
  await c3.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
