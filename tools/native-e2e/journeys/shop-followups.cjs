// The shopper app when a read fails, and the delivery date of a cart's
// alternative (migration 084600), web export, at phone size, on a freshly
// seeded database. The journey makes the API answer 500 for one function at a
// time (in the browser only) and checks what the screen says:
//
//   1. The order page of a paid order Central stopped, while its payment cannot
//      be read: it says so with "Intentar de nuevo", states no amount, and keeps
//      what the order says; asked again (the same function a pull runs), the
//      amount comes. Then the order and its payment cannot be refreshed: what
//      is on screen stays, with a notice above it, until asked again.
//   2. A brand's results on screen whose background refresh fails: they stay,
//      with their count and a notice above them. Another brand chosen while
//      the search fails: the error state, never the first brand's products.
//   3. The cart with a line another shop still sells: the other shop's date
//      comes with the alternative (no product page is asked for) and is the
//      date that offer's product page shows. While the alternatives cannot be
//      read, the line never says that nobody else sells it.
//
// Pull-to-refresh is not driven: the web export has no pull gesture. The
// order page's pull and its "Intentar de nuevo" run the same function.
// Fails on any console error, uncaught exception or 5xx other than the ones
// the journey makes on purpose.

const { chromium, request } = require("playwright");
const { settledText } = require("../../e2e/lib/settle.cjs");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const SHOP = process.env.NATIVE_SHOP_URL || "http://127.0.0.1:3010";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHOPPER = "comprador3@yuntera.example";
const EARPHONES = "audifonos-inalambricos-nimbo-aire";
const log = (...args) => console.log(...args);
const squash = (text) => text.replace(/\s+/g, " ").trim();
/** Colones as the apps write them (packages/core format). */
const colones = (minor) =>
  `₡${String(Math.floor(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${
    minor % 100 ? `,${String(minor % 100).padStart(2, "0")}` : ""
  }`;
/** Longer than the app's cache keeps an answer fresh (30 s), so a return to the app asks again. */
const STALE_MS = 31_000;

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

/** Signs in through the API (or not, for a visitor) and calls database functions as that person. */
async function as(email) {
  const ctx = await request.newContext();
  let headers = { apikey: KEY };
  if (email) {
    const token = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
      headers: { apikey: KEY },
      data: { email, password: PASSWORD },
    });
    const { access_token } = await token.json();
    headers = { ...headers, authorization: `Bearer ${access_token}` };
  }
  const rpc = async (fn, args = {}) => {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, { headers, data: args });
    const body = await r.json().catch(() => null);
    if (r.status() >= 400)
      throw new Error(`${fn} as ${email ?? "visitor"}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  rpc.dispose = () => ctx.dispose();
  return rpc;
}

/** A paid order of the shopper, a notebook from the warehouse, packed and stopped by Central. */
async function stoppedOrder(buyer) {
  const address = (await buyer("my_addresses")).find((a) => a.is_default && a.zone_active);
  const product = await buyer("get_product", { p_slug: "libreta-tapa-dura-a5" });
  const offer = product.skus.flatMap((k) => k.offers).find((o) => o.fulfillment === "platform");
  const placed = await buyer("place_order", {
    p_items: [{ offer_id: offer.offer_id, quantity: 1 }],
    p_address_id: address.id,
    p_payment_method: "sinpe_movil",
    p_idempotency_key: `native-shop-followups-${Date.now()}`,
  });
  await buyer("confirm_sandbox_payment", { p_order_id: placed.order_id });
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
  const central = await as("central@yuntera.example");
  await central("ops_recall_shipment", {
    p_shipment_id: shipment.shipment_id,
    p_reason: "El cliente pidió cancelar",
  });
  await central.dispose();
  return buyer("get_order", { p_order_number: placed.order_number });
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
  // The functions this journey makes fail on purpose, and how many times.
  const failing = new Set();
  const failedOnPurpose = new Map();
  const onPurpose = (url) => [...failing].some((fn) => url.includes(`/rest/v1/rpc/${fn}`));
  page.on("console", (message) => {
    const url = message.location()?.url ?? "";
    if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource") && onPurpose(url)) return;
    errors.push(`console: ${message.text().slice(0, 300)}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 300)}`));
  page.on("response", (response) => {
    if (response.status() >= 500 && !onPurpose(response.url()))
      errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await page.route("**/rest/v1/rpc/*", async (route) => {
    const fn = new URL(route.request().url()).pathname.split("/").pop();
    if (failing.has(fn)) {
      failedOnPurpose.set(fn, (failedOnPurpose.get(fn) ?? 0) + 1);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "XX000", message: "made to fail by the journey" }),
      });
      return;
    }
    await route.continue();
  });
  const fail = (...fns) => {
    for (const fn of fns) failing.add(fn);
  };
  const heal = () => failing.clear();

  const visible = (testId) => page.getByTestId(testId).filter({ visible: true }).first();
  const flat = async (locator) => squash(await locator.innerText());
  const shot = (name) =>
    page.screenshot({ path: `${SHOTS}/native-shop-followups-${name}.png`, fullPage: true });
  const noSideways = async (where) =>
    check(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      `no sideways scrolling at 390 px: ${where}`,
    );
  // The phone leaves the app and comes back (the web export hears it through
  // the page's visibility, as a phone through AppState).
  const backToTheApp = () =>
    page.evaluate(() => {
      const set = (state) => {
        Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
        document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      };
      set("hidden");
      set("visible");
    });

  // ── 1. The order page while its payment cannot be read ─────────────────────
  const buyer = await as(SHOPPER);
  const order = await stoppedOrder(buyer);
  check(order.shipping_minor > 0, `the order ${order.order_number} pays a delivery fee`);
  const amount = colones(order.total_minor);

  await page.goto(`${SHOP}/ingresar?siguiente=%2Fpedidos`, { waitUntil: "networkidle" });
  await visible("sign-in-email").fill(SHOPPER);
  await visible("sign-in-password").fill(PASSWORD);
  await visible("sign-in-submit").click();
  await visible(`order-${order.order_number}`).waitFor();

  fail("order_payment");
  await page.goto(`${SHOP}/pedidos/${order.order_number}`, { waitUntil: "networkidle" });
  await visible("order-title").waitFor();
  const unread = await settledText(
    visible("payment-unread"),
    (text) => text.startsWith("No pudimos consultar su pago"),
    { what: "the payment's notice" },
  );
  log("   ", unread);
  check(
    unread.includes("Lo demás de su pedido sí está al día.") &&
      unread.includes("Algo salió mal de nuestro lado.") &&
      unread.includes("Intentar de nuevo"),
    "the page says the payment could not be read, why, and offers to try again",
  );
  const stopping = await flat(visible("order-stopping"));
  log("   ", stopping);
  check(
    stopping.includes("Todavía no le podemos decir el monto: no pudimos consultar su pago.") &&
      !stopping.includes("₡"),
    "the refund notice states no amount and says why",
  );
  const body = await flat(page.locator("body"));
  check(
    body.includes(`Pedido ${order.order_number}`) &&
      body.includes("Se está cancelando") &&
      body.includes("Detenido en la bodega"),
    "what the order itself says stays on screen",
  );
  check(
    !body.includes("le devolvemos ₡") && !body.includes("En total le devolvemos"),
    "nothing about the money comes back is stated",
  );
  check((failedOnPurpose.get("order_payment") ?? 0) >= 1, "the payment was asked for and failed");
  await noSideways("order page, payment unread");
  await shot("01-payment-unread");

  heal();
  await visible("payment-unread-retry").click();
  const told = await settledText(
    visible("order-stopping"),
    (text) => text.includes(`le devolvemos ${amount}, el envío incluido,`),
    { what: "the notice once the payment answered" },
  );
  log("   ", told);
  check(
    (await page.getByTestId("payment-unread").filter({ visible: true }).count()) === 0,
    "asked again, the payment answers: the amount comes and the notice goes",
  );
  await shot("02-payment-read");

  // The order and its payment cannot be refreshed: what is shown stays.
  await page.waitForTimeout(STALE_MS);
  fail("get_order", "order_payment");
  await backToTheApp();
  const kept = await settledText(
    visible("order-kept"),
    (text) => text.startsWith("No pudimos actualizar su pedido"),
    { what: "the order's notice" },
  );
  log("   ", kept);
  check(
    (await flat(visible("order-stopping"))).includes(`le devolvemos ${amount}, el envío incluido,`),
    "a failed refresh keeps the order and its amount on screen",
  );
  check(
    (await page.getByTestId("payment-kept").filter({ visible: true }).count()) === 1,
    "and says the payment's amounts may not be up to date",
  );
  await noSideways("order page, refresh failed");
  await shot("03-order-kept");
  heal();
  await visible("order-kept-retry").click();
  await page
    .getByTestId("order-kept")
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => undefined);
  check(
    (await page.getByTestId("order-kept").filter({ visible: true }).count()) === 0 &&
      (await page.getByTestId("payment-kept").filter({ visible: true }).count()) === 0,
    "asked again, both answer and the notices go",
  );

  // ── 2. A brand's results whose refresh fails ───────────────────────────────
  const visitor = await as(null);
  const nimbo = await visitor("search_products", { p_brand_slug: "nimbo", p_limit: 48 });
  const volcan = await visitor("search_products", { p_brand_slug: "volcan", p_limit: 48 });
  const nimboCount = nimbo[0]?.total_count ?? 0;
  const nimboSlugs = new Set(nimbo.map((p) => p.slug));
  check(
    nimboCount >= 2 && volcan.every((p) => !nimboSlugs.has(p.slug)),
    "two brands with different products",
  );
  const shownSlugs = () =>
    page
      .locator('[data-testid^="product-"]')
      .filter({ visible: true })
      .evaluateAll((cards) => cards.map((c) => c.getAttribute("data-testid").slice(8)));

  await page.goto(`${SHOP}/buscar?marca=nimbo`, { waitUntil: "networkidle" });
  const summary = `Mostrando ${nimboCount} productos de Nimbo`;
  await settledText(visible("brand-summary"), summary, { what: "the Nimbo summary" });
  const before = await shownSlugs();
  check(before.length > 0 && before.every((slug) => nimboSlugs.has(slug)), "Nimbo's products");

  await page.waitForTimeout(STALE_MS);
  fail("search_products");
  await backToTheApp();
  const listingKept = await settledText(
    visible("listing-kept"),
    (text) => text.startsWith("No pudimos actualizar estos resultados"),
    { what: "the results' notice" },
  );
  log("   ", listingKept);
  check(
    listingKept.includes("Le mostramos los que ya tenía; pueden no estar al día.") &&
      listingKept.includes("Intentar de nuevo"),
    "the notice says the results could not be updated and offers to try again",
  );
  check(
    (await flat(visible("brand-summary"))) === summary,
    "the count of the results on screen stays",
  );
  const during = await shownSlugs();
  check(
    during.length === before.length && during.every((slug) => nimboSlugs.has(slug)),
    "the results already on screen stay",
  );
  check(
    (await page
      .getByText("No pudimos cargar esta información")
      .filter({ visible: true })
      .count()) === 0,
    "they are not replaced by the error state",
  );
  await noSideways("results kept");
  await shot("04-results-kept");

  // Another brand while the search still fails: its own error, never Nimbo's products.
  await visible("brand").click();
  await visible("brand-option-volcan").click();
  await page.waitForURL(/marca=volcan/);
  await page
    .getByText("No pudimos cargar esta información")
    .filter({ visible: true })
    .first()
    .waitFor();
  const other = await shownSlugs();
  check(other.length === 0, "a new brand's failed first search shows none of Nimbo's products");
  check(
    (await page.getByTestId("listing-kept").filter({ visible: true }).count()) === 0 &&
      (await page.getByTestId("brand-summary").filter({ visible: true }).count()) === 0,
    "and no notice or count meant for other results",
  );
  await shot("05-other-brand-failed");
  heal();
  await page
    .getByRole("button", { name: "Intentar de nuevo" })
    .filter({ visible: true })
    .first()
    .click();
  await settledText(visible("brand-summary"), /^Mostrando \d+ productos? de Volcán$/, {
    what: "the Volcán summary",
  });
  const volcanSlugs = new Set(volcan.map((p) => p.slug));
  const after = await shownSlugs();
  check(
    after.length > 0 && after.every((slug) => volcanSlugs.has(slug)),
    "asked again, Volcán's own products",
  );

  // ── 3. The cart: another shop's offer and its date ─────────────────────────
  const product = await visitor("get_product", { p_slug: EARPHONES });
  const offers = product.skus[0].offers;
  const sendero = offers.find((o) => o.seller.slug === "tienda-sendero");
  const tecno = offers.find((o) => o.seller.slug === "tecnocasa");
  check(Boolean(sendero && tecno), "two shops sell the earphones");
  await page.goto(`${SHOP}/p/${EARPHONES}`, { waitUntil: "networkidle" });
  await visible("buy-box").waitFor();
  check((await flat(visible("buy-box"))).includes("Tienda Sendero"), "Sendero's offer first");
  await visible("add-to-cart").click();
  await visible("added-message").waitFor();
  const shop = await as("sendero@yuntera.example");
  await shop("seller_update_offer", {
    p_offer_id: sendero.offer_id,
    p_price_minor: sendero.price_minor,
    p_status: "paused",
  });
  try {
    // The district the cart is priced for (none chosen: the shop's default).
    const district = await page.evaluate(() => localStorage.getItem("yt_cp"));
    const [alternative] = await visitor("cart_alternatives", {
      p_offer_ids: [sendero.offer_id],
      p_postal_code: district ?? "10101",
    });
    const page_ = await visitor("get_product", {
      p_slug: EARPHONES,
      p_postal_code: district ?? "10101",
    });
    const tecnoNow = page_.skus[0].offers.find((o) => o.offer_id === tecno.offer_id);
    check(
      JSON.stringify(alternative.promise) === JSON.stringify(tecnoNow.promise) &&
        alternative.promise !== null,
      `the database gives the alternative the product page's date (${JSON.stringify(alternative.promise)})`,
    );

    // While the alternatives cannot be read: never "nobody else sells it".
    fail("cart_alternatives");
    let productReads = 0;
    const countReads = (r) => {
      if (r.url().includes("/rest/v1/rpc/get_product")) productReads += 1;
    };
    page.on("request", countReads);
    await page.goto(`${SHOP}/carrito`, { waitUntil: "networkidle" });
    const unavailable = await settledText(
      visible("cart-unavailable"),
      (text) => text.includes("No pudimos revisar si otra tienda lo vende"),
      { what: "the line while the other shops cannot be checked" },
    );
    log("   ", unavailable);
    check(
      !unavailable.includes("ninguna otra tienda lo vende"),
      "the line never says nobody else sells it while that is unknown",
    );
    check(
      (await flat(visible("cart-blocked"))).startsWith("Cambie o quite"),
      "the footer still offers to change the line",
    );
    await noSideways("cart, alternatives unread");
    await shot("06-cart-alternatives-unread");
    heal();
    await visible("cart-alternatives-retry").click();
    await visible("cart-alternative").waitFor();
    const arrival = await flat(visible("cart-alternative-arrival"));
    log("    the cart says:", arrival);
    check(/^Llega (el|entre el) /.test(arrival), "the alternative says when it would arrive");
    check(productReads === 0, "the cart asked for no product page to say it");
    page.off("request", countReads);
    await noSideways("cart with the alternative");
    await shot("07-cart-alternative-date");

    // The same date as that offer on its product page, at the same moment.
    await page.goto(`${SHOP}/p/${EARPHONES}`, { waitUntil: "networkidle" });
    await visible("buy-box").waitFor();
    const buyBox = await flat(visible("buy-box"));
    check(buyBox.includes("TecnoCasa"), "TecnoCasa's offer comes first on the product page now");
    check(
      buyBox.includes(arrival),
      `the product page shows the same date for TecnoCasa's offer ("${arrival}")`,
    );
    await shot("08-product-same-date");
  } finally {
    await shop("seller_update_offer", {
      p_offer_id: sendero.offer_id,
      p_price_minor: sendero.price_minor,
      p_status: "active",
    });
    await shop.dispose();
  }

  await visitor.dispose();
  await buyer.dispose();
  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
  log("\nThe shopper follow-ups journey passed.");
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
