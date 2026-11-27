// Order follow-ups journey (20261121084200_order_followups.sql): what the
// hosted preview found on 23 November 2026.
//
//   - Central stops a packed parcel from the staff order page: a reason that
//     is too short and a missing confirmation are refused with what to do;
//     the confirmation names the order and the money (the delivery fee
//     included, as nobody went to the door). The heading then says the order
//     is being cancelled, never "En camino".
//   - The shopper's list and order page say the order is being cancelled and
//     how much comes back; the delivery code is not shown for it.
//   - The warehouse's list (field app) says the parcel never left the
//     building; checking it in refunds the goods and the delivery fee, and
//     the shopper's page says the total and that the fee is included.
//   - An order whose only parcel was taken off a route being driven: the
//     shopper's list says "Entrega reprogramada", the staff order page's
//     heading does not say "En camino", the route card does not call it a
//     failed delivery, and Despacho does not either.
//   - The same parcel then sent back to the warehouse (the preview's
//     YT-101282 and YT-101283): the shopper's list and page and the staff
//     heading say the order is being cancelled, with no "En camino", no date
//     and no delivery code, and the page says how much comes back.
//   - A cash order stopped: nothing was paid, so nothing is promised.
//   - A stop form left open while the parcel was stopped elsewhere says why
//     it is refused and keeps the reason typed.
//   - A parcel that failed at the door, was planned again and taken off the
//     new route reads "Entrega reprogramada", never "En camino"; once it is
//     stopped and received, the delivery fee stays charged (someone went to
//     the door) and the shopper's page says so, before and after.
//   - A district moved away and back follows its canton again, and the
//     console's district view says which districts have a zone of their own.
//   - The pages at phone width, with no sideways scroll.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const { ownRoute } = require("../lib/own-route.cjs");
const web = require("../lib/web.cjs");
const ops = require("../lib/ops.cjs");
const field = require("../lib/field.cjs");
const { word } = require("../lib/words.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHOPPER = "comprador3@yuntera.example";
const log = (...a) => console.log(...a);
// The status words these checks look for (tools/e2e/lib/words.cjs).
const byViewer = (kind, value, viewers) =>
  Object.fromEntries(viewers.map((viewer) => [viewer, word(kind, value, { viewer })]));
const ON_ITS_WAY = byViewer("order_status", "shipped", ["shopper", "staff"]);
const CANCELLING = byViewer("order_summary", "cancelling", ["shopper", "staff"]);
const RESCHEDULED = byViewer("order_summary", "rescheduled", ["shopper"]);
/** Colones as the apps write them (packages/core format): ₡6 450, ₡12 500,50. */
const colones = (minor) => {
  const whole = String(Math.floor(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `₡${whole}${minor % 100 ? `,${String(minor % 100).padStart(2, "0")}` : ""}`;
};

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

/**
 * One order of the third demo shopper, a notebook from the warehouse, picked
 * and packed: paid in the simulation, or cash on delivery (not paid yet).
 */
async function packedOrder(method = "sinpe_movil") {
  const buyer = await as(SHOPPER);
  const address = (await buyer("my_addresses")).find((a) => a.is_default && a.zone_active);
  const product = await buyer("get_product", { p_slug: "libreta-tapa-dura-a5" });
  const offer = product.skus.flatMap((k) => k.offers).find((o) => o.fulfillment === "platform");
  const placed = await buyer("place_order", {
    p_items: [{ offer_id: offer.offer_id, quantity: 1 }],
    p_address_id: address.id,
    p_payment_method: method,
    p_idempotency_key: `order-followups-${Date.now()}`,
  });
  if (method !== "cash_on_delivery") {
    await buyer("confirm_sandbox_payment", { p_order_id: placed.order_id });
  }
  await buyer.dispose();

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
  return placed.order_number;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const desktop = () =>
    browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CR" });
  const phone = (extra = {}) =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
      ...extra,
    });

  // ── 1. Central stops a packed parcel ──────────────────────────────────────
  const order = await packedOrder();
  const shopperApi = await as(SHOPPER);
  const placed = await shopperApi("get_order", { p_order_number: order });
  const parcel = placed.shipments[0];
  log(
    "order:",
    order,
    "parcel:",
    parcel.tracking_code,
    "total:",
    placed.total_minor,
    "fee:",
    placed.shipping_minor,
  );
  check(placed.shipping_minor > 0, "the journey's order pays no delivery fee");

  const staffContext = await desktop();
  const staff = await staffContext.newPage();
  watch(staff);
  await ops.signIn(staff, "central@yuntera.example");
  await ops.openOrder(staff, order);
  check(
    (await ops.stopOffers(staff, parcel.tracking_code)) === 1,
    "the staff order page offers no stop for the packed parcel",
  );
  const confirmText = await ops.openStop(staff, parcel.tracking_code);
  log("confirmation:", confirmText);
  check(
    confirmText.includes(order) &&
      confirmText.includes(colones(placed.total_minor)) &&
      confirmText.includes("productos y envío") &&
      confirmText.includes("queda cancelado"),
    `the confirmation does not name the order and the money: ${confirmText}`,
  );
  await ops.typeStopReason(staff, "1234 ok");
  let outcome = await ops.sendStop(staff);
  log("short reason:", outcome);
  check(
    outcome.includes("al menos cinco letras"),
    `a short reason is not refused clearly: ${outcome}`,
  );
  await ops.typeStopReason(staff, "El cliente pidió cancelar por teléfono");
  outcome = await ops.sendStop(staff);
  log("no confirmation:", outcome);
  check(
    outcome.includes("Marque la casilla"),
    `a missing confirmation is not refused clearly: ${outcome}`,
  );
  check(
    (await ops.stopReasonTyped(staff)).includes("pidió cancelar"),
    "the reason typed is lost after a refusal",
  );
  await staff.screenshot({ path: SHOTS + "/of1-stop-confirmation.png", fullPage: true });
  await ops.confirmStop(staff);
  outcome = await ops.sendStop(staff);
  log("stopped:", outcome);
  check(
    outcome.includes(`Paquete ${parcel.tracking_code} detenido`),
    `the parcel was not stopped: ${outcome}`,
  );
  await ops.openOrder(staff, order);
  const staffHeader = await ops.orderHeader(staff);
  log("staff heading:", staffHeader);
  check(
    staffHeader.includes(CANCELLING.staff),
    `the staff heading does not say it is being cancelled: ${staffHeader}`,
  );
  check(!staffHeader.includes(ON_ITS_WAY.staff), "the staff heading says En camino");
  const staffParcels = await ops.orderParcels(staff);
  check(
    staffParcels.includes(word("order_flags", "stopped", { viewer: "staff" })) &&
      !staffParcels.includes(word("shipment_status", "delivery_failed", { viewer: "staff" })) &&
      !/returning/.test(staffParcels),
    `the parcel is not described in plain words: ${staffParcels}`,
  );
  await staff.screenshot({ path: SHOTS + "/of2-staff-order-stopped.png", fullPage: true });

  // ── 2. The shopper while the parcel waits ─────────────────────────────────
  const shopContext = await desktop();
  const shop = await shopContext.newPage();
  watch(shop);
  await web.signIn(shop, SHOPPER);
  const row = await web.orderRow(shop, order);
  log("list row:", row);
  check(
    row.includes(CANCELLING.shopper) && !row.includes(ON_ITS_WAY.shopper),
    `the list row is wrong: ${row}`,
  );
  await web.openOrder(shop, order);
  const waiting = await web.mainText(shop);
  check(
    waiting.includes("Estamos cancelando su pedido") &&
      waiting.includes(`le devolvemos ${colones(placed.total_minor)}, el envío incluido,`),
    "the shopper's page does not say the order is being cancelled and what comes back",
  );
  check(!waiting.includes(ON_ITS_WAY.shopper), "the shopper's page says En camino");
  check(
    !waiting.includes("Su código de entrega"),
    "the delivery code is shown for an order being cancelled",
  );
  check(
    waiting.includes(word("order_flags", "stopped", { viewer: "shopper" })),
    "the parcel is not described as stopped",
  );
  await shop.screenshot({ path: SHOTS + "/of3-shopper-waiting.png", fullPage: true });

  // ── 3. The warehouse receives it ──────────────────────────────────────────
  const fieldContext = await phone();
  const worker = await fieldContext.newPage();
  watch(worker);
  await field.signIn(worker, "bodega@yuntera.example");
  await field.open(worker, "/bodega");
  const returnedText = await field.returnedRowText(worker, parcel.tracking_code);
  log("warehouse row:", returnedText);
  check(
    returnedText.includes("Nunca salió de la bodega") &&
      returnedText.includes(
        "Central lo detuvo antes de que saliera: recíbalo y guarde las unidades en la zona de devoluciones",
      ) &&
      !returnedText.includes("estantes") &&
      !returnedText.includes("0 intentos"),
    `the warehouse is not told the parcel never left: ${returnedText}`,
  );
  check((await overflow(worker)) <= 0, "the warehouse board scrolls sideways on a phone");
  await worker.screenshot({ path: SHOTS + "/of4-warehouse-never-left.png", fullPage: true });
  await field.receiveReturned(worker, parcel.tracking_code, "resellable");

  await web.openOrder(shop, order);
  const done = await web.mainText(shop);
  log("refund total:", await web.refundTotal(shop));
  check(
    done.includes(
      `En total le devolvemos ${colones(placed.total_minor)}: todo lo que pagó, el envío incluido.`,
    ),
    "the shopper's page does not state the total refunded with the fee",
  );
  check(
    done.includes(`Le devolvemos también el envío, ${colones(placed.shipping_minor)}`) &&
      done.includes(`le devolvemos lo que pagó por él: ${colones(placed.items_total_minor)}`),
    "the history does not state the amounts",
  );
  check(
    done.includes(word("order_status", "refunded", { viewer: "shopper" })),
    "the order does not read Reembolsado",
  );
  await shop.screenshot({ path: SHOTS + "/of5-shopper-refunded.png", fullPage: true });
  const refunded = await shopperApi("get_order", { p_order_number: order });
  check(
    refunded.payment.status === "refunded",
    `the payment is ${refunded.payment.status}, not refunded`,
  );

  // ── 4. A stop taken off a route being driven ──────────────────────────────
  const route = await ownRoute(1);
  const stop = route.stops[0];
  const central = await as("central@yuntera.example");
  await central("ops_remove_route_stop", { p_stop_id: stop.stopId, p_reason: "El camión se varó" });
  const offRoute = await web.orderRow(shop, stop.orderNumber);
  log("list row off the route:", offRoute);
  check(
    offRoute.includes(RESCHEDULED.shopper) && !offRoute.includes(ON_ITS_WAY.shopper),
    `the list says the wrong thing for a parcel off its route: ${offRoute}`,
  );
  await shop.screenshot({ path: SHOTS + "/of6-shopper-list.png", fullPage: true });
  await ops.openOrder(staff, stop.orderNumber);
  const offHeader = await ops.orderHeader(staff);
  log("staff heading off the route:", offHeader);
  check(
    !offHeader.includes(ON_ITS_WAY.staff) &&
      offHeader.includes(word("order_flags", "awaiting_route", { viewer: "staff" })),
    `heading: ${offHeader}`,
  );
  await ops.open(staff, "/operacion/rutas");
  const card = await ops.routeStopText(staff, stop.tracking);
  log("route card stop:", card);
  check(
    card.includes("Paquete: quitado de esta ruta, sin intento de entrega") &&
      !card.includes(word("shipment_status", "delivery_failed", { viewer: "staff" })),
    `the route card calls a removed stop a failed delivery: ${card}`,
  );
  await staff.screenshot({ path: SHOTS + "/of7-route-card.png", fullPage: true });
  await ops.open(staff, "/despacho");
  const dispatchText = await ops.dispatchFailed(staff);
  log("dispatch:", dispatchText.slice(0, 200));
  check(
    dispatchText.includes(stop.tracking) &&
      dispatchText.includes("quitado de una ruta, sin intento de entrega") &&
      /^(Quitados de una ruta|Entregas fallidas o quitadas de una ruta)/.test(dispatchText),
    `Despacho calls the removed parcel a failed delivery: ${dispatchText.slice(0, 120)}`,
  );

  // ── 4b. The same parcel sent back to the warehouse ───────────────────────
  // What the preview walked for YT-101282 and YT-101283: nothing is on its
  // way any more, and the order is cancelled once the warehouse receives it.
  const offOrder = await shopperApi("get_order", { p_order_number: stop.orderNumber });
  await central("ops_return_shipment", { p_shipment_id: offOrder.shipments[0].id });
  const backRow = await web.orderRow(shop, stop.orderNumber);
  log("list row sent back:", backRow);
  check(
    backRow.includes(CANCELLING.shopper) &&
      backRow.includes("le devolvemos el dinero") &&
      !backRow.includes(ON_ITS_WAY.shopper) &&
      !backRow.includes("Llega el"),
    `the list says the wrong thing for a parcel sent back: ${backRow}`,
  );
  await web.openOrder(shop, stop.orderNumber);
  // The history below may say "En camino": it was, before it came back.
  const backAll = await web.mainText(shop);
  const backPage = backAll.slice(0, backAll.indexOf("Historial"));
  log("page sent back:", backPage.slice(0, 300));
  check(
    backPage.includes("Su pedido regresa a nuestra bodega sin entregarse.") &&
      backPage.includes(`le devolvemos ${colones(offOrder.total_minor)}, el envío incluido,`),
    "the shopper's page does not say the order comes back and what is refunded",
  );
  check(
    !backPage.includes(ON_ITS_WAY.shopper) &&
      !backPage.includes("Llega el") &&
      !backPage.includes("Su código de entrega"),
    "the shopper's page shows En camino, a date or the delivery code for a parcel sent back",
  );
  check(
    (await shopperApi("get_order", { p_order_number: stop.orderNumber })).delivery_pin === null,
    "the database still gives the delivery code for an order whose parcel comes back",
  );
  await shop.screenshot({ path: SHOTS + "/of6b-shopper-sent-back.png", fullPage: true });
  await ops.openOrder(staff, stop.orderNumber);
  const backHeader = await ops.orderHeader(staff);
  log("staff heading sent back:", backHeader);
  check(
    backHeader.includes(CANCELLING.staff) && !backHeader.includes(ON_ITS_WAY.staff),
    `the staff heading for a parcel sent back: ${backHeader}`,
  );

  // ── 4c. A cash order stopped: nothing was paid, nothing is promised ──────
  const codOrder = await packedOrder("cash_on_delivery");
  const codDetail = await shopperApi("get_order", { p_order_number: codOrder });
  await central("ops_recall_shipment", {
    p_shipment_id: codDetail.shipments[0].id,
    p_reason: "El cliente ya no lo quiere",
  });
  const codRow = await web.orderRow(shop, codOrder);
  log("list row cash order:", codRow);
  check(
    codRow.includes(CANCELLING.shopper) &&
      codRow.includes("No se le cobró nada") &&
      !codRow.includes("devolvemos"),
    `the list promises money back for a cash order: ${codRow}`,
  );
  await web.openOrder(shop, codOrder);
  const codPage = await web.mainText(shop);
  check(
    codPage.includes("No se le cobró nada, así que no hay nada que devolver.") &&
      !/le devolvemos/i.test(codPage),
    `the page promises money back for a cash order: ${codPage.slice(0, 300)}`,
  );
  await shop.screenshot({ path: SHOTS + "/of6c-shopper-cash-stopped.png", fullPage: true });

  // ── 4d. A stop form left open while the parcel was stopped elsewhere ─────
  const staleOrder = await packedOrder();
  const staleDetail = await shopperApi("get_order", { p_order_number: staleOrder });
  await ops.openOrder(staff, staleOrder);
  await ops.openStop(staff);
  await ops.typeStopReason(staff, "La dirección está equivocada");
  await ops.confirmStop(staff);
  await central("ops_recall_shipment", {
    p_shipment_id: staleDetail.shipments[0].id,
    p_reason: "Lo detuvo otra persona",
  });
  outcome = await ops.sendStop(staff);
  log("stale form:", outcome);
  check(
    outcome.includes("ya no se puede detener") && outcome.includes("Recargue la página"),
    `a stale stop form does not say why it is refused: ${outcome}`,
  );
  check(
    (await ops.stopReasonTyped(staff)).includes("equivocada"),
    "the reason typed in a stale stop form is lost",
  );

  // ── 4e. Failed at the door, planned again, then taken off the new route ──
  // The parcel is packed again with one attempt and the order stays
  // "shipped" (an order never moves back): nothing is on its way, so the
  // list and the page must not say "En camino" or the old date.
  const again = await ownRoute(1);
  const againStop = again.stops[0];
  const driverApi = await as("repartidor@yuntera.example");
  await driverApi("driver_fail_stop", { p_stop_id: againStop.stopId, p_reason: "nobody_home" });
  await driverApi.dispose();
  const failedDetail = await shopperApi("get_order", { p_order_number: againStop.orderNumber });
  const dispatch = await central("ops_dispatch_board");
  const drivers = await central("ops_drivers");
  await central("ops_create_route", {
    p_service_date: dispatch.date,
    p_depot_warehouse_id: dispatch.depots[0].id,
    p_stops: [{ shipment_id: failedDetail.shipments[0].id, sequence: 1, eta_minute: 15 }],
    p_driver_id: drivers.find((d) => d.full_name.startsWith("Carlos")).id,
    p_planned_km: 5,
    p_planned_minutes: 30,
  });
  const openRoutes = await central("ops_open_routes");
  const newStop = openRoutes
    .flatMap((r) => r.stops.map((s) => ({ ...s, route: r })))
    .find((s) => s.tracking_code === againStop.tracking && s.status === "pending");
  await central("ops_remove_route_stop", {
    p_stop_id: newStop.stop_id,
    p_reason: "Se cambia de repartidor",
  });
  const againOrder = await shopperApi("get_order", { p_order_number: againStop.orderNumber });
  log("re-planned and removed:", againOrder.status, JSON.stringify(againOrder.shipments[0].status));
  check(
    againOrder.status === "shipped" &&
      againOrder.shipments[0].status === "packed" &&
      againOrder.shipments[0].attempt_count === 1,
    `fixture: the order is not shipped with a packed parcel after one attempt: ${againOrder.status} ${againOrder.shipments[0].status}`,
  );
  const againRow = await web.orderRow(shop, againStop.orderNumber);
  log("list row planned again and removed:", againRow);
  check(
    againRow.includes(RESCHEDULED.shopper) &&
      againRow.includes("Le avisaremos cuando vuelva a salir hacia usted") &&
      !againRow.includes(ON_ITS_WAY.shopper) &&
      !againRow.includes("Llega el"),
    `the list says the wrong thing for a parcel waiting to go out again: ${againRow}`,
  );
  await web.openOrder(shop, againStop.orderNumber);
  const againAll = await web.mainText(shop);
  const againPage = againAll.slice(0, againAll.indexOf("Historial"));
  log("page planned again and removed:", againPage.slice(0, 300));
  check(
    againPage.includes(RESCHEDULED.shopper) &&
      againPage.includes("Reprogramamos la entrega") &&
      !againPage.includes(ON_ITS_WAY.shopper) &&
      !againPage.includes("Llega el") &&
      !againPage.includes("Llega entre"),
    `the order page says the wrong thing for a parcel waiting to go out again: ${againPage.slice(0, 300)}`,
  );
  await shop.screenshot({ path: SHOTS + "/of6e-shopper-planned-again.png", fullPage: true });

  // ── 4f. That parcel stopped and received: the fee stays, and the page says why ──
  // Someone went to the door, so the delivery fee is not refunded (the
  // owner's rule); the shopper is told so, before and after the check-in.
  check(againOrder.shipping_minor > 0, "fixture: the re-planned order has a delivery fee");
  await central("ops_recall_shipment", {
    p_shipment_id: againOrder.shipments[0].id,
    p_reason: "El cliente pidió cancelar",
  });
  const feeLine = `El envío (${colones(againOrder.shipping_minor)}) no se devuelve porque fuimos a entregarlo a su dirección.`;
  await web.openOrder(shop, againStop.orderNumber);
  const keptAll = await web.mainText(shop);
  const keptPage = keptAll.slice(0, keptAll.indexOf("Historial"));
  log("page stopped after an attempt:", keptPage.slice(0, 400));
  check(
    keptPage.includes(
      `le devolvemos ${colones(againOrder.total_minor - againOrder.shipping_minor)} por el mismo medio con que pagó. ${feeLine}`,
    ) && !keptPage.includes("el envío incluido"),
    `the page does not say why the delivery fee stays: ${keptPage.slice(0, 400)}`,
  );
  const keptBodega = await as("bodega@yuntera.example");
  const received = await keptBodega("wms_receive_returned_shipment", {
    p_shipment_id: againOrder.shipments[0].id,
    p_resellable: true,
    p_note: null,
  });
  await keptBodega.dispose();
  check(
    (received.delivery_fee_refund_minor ?? 0) === 0,
    "fixture: no delivery-fee refund after a real attempt",
  );
  // "load", not "networkidle": the page may keep asking for its credit note
  // while the invoice worker is busy.
  await web.openOrder(shop, againStop.orderNumber, "load");
  // Once cancelled, the cancellation notice says it: only the products' money
  // comes back, and why the fee stays, once on the page.
  const keptAfter = await web.cancelNotice(shop);
  log("page cancelled after an attempt:", keptAfter);
  check(keptAfter.includes(feeLine), "after the check-in the notice says why the fee stays");
  check(
    keptAfter.includes("Le devolvemos lo que pagó por los productos") &&
      !keptAfter.includes("Le devolvemos lo que pagó por el mismo medio"),
    "the notice does not promise back what was paid for the delivery",
  );
  check(
    (await web.mainText(shop)).split(feeLine).length - 1 === 1,
    "the page says why the fee stays once",
  );
  await shop.screenshot({ path: SHOTS + "/of6f-shopper-fee-kept.png", fullPage: true });

  // ── 5. A district moved away and back follows its canton ──────────────────
  await central("ops_move_districts", { p_postal_codes: ["10111"], p_zone_id: "gam-extended" });
  await ops.open(staff, "/operacion/distritos?canton=101");
  let district = await ops.districtText(staff, "10111");
  log("district moved away:", district);
  check(
    district.includes("Zona propia, no la del cantón"),
    `the district view does not say it has its own zone: ${district}`,
  );
  await staff.screenshot({ path: SHOTS + "/of8-district-own-zone.png", fullPage: true });
  await central("ops_move_districts", { p_postal_codes: ["10111"], p_zone_id: "gam-core" });
  const [back] = (await central("ops_canton_districts", { p_canton_code: "101" })).districts.filter(
    (d) => d.postal_code === "10111",
  );
  check(
    back.own_zone === false && back.zone_id === "gam-core",
    `moved back, it keeps a zone of its own: ${JSON.stringify(back)}`,
  );
  await ops.open(staff, "/operacion/distritos?canton=101");
  district = await ops.districtText(staff, "10111");
  log("district moved back:", district);
  check(
    district.includes("Sigue la zona del cantón"),
    `moved back, the view does not say it follows its canton: ${district}`,
  );
  await central.dispose();
  await shopperApi.dispose();

  // ── 6. At phone width ─────────────────────────────────────────────────────
  const mobileShop = await (
    await phone({ storageState: await shopContext.storageState() })
  ).newPage();
  watch(mobileShop);
  for (const [path, shot] of [
    ["/pedidos", "of9-mobile-list"],
    [`/pedidos/${order}`, "of10-mobile-refunded"],
  ]) {
    await web.open(mobileShop, path, "load");
    await web.waitForOrderHeading(mobileShop);
    const px = await overflow(mobileShop);
    log(`mobile shop ${path} overflow px:`, px);
    check(px <= 0, `shop ${path} scrolls sideways on a phone`);
    await mobileShop.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }
  const mobileOps = await (
    await phone({ storageState: await staffContext.storageState() })
  ).newPage();
  watch(mobileOps);
  const packedForPhone = await packedOrder();
  for (const [path, shot] of [
    [`/pedidos/${packedForPhone}`, "of11-mobile-stop-form"],
    ["/operacion/rutas", "of12-mobile-routes"],
    ["/operacion/distritos?canton=101", "of13-mobile-districts"],
  ]) {
    await ops.open(mobileOps, path);
    await mobileOps.evaluate(() => {
      for (const details of document.querySelectorAll("main details")) details.open = true;
    });
    const px = await overflow(mobileOps);
    log(`mobile ops ${path} overflow px:`, px);
    check(px <= 0, `ops ${path} scrolls sideways on a phone`);
    await mobileOps.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
