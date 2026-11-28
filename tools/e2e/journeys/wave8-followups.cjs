// The follow-ups of the hosted check of wave 8 (27 November 2026), at 390 px:
//
//   1. An order whose only parcel staff stopped in the warehouse before it
//      left, checked in: the shopper's order page says it was cancelled before
//      it left the warehouse (not that the parcels came back), that the money
//      goes back, and where to ask why; its history says the same.
//   2. The console's staff-cancel form says the reason stays with the team and
//      what the shopper reads instead.
//   3. The console's order page right after a staff cancellation shows the
//      order refunded, once the action has answered and on the next load.
//      Also logged, not checked: what a reload sent while the action is still
//      running shows (the moment the hosted check reloaded).
//   4. Two links measured on a phone: the shop category page's breadcrumb
//      ("Inicio" and the parent category) and the console's "Ver en Cobros"
//      on a refunded order are 44 px tall, and the breadcrumb's line did not
//      grow.
//
// Its orders are its own (the demo shopper comprador3, paid in the
// simulation). Screen steps are in lib/web.cjs and lib/ops.cjs; status words
// come from lib/words.cjs. Fails on any console error, uncaught exception or
// 5xx.

const { spawnSync } = require("node:child_process");
const { chromium, request } = require("playwright");
const web = require("../lib/web.cjs");
const ops = require("../lib/ops.cjs");
const { word } = require("../lib/words.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const SHOPPER = "comprador3@yuntera.example";
const PRODUCT = "libreta-tapa-dura-a5";
const SHOPPER_VIEW = { viewer: "shopper" };
const STAFF_VIEW = { viewer: "staff" };

const log = (...a) => console.log(...a);

function sql(statement) {
  const run = spawnSync(
    "psql",
    [DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
  return run.stdout.trim();
}

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
    if (r.status() >= 400) throw new Error(`${fn}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  rpc.dispose = () => ctx.dispose();
  return rpc;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
    else log(`  ok: ${message}`);
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
  const phone = () =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    });
  const overflow = (page) => kit.overflowPx(page);
  const height = async (locator) => (await locator.first().boundingBox())?.height ?? 0;

  const buyer = await as(SHOPPER);
  const central = await as("central@yuntera.example");
  const bodega = await as("bodega@yuntera.example");
  const address = (await buyer("my_addresses")).find((a) => a.is_default && a.zone_active);
  const product = await buyer("get_product", { p_slug: PRODUCT });
  const offer = product.skus.flatMap((k) => k.offers).find((o) => o.fulfillment === "platform");
  const paidOrder = async (key) => {
    const placed = await buyer("place_order", {
      p_items: [{ offer_id: offer.offer_id, quantity: 1 }],
      p_address_id: address.id,
      p_payment_method: "card",
      p_idempotency_key: `wave8-followups-${key}-${Date.now()}`,
    });
    await buyer("confirm_sandbox_payment", { p_order_id: placed.order_id });
    return placed;
  };

  // ── 1. Stopped before it left, checked in ──────────────────────────────────
  const stopped = await paidOrder("detenido");
  const shipment = sql(`select id from public.shipments where order_id = '${stopped.order_id}'`);
  await central("wms_start_picking", { p_shipment_id: shipment });
  for (const line of sql(
    `select t.id || '|' || t.quantity || '|' || k.code from public.pick_tasks t
       join public.skus k on k.id = t.sku_id where t.shipment_id = '${shipment}'`,
  ).split("\n")) {
    const [task, quantity, code] = line.split("|");
    await central("wms_confirm_pick", {
      p_task_id: task,
      p_quantity: Number(quantity),
      p_location_id: null,
      p_code: code,
    });
  }
  await central("wms_pack_shipment", { p_shipment_id: shipment, p_weight_grams: 900 });
  await central("ops_recall_shipment", {
    p_shipment_id: shipment,
    p_reason: "Prueba interna: lo detuvo soporte, caso 5521",
  });
  await bodega("wms_receive_returned_shipment", {
    p_shipment_id: shipment,
    p_resellable: true,
    p_note: null,
  });
  log("stopped before it left and checked in:", stopped.order_number);

  const shopper = await (await phone()).newPage();
  watch(shopper);
  await web.signIn(shopper, SHOPPER, { next: `/pedidos/${stopped.order_number}` });
  // "load": the page may keep asking for its credit note while the invoice worker is busy.
  await web.openOrder(shopper, stopped.order_number, "load");
  const said = await web.cancelReason(shopper, 30_000);
  log("the order page says:", said);
  check(
    said.startsWith("Cancelamos su pedido antes de que saliera de nuestra bodega") &&
      said.includes("no llegaron a salir de nuestra bodega") &&
      said.includes("Le devolvemos lo que pagó por el mismo medio con que pagó.") &&
      said.includes("Ayuda") &&
      said.includes("haga el pedido de nuevo"),
    "the order page says it never left, that the money goes back, and where to ask why",
  );
  const all = await web.mainText(shopper);
  check(
    !all.includes("regresaron sin entregarse") && !all.includes("5521"),
    "the page says nothing of parcels coming back, nor staff's reason",
  );
  const history = await web.orderHistory(shopper);
  check(
    history.includes("Cancelado: el pedido no llegó a salir de nuestra bodega"),
    `the history says the same: ${history.slice(0, 200)}`,
  );
  // The parcel itself (wave 9 integration): never the words of a parcel that
  // came back for one that never left.
  const neverLeft = word("shipment_status", "returned", {
    ...SHOPPER_VIEW,
    stoppedBeforeLeaving: true,
  });
  const cameBack = word("shipment_status", "returned", SHOPPER_VIEW);
  // «Devuelto», the word a parcel that came back read before §4.3's words.
  const cameBackBefore = word("payment_status", "refunded", SHOPPER_VIEW);
  check(
    all.includes(neverLeft) && !all.includes(cameBack) && !all.includes(cameBackBefore),
    `the parcel says «${neverLeft}», not «${cameBack}» nor «${cameBackBefore}»`,
  );
  check(
    history.includes(`Paquete: ${neverLeft.toLowerCase()}`) &&
      !history.includes(`Paquete: ${cameBack.toLowerCase()}`) &&
      !history.includes(`Paquete: ${cameBackBefore.toLowerCase()}`),
    "and so does its history line",
  );
  check((await overflow(shopper)) <= 0, "the order page fits 390 px");
  await shopper.screenshot({ path: SHOTS + "/w8f1-shopper-stopped.png", fullPage: true });

  // ── 2. The console's staff-cancel form ────────────────────────────────────
  const cancelled = await paidOrder("personal");
  const staff = await (await phone()).newPage();
  watch(staff);
  await ops.signIn(staff, "central@yuntera.example");
  await ops.openOrder(staff, cancelled.order_number);
  const formText = await ops.staffCancelText(staff);
  log("the cancel form says:", formText);
  check(
    formText.includes("Solo lo ve el equipo.") &&
      formText.includes("Cancelamos este pedido") &&
      formText.includes("Ayuda") &&
      !formText.includes("El cliente lo ve en su pedido"),
    "the form says the reason stays with the team and what the shopper reads",
  );
  await ops.staffCancelForm(staff).screenshot({ path: SHOTS + "/w8f2-console-cancel-hint.png" });

  // ── 3. Right after a staff cancellation ───────────────────────────────────
  await ops.staffCancelOrder(staff, "Prueba interna: cancelado por el equipo de la ola nueve");
  // The action answers, and the page behind it is drawn again (refresh()).
  const refunded = word("order_status", "refunded", STAFF_VIEW);
  const confirmed = word("order_status", "confirmed", STAFF_VIEW);
  await ops.waitForOrderHeaderWith(staff, refunded);
  let header = await ops.orderHeader(staff);
  check(header.includes(refunded), `after the action the page reads refunded: ${header}`);
  await staff.reload({ waitUntil: "networkidle" });
  header = await ops.orderHeader(staff);
  log("the first reload after the action:", header);
  check(
    header.includes(refunded) && !header.includes(confirmed),
    `the first reload after the action reads refunded: ${header}`,
  );
  check((await ops.staffCancelForms(staff)) === 0, "the cancel form is gone");
  await staff.screenshot({ path: SHOTS + "/w8f3-console-after-cancel.png", fullPage: true });

  // What a reload sent while the action is still running shows (not checked:
  // the page is drawn from the database at that moment).
  // A page of its own, not watched: the reload cuts the action's request,
  // which the browser reports as an error of its own.
  const raced = await paidOrder("carrera");
  const racer = await staff.context().newPage();
  await ops.openOrder(racer, raced.order_number);
  await ops.staffCancelOrder(racer, "Prueba interna: recarga inmediata");
  await racer.reload({ waitUntil: "networkidle" }).catch(() => undefined);
  log("a reload sent while the action runs reads:", await ops.orderHeader(racer));
  await racer.close();
  // Whatever it showed, the cancellation finished, and the next load says so.
  let settled = "";
  for (let i = 0; i < 20 && !settled.includes(refunded); i += 1) {
    await staff.waitForTimeout(500);
    await ops.openOrder(staff, raced.order_number);
    settled = await ops.orderHeader(staff);
  }
  log("the next load reads:", settled);
  check(settled.includes(refunded), `the next load reads refunded: ${settled}`);

  // ── 4. Two links measured ─────────────────────────────────────────────────
  await ops.openOrder(staff, cancelled.order_number);
  const toPayments = ops.toPaymentsLink(staff);
  const paymentsHeight = await height(toPayments);
  log("'Ver en Cobros' is", paymentsHeight, "px tall");
  check(paymentsHeight >= 44, `'Ver en Cobros' is ${paymentsHeight} px tall, not 44`);
  check((await overflow(staff)) <= 0, "the console's order page fits 390 px");
  await toPayments.scrollIntoViewIfNeeded();
  await staff.screenshot({ path: SHOTS + "/w8f4-console-ver-en-cobros.png" });

  const visitor = await (await phone()).newPage();
  watch(visitor);
  await web.openCategory(visitor, "cafe");
  const home = await height(web.breadcrumbHome(visitor));
  const parent = await height(web.breadcrumbParent(visitor));
  const line = await height(web.breadcrumbLine(visitor));
  log("breadcrumb:", { home, parent, line });
  check(home >= 44, `the breadcrumb's "Inicio" is ${home} px tall, not 44`);
  check(parent >= 44, `the breadcrumb's category is ${parent} px tall, not 44`);
  check(line > 0 && line <= 24, `the breadcrumb's line is ${line} px, one line of text`);
  check((await overflow(visitor)) <= 0, "the category page fits 390 px");
  await visitor.screenshot({ path: SHOTS + "/w8f5-category-breadcrumb.png" });

  await buyer.dispose();
  await central.dispose();
  await bodega.dispose();
  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
  log("\nThe wave 8 follow-ups journey passed.");
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
