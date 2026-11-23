// The shopper app and the warehouse app after migration 084200 (order
// follow-ups), web export, at phone size, on a freshly seeded database.
//
// Central stops a packed parcel of the third demo shopper through the API, as
// the console does. In the shopper app the order list says the order is being
// cancelled (never "En camino") and the order page says how much comes back,
// the delivery fee included, without the delivery code. In the warehouse app
// the parcel reads "Nunca salió de la bodega"; checking it in says the
// shopper gets the goods and the delivery fee back. The shopper's page then
// gives the total refunded. Then two more orders: a cash order stopped (the
// list and page promise no money back, as nothing was paid) and a paid one
// taken off a route being driven and sent back to the warehouse (the list
// and page say it is being cancelled, never "En camino", and show no date or
// delivery code). Last, a paid order whose parcel came back after the
// driver found nobody home: once checked in, the page says the delivery fee
// is not refunded and why (the parcel stopped before it left says nothing of
// the kind). Fails on any console error, uncaught exception or 5xx.

const { chromium, request } = require("playwright");
const { ownRoute } = require("../../e2e/lib/own-route.cjs");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const SHOP = process.env.NATIVE_SHOP_URL || "http://127.0.0.1:3010";
const WAREHOUSE = process.env.NATIVE_WAREHOUSE_URL || "http://127.0.0.1:3013";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHOPPER = "comprador3@yuntera.example";
const log = (...args) => console.log(...args);
const squash = (text) => text.replace(/\s+/g, " ").trim();
/** Colones as the apps write them (packages/core format). */
const colones = (minor) =>
  `₡${String(Math.floor(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${
    minor % 100 ? `,${String(minor % 100).padStart(2, "0")}` : ""
  }`;

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

/** An order of the shopper, a notebook from the warehouse, picked and packed. */
async function packedOrder(buyer, method) {
  const address = (await buyer("my_addresses")).find((a) => a.is_default && a.zone_active);
  const product = await buyer("get_product", { p_slug: "libreta-tapa-dura-a5" });
  const offer = product.skus.flatMap((k) => k.offers).find((o) => o.fulfillment === "platform");
  const placed = await buyer("place_order", {
    p_items: [{ offer_id: offer.offer_id, quantity: 1 }],
    p_address_id: address.id,
    p_payment_method: method,
    p_idempotency_key: `native-order-followups-${Date.now()}`,
  });
  if (method !== "cash_on_delivery") {
    await buyer("confirm_sandbox_payment", { p_order_id: placed.order_id });
  }
  const bodega = await as("bodega@yuntera.example");
  const warehouse = (await bodega("my_roles")).warehouses[0].id;
  const board = await bodega("wms_board", { p_warehouse_id: warehouse });
  const shipment = board.shipments.find((s) => s.order_number === placed.order_number);
  await bodega("wms_start_picking", { p_shipment_id: shipment.shipment_id });
  const detail = await bodega("wms_shipment", { p_shipment_id: shipment.shipment_id });
  for (const task of detail.tasks) {
    await bodega("wms_confirm_pick", {
      p_task_id: task.task_id,
      p_quantity: task.quantity,
      p_location_id: task.location_id,
      p_code: task.sku_code,
    });
  }
  await bodega("wms_pack_shipment", {
    p_shipment_id: shipment.shipment_id,
    p_weight_grams: detail.expected_weight_grams || 1000,
    p_package_count: 1,
  });
  await bodega.dispose();
  return { placed, shipment };
}

(async () => {
  // ── 1. A paid order, packed, and stopped by Central ──
  const buyer = await as(SHOPPER);
  const { placed, shipment } = await packedOrder(buyer, "sinpe_movil");
  const central = await as("central@yuntera.example");
  await central("ops_recall_shipment", {
    p_shipment_id: shipment.shipment_id,
    p_reason: "El cliente pidió cancelar",
  });
  const order = await buyer("get_order", { p_order_number: placed.order_number });
  check(order.shipping_minor > 0, `the order ${order.order_number} pays a delivery fee`);

  const browser = await chromium.launch();
  const errors = [];
  const phone = async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    });
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
    return page;
  };
  const noSideways = async (page, where) =>
    check(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      `no sideways scrolling at 390 px: ${where}`,
    );

  // ── 2. The shopper app while the parcel waits ──
  const shop = await phone();
  const shopId = (id) => shop.getByTestId(id).filter({ visible: true }).first();
  await shop.goto(`${SHOP}/ingresar?siguiente=%2Fpedidos`, { waitUntil: "networkidle" });
  await shopId("sign-in-email").fill(SHOPPER);
  await shopId("sign-in-password").fill(PASSWORD);
  await shopId("sign-in-submit").click();
  await shopId(`order-${order.order_number}`).waitFor();
  const row = squash(await shopId(`order-${order.order_number}`).innerText());
  log("   ", row);
  check(
    row.includes("Se está cancelando") && !row.includes("En camino"),
    "the list says it is being cancelled",
  );
  await noSideways(shop, "order list");
  await shop.screenshot({ path: `${SHOTS}/native-order-followups-01-list.png`, fullPage: true });
  await shopId(`order-${order.order_number}`).click();
  await shopId("order-stopping").waitFor();
  const stopping = squash(await shopId("order-stopping").innerText());
  log("   ", stopping);
  check(
    stopping.includes(`le devolvemos ${colones(order.total_minor)}, el envío incluido,`),
    "the order page says how much comes back, the delivery fee included",
  );
  check(
    (await shop.getByTestId("delivery-pin").count()) === 0,
    "no delivery code for an order being cancelled",
  );
  check(!squash(await shop.locator("body").innerText()).includes("En camino"), "never En camino");
  await noSideways(shop, "order page");
  await shop.screenshot({ path: `${SHOTS}/native-order-followups-02-order.png`, fullPage: true });

  // ── 3. The warehouse app checks it in ──
  const floor = await phone();
  const floorId = (id) => floor.getByTestId(id).filter({ visible: true }).first();
  await floor.goto(`${WAREHOUSE}/`, { waitUntil: "networkidle" });
  await floorId("sign-in-email").fill("bodega@yuntera.example");
  await floorId("sign-in-password").fill(PASSWORD);
  await floorId("sign-in-submit").click();
  await floorId("warehouse-board").waitFor();
  const parcelRow = floor
    .getByTestId("returned-row")
    .filter({ hasText: shipment.tracking_code })
    .first();
  await parcelRow.waitFor();
  const parcelText = squash(await parcelRow.innerText());
  log("   ", parcelText);
  check(
    parcelText.includes("Nunca salió de la bodega") &&
      parcelText.includes(
        "Central lo detuvo antes de que saliera: recíbalo y guarde las unidades en la zona de devoluciones",
      ) &&
      !parcelText.includes("estantes") &&
      !parcelText.includes("0 intentos"),
    "the board says the parcel never left the building",
  );
  await noSideways(floor, "warehouse board");
  await floor.screenshot({ path: `${SHOTS}/native-order-followups-03-board.png`, fullPage: true });
  await parcelRow.click();
  await floorId("returned-submit").waitFor();
  check(
    squash(await floorId("returned-origin").innerText()).includes("Central lo detuvo"),
    "and so does its page",
  );
  await floorId("returned-condition-resellable").click();
  await floorId("returned-submit").click();
  await floorId("returned-result").waitFor();
  const result = squash(await floorId("returned-result").innerText());
  log("   ", result);
  check(
    result.includes(`Al cliente se le devuelven ${colones(order.total_minor)}, el envío incluido.`),
    "checked in: the shopper gets the goods and the delivery fee back",
  );
  await floor.screenshot({
    path: `${SHOTS}/native-order-followups-04-checked-in.png`,
    fullPage: true,
  });

  // ── 4. The shopper app afterwards ──
  await shop.reload({ waitUntil: "networkidle" });
  await shopId("refund-total").waitFor();
  const total = squash(await shopId("refund-total").innerText());
  log("   ", total);
  check(
    total ===
      `En total le devolvemos ${colones(order.total_minor)}: todo lo que pagó, el envío incluido.`,
    "the order page gives the total refunded",
  );
  check(
    (await shop.getByTestId("fee-kept").count()) === 0,
    "no word of a fee kept for a parcel stopped before it left",
  );
  await shop.screenshot({
    path: `${SHOTS}/native-order-followups-05-refunded.png`,
    fullPage: true,
  });

  // ── 5. A cash order stopped: nothing was paid, nothing is promised ──
  const cash = await packedOrder(buyer, "cash_on_delivery");
  await central("ops_recall_shipment", {
    p_shipment_id: cash.shipment.shipment_id,
    p_reason: "El cliente ya no lo quiere",
  });
  // ── 6. A paid order taken off a route being driven, then sent back ──
  const route = await ownRoute(1);
  const sent = route.stops[0];
  await central("ops_remove_route_stop", { p_stop_id: sent.stopId, p_reason: "El camión se varó" });
  const sentOrder = await buyer("get_order", { p_order_number: sent.orderNumber });
  await central("ops_return_shipment", { p_shipment_id: sentOrder.shipments[0].id });
  await central.dispose();

  await shop.goto(`${SHOP}/pedidos`, { waitUntil: "networkidle" });
  await shopId(`order-${cash.placed.order_number}`).waitFor();
  const cashRow = squash(await shopId(`order-${cash.placed.order_number}`).innerText());
  log("   ", cashRow);
  check(
    cashRow.includes("Se está cancelando") &&
      cashRow.includes("No se le cobró nada") &&
      !cashRow.includes("devolvemos"),
    "the list promises no money back for a cash order",
  );
  const sentRow = squash(await shopId(`order-${sent.orderNumber}`).innerText());
  log("   ", sentRow);
  check(
    sentRow.includes("Se está cancelando") &&
      sentRow.includes("le devolvemos el dinero") &&
      !sentRow.includes("En camino") &&
      !sentRow.includes("Llega el"),
    "the list says a parcel sent back is being cancelled",
  );
  await noSideways(shop, "order list, cash and sent back");
  await shop.screenshot({ path: `${SHOTS}/native-order-followups-06-list.png`, fullPage: true });

  await shopId(`order-${cash.placed.order_number}`).click();
  await shopId("order-stopping").waitFor();
  const cashPage = squash(await shopId("order-stopping").innerText());
  log("   ", cashPage);
  check(
    cashPage.includes("No se le cobró nada, así que no hay nada que devolver.") &&
      !/le devolvemos/i.test(squash(await shop.locator("body").innerText())),
    "the page promises no money back for a cash order",
  );
  await shop.goto(`${SHOP}/pedidos`, { waitUntil: "networkidle" });
  await shopId(`order-${sent.orderNumber}`).click();
  await shop.getByText(`Pedido ${sent.orderNumber}`).first().waitFor();
  await shopId("order-stopping").waitFor();
  const sentPage = squash(await shopId("order-stopping").innerText());
  log("   ", sentPage);
  check(
    sentPage.includes("Su pedido regresa a nuestra bodega sin entregarse.") &&
      sentPage.includes(`le devolvemos ${colones(sentOrder.total_minor)}, el envío incluido,`),
    "the page says a parcel sent back comes back and what is refunded",
  );
  // The history below may say "En camino": it was, before it came back.
  const sentAll = squash(await shop.locator("body").innerText());
  const sentBody = sentAll.slice(0, sentAll.indexOf("Historial"));
  check(
    !sentBody.includes("En camino") && !sentBody.includes("Llega el"),
    "never En camino or a date for a parcel sent back",
  );
  check(
    (await shop.getByTestId("delivery-pin").count()) === 0,
    "no delivery code for a parcel sent back",
  );
  await noSideways(shop, "order page, sent back");
  await shop.screenshot({
    path: `${SHOTS}/native-order-followups-07-sent-back.png`,
    fullPage: true,
  });

  // ── 7. A paid order after a real attempt at the door: the fee stays ──
  // The driver finds nobody home, Central sends the parcel back, the
  // warehouse checks it in: the goods are refunded, the delivery fee is not
  // (someone went to the door), and the page says why.
  const tried = (await ownRoute(1)).stops[0];
  const driver = await as("repartidor@yuntera.example");
  await driver("driver_fail_stop", { p_stop_id: tried.stopId, p_reason: "nobody_home" });
  await driver.dispose();
  const triedOrder = await buyer("get_order", { p_order_number: tried.orderNumber });
  check(triedOrder.shipping_minor > 0, "fixture: the order tried at the door has a delivery fee");
  const central2 = await as("central@yuntera.example");
  await central2("ops_return_shipment", { p_shipment_id: triedOrder.shipments[0].id });
  await central2.dispose();
  const feeLine = `El envío (${colones(triedOrder.shipping_minor)}) no se devuelve porque fuimos a entregarlo a su dirección.`;
  await shop.goto(`${SHOP}/pedidos`, { waitUntil: "networkidle" });
  await shopId(`order-${tried.orderNumber}`).click();
  await shop.getByText(`Pedido ${tried.orderNumber}`).first().waitFor();
  await shopId("order-stopping").waitFor();
  const triedPage = squash(await shopId("order-stopping").innerText());
  log("   ", triedPage);
  check(
    triedPage.includes(feeLine) && !triedPage.includes("el envío incluido"),
    "while it comes back, the page says why the delivery fee stays",
  );
  const triedBodega = await as("bodega@yuntera.example");
  const triedIn = await triedBodega("wms_receive_returned_shipment", {
    p_shipment_id: triedOrder.shipments[0].id,
    p_resellable: true,
    p_note: null,
  });
  await triedBodega.dispose();
  check(
    (triedIn.delivery_fee_refund_minor ?? 0) === 0 && triedIn.order_status === "cancelled",
    "fixture: cancelled, no delivery-fee refund after a real attempt",
  );
  await shop.reload({ waitUntil: "load" });
  await shopId("fee-kept").waitFor();
  const kept = squash(await shopId("fee-kept").innerText());
  log("   ", kept);
  check(kept === feeLine, "after the check-in the page still says why the fee stays");
  await noSideways(shop, "order page, fee kept");
  await shop.screenshot({
    path: `${SHOTS}/native-order-followups-08-fee-kept.png`,
    fullPage: true,
  });
  await buyer.dispose();

  await browser.close();
  if (errors.length) throw new Error(`errors: ${errors.join(" | ")}`);
  log("passed");
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
