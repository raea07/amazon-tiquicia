// The shopper app (web export, at phone size): an order whose only parcel
// staff stopped in the warehouse before it left, checked in, says it was
// cancelled before it left the warehouse (not that the parcels came back),
// that the money goes back and where to ask why, on its page and in its
// history (the follow-ups of wave 8, migration 085000).
//
//   A card order of the second demo shopper, paid in the simulation, picked
//   and packed by central, stopped by central and checked in by bodega, all
//   through the API.
//
// Fails on any console error, uncaught exception or 5xx.

const { spawnSync } = require("node:child_process");
const { chromium, request } = require("playwright");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const SHOP = process.env.NATIVE_SHOP_URL || "http://127.0.0.1:3010";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const SHOPPER = "comprador2@yuntera.example";
const PRODUCT = "libreta-tapa-dura-a5";
const log = (...args) => console.log(...args);
const squash = (text) => text.replace(/\s+/g, " ").trim();

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    timezoneId: "America/Costa_Rica",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 300)}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 300)}`));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  const visible = (testId) => page.getByTestId(testId).filter({ visible: true }).first();

  // ── The order, stopped before it left and checked in ──────────────────────
  const buyer = await as(SHOPPER);
  const central = await as("central@yuntera.example");
  const bodega = await as("bodega@yuntera.example");
  const address = (await buyer("my_addresses")).find((a) => a.is_default && a.zone_active);
  const product = await buyer("get_product", { p_slug: PRODUCT });
  const offer = product.skus.flatMap((k) => k.offers).find((o) => o.fulfillment === "platform");
  const placed = await buyer("place_order", {
    p_items: [{ offer_id: offer.offer_id, quantity: 1 }],
    p_address_id: address.id,
    p_payment_method: "card",
    p_idempotency_key: `native-stopped-${Date.now()}`,
  });
  await buyer("confirm_sandbox_payment", { p_order_id: placed.order_id });
  const shipment = sql(`select id from public.shipments where order_id = '${placed.order_id}'`);
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
    p_reason: "Prueba interna: lo detuvo soporte, caso 6632",
  });
  await bodega("wms_receive_returned_shipment", {
    p_shipment_id: shipment,
    p_resellable: true,
    p_note: null,
  });
  await buyer.dispose();
  await central.dispose();
  await bodega.dispose();
  log("stopped before it left and checked in:", placed.order_number);

  await page.goto(`${SHOP}/ingresar?siguiente=%2Fpedidos`, { waitUntil: "networkidle" });
  await visible("sign-in-email").fill(SHOPPER);
  await visible("sign-in-password").fill(PASSWORD);
  await visible("sign-in-submit").click();
  await visible(`order-${placed.order_number}`).waitFor();
  await page.goto(`${SHOP}/pedidos/${placed.order_number}`, { waitUntil: "networkidle" });
  const why = squash(await visible("order-cancel-reason").innerText());
  log("   the order page says:", why);
  check(
    why.startsWith("Cancelamos su pedido antes de que saliera de nuestra bodega") &&
      why.includes("no llegaron a salir de nuestra bodega") &&
      why.includes("Le devolvemos lo que pagó por el mismo medio con que pagó.") &&
      why.includes("Ayuda") &&
      why.includes("haga el pedido de nuevo"),
    "the order page says it never left, that the money goes back, and where to ask why",
  );
  const screen = squash(await page.locator("body").innerText());
  check(
    screen.includes("Cancelado: el pedido no llegó a salir de nuestra bodega"),
    "the history says the same",
  );
  check(
    !screen.includes("regresaron sin entregarse") && !screen.includes("6632"),
    "nothing of parcels coming back, nor staff's reason",
  );
  // The parcel itself (wave 9 integration): never "Devuelto" for one that never left.
  check(
    screen.includes("No salió de la bodega") &&
      screen.includes("Paquete: no salió de nuestra bodega") &&
      !screen.includes("Devuelto") &&
      !screen.includes("Paquete: devuelto"),
    "the parcel and its history say it did not leave the warehouse",
  );
  check(
    (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
    "no sideways scrolling at 390 px",
  );
  await page.screenshot({ path: `${SHOTS}/native-stopped-order.png`, fullPage: true });

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
  log("\nThe stopped order journey passed.");
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
