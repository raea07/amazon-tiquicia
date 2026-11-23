// Seller-listings journey: two shops and one product. Ferretería El Higuerón
// finds Tienda Sendero's thermal bottle and adds its own offer; a shopper sees
// both offers on one product page, chooses the second shop's and buys it;
// Sendero retires a size of its T-shirt and brings it back, takes a listing
// back to draft and sends it to review again (staff publish it); Sendero
// changes its description and logo, staff approve both, and the shop's page
// and the product page show them. Also: when the offer in a cart sells out,
// the cart names the other shop's offer and swaps to it; a package edit that
// would pause another shop's offer needs staff to confirm it, and that shop
// sees why; a paused offer does not stop the creating shop from going back to
// draft, and the offering shop can stop selling for good; the description can
// be removed. Screens are looked at at 390 px too.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

const BOTTLE = "/p/botella-termica-sendero-750ml";
const SHIRT = "/p/camiseta-algodon-sendero";
const PUZZLE = "/p/rompecabezas-volcanes-500";
const PUZZLE_TITLE = "Rompecabezas Volcanes de Costa Rica 500 piezas";
const DESCRIPTION =
  "Ropa y equipo para el aire libre, desde Escazú.\n\n<b>Envíos</b> a todo el Gran Área Metropolitana.";

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
  const signIn = async (page, base, email) => {
    await page.goto(base + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === "/");
    await page.waitForSelector("main h1:visible, main h2:visible");
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const desktop = () =>
    browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CR" });
  const phoneOf = async (context) =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
      storageState: context ? await context.storageState() : undefined,
    });
  // Looks at a page at 390 px: no sideways scrolling, and a screenshot to read.
  const onPhone = async (context, url, shot) => {
    const phone = await phoneOf(context);
    const page = await phone.newPage();
    watch(page);
    await page.goto(url, { waitUntil: "networkidle" });
    const px = await overflow(page);
    log(`390 px ${new URL(url).pathname}: overflow ${px} px`);
    check(px <= 0, `${new URL(url).pathname} scrolls sideways on a phone (${px} px)`);
    await page.screenshot({ path: `${SHOTS}/${shot}`, fullPage: true });
    await phone.close();
  };
  // A visitor's fresh look at a shop page (a fresh browser: see listing-edit.cjs).
  const visit = async (path, { notFound = false } = {}) => {
    const context = await browser.newContext({ locale: "es-CR" });
    const page = await context.newPage();
    // A page that must answer 404 makes the browser log that 404 as an
    // error; only server errors count there.
    if (notFound) {
      page.on("response", (r) => {
        if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
      });
    } else {
      watch(page);
    }
    const response = await page.goto(WEB + path, { waitUntil: "networkidle" });
    return { page, context, status: response?.status() ?? 0 };
  };

  // A logo to upload, drawn by the browser itself: a real JPEG.
  const painter = await (await browser.newContext()).newPage();
  const logoJpeg = await painter
    .evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 900;
      const g = canvas.getContext("2d");
      g.fillStyle = "hsl(150 45% 40%)";
      g.fillRect(0, 0, 900, 900);
      g.fillStyle = "hsl(45 90% 60%)";
      g.beginPath();
      g.moveTo(450, 150);
      g.lineTo(780, 750);
      g.lineTo(120, 750);
      g.closePath();
      g.fill();
      return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
    })
    .then((b64) => Buffer.from(b64, "base64"));

  // ── 1. Ferretería El Higuerón offers on Sendero's bottle ────────────────────
  const ferreteriaContext = await desktop();
  const ferreteria = await ferreteriaContext.newPage();
  watch(ferreteria);
  await signIn(ferreteria, SELLER, "vendedor@yuntera.example");
  if (!(await ferreteria.locator("main h1:visible").innerText()).includes("Ferretería")) {
    await ferreteria.selectOption("#shop", { label: "Ferretería El Higuerón" });
    await ferreteria.click('header button:has-text("Cambiar")');
    await ferreteria.waitForSelector('main h1:visible:has-text("Ferretería")');
  }
  await ferreteria.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  await ferreteria.click('main:visible a:has-text("Vender uno que ya existe")');
  await ferreteria.waitForURL((u) => new URL(u).pathname === "/productos/ofrecer");
  await ferreteria.fill('main:visible input[name="q"]', "botella térmica");
  await ferreteria.click('main:visible button:has-text("Buscar")');
  const match = ferreteria
    .locator("main:visible li", { hasText: "Botella térmica Sendero" })
    .first();
  await match.waitFor();
  log("found:", (await text(match)).slice(0, 160));
  check((await text(match)).includes("Publicado por Tienda Sendero"), "the creator is not named");
  await ferreteria.screenshot({ path: SHOTS + "/sl1-offer-search.png", fullPage: true });
  await match.locator('input[name="price"]').fill("9 500");
  await match.locator('select[name="fulfillment"]').selectOption("seller");
  await match.locator('input[name="handlingDays"]').fill("1");
  await match.locator('button:has-text("Agregar mi oferta")').click();
  await ferreteria.waitForSelector("main:visible >> text=Agregamos su oferta");
  log("added:", await text(ferreteria.locator('main:visible [role="status"]').first()));
  await onPhone(
    ferreteriaContext,
    `${SELLER}/productos/ofrecer?q=botella`,
    "sl1b-offer-search-390.png",
  );

  // Its stock, at its own place, by the usual path.
  await ferreteria.goto(SELLER + "/inventario", { waitUntil: "networkidle" });
  const stockRow = ferreteria
    .locator("main:visible tbody tr", { hasText: "Botella térmica" })
    .first();
  await stockRow.locator('input[name="quantity"]').fill("6");
  await stockRow.locator('button[type="submit"]').click();
  await stockRow.locator('[role="status"], [role="alert"]').first().waitFor();
  log("stock:", await text(stockRow.locator('[role="status"], [role="alert"]').first()));

  // Its list: the offer is there, marked as another shop's listing, without "Editar".
  await ferreteria.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  const offerRow = ferreteria.locator("main:visible tbody tr", { hasText: "Botella térmica" });
  const offerRowText = await text(offerRow);
  log("offer row:", offerRowText.slice(0, 200));
  check(
    offerRowText.includes("De otra tienda"),
    "the offer is not marked as another shop's listing",
  );
  check(
    (await offerRow.locator('a:has-text("Editar")').count()) === 0,
    "it can edit another shop's listing",
  );
  // What it may change is said on screen, not only to screen readers.
  check(
    await offerRow.locator("text=Usted cambia su precio y sus existencias").isVisible(),
    "the row does not say, visibly, what the shop may change",
  );

  // ── 2. A shopper sees both offers and buys from the second shop ─────────────
  const shopperContext = await desktop();
  const shopper = await shopperContext.newPage();
  watch(shopper);
  await shopper.goto(WEB + BOTTLE, { waitUntil: "networkidle" });
  const buyBox = await text(shopper.locator('aside[aria-label="Comprar"]'));
  log("buy box:", buyBox.slice(0, 200));
  check(
    buyBox.includes("Vendido por Ferretería El Higuerón"),
    "the cheaper offer in stock is not first",
  );
  const others = await text(shopper.locator('section[aria-labelledby="otras-ofertas"]'));
  log("other offers:", others.slice(0, 220));
  check(others.includes("Tienda Sendero"), "the creator's offer is not listed");
  await shopper.screenshot({ path: SHOTS + "/sl2-product-two-offers.png", fullPage: true });
  await onPhone(null, WEB + BOTTLE, "sl2b-product-two-offers-390.png");
  await shopper
    .locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")')
    .click();
  await shopper.waitForSelector("text=Agregado al carrito");
  await shopper.goto(WEB + "/carrito", { waitUntil: "networkidle" });
  const cart = await text(shopper.locator("main ul > li").first());
  log("cart line:", cart.slice(0, 160));
  check(
    cart.includes("Vendido por Ferretería El Higuerón"),
    "the cart does not name the shop chosen",
  );
  await shopper.click("text=Continuar con la compra");
  await shopper.waitForURL(/ingresar/);
  await shopper.fill('main input[name="email"]', "comprador@yuntera.example");
  await shopper.fill('main input[name="password"]', PASSWORD);
  await shopper.click('main form button[type="submit"]');
  await shopper.waitForURL((u) => new URL(u).pathname === "/pagar");
  await shopper.check('input[name="paymentMethod"][value="sinpe_movil"]');
  await shopper.click('button:has-text("Confirmar pedido")');
  await shopper.waitForURL((u) => /^\/pedidos\/YT-/.test(new URL(u).pathname));
  await shopper.waitForSelector('h1:visible:has-text("Pedido YT-")');
  await shopper.click('button:visible:has-text("Simular pago")');
  await shopper.waitForSelector("text=Su código de entrega", { timeout: 15000 });
  const order = await text(shopper.locator("main:visible"));
  check(order.includes("Botella térmica"), "the order does not hold the bottle");
  log("order paid:", shopper.url().replace(WEB, ""));

  // The second shop sees the sale to pack; the first does not.
  await ferreteria.goto(SELLER + "/pedidos", { waitUntil: "networkidle" });
  const toPack = await text(ferreteria.locator("main:visible"));
  check(toPack.includes("Botella térmica"), "the offering shop does not see its sale");

  // ── 2b. The offer in a cart sells out: the cart names the other shop's ─────
  const visitorContext = await desktop();
  const visitor = await visitorContext.newPage();
  watch(visitor);
  await visitor.goto(WEB + BOTTLE, { waitUntil: "networkidle" });
  await visitor
    .locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")')
    .click();
  await visitor.waitForSelector("text=Agregado al carrito");
  const setFerreteriaStock = async (units) => {
    await ferreteria.goto(SELLER + "/inventario", { waitUntil: "networkidle" });
    const row = ferreteria.locator("main:visible tbody tr", { hasText: "Botella térmica" }).first();
    await row.locator('input[name="quantity"]').fill(String(units));
    await row.locator('button[type="submit"]').click();
    await row.locator('[role="status"], [role="alert"]').first().waitFor();
  };
  // One unit is held for the order just paid: on hand 1 leaves none to sell.
  await setFerreteriaStock(1);
  await visitor.goto(WEB + "/carrito", { waitUntil: "networkidle" });
  const soldOut = await text(visitor.locator("main ul > li").first());
  log("sold-out line:", soldOut.slice(0, 220));
  check(
    soldOut.includes("La oferta de Ferretería El Higuerón se agotó") &&
      soldOut.includes("Tienda Sendero lo vende a"),
    "the cart does not say whose offer ran out and who else sells it",
  );
  check(!soldOut.includes("Ya no está disponible"), "the cart says the product is gone");
  // When the other shop's offer would arrive (084600): the date its product
  // page gives for the same district, read a moment later.
  const arrival = await text(
    visitor.locator("main ul > li").first().locator('[data-testid="cart-alternative-arrival"]'),
  );
  log("alternative arrives:", arrival);
  check(
    /^Llega (el|entre el) /.test(arrival),
    "the cart does not say when the other offer arrives",
  );
  await visitor.goto(WEB + BOTTLE, { waitUntil: "networkidle" });
  const visitorBuyBox = visitor.locator('aside[aria-label="Comprar"]');
  check(
    (await text(visitorBuyBox)).includes("Tienda Sendero"),
    "Tienda Sendero's offer is not shown first",
  );
  const pageDate = await text(visitorBuyBox.locator("dd.text-success").first());
  check(
    arrival === `Llega ${pageDate}`,
    `the cart's date (${arrival}) is not the product page's (${pageDate})`,
  );
  await visitor.goto(WEB + "/carrito", { waitUntil: "networkidle" });
  await visitor.screenshot({ path: SHOTS + "/sl2c-cart-sold-out.png", fullPage: true });
  await onPhone(visitorContext, WEB + "/carrito", "sl2d-cart-sold-out-390.png");
  await visitor.click('main button:has-text("Cambiar a la oferta de Tienda Sendero")');
  await visitor.waitForSelector("main >> text=Vendido por Tienda Sendero");
  check(
    (await visitor.locator("main >> text=Continuar con la compra").count()) === 1,
    "the cart cannot go on after the swap",
  );
  log("swapped:", (await text(visitor.locator("main ul > li").first())).slice(0, 160));
  await visitorContext.close();
  await setFerreteriaStock(6);

  // ── 3. Sendero retires a size and brings it back ───────────────────────────
  const senderoContext = await desktop();
  const sendero = await senderoContext.newPage();
  watch(sendero);
  await signIn(sendero, SELLER, "sendero@yuntera.example");
  await sendero.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  await sendero
    .locator("main:visible tbody tr", { hasText: "Talla S" })
    .locator('a:has-text("Editar")')
    .click();
  await sendero.waitForSelector('main:visible section[aria-labelledby="variantes"]');
  const shirtEdit = sendero.url();
  const small = sendero.locator('main:visible section[aria-labelledby="variantes"] li', {
    hasText: "Talla S",
  });
  await small.locator('button:has-text("Retirar")').click();
  await small.locator("text=Variante retirada").waitFor();
  log("retired:", await text(small));
  await sendero.screenshot({ path: SHOTS + "/sl3-variant-retired.png", fullPage: true });
  let look = await visit(SHIRT);
  const optionsOff = await look.page.locator("main").innerText();
  check(
    !/Talla S/.test(optionsOff) && /Talla M/.test(optionsOff),
    "the retired size is still offered",
  );
  await look.context.close();
  await sendero.goto(shirtEdit, { waitUntil: "networkidle" });
  await small.locator('button:has-text("Volver a ofrecer")').click();
  await small.locator("text=a la venta otra vez").waitFor();
  look = await visit(SHIRT);
  check(/Talla S/.test(await look.page.locator("main").innerText()), "the size did not come back");
  await look.context.close();
  await onPhone(senderoContext, shirtEdit, "sl3b-variants-390.png");
  // Its own offer on a size paused (nobody else sells it): the page says so
  // and offers to put it back, instead of "A la venta".
  await sendero.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  const mediumRow = sendero.locator("main:visible tbody tr", { hasText: "Talla M" }).first();
  await mediumRow.locator("summary").click();
  await mediumRow.locator('select[name="status"]').selectOption("paused");
  await mediumRow.locator('form:has(select[name="status"]) button:has-text("Guardar")').click();
  await mediumRow.locator('[role="status"]').first().waitFor();
  await sendero.goto(shirtEdit, { waitUntil: "networkidle" });
  const medium = sendero.locator('main:visible section[aria-labelledby="variantes"] li', {
    hasText: "Talla M",
  });
  const mediumText = await text(medium);
  log("own offer paused:", mediumText);
  check(
    mediumText.includes("Su oferta en pausa") && !mediumText.includes("A la venta"),
    "a size whose own offer is paused is shown as on sale",
  );
  await medium.locator('button:has-text("Volver a ofrecer")').click();
  await medium.locator("text=a la venta otra vez").waitFor();

  // ── 4. A listing back to draft, and through review again ───────────────────
  await sendero.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  await sendero
    .locator("main:visible tbody tr", { hasText: "Rompecabezas" })
    .locator('a:has-text("Editar")')
    .click();
  await sendero.waitForSelector('main:visible section[aria-labelledby="borrador"]');
  const puzzleEdit = sendero.url();
  const draftBox = sendero.locator('main:visible section[aria-labelledby="borrador"]');
  await draftBox.locator('input[name="confirma"]').check();
  await draftBox.locator('button:has-text("Volver a borrador")').click();
  await sendero.waitForSelector("main:visible >> text=Volvió a borrador");
  log(
    "to draft:",
    (await text(sendero.locator('main:visible [role="status"]').first())).slice(0, 160),
  );
  await sendero.screenshot({ path: SHOTS + "/sl3c-back-to-draft.png", fullPage: true });
  look = await visit(PUZZLE, { notFound: true });
  log("shop while in draft:", look.status);
  check(look.status === 404, `a draft is still in the shop (${look.status})`);
  await look.context.close();
  await sendero.goto(puzzleEdit, { waitUntil: "networkidle" });
  check(
    (await text(sendero.locator('main:visible [role="status"]').first())).includes("Borrador"),
    "the edit page does not say it is a draft",
  );
  await sendero.click('main:visible button:has-text("Guardar y enviar a revisión")');
  // The page now says where it stands (the form starts afresh for a new state).
  await sendero.waitForSelector("main:visible >> text=En revisión; todavía no está publicado");

  const staffContext = await desktop();
  const staff = await staffContext.newPage();
  watch(staff);
  await signIn(staff, OPS, "central@yuntera.example");
  await staff.goto(OPS + "/catalogo", { waitUntil: "networkidle" });
  const card = staff.locator('main:visible section[aria-labelledby="nuevos"] li', {
    hasText: PUZZLE_TITLE,
  });
  await card.locator('button:has-text("Publicar")').click();
  // Decided, it leaves the queue.
  await card.waitFor({ state: "detached" });
  look = await visit(PUZZLE);
  check(look.status === 200, `the listing did not come back to the shop (${look.status})`);
  await look.context.close();

  // ── 5. The shop's description and logo ─────────────────────────────────────
  await sendero.goto(SELLER + "/tienda", { waitUntil: "networkidle" });
  await sendero.fill('main:visible textarea[name="description"]', DESCRIPTION);
  await sendero.click('main:visible button:has-text("Enviar a revisión")');
  await sendero.waitForSelector("main:visible >> text=Descripción nueva en revisión");
  await sendero.locator('main:visible [data-testid="logo-file"]').setInputFiles({
    name: "logo-sendero.jpg",
    mimeType: "image/jpeg",
    buffer: logoJpeg,
  });
  await sendero.waitForSelector("main:visible >> text=Enviamos el logotipo a revisión", {
    timeout: 30000,
  });
  await sendero.goto(SELLER + "/tienda", { waitUntil: "networkidle" });
  await sendero.waitForSelector("main:visible >> text=Logotipo en revisión");
  await sendero.screenshot({ path: SHOTS + "/sl4-shop-front-waiting.png", fullPage: true });
  await onPhone(senderoContext, SELLER + "/tienda", "sl4b-shop-front-390.png");

  // Staff approve both: the description where shop changes are decided, the
  // logo where photos are.
  await staff.goto(OPS + "/cambios-tienda", { waitUntil: "networkidle" });
  const request = staff.locator("main:visible li", { hasText: "Descripción de la tienda" }).first();
  log("request:", (await text(request)).slice(0, 220));
  check((await text(request)).includes("<b>Envíos</b>"), "staff do not see the text as typed");
  await request.locator('button:has-text("Aprobar el cambio")').click();
  await staff.waitForURL(/resuelta=aprobada/);
  await staff.goto(OPS + "/catalogo/logotipos", { waitUntil: "networkidle" });
  const logoCard = staff.locator("main:visible li", { hasText: "Tienda Sendero" }).first();
  await logoCard.locator('img[alt^="Logotipo nuevo"]').waitFor();
  await staff.screenshot({ path: SHOTS + "/sl5-logo-review.png", fullPage: true });
  await onPhone(staffContext, OPS + "/catalogo/logotipos", "sl5b-logo-review-390.png");
  await logoCard.locator('button:has-text("Aprobar y publicar")').click();
  // Approved and published, it leaves the queue.
  await logoCard.waitFor({ state: "detached", timeout: 30000 });

  // The shop's page and the product page show them.
  look = await visit("/tienda/tienda-sendero");
  check(look.status === 200, `the shop page answered ${look.status}`);
  const about = await text(look.page.locator('section[aria-label="Sobre la tienda"]'));
  log("shop page description:", about.slice(0, 160));
  check(about.includes("<b>Envíos</b>"), "the description's markup was not shown as text");
  check(
    (await look.page.locator('section[aria-label="Sobre la tienda"] b').count()) === 0,
    "markup was rendered",
  );
  const logo = look.page.locator("main header img").first();
  check(
    (await logo.evaluate((img) => img.complete && img.naturalWidth > 0)) === true,
    "the logo does not load on the shop page",
  );
  check(
    (await text(look.page.locator('section[aria-labelledby="productos-tienda"]'))).includes(
      "Botella",
    ),
    "the shop page does not list what it sells",
  );
  await look.page.screenshot({ path: SHOTS + "/sl6-shop-page.png", fullPage: true });
  await look.context.close();
  await onPhone(null, WEB + "/tienda/tienda-sendero", "sl6b-shop-page-390.png");
  look = await visit(BOTTLE);
  const senderoOffer = look.page.locator('section[aria-labelledby="otras-ofertas"] li', {
    hasText: "Tienda Sendero",
  });
  check(
    (await senderoOffer.locator("img").count()) === 1,
    "the product page shows no logo for the shop",
  );
  await senderoOffer.locator('a:has-text("Tienda Sendero")').click();
  await look.page.waitForURL((u) => new URL(u).pathname === "/tienda/tienda-sendero");
  await look.context.close();
  const missing = await visit("/tienda/no-existe-esta-tienda", { notFound: true });
  check(missing.status === 404, `an unknown shop answered ${missing.status}`);
  await missing.context.close();

  // ── 6. A package edit that would pause another shop's offer ────────────────
  // Sendero sells TecnoCasa's blender from the warehouse at a price that
  // covers today's fees; TecnoCasa then declares a much heavier package.
  await sendero.goto(SELLER + "/productos/ofrecer?q=licuadora", { waitUntil: "networkidle" });
  const blender = sendero.locator("main:visible li", { hasText: "Licuadora" }).first();
  await blender.locator('input[name="price"]').fill("4 000");
  await blender.locator('select[name="fulfillment"]').selectOption("platform");
  await blender.locator('button:has-text("Agregar mi oferta")').click();
  await sendero.waitForSelector("main:visible >> text=Agregamos su oferta");

  const tecnoContext = await desktop();
  const tecno = await tecnoContext.newPage();
  watch(tecno);
  await signIn(tecno, SELLER, "vendedor@yuntera.example");
  if (!(await tecno.locator("main h1:visible").innerText()).includes("TecnoCasa")) {
    await tecno.selectOption("#shop", { label: "TecnoCasa" });
    await tecno.click('header button:has-text("Cambiar")');
    await tecno.waitForSelector('main h1:visible:has-text("TecnoCasa")');
  }
  await tecno.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  await tecno
    .locator("main:visible tbody tr", { hasText: "Licuadora" })
    .first()
    .locator('a:has-text("Editar")')
    .click();
  await tecno.waitForSelector('main:visible input[name="weightGrams"]');
  await tecno.fill('main:visible input[name="weightGrams"]', "29000");
  await tecno.click('main:visible button:has-text("Enviar cambios a revisión")');
  await tecno.waitForSelector("main:visible >> text=Publicado; sus cambios están en revisión");
  await tecnoContext.close();

  await staff.goto(OPS + "/catalogo", { waitUntil: "networkidle" });
  const heavy = staff
    .locator('main:visible section[aria-labelledby="cambios"] article', { hasText: "Licuadora" })
    .first();
  const warning = await text(heavy.locator('[data-testid="edit-pauses-offers"]'));
  log("edit warning:", warning.slice(0, 220));
  check(
    warning.includes("se pausa la oferta de otra tienda") && warning.includes("Tienda Sendero"),
    "staff are not told the edit pauses another shop's offer",
  );
  await staff.screenshot({ path: SHOTS + "/sl7-edit-pauses-offers.png", fullPage: true });
  await onPhone(staffContext, OPS + "/catalogo", "sl7b-edit-pauses-offers-390.png");
  // Without the tick, the approval is refused with what to do.
  await heavy.locator('button:has-text("Aprobar cambio")').click();
  await heavy.locator("text=marque la casilla para confirmarlo").waitFor();
  await heavy.locator('input[name="pausaOfertas"]').check();
  await heavy.locator('button:has-text("Aprobar cambio")').click();
  await heavy.waitFor({ state: "detached", timeout: 30000 });

  // Sendero sees its offer paused, why, and the lowest price that covers the fees.
  await sendero.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  const pausedList = await text(sendero.locator('main:visible [data-testid="paused-offers"]'));
  log("paused list:", pausedList.slice(0, 240));
  check(
    pausedList.includes("Licuadora") && pausedList.includes("se aprobó un cambio del paquete"),
    "the shop does not see why its offer was paused",
  );

  // ── 7. A paused offer holds nothing back; the shop stops selling for good ───
  const bottleEdit =
    SELLER +
    (await sendero
      .locator("main:visible tbody tr", { hasText: "Botella térmica" })
      .first()
      .locator('a:has-text("Editar")')
      .getAttribute("href"));
  await ferreteria.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  const ferreteriaBottle = ferreteria
    .locator("main:visible tbody tr", { hasText: "Botella térmica" })
    .first();
  await ferreteriaBottle.locator("summary").click();
  await ferreteriaBottle.locator('select[name="status"]').selectOption("paused");
  await ferreteriaBottle
    .locator('form:has(select[name="status"]) button:has-text("Guardar")')
    .click();
  await ferreteriaBottle.locator('[role="status"]').first().waitFor();
  await sendero.goto(bottleEdit, { waitUntil: "networkidle" });
  const draftNow = await text(sendero.locator('main:visible section[aria-labelledby="borrador"]'));
  log("draft box with a paused offer elsewhere:", draftNow.slice(0, 240));
  check(
    draftNow.includes("oferta en pausa") &&
      (await sendero
        .locator(
          'main:visible section[aria-labelledby="borrador"] button:has-text("Volver a borrador")',
        )
        .count()) === 1,
    "another shop's paused offer still blocks going back to draft",
  );
  // The offering shop opening the listing's page is told whose it is.
  await ferreteria.goto(bottleEdit, { waitUntil: "networkidle" });
  check(
    (await text(ferreteria.locator("main:visible h1"))).includes(
      "Esta publicación es de otra tienda",
    ),
    "the offering shop gets no explanation on the listing's page",
  );
  await ferreteria.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  await ferreteriaBottle.locator("summary").click();
  await ferreteriaBottle.locator('input[name="confirma"]').check();
  await ferreteriaBottle.locator('button:has-text("Dejar de vender este producto")').click();
  await ferreteriaBottle.locator("text=Dejó de venderlo").waitFor();
  await ferreteria.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  check(
    (await ferreteria.locator("main:visible tbody tr", { hasText: "Botella térmica" }).count()) ===
      0,
    "the withdrawn offer is still in the shop's list",
  );
  look = await visit(BOTTLE);
  check(
    !(await text(look.page.locator("main"))).includes("Ferretería El Higuerón"),
    "the withdrawn offer is still on the product page",
  );
  await look.context.close();

  // ── 8. The description removed ─────────────────────────────────────────────
  await sendero.goto(SELLER + "/tienda", { waitUntil: "networkidle" });
  await sendero.click('main:visible button:has-text("Quitar la descripción")');
  // The page now says what waits for review (the form starts afresh for it).
  await sendero.waitForSelector("main:visible >> text=Pidió quitar la descripción");
  check(
    (await sendero
      .locator('main:visible textarea[name="description"]')
      .getAttribute("required")) === null,
    "the description field cannot be left empty",
  );

  await browser.close();
  if (errors.length > 0) {
    console.error("FAILED:\n  " + errors.join("\n  "));
    process.exit(1);
  }
  log("seller listings journey: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
