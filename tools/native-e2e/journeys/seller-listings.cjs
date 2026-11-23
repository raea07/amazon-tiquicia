// Yuntera Vende, the seller app (apps/seller-native): the seller actions of
// 20261121083600_seller_listings.sql that the seller centre has. Web export,
// at phone size, on a freshly seeded database. Tienda Sendero's owner works
// in the app; what the next person sees is read through the API as a visitor
// (the shop) or as the database answers the seller centre.
//
//   1. Sells a product another shop created: finds TecnoCasa's blender and
//      adds its own offer from the warehouse. The product page then has it.
//   2. TecnoCasa declares a much heavier package and staff approve it, which
//      pauses Sendero's offer below the price floor. The app lists it with
//      why and the lowest price that covers the fees, and puts it back on
//      sale at a new price in one step.
//   3. Pauses its offer of TecnoCasa's earphones: the shop no longer sells
//      Sendero's offer; resumes it: it is back. Stops selling the blender for
//      good (the tick box first): its offer leaves the product page.
//   4. Retires a size of its own T-shirt: the shop no longer offers that
//      size; brings it back.
//   5. Takes its puzzle back to draft (the tick box first): the product page
//      is gone for shoppers.
//   6. Writes the shop's description: it waits for review, the database holds
//      it, and the app withdraws it again. The card says the logo is still
//      uploaded on the web.
//
// Fails on any console error, uncaught exception or 5xx.

const { chromium, request } = require("playwright");

const BASE = process.env.NATIVE_SELLER_URL || "http://127.0.0.1:3011";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const OWNER = "sendero@yuntera.example";
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
    const body = r.status() === 204 ? null : await r.json().catch(() => null);
    if (r.status() >= 400)
      throw new Error(`${fn} as ${email ?? "visitor"}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  rpc.dispose = () => ctx.dispose();
  return rpc;
}

(async () => {
  const visitor = await as(null);
  const owner = await as(OWNER);
  const shopId = (await owner("my_roles")).sellers[0].id;
  const offersOf = async (slug) =>
    ((await visitor("get_product", { p_slug: slug }))?.skus ?? []).flatMap((k) =>
      k.offers.map((o) => ({ ...o, variant: k.variant_name })),
    );
  const listings = () => owner("seller_listings", { p_seller_id: shopId });

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
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const visible = (id) => page.getByTestId(id).filter({ visible: true }).first();
  const said = async (id) => (await visible(id).innerText()).replace(/\s+/g, " ").trim();
  const shot = (name) =>
    page.screenshot({ path: `${SHOTS}/native-seller-listings-${name}.png`, fullPage: true });
  const noSideways = async (where) =>
    check(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      `${where}: no sideways scrolling at 390 px`,
    );
  const tall = async (id, what) => {
    const box = await visible(id).boundingBox();
    check(box !== null && box.height >= 44, `${what} is at least 44 px high`);
  };

  // Sign in as Tienda Sendero's owner.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await visible("sign-in-email").fill(OWNER);
  await visible("sign-in-password").fill(PASSWORD);
  await visible("sign-in-submit").click();
  await page
    .getByRole("tab", { name: /^Productos/ })
    .first()
    .waitFor();

  // ── 1. An offer on a product another shop created ──────────────────────────
  await page.goto(`${BASE}/productos`, { waitUntil: "networkidle" });
  await visible("offer-existing").click();
  await page.waitForURL(/\/ofrecer/);
  await visible("catalog-query").fill("licuadora");
  await visible("catalog-search").click();
  const blender = "licuadora-volcan-600w";
  await visible(`catalog-match-${blender}`).waitFor();
  const match = await said(`catalog-match-${blender}`);
  check(match.includes("Publicado por TecnoCasa"), "the blender is found, published by TecnoCasa");
  const form = `add-offer-${blender}-0`;
  await visible(`${form}-submit`).click();
  check(
    (await said(`${form}-result`)) === "Elija quién guarda y despacha el producto.",
    "the offer needs who ships it, in the seller centre's words",
  );
  await visible(`${form}-price`).fill("4 000");
  await visible(`${form}-fulfillment-platform`).click();
  check(
    (await page.getByTestId(`${form}-days`).count()) === 0,
    "no handling days are asked when the warehouse ships it",
  );
  await tall(`${form}-submit`, "the add-offer button");
  await noSideways("offering on another shop's product");
  await shot("01-offer-existing");
  await visible(`${form}-submit`).click();
  await page.getByText("Agregamos su oferta. Envíe mercadería a la bodega").first().waitFor();
  check(true, "the offer is added and the app says what to do next");
  await shot("01b-offer-added");
  const blenderOffer = (await listings()).find((l) => l.product_slug === blender);
  check(
    blenderOffer?.offer_status === "active" && blenderOffer.price_minor === 400_000,
    "the database holds Sendero's offer on the blender at ₡4 000",
  );
  check(
    (await offersOf(blender)).some((o) => o.seller.slug === "tienda-sendero"),
    "the shop's product page lists Sendero's offer next to TecnoCasa's",
  );

  // ── 2. Paused below the price floor, back on sale at a new price ───────────
  const tecno = await as("vendedor@yuntera.example");
  const blenderListing = await tecno("seller_listing", { p_product_id: blenderOffer.product_id });
  const c = blenderListing.content;
  await tecno("seller_update_listing", {
    p_product_id: blenderOffer.product_id,
    p_title: c.title,
    p_category_slug: c.category_slug,
    p_description: c.description,
    p_bullet_points: c.bullet_points,
    p_weight_grams: 29_000,
    p_length_cm: c.length_cm,
    p_width_cm: c.width_cm,
    p_height_cm: c.height_cm,
    p_sku_id: c.sku_id,
    p_submit: true,
  });
  await tecno.dispose();
  const central = await as("central@yuntera.example");
  const edit = (await central("ops_listing_edits_for_review")).find(
    (e) => e.product_id === blenderOffer.product_id,
  );
  check(
    edit?.pauses_offers.some((o) => o.seller_name === "Tienda Sendero"),
    "staff see that approving TecnoCasa's edit pauses Sendero's offer",
  );
  await central("ops_review_listing_edit", {
    p_request_id: edit.request_id,
    p_approve: true,
    p_pause_offers: true,
  });
  await central.dispose();
  const pausedNow = (await owner("seller_paused_offers", { p_seller_id: shopId })).find(
    (o) => o.offer_id === blenderOffer.offer_id,
  );
  check(Boolean(pausedNow?.min_price_minor), "Sendero's blender offer is paused below the floor");

  await page.goto(`${BASE}/productos`, { waitUntil: "networkidle" });
  await visible("paused-offers").waitFor();
  const pausedText = await said("paused-offers");
  log("  paused:", pausedText.slice(0, 260));
  check(
    pausedText.includes("Una oferta en pausa porque su precio ya no cubre las tarifas") &&
      pausedText.includes("Licuadora") &&
      pausedText.includes("se aprobó un cambio del paquete o de la categoría") &&
      pausedText.includes("El precio más bajo que cubre las tarifas es"),
    "the app says which offer is paused, why, and the lowest price that covers the fees",
  );
  const suggested = await visible(`paused-price-${blenderOffer.offer_id}`).inputValue();
  check(
    Number(suggested.replace(/\D/g, "")) * 100 === pausedNow.min_price_minor,
    `the new price starts from that lowest price (${suggested})`,
  );
  await noSideways("the paused offers");
  await shot("02-paused-offer");
  await visible(`paused-resume-${blenderOffer.offer_id}`).click();
  await page.getByText("Precio guardado. Su oferta está a la venta otra vez.").first().waitFor();
  const resumed = (await listings()).find((l) => l.offer_id === blenderOffer.offer_id);
  check(
    resumed.offer_status === "active" && resumed.price_minor === pausedNow.min_price_minor,
    "the offer is on sale again at the price that covers the fees",
  );

  // ── 3. Pause and resume an offer; stop selling for good ────────────────────
  const earphones = (await listings()).find(
    (l) => l.product_slug === "audifonos-inalambricos-nimbo-aire",
  );
  await page.goto(`${BASE}/oferta/${earphones.offer_id}`, { waitUntil: "networkidle" });
  await visible("shared-listing").waitFor();
  await visible("offer-status-paused").click();
  await visible("offer-save").click();
  await page.getByText("Cambios guardados.").first().waitFor();
  check(
    !(await offersOf(earphones.product_slug)).some((o) => o.seller.slug === "tienda-sendero"),
    "once paused in the app, the shop no longer sells Sendero's earphones",
  );
  await shot("03-paused-own-offer");
  await visible("offer-status-active").click();
  await visible("offer-save").click();
  await page
    .getByTestId("offer-result")
    .filter({ visible: true, hasText: "Cambios guardados." })
    .first()
    .waitFor();
  await page.waitForTimeout(300);
  check(
    (await offersOf(earphones.product_slug)).some((o) => o.seller.slug === "tienda-sendero"),
    "resumed, the shop sells Sendero's earphones again",
  );

  await page.goto(`${BASE}/oferta/${blenderOffer.offer_id}`, { waitUntil: "networkidle" });
  await visible("withdraw-offer").waitFor();
  await visible("withdraw-offer-submit").click();
  check(
    (await said("withdraw-offer-result")) ===
      "Marque la casilla para confirmar que deja de venderlo.",
    "stopping for good needs the tick box first",
  );
  await visible("withdraw-offer-confirm").click();
  await tall("withdraw-offer-submit", "the stop-selling button");
  await noSideways("the offer on another shop's product");
  await shot("04-withdraw-offer");
  await visible("withdraw-offer-submit").click();
  await page.getByText("Dejó de venderlo: su oferta ya no aparece").first().waitFor();
  check(
    !(await offersOf(blender)).some((o) => o.seller.slug === "tienda-sendero"),
    "the blender's product page no longer lists Sendero's offer",
  );
  check(
    (await listings()).find((l) => l.offer_id === blenderOffer.offer_id)?.offer_status ===
      "archived" || !(await listings()).some((l) => l.offer_id === blenderOffer.offer_id),
    "the offer is archived",
  );

  // ── 4. A size retired and brought back ─────────────────────────────────────
  const shirt = (await listings()).find((l) => l.product_slug === "camiseta-algodon-sendero");
  const shirtDetail = await owner("seller_listing", { p_product_id: shirt.product_id });
  const small = shirtDetail.variants.find((v) => v.variant_name === "Talla S");
  const sizesOnSale = async () =>
    (await offersOf(shirt.product_slug))
      .map((o) => o.variant)
      .filter((v, i, all) => all.indexOf(v) === i);
  check((await sizesOnSale()).includes("Talla S"), "the shop offers the T-shirt in size S");
  await page.goto(`${BASE}/editar/${shirt.product_id}`, { waitUntil: "networkidle" });
  await visible("variants").waitFor();
  await tall(`variant-${small.sku_code}-toggle`, "the variant button");
  await visible(`variant-${small.sku_code}-toggle`).click();
  await page.getByText("Variante retirada: ya no se puede pedir.").first().waitFor();
  check(
    (await said(`variant-${small.sku_code}`)).includes("Retirada"),
    "the size reads as retired, in words",
  );
  check(!(await sizesOnSale()).includes("Talla S"), "the shop no longer offers size S");
  await noSideways("the variants");
  await shot("05-variant-off");
  await visible(`variant-${small.sku_code}-toggle`).click();
  await page.getByText("La variante está a la venta otra vez.").first().waitFor();
  check((await sizesOnSale()).includes("Talla S"), "brought back, the shop offers size S again");

  // ── 5. Back to draft ───────────────────────────────────────────────────────
  const puzzle = (await listings()).find((l) => l.product_slug === "rompecabezas-volcanes-500");
  check(
    (await visitor("get_product", { p_slug: puzzle.product_slug })) !== null,
    "shoppers can open the puzzle",
  );
  await page.goto(`${BASE}/editar/${puzzle.product_id}`, { waitUntil: "networkidle" });
  await visible("unpublish").waitFor();
  await visible("unpublish-submit").click();
  check(
    (await said("unpublish-error")) ===
      "Marque la casilla para confirmar que quiere volverlo a borrador.",
    "going back to draft needs the tick box first",
  );
  await visible("unpublish-confirm").click();
  await shot("06-unpublish");
  await visible("unpublish-submit").click();
  await visible("unpublish-result").waitFor();
  check(
    (await said("unpublish-result")).includes("Ya no aparece en la tienda ni en las búsquedas") &&
      (await said("edit-state")).includes("Borrador"),
    "the app says it is back to draft and what that means",
  );
  check(
    (await visitor("get_product", { p_slug: puzzle.product_slug })) === null,
    "shoppers can no longer open the puzzle",
  );
  await noSideways("a listing back to draft");
  await shot("06b-draft");

  // ── 6. The shop's description ──────────────────────────────────────────────
  const description = "Ropa y equipo para el aire libre, desde Escazú.\n\nEnvíos a todo el país.";
  await page.goto(`${BASE}/cuenta`, { waitUntil: "networkidle" });
  await visible("shop-face").waitFor();
  check(
    /todavía no sube imágenes/.test(await said("shop-face-elsewhere")) &&
      /«Tienda»/.test(await said("shop-face-elsewhere")),
    "the card says the logo is still uploaded on the web, and where",
  );
  await visible("shop-description").fill(description);
  await visible("shop-description-submit").click();
  await page
    .getByText(
      "Enviamos la descripción a revisión. Mientras tanto la tienda muestra la que ya tenía.",
    )
    .first()
    .waitFor();
  await visible("shop-face-description-status").waitFor();
  check(
    /Descripción nueva en revisión/.test(await said("shop-face-description-status")),
    "the description waits for review",
  );
  const front = await owner("seller_shop_front", { p_seller_id: shopId });
  check(
    front.description_request?.status === "pending" &&
      front.description_request.proposed.description === description,
    "the database holds the description as written, waiting for staff",
  );
  await noSideways("the shop's description");
  await shot("07-description");
  await visible("shop-face-withdraw").click();
  await page.getByTestId("shop-face-withdraw").waitFor({ state: "detached" });
  check(
    (await owner("seller_shop_front", { p_seller_id: shopId })).description_request?.status !==
      "pending",
    "the waiting description is withdrawn from the app",
  );

  await owner.dispose();
  await visitor.dispose();
  await browser.close();
  if (errors.length > 0) {
    console.error("ERRORS:", errors);
    process.exit(1);
  }
  log("\nThe seller listings journey passed.");
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
