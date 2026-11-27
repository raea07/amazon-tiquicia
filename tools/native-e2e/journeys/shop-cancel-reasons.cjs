// The shopper app (web export, at phone size): an order the unpaid-order sweep
// cancelled says why and what to do next, on its page and in its history; a
// cart whose only line can no longer be bought shows no total and no date.
//
//   1. A SINPE Móvil order of the second demo shopper, cancelled the way the
//      sweep cancels it (private.cancel_order_internal with the sweep's
//      reason), for this order alone.
//   2. A notebook in the cart, its offer paused for a moment (and put back).
//
// Fails on any console error, uncaught exception or 5xx.

const { spawnSync } = require("node:child_process");
const { chromium, request } = require("playwright");
const { overflow, screenText, testIds } = require("../lib/screen.cjs");
const shopApp = require("../lib/shop.cjs");

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
  const visible = (testId) => testIds(page, testId).filter({ visible: true }).first();
  const noSideways = async (where) =>
    check((await overflow(page)) <= 0, `no sideways scrolling at 390 px: ${where}`);

  // ── 1. An order the sweep cancelled ────────────────────────────────────────
  const buyer = await as(SHOPPER);
  const address = (await buyer("my_addresses")).find((a) => a.is_default && a.zone_active);
  const product = await buyer("get_product", { p_slug: PRODUCT });
  const offer = product.skus.flatMap((k) => k.offers).find((o) => o.fulfillment === "platform");
  const placed = await buyer("place_order", {
    p_items: [{ offer_id: offer.offer_id, quantity: 1 }],
    p_address_id: address.id,
    p_payment_method: "sinpe_movil",
    p_idempotency_key: `native-cancel-reasons-${Date.now()}`,
  });
  await buyer.dispose();
  sql(`select private.cancel_order_internal('${placed.order_id}', 'Pago no recibido a tiempo')`);

  await page.goto(`${SHOP}/ingresar?siguiente=%2Fpedidos`, { waitUntil: "networkidle" });
  await shopApp.signIn(page, SHOPPER, PASSWORD);
  await visible(`order-${placed.order_number}`).waitFor();
  await page.goto(`${SHOP}/pedidos/${placed.order_number}`, { waitUntil: "networkidle" });
  const why = squash(await visible("order-cancel-reason").innerText());
  log("   the order page says:", why);
  check(
    why.startsWith("Cancelamos su pedido porque no recibimos el pago a tiempo") &&
      why.includes("No se le cobró nada.") &&
      why.includes("haga el pedido de nuevo"),
    "the order page says why it was cancelled, that nothing was charged, and to order again",
  );
  check(
    (await screenText(page)).includes("Cancelado: no recibimos el pago a tiempo"),
    "the history says why",
  );
  await noSideways("the cancelled order");
  await page.screenshot({ path: `${SHOTS}/native-cancel-reasons-1-order.png`, fullPage: true });

  // ── 2. A cart whose only line can no longer be bought ─────────────────────
  await page.goto(`${SHOP}/p/${PRODUCT}`, { waitUntil: "networkidle" });
  await visible("buy-box").waitFor();
  await visible("add-to-cart").click();
  await visible("added-message").waitFor();
  sql(`update public.offers set status = 'paused' where id = '${offer.offer_id}'`);
  try {
    await page.goto(`${SHOP}/carrito`, { waitUntil: "networkidle" });
    await visible("cart-nothing-to-buy").waitFor({ timeout: 30_000 });
    const summary = squash(await visible("cart-summary").innerText());
    log("   the summary says:", summary);
    check(
      !summary.includes("Total") && !summary.includes("Llega el") && !summary.includes("₡"),
      "the summary shows no total to pay and no date",
    );
    check(summary.includes("quítelo"), "the summary says what to do");
    const screen = await screenText(page);
    check(
      !screen.includes("El total cambia") &&
        !screen.includes("Continuar con la compra") &&
        (await testIds(page, "cart-blocked").count()) === 0,
      "the bottom bar says nothing more: no total and no second instruction",
    );
    const title = sql(`select title from public.products where slug = '${PRODUCT}'`);
    check(
      screen.includes(title) && !screen.includes("Producto no disponible"),
      "the paused line still names its product, so the shopper knows what to remove",
    );
    await noSideways("the cart with nothing to buy");
    await page.screenshot({ path: `${SHOTS}/native-cancel-reasons-2-cart.png`, fullPage: true });
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
