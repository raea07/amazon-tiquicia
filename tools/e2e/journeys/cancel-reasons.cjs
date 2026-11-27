// Three things the hosted check of wave 7 found, and a cart with nothing to buy:
//
//   1. An order the unpaid-order sweep cancelled: the web shop's order page says
//      why ("no recibimos el pago a tiempo"), that nothing was charged and to
//      order again, and its history says the same, not just "Cancelado". The
//      order is cancelled the way the sweep cancels it
//      (private.cancel_order_internal with the sweep's reason), for this order
//      alone, so the seed's waiting orders stay for the other journeys.
//   2. The link "Presente un reclamo" on that page, and the back links at the top
//      of the warehouse's pages ("← Bodega", "← Ubicaciones") and of the
//      console's order page ("← Pedidos"), are 44 px tall on a phone.
//   3. A cart whose only line can no longer be bought (its offer paused, then
//      put back): the summary shows no total and no date, and says what to do.
//
// Fails on any console error, uncaught exception or 5xx.

const { spawnSync } = require("node:child_process");
const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FIELD = process.env.FIELD_URL || "http://127.0.0.1:3003";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const SHOPPER = "comprador2@yuntera.example";
const PRODUCT = "libreta-tapa-dura-a5";

const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

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
  const signIn = async (page, base, email, next = "") => {
    await page.goto(`${base}/ingresar${next ? `?siguiente=${encodeURIComponent(next)}` : ""}`, {
      waitUntil: "networkidle",
    });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
    await page.waitForLoadState("networkidle");
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  /** The height of a link, as a finger meets it. */
  const height = async (locator) => (await locator.first().boundingBox())?.height ?? 0;

  // ── 1. An order the sweep cancelled ────────────────────────────────────────
  const buyer = await as(SHOPPER);
  const address = (await buyer("my_addresses")).find((a) => a.is_default && a.zone_active);
  const product = await buyer("get_product", { p_slug: PRODUCT });
  const offer = product.skus.flatMap((k) => k.offers).find((o) => o.fulfillment === "platform");
  const placed = await buyer("place_order", {
    p_items: [{ offer_id: offer.offer_id, quantity: 1 }],
    p_address_id: address.id,
    p_payment_method: "sinpe_movil",
    p_idempotency_key: `cancel-reasons-${Date.now()}`,
  });
  await buyer.dispose();
  sql(`select private.cancel_order_internal('${placed.order_id}', 'Pago no recibido a tiempo')`);
  log("cancelled for no payment:", placed.order_number);

  const shopper = await (await phone()).newPage();
  watch(shopper);
  await signIn(shopper, WEB, SHOPPER, `/pedidos/${placed.order_number}`);
  await shopper.goto(`${WEB}/pedidos/${placed.order_number}`, { waitUntil: "networkidle" });
  const why = shopper.locator('[data-testid="order-cancel-reason"]');
  await why.waitFor({ timeout: 30_000 });
  const said = await text(why);
  log("the order page says:", said);
  check(
    said.startsWith("Cancelamos su pedido porque no recibimos el pago a tiempo") &&
      said.includes("No se le cobró nada.") &&
      said.includes("haga el pedido de nuevo"),
    "the order page says why it was cancelled, that nothing was charged, and to order again",
  );
  const history = await text(shopper.locator('section[aria-labelledby="historial"]'));
  check(
    history.includes("Cancelado: no recibimos el pago a tiempo"),
    `the history says why: ${history.slice(0, 200)}`,
  );
  const claim = shopper.locator('a:has-text("Presente un reclamo")');
  const claimHeight = await height(claim);
  log("'Presente un reclamo' is", claimHeight, "px tall");
  check(claimHeight >= 44, `'Presente un reclamo' is ${claimHeight} px tall, not 44`);
  check((await overflow(shopper)) <= 0, "the order page fits 390 px");
  await shopper.screenshot({ path: SHOTS + "/cr1-order-cancelled-unpaid.png", fullPage: true });

  // ── 2. The back links at the top of pages ─────────────────────────────────
  const worker = await (await phone()).newPage();
  watch(worker);
  await signIn(worker, FIELD, "bodega@yuntera.example");
  await worker.goto(`${FIELD}/bodega/ubicaciones`, { waitUntil: "networkidle" });
  const toWarehouse = worker.locator("a[data-back-link]", { hasText: "← Bodega" });
  const firstLocation = await worker
    .locator('a[href^="/bodega/ubicacion?codigo="]')
    .first()
    .getAttribute("href");
  const warehouseHeight = await height(toWarehouse);
  // The line around it stays one line of text: the link's extra height is outside it,
  // so nothing under it moves.
  const lineHeight = await height(worker.locator("p:has(> a[data-back-link])"));
  await worker.goto(`${FIELD}${firstLocation}`, { waitUntil: "networkidle" });
  const locationsHeight = await height(
    worker.locator("a[data-back-link]", { hasText: "← Ubicaciones" }),
  );
  log("back links:", { warehouseHeight, locationsHeight, lineHeight });
  check(warehouseHeight >= 44, `'← Bodega' is ${warehouseHeight} px tall, not 44`);
  check(locationsHeight >= 44, `'← Ubicaciones' is ${locationsHeight} px tall, not 44`);
  check(
    lineHeight > 0 && lineHeight <= 24,
    `the back link's line is ${lineHeight} px, one line of text`,
  );
  await worker.screenshot({ path: SHOTS + "/cr2-location-back-link.png" });

  const staff = await (await phone()).newPage();
  watch(staff);
  await signIn(staff, OPS, "central@yuntera.example");
  await staff.goto(`${OPS}/pedidos/${placed.order_number}`, { waitUntil: "networkidle" });
  const ordersHeight = await height(staff.locator("a[data-back-link]", { hasText: "← Pedidos" }));
  log("'← Pedidos' is", ordersHeight, "px tall");
  check(ordersHeight >= 44, `'← Pedidos' is ${ordersHeight} px tall, not 44`);
  await staff.screenshot({ path: SHOTS + "/cr3-console-order-back-link.png" });

  // ── 3. A cart whose only line can no longer be bought ─────────────────────
  const visitorContext = await phone();
  await visitorContext.addCookies([{ name: "yt_cp", value: "10101", url: WEB }]);
  const visitor = await visitorContext.newPage();
  watch(visitor);
  await visitor.goto(`${WEB}/p/${PRODUCT}`, { waitUntil: "networkidle" });
  await visitor
    .locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")')
    .click();
  await visitor.waitForSelector("text=Agregado al carrito");
  sql(`update public.offers set status = 'paused' where id = '${offer.offer_id}'`);
  try {
    await visitor.goto(`${WEB}/carrito`, { waitUntil: "networkidle" });
    const summary = visitor.locator('aside[aria-label="Resumen"]');
    await summary.locator('[data-testid="cart-nothing-to-buy"]').waitFor({ timeout: 30_000 });
    const shown = await text(summary);
    log("the summary says:", shown);
    check(
      !shown.includes("Total") && !shown.includes("Llega el") && !shown.includes("₡"),
      "the summary shows no total to pay and no date",
    );
    check(shown.includes("quítelo"), "the summary says what to do");
    check(
      !shown.includes("El total cambia") && !shown.includes("Continuar con la compra"),
      "the summary says what to do once, and speaks of no total",
    );
    const title = sql(`select title from public.products where slug = '${PRODUCT}'`);
    const page = await text(visitor.locator("main"));
    check(
      page.includes(title) && !page.includes("Producto no disponible"),
      "the paused line still names its product, so the shopper knows what to remove",
    );
    check((await overflow(visitor)) <= 0, "the cart fits 390 px");
    await visitor.screenshot({ path: SHOTS + "/cr4-cart-nothing-to-buy.png", fullPage: true });
  } finally {
    sql(`update public.offers set status = 'active' where id = '${offer.offer_id}'`);
  }

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
  log("\nThe cancellation reasons journey passed.");
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
