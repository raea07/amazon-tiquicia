// Shopper app (apps/shop-native): what the website does that the app now does
// too. Web export, at phone size, on a freshly seeded database.
//
//   1. The brand filter. A visitor narrows all products to one brand and
//      gets exactly the products the database gives for it, with the count,
//      takes the filter off, and in a category with none of that brand reads
//      that there are none and takes it off from there.
//   2. The category menu follows staff. The "Mascotas" department is in the
//      menu; staff hide it (as the console does); when the app comes back to
//      the foreground the menu no longer has it, and its address says the
//      category is not there.
//   3. A product taken down, and a district we do not serve, read as the
//      website says them.
//   4. A sold-out line swapped. The visitor puts Tienda Sendero's offer of the
//      Nimbo earphones in the cart; Tienda Sendero then pauses it. The cart
//      says the offer is no longer on sale and that TecnoCasa sells it, at
//      what price and when it would arrive, and nothing changes until the
//      visitor taps the swap. After the tap the line is TecnoCasa's at that
//      price; the visitor signs in, the checkout shows TecnoCasa and that
//      price, and the order placed charges exactly it.
//
// Fails on any browser console error, uncaught exception or 5xx response.

const { chromium, request } = require("playwright");
const { settledText } = require("../../e2e/lib/settle.cjs");

const BASE = process.env.NATIVE_SHOP_URL || "http://127.0.0.1:3010";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHOPPER = "comprador@yuntera.example";
const EARPHONES = "audifonos-inalambricos-nimbo-aire";
const log = (...args) => console.log(...args);

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
  const flat = async (locator) => (await locator.innerText()).replace(/\s+/g, " ").trim();
  const shot = (name) => page.screenshot({ path: `${SHOTS}/native-shop-parity-${name}.png` });
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const cards = () => page.locator('[data-testid^="product-"]').filter({ visible: true });
  const visitor = await as(null);

  // ── 1. The brand filter ────────────────────────────────────────────────────
  const nimbo = await visitor("search_products", { p_brand_slug: "nimbo", p_limit: 48 });
  const nimboCount = nimbo[0]?.total_count ?? 0;
  check(nimboCount >= 2, `the seed has Nimbo products to filter (${nimboCount})`);

  // The search answers for a brand can be held back, to read the screen while
  // it waits for them as a slow phone connection would show it.
  const held = new Map();
  const hold = (slug) => {
    const gate = {};
    gate.release = new Promise((resolve) => (gate.open = resolve));
    gate.reached = new Promise((resolve) => (gate.reach = resolve));
    held.set(slug, gate);
    return gate;
  };
  await page.route("**/rest/v1/rpc/search_products", async (route) => {
    const gate = held.get(route.request().postDataJSON()?.p_brand_slug);
    if (gate) {
      gate.reach();
      await gate.release;
    }
    await route.continue();
  });
  const heldUp = (gate, slug) =>
    Promise.race([
      gate.reached,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`no search for ${slug} was sent`)), 10_000),
      ),
    ]);
  const summaryText = (wanted, what) =>
    settledText(visible("brand-summary"), wanted, { what, timeout: 15_000 });

  await page.goto(`${BASE}/buscar`, { waitUntil: "networkidle" });
  await visible("brand-filter").waitFor();
  const brandBox = await visible("brand").boundingBox();
  check(brandBox !== null && brandBox.height >= 44, "the brand field is at least 44 px high");
  const nimboGate = hold("nimbo");
  await visible("brand").click();
  await visible("brand-option-nimbo").click();
  await page.waitForURL(/marca=nimbo/);
  await heldUp(nimboGate, "nimbo");
  await visible("brand-summary").waitFor();
  // The answer is held: whatever the screen says now, it says while loading.
  const loading = await flat(visible("brand-summary"));
  log("  brand summary while loading:", loading);
  check(
    !/\d/.test(loading) && loading === "Cargando productos de Nimbo…",
    "while the brand's results load, the summary states no count (never '0 productos')",
  );
  nimboGate.open();
  held.delete("nimbo");
  const summary = await summaryText(
    `Mostrando ${nimboCount} productos de Nimbo`,
    "the Nimbo summary",
  );
  log("  brand summary:", summary);
  check(true, "the results say how many products of the brand there are");
  await cards().first().waitFor();
  const shown = (await cards().evaluateAll((els) => els.map((el) => el.dataset.testid))).map((id) =>
    id.replace(/^product-/, ""),
  );
  check(
    shown.length === nimboCount && shown.every((slug) => nimbo.some((p) => p.slug === slug)),
    `exactly the Nimbo products are shown (${shown.join(", ")})`,
  );
  check((await overflow()) <= 0, "the filtered results have no sideways scrolling at 390 px");
  await shot("01-brand");

  // From one brand to another: Nimbo's count is never shown under the other's name.
  const others = (await visitor("list_brands", {})).filter(
    (b) => b.slug !== "nimbo" && b.product_count > 0,
  );
  const other = others.find((b) => b.product_count !== nimboCount) ?? others[0];
  check(Boolean(other), `the seed has another brand to switch to (${other?.name})`);
  const otherCount =
    (await visitor("search_products", { p_brand_slug: other.slug, p_limit: 1 }))[0]?.total_count ??
    0;
  const otherGate = hold(other.slug);
  await visible("brand").click();
  await visible(`brand-option-${other.slug}`).click();
  await page.waitForURL(new RegExp(`marca=${other.slug}`));
  await heldUp(otherGate, other.slug);
  const switching = await flat(visible("brand-summary"));
  log("  brand summary while switching:", switching);
  check(
    !/\d/.test(switching) && !switching.includes("Nimbo"),
    `while ${other.name}'s results load, the summary states no count and not Nimbo's`,
  );
  otherGate.open();
  held.delete(other.slug);
  await summaryText(
    `Mostrando ${otherCount} ${otherCount === 1 ? "producto" : "productos"} de ${other.name}`,
    `the ${other.name} summary`,
  );
  check(true, `then it says how many products ${other.name} has (${otherCount})`);
  await page.unroute("**/rest/v1/rpc/search_products");
  await visible("brand-clear").click();
  await page.waitForURL((url) => !new URL(url).searchParams.has("marca"));
  await page.getByText("Todos los productos").filter({ visible: true }).first().waitFor();
  check((await page.getByTestId("brand-summary").count()) === 0, "the brand filter comes off");

  await page.goto(`${BASE}/c/mascotas?marca=nimbo`, { waitUntil: "networkidle" });
  await page
    .getByText("No hay productos de esa marca aquí")
    .filter({ visible: true })
    .first()
    .waitFor();
  check(true, "a category with none of the brand says so");
  await shot("02-brand-empty");
  await page
    .getByRole("button", { name: "Quitar el filtro de marca" })
    .filter({ visible: true })
    .first()
    .click();
  await cards().first().waitFor();
  check(!page.url().includes("marca="), "the filter is taken off from the empty result");

  // ── 2. The category menu follows staff ─────────────────────────────────────
  await page.goto(`${BASE}/categorias`, { waitUntil: "networkidle" });
  await visible("department-mascotas").waitFor();
  check(true, "the menu shows Mascotas");
  const central = await as("central@yuntera.example");
  const mascotas = (await central("ops_catalog_categories")).find((c) => c.slug === "mascotas");
  await central("ops_set_category_active", { p_category_id: mascotas.id, p_active: false });
  // Moving between screens costs no request: the menu read a moment ago stays.
  await page
    .getByRole("tab", { name: /^Buscar/ })
    .first()
    .click();
  await page.waitForURL(/\/buscar/);
  await page
    .getByRole("tab", { name: /^Categorías/ })
    .first()
    .click();
  await page.waitForURL(/\/categorias/);
  await page.waitForTimeout(1_000);
  check(
    (await page.getByTestId("department-mascotas").filter({ visible: true }).count()) === 1,
    "a menu read a moment ago is not read again on every screen",
  );
  // The phone leaves the app and comes back (the web export hears it through
  // the page's visibility, as a phone through AppState).
  await page.evaluate(() => {
    const set = (state) => {
      Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    };
    set("hidden");
    set("visible");
  });
  await page
    .getByTestId("department-mascotas")
    .waitFor({ state: "detached", timeout: 10_000 })
    .catch(() => undefined);
  check(
    (await page.getByTestId("department-mascotas").filter({ visible: true }).count()) === 0,
    "back in the foreground, the menu no longer shows the hidden category",
  );
  await shot("03-menu-after-hiding");
  await page.goto(`${BASE}/c/mascotas`, { waitUntil: "networkidle" });
  await page.getByText("No encontramos esa categoría").filter({ visible: true }).first().waitFor();
  check(true, "the hidden category's address says it is not there");

  // ── 3. A product taken down; a district we do not serve ────────────────────
  const hammock = (await visitor("search_products", { p_query: "hamaca" })).find((p) =>
    p.slug.startsWith("hamaca"),
  );
  const hammockPage = await visitor("get_product", { p_slug: hammock.slug });
  await central("ops_take_down_product", {
    p_product_id: hammockPage.id,
    p_reason: "Fotos de otra marca.",
  });
  await page.goto(`${BASE}/p/${hammock.slug}`, { waitUntil: "networkidle" });
  await page.getByText("No encontramos esa página").filter({ visible: true }).first().waitFor();
  const gone = await flat(page.locator("body"));
  check(
    gone.includes(
      "Puede que el enlace esté mal escrito o que el producto ya no esté a la venta.",
    ) && gone.includes("Ir al inicio"),
    "a product taken down reads as the website's not-found page",
  );
  await shot("04-taken-down");
  await visible("not-found-home").click();
  await page.waitForURL((url) => new URL(url).pathname === "/");
  await central.dispose();

  // A district the shop does not serve (Santiago de Puriscal), chosen earlier.
  const unserved = (await visitor("list_districts")).find((d) => !d.zone_active);
  await page.evaluate((code) => localStorage.setItem("yt_cp", code), unserved.postal_code);
  await page.goto(`${BASE}/p/${EARPHONES}`, { waitUntil: "networkidle" });
  await visible("buy-box").waitFor();
  const outside = await flat(visible("buy-box"));
  check(
    outside.includes("Por ahora no entregamos en su zona") &&
      outside.includes("Puede comprar para una dirección en otra zona."),
    `a district we do not serve is named as the website names it (${unserved.district})`,
  );
  await shot("05-zone-not-served");
  await page.evaluate(() => localStorage.removeItem("yt_cp"));

  // ── 4. A sold-out line swapped for another shop's offer ────────────────────
  const product = await visitor("get_product", { p_slug: EARPHONES });
  const offers = product.skus[0].offers;
  const sendero = offers.find((o) => o.seller.slug === "tienda-sendero");
  const tecno = offers.find((o) => o.seller.slug === "tecnocasa");
  check(Boolean(sendero && tecno), "two shops sell the earphones");

  await page.goto(`${BASE}/p/${EARPHONES}`, { waitUntil: "networkidle" });
  await visible("buy-box").waitFor();
  check(
    (await flat(visible("buy-box"))).includes("Tienda Sendero"),
    "Tienda Sendero's offer is the one shown first",
  );
  await visible("add-to-cart").click();
  await visible("added-message").waitFor();

  // Tienda Sendero pauses its offer (as its seller app does).
  const shop = await as("sendero@yuntera.example");
  await shop("seller_update_offer", {
    p_offer_id: sendero.offer_id,
    p_price_minor: sendero.price_minor,
    p_status: "paused",
  });
  await shop.dispose();

  await page.goto(`${BASE}/carrito`, { waitUntil: "networkidle" });
  await visible("cart-alternative").waitFor();
  await visible("cart-alternative-arrival").waitFor();
  const proposal = await flat(visible("cart-alternative"));
  log("  proposal:", proposal);
  const tecnoPrice = `₡${(tecno.price_minor / 100).toLocaleString("en-US").replace(/,/g, " ")}`;
  check(
    // A paused offer comes back from the cart as an id only, so the shop is not named.
    proposal.includes("La oferta que eligió ya no está a la venta.") &&
      proposal.replace(/\s/g, " ").includes(`TecnoCasa lo vende a ${tecnoPrice}.`),
    `the line says the offer is no longer on sale and who else sells it at ${tecnoPrice}`,
  );
  check(/Llega (el|entre el) /.test(proposal), "and when TecnoCasa's offer would arrive");
  check(
    (await flat(visible("cart-blocked"))).startsWith(
      "Cambie o quite los productos que ya no están disponibles para continuar.",
    ) && (await page.getByTestId("cart-continue").count()) === 0,
    "the checkout waits until the line is changed or removed",
  );
  const before = await page.evaluate(() => localStorage.getItem("yt_cart"));
  check(before.includes(sendero.offer_id), "nothing was swapped without a tap");
  const swapBox = await visible("cart-swap").boundingBox();
  check(swapBox !== null && swapBox.height >= 44, "the swap button is at least 44 px high");
  check((await overflow()) <= 0, "the cart has no sideways scrolling at 390 px");
  await page.screenshot({ path: `${SHOTS}/native-shop-parity-06-cart-swap.png`, fullPage: true });
  // At the narrowest supported width the button still names the other shop
  // in full: its label wraps instead of being cut off.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(300);
  const clipped = await visible("cart-swap").evaluate((button) =>
    [...button.querySelectorAll("*")]
      .filter((el) => el.textContent.includes("Cambiar a la oferta de"))
      .some((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1),
  );
  check(!clipped, "at 320 px the swap button shows 'Cambiar a la oferta de TecnoCasa' whole");
  check((await overflow()) <= 0, "the cart has no sideways scrolling at 320 px");
  await page.screenshot({
    path: `${SHOTS}/native-shop-parity-06b-cart-swap-320.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });

  await visible("cart-swap").click();
  await visible("cart-continue").waitFor();
  const line = await flat(visible("cart-line"));
  log("  swapped line:", line);
  check(
    line.includes("Vendido por TecnoCasa") && line.replace(/\s/g, " ").includes(tecnoPrice),
    "after the tap the line is TecnoCasa's, at the price shown",
  );
  const after = await page.evaluate(() => localStorage.getItem("yt_cart"));
  check(
    after.includes(tecno.offer_id) && !after.includes(sendero.offer_id),
    "the cart holds TecnoCasa's offer instead",
  );
  await shot("07-cart-swapped");

  await visible("cart-continue").click();
  await page.waitForURL(/\/ingresar/);
  await visible("sign-in-email").fill(SHOPPER);
  await visible("sign-in-password").fill(PASSWORD);
  await visible("sign-in-submit").click();
  await page.waitForURL((url) => new URL(url).pathname === "/pagar");
  await visible("checkout-summary").waitFor();
  const checkout = (await flat(visible("checkout-summary"))).replace(/\s/g, " ");
  log("  checkout:", checkout.slice(0, 240));
  check(
    checkout.includes("Vendido por TecnoCasa") &&
      checkout.includes(tecnoPrice) &&
      !checkout.includes("Tienda Sendero"),
    "the checkout shows TecnoCasa and its price",
  );
  await shot("08-checkout");
  await visible("payment-sinpe_movil").click();
  await visible("checkout-confirm").click();
  await page.waitForURL((url) => /^\/pedidos\/YT-/.test(new URL(url).pathname));
  const orderNumber = decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
  const buyer = await as(SHOPPER);
  const order = await buyer("get_order", { p_order_number: orderNumber });
  await buyer.dispose();
  const item = order.items[0];
  log(
    "  order:",
    orderNumber,
    JSON.stringify({ seller: item.seller_name, price: item.unit_price_minor }),
  );
  check(
    order.items.length === 1 && item.unit_price_minor === tecno.price_minor,
    `the order charges TecnoCasa's price, ${tecnoPrice}`,
  );
  await visitor.dispose();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
  log("\nThe shopper parity journey passed.");
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
