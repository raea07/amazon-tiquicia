// Integrity journey: what the fixes of 21 November 2026 change on screen.
//
//   1. A shopper with three orders waiting for payment is told, at checkout,
//      to pay or cancel one before placing another.
//   2. The shopper's order page says what happens after a withdrawal (we
//      collect the product; the money goes back once it is here). Staff close
//      an approved return whose product never came, with a reason the shopper
//      reads, and record that another returned product reached the warehouse
//      before they can refund it, then refund it once.
//   3. A delivery code locked after five wrong attempts (counted for the whole
//      order) shows on the order in the console; staff release it, the shopper
//      sees a new code, and the driver delivers with it.
//   4. A parcel that came back undelivered is listed on the warehouse board;
//      it is checked in from the order page; the shopper's money for it is
//      refunded and the order is cancelled.
//   5. The console pages it touches fit a 390 px phone.
//
// Like every journey it runs against a freshly seeded database and fails on a
// step that does not arrive, a console error or any 5xx response.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FIELD = process.env.FIELD_URL || "http://127.0.0.1:3003";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Calls API functions as a user, the way an app does.
async function as(email) {
  const ctx = await request.newContext();
  const t = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await t.json();
  const rpc = async (fn, args = {}) => {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: args,
    });
    const body = await r.text();
    const value = body ? JSON.parse(body) : null;
    if (r.status() >= 400) throw new Error(`${fn}: ${r.status()} ${body.slice(0, 200)}`);
    return value;
  };
  return { rpc, dispose: () => ctx.dispose() };
}

(async () => {
  const shopper = await as("comprador@yuntera.example");
  const shopper2 = await as("comprador2@yuntera.example");
  const shopper3 = await as("comprador3@yuntera.example");
  const staff = await as("central@yuntera.example");
  const driver = await as("repartidor@yuntera.example");

  // ── Setup through the API, as the people involved would ──────────────────
  // 1. Two more orders waiting for a transfer: with the seed's one, three.
  const address = (await shopper.rpc("my_addresses")).find((a) => a.is_default);
  const product = await shopper.rpc("get_product", { p_slug: "libreta-tapa-dura-a5" });
  const libreta = product.skus[0].offers[0].offer_id;
  for (const key of ["journey-unpaid-1", "journey-unpaid-2"]) {
    await shopper.rpc("place_order", {
      p_items: [{ offer_id: libreta, quantity: 1 }],
      p_address_id: address.id,
      p_payment_method: "sinpe_movil",
      p_idempotency_key: key,
    });
  }
  const unpaid = (await shopper.rpc("my_orders")).filter((o) => o.status === "pending_payment");
  log("shopper's orders waiting for payment:", unpaid.length);
  check(unpaid.length === 3, "expected three unpaid orders");

  // 2. A withdrawal on a delivered order: approved at once, as the law gives it.
  const delivered = (await shopper.rpc("my_orders")).find((o) => o.status === "delivered");
  const detail = await shopper.rpc("get_order", { p_order_number: delivered.order_number });
  await shopper.rpc("request_return", {
    p_order_item_id: detail.items[0].id,
    p_kind: "withdrawal",
    p_quantity: 1,
  });
  log("withdrawal requested on", delivered.order_number, "for", detail.items[0].title);
  // Another, by a second shopper, whose product will never come back.
  const delivered2 = (await shopper2.rpc("my_orders")).find((o) => o.status === "delivered");
  const detail2 = await shopper2.rpc("get_order", { p_order_number: delivered2.order_number });
  await shopper2.rpc("request_return", {
    p_order_item_id: detail2.items[0].id,
    p_kind: "withdrawal",
    p_quantity: 1,
  });
  log("withdrawal requested on", delivered2.order_number, "(the product will not come back)");

  // 3. The packed parcel of the seed goes out, and five wrong codes are typed.
  const board = await staff.rpc("ops_dispatch_board");
  const parcel = board.ready.find((s) => s.status === "packed");
  const carlos = board.drivers.find((d) => d.full_name.startsWith("Carlos"));
  const route = await staff.rpc("ops_create_route", {
    p_service_date: board.date,
    p_depot_warehouse_id: board.depots[0].id,
    p_stops: [{ shipment_id: parcel.shipment_id, sequence: 1 }],
    p_driver_id: carlos.id,
  });
  await driver.rpc("driver_start_route", { p_route_id: route });
  const stopOf = async (tracking) =>
    (await driver.rpc("driver_today")).routes
      .flatMap((r) => r.stops)
      .find((s) => s.tracking_code === tracking && s.status === "pending");
  const stop = await stopOf(parcel.tracking_code);
  const before = await shopper3.rpc("get_order", { p_order_number: parcel.order_number });
  const wrong = String((Number(before.delivery_pin) + 1) % 10000).padStart(4, "0");
  let answer = null;
  for (let i = 0; i < 5; i++) {
    answer = await driver.rpc("driver_complete_stop", {
      p_stop_id: stop.stop_id,
      p_pin: wrong,
      p_recipient_name: "Sofía Vargas",
    });
  }
  log("after five wrong codes:", JSON.stringify(answer));
  check(
    answer.error === "pin_locked" && answer.attempts_left === 0,
    "the fifth wrong code says at once that the order is locked",
  );
  const locked = await driver.rpc("driver_complete_stop", {
    p_stop_id: stop.stop_id,
    p_pin: before.delivery_pin,
    p_recipient_name: "Sofía Vargas",
  });
  log("the right code once locked:", JSON.stringify(locked));
  check(locked.error === "pin_locked", "locked means locked");

  // 4. A card order out for delivery fails at the door and is sent back.
  const shipped = (await shopper2.rpc("my_orders")).find((o) => o.status === "shipped");
  const shippedDetail = await shopper2.rpc("get_order", { p_order_number: shipped.order_number });
  const failedStop = await stopOf(shippedDetail.shipments[0].tracking_code);
  await driver.rpc("driver_fail_stop", { p_stop_id: failedStop.stop_id, p_reason: "nobody_home" });
  await staff.rpc("ops_return_shipment", { p_shipment_id: shippedDetail.shipments[0].id });
  log(
    "parcel on its way back:",
    shippedDetail.shipments[0].tracking_code,
    "of",
    shipped.order_number,
  );

  // ── The screens ──────────────────────────────────────────────────────────
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
  const signIn = async (page, base, email, expectPath) => {
    await page.goto(base + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === expectPath);
  };

  // 1. Checkout refuses a fourth unpaid order, and says what to do.
  const shop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const s = await shop.newPage();
  watch(s);
  await s.goto(WEB + "/p/libreta-tapa-dura-a5", { waitUntil: "networkidle" });
  await s.locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")').click();
  await s.waitForSelector("text=Agregado al carrito");
  await s.goto(WEB + "/carrito", { waitUntil: "networkidle" });
  await s.click("text=Continuar con la compra");
  await s.waitForURL(/ingresar/);
  await s.fill('main input[name="email"]', "comprador@yuntera.example");
  await s.fill('main input[name="password"]', PASSWORD);
  await s.click('main form button[type="submit"]');
  await s.waitForURL((u) => new URL(u).pathname === "/pagar");
  await s.check('input[name="paymentMethod"][value="sinpe_movil"]');
  await s.click('button:has-text("Confirmar pedido")');
  await s.waitForSelector("main:visible >> text=/varios pedidos esperando el pago/");
  const refusal = await text(s.locator('main:visible [role="alert"]').first());
  log("checkout refusal:", refusal);
  check(/Pague o cancele/.test(refusal), "the refusal says what to do next");
  check(new URL(s.url()).pathname === "/pagar", "the shopper stays on checkout");
  await s.screenshot({ path: SHOTS + "/i1-checkout-limit.png", fullPage: true });

  // The withdrawal on the shopper's order: what happens next, in their words.
  await s.goto(WEB + `/pedidos/${delivered.order_number}`, { waitUntil: "networkidle" });
  await s.waitForSelector("main:visible >> text=/Le contactaremos para recoger el producto/");
  const next = await text(s.locator('main:visible li:has-text("Le contactaremos")').last());
  log("shopper's order page says:", next.slice(0, 220));
  check(
    /cuando llegue a nuestra bodega le reembolsamos/.test(next),
    "the refund waits for the product",
  );
  await s.screenshot({ path: SHOTS + "/i1b-return-next-step.png", fullPage: true });
  await shop.close();

  // 2. A return: received first, refunded after.
  const console_ = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const page = await console_.newPage();
  watch(page);
  await signIn(page, OPS, "central@yuntera.example", "/");
  await page.goto(OPS + "/atencion", { waitUntil: "networkidle" });
  // The product of the second withdrawal never came back: close it, with a reason.
  const stuck = page
    .locator('main:visible section[aria-labelledby="devoluciones"] li')
    .filter({ hasText: delivered2.order_number });
  await stuck.locator("summary:has-text('El producto no llegó')").click();
  await stuck.locator('textarea[name="note"]').fill("corto");
  await stuck.locator('button:has-text("Cerrar sin reembolso")').click();
  await page.waitForSelector("main:visible >> text=/Explique al cliente por qué se cierra/");
  check(
    (await stuck.locator('textarea[name="note"]').inputValue()) === "corto",
    "the typed reason is kept",
  );
  await stuck
    .locator('textarea[name="note"]')
    .fill("Intentamos recogerlo dos veces y el cliente no respondió las llamadas.");
  await stuck.locator('button:has-text("Cerrar sin reembolso")').click();
  // Closed, it leaves the queue.
  await stuck.waitFor({ state: "detached" });
  const closed = await shopper2.rpc("my_order_returns", {
    p_order_number: delivered2.order_number,
  });
  log("the shopper's return now:", closed[0].status, "|", closed[0].resolution_note);
  check(closed[0].status === "rejected", "the return is closed");
  await page.goto(OPS + "/atencion", { waitUntil: "networkidle" });
  const card = page
    .locator('main:visible section[aria-labelledby="devoluciones"] li')
    .filter({ hasText: delivered.order_number });
  log("return card:", (await text(card)).slice(0, 220));
  check(
    (await card.locator('button:has-text("Registrar reembolso")').count()) === 0,
    "no refund button before the goods are back",
  );
  await page.screenshot({ path: SHOTS + "/i2-return-approved.png", fullPage: true });
  await card.locator('select[name="condition"]').selectOption("resellable");
  await card.locator('button:has-text("Registrar que llegó a bodega")').click();
  await page.waitForSelector("main:visible >> text=/Registrar reembolso de/");
  log("after receipt:", (await text(card)).slice(0, 200));
  await page.locator('main:visible button:has-text("Registrar reembolso de")').first().click();
  await page.waitForSelector("main:visible >> text=No hay devoluciones pendientes");
  log("refunded once: queue empty");

  // 3. The locked code on the order, and its release.
  await page.goto(OPS + `/pedidos/${parcel.order_number}`, { waitUntil: "networkidle" });
  await page.waitForSelector("main:visible >> text=Código de entrega bloqueado");
  const alert = await text(
    page.locator('main:visible [role="alert"]:has-text("bloqueado")').first(),
  );
  log("console shows:", alert);
  check(!alert.includes(before.delivery_pin), "the console never shows the code");
  check(
    (await text(page.locator("main:visible"))).includes("Código de entrega bloqueado tras 5"),
    "the lock is in the order's history",
  );
  await page.screenshot({ path: SHOTS + "/i3-code-locked.png", fullPage: true });
  await page.fill(
    'main:visible input[name="note"]',
    "Hablé con la clienta al teléfono del pedido; espera el paquete hoy.",
  );
  await page.click('main:visible button:has-text("Liberar y dar un código nuevo")');
  // Once released the panel goes away with the lock.
  await page.waitForSelector(
    'main:visible [role="alert"]:has-text("Código de entrega bloqueado")',
    {
      state: "detached",
    },
  );
  const code = await staff.rpc("ops_delivery_code", { p_order_id: before.id });
  log("released:", JSON.stringify(code));
  check(!code.locked && code.attempts_left === 5, "the code is released with fresh attempts");

  const after = await shopper3.rpc("get_order", { p_order_number: parcel.order_number });
  check(/^\d{4}$/.test(after.delivery_pin), "the shopper has a code");
  const web3 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-CR" });
  const w = await web3.newPage();
  watch(w);
  await w.goto(WEB + "/ingresar", { waitUntil: "networkidle" });
  await w.fill('main input[name="email"]', "comprador3@yuntera.example");
  await w.fill('main input[name="password"]', PASSWORD);
  await w.click('main form button[type="submit"]');
  await w.waitForURL((u) => new URL(u).pathname !== "/ingresar");
  await w.goto(WEB + `/pedidos/${parcel.order_number}`, { waitUntil: "networkidle" });
  await w.waitForSelector("text=Su código de entrega");
  const shown = (
    await w.locator('section:visible:has-text("Su código de entrega") p').first().innerText()
  ).trim();
  log("shopper reads the new code:", shown === after.delivery_pin);
  check(shown === after.delivery_pin, "the shopper's page shows the new code");
  check(
    (await text(w.locator("main:visible"))).includes("Le dimos un código de entrega nuevo"),
    "and is told why it changed",
  );
  log(
    "shopper page overflow px:",
    await w.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  await w.screenshot({ path: SHOTS + "/i4-shopper-new-code.png", fullPage: true });
  await web3.close();
  const delivered3 = await driver.rpc("driver_complete_stop", {
    p_stop_id: stop.stop_id,
    p_pin: after.delivery_pin,
    p_recipient_name: "Sofía Vargas",
  });
  log("driver delivers with the new code:", JSON.stringify(delivered3));
  check(delivered3.ok === true, "the new code delivers");

  // 4. The warehouse board lists the parcel on its way back.
  const field = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const f = await field.newPage();
  watch(f);
  await f.goto(FIELD + "/ingresar", { waitUntil: "networkidle" });
  await f.fill('main input[name="email"]', "bodega@yuntera.example");
  await f.fill('main input[name="password"]', PASSWORD);
  await f.click('main form button[type="submit"]');
  await f.waitForURL((u) => new URL(u).pathname !== "/ingresar");
  await f.goto(FIELD + "/bodega", { waitUntil: "networkidle" });
  await f.waitForSelector("main:visible >> text=/Paquetes devueltos por recibir \\(1\\)/");
  const coming = await text(
    f.locator('main:visible section[aria-labelledby="devueltos"] li').first(),
  );
  log("warehouse board:", coming.slice(0, 160));
  check(coming.includes(shippedDetail.shipments[0].tracking_code), "the parcel is on the board");
  log(
    "warehouse board overflow px:",
    await f.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  await f.screenshot({ path: SHOTS + "/i5a-warehouse-returning.png", fullPage: true });
  await field.close();

  // It is checked in from its order.
  await page.goto(OPS + `/pedidos/${shipped.order_number}`, { waitUntil: "networkidle" });
  const back = page.locator('main:visible section[aria-labelledby="paquetes"] li').first();
  log("parcel:", (await text(back)).slice(0, 160));
  await back.locator('select[name="condition"]').selectOption("resellable");
  await back.locator('button:has-text("Recibir el paquete devuelto")').click();
  // The page redraws: the parcel is back, and the history says the money goes back.
  await page.waitForSelector("main:visible >> text=/le devolvemos lo que pagó/");
  const history = await text(page.locator('main:visible section[aria-labelledby="historial"]'));
  log("history ends with:", history.slice(-160));
  check(/le devolvemos lo que pagó/.test(history), "the refund is in the order's history");
  const refunded = await staff.rpc("get_order", { p_order_number: shipped.order_number });
  log("payment now:", refunded.payment.status, "| parcel:", refunded.shipments[0].status);
  check(refunded.shipments[0].status === "returned", "the parcel is returned");
  await page.reload({ waitUntil: "networkidle" });
  const status = await text(page.locator("main:visible header").first());
  log("order header now:", status.slice(0, 120));
  check(/Cancelado/.test(status), "an order none of whose parcels arrived is cancelled");
  await page.screenshot({ path: SHOTS + "/i5-parcel-returned.png", fullPage: true });
  await console_.close();

  // 5. Phone width.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const m = await phone.newPage();
  watch(m);
  await signIn(m, OPS, "central@yuntera.example", "/");
  for (const path of [
    "/atencion",
    `/pedidos/${parcel.order_number}`,
    `/pedidos/${shipped.order_number}`,
  ]) {
    await m.goto(OPS + path, { waitUntil: "networkidle" });
    const overflow = await m.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    log(`mobile ${path} overflow px:`, overflow);
    check(overflow <= 0, `${path} scrolls sideways on a phone`);
  }
  await m.screenshot({ path: SHOTS + "/i6-mobile.png", fullPage: true });
  await phone.close();

  for (const api of [shopper, shopper2, shopper3, staff, driver]) await api.dispose();
  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
