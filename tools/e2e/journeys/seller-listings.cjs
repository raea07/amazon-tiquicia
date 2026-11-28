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
const web = require("../lib/web.cjs");
const seller = require("../lib/seller.cjs");
const { word } = require("../lib/words.cjs");
const ops = require("../lib/ops.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = web.BASE;
const SELLER = seller.BASE;
const OPS = ops.BASE;
const log = (...a) => console.log(...a);

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
  const overflow = (page) => kit.overflowPx(page);
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
  await seller.signInHome(ferreteria, "vendedor@yuntera.example");
  await seller.chooseShop(ferreteria, "Ferretería El Higuerón");
  await seller.openOfferSearch(ferreteria);
  const match = await seller.searchToOffer(
    ferreteria,
    "botella térmica",
    "Botella térmica Sendero",
  );
  log("found:", match.slice(0, 160));
  check(match.includes("Publicado por Tienda Sendero"), "the creator is not named");
  await ferreteria.screenshot({ path: SHOTS + "/sl1-offer-search.png", fullPage: true });
  const added = await seller.addOffer(ferreteria, "Botella térmica Sendero", {
    price: "9 500",
    fulfillment: "seller",
    handlingDays: "1",
  });
  log("added:", added);
  await onPhone(
    ferreteriaContext,
    `${SELLER}/productos/ofrecer?q=botella`,
    "sl1b-offer-search-390.png",
  );

  // Its stock, at its own place, by the usual path.
  log("stock:", await seller.setStockOf(ferreteria, "Botella térmica", 6));

  // Its list: the offer is there, marked as another shop's listing, without "Editar".
  await seller.open(ferreteria, "/productos");
  const offerRow = await seller.sharedRow(ferreteria, "Botella térmica");
  log("offer row:", offerRow.text.slice(0, 200));
  check(
    offerRow.text.includes("De otra tienda"),
    "the offer is not marked as another shop's listing",
  );
  check(offerRow.edits === 0, "it can edit another shop's listing");
  // What it may change is said on screen, not only to screen readers.
  check(offerRow.saysWhatChanges, "the row does not say, visibly, what the shop may change");

  // ── 2. A shopper sees both offers and buys from the second shop ─────────────
  const shopperContext = await desktop();
  const shopper = await shopperContext.newPage();
  watch(shopper);
  await web.open(shopper, BOTTLE);
  const buyBox = (await web.productSummary(shopper)).buyBox;
  log("buy box:", buyBox.slice(0, 200));
  check(
    buyBox.includes("Vendido por Ferretería El Higuerón"),
    "the cheaper offer in stock is not first",
  );
  const others = await web.otherOffersText(shopper);
  log("other offers:", others.slice(0, 220));
  check(others.includes("Tienda Sendero"), "the creator's offer is not listed");
  await shopper.screenshot({ path: SHOTS + "/sl2-product-two-offers.png", fullPage: true });
  await onPhone(null, WEB + BOTTLE, "sl2b-product-two-offers-390.png");
  await web.addToCart(shopper);
  await web.open(shopper, "/carrito");
  const cart = await web.firstCartLine(shopper);
  log("cart line:", cart.slice(0, 160));
  check(
    cart.includes("Vendido por Ferretería El Higuerón"),
    "the cart does not name the shop chosen",
  );
  const order = await web.checkoutSignedOutAndPay(
    shopper,
    "comprador@yuntera.example",
    "sinpe_movil",
  );
  check(order.includes("Botella térmica"), "the order does not hold the bottle");
  log("order paid:", shopper.url().replace(WEB, ""));

  // The second shop sees the sale to pack; the first does not.
  await seller.open(ferreteria, "/pedidos");
  const toPack = await seller.mainText(ferreteria);
  check(toPack.includes("Botella térmica"), "the offering shop does not see its sale");

  // ── 2b. The offer in a cart sells out: the cart names the other shop's ─────
  const visitorContext = await desktop();
  const visitor = await visitorContext.newPage();
  watch(visitor);
  await web.open(visitor, BOTTLE);
  await web.addToCart(visitor);
  // One unit is held for the order just paid: on hand 1 leaves none to sell.
  await seller.setStockOf(ferreteria, "Botella térmica", 1);
  await web.open(visitor, "/carrito");
  const soldOut = await web.firstCartLine(visitor);
  log("sold-out line:", soldOut.slice(0, 220));
  check(
    soldOut.includes("La oferta de Ferretería El Higuerón se agotó") &&
      soldOut.includes("Tienda Sendero lo vende a"),
    "the cart does not say whose offer ran out and who else sells it",
  );
  check(!soldOut.includes("Ya no está disponible"), "the cart says the product is gone");
  // When the other shop's offer would arrive (084600): the date its product
  // page gives for the same district, read a moment later.
  const arrival = await web.cartAlternativeArrival(visitor);
  log("alternative arrives:", arrival);
  check(
    /^Llega (el|entre el) /.test(arrival),
    "the cart does not say when the other offer arrives",
  );
  await web.open(visitor, BOTTLE);
  // Tienda Sendero's offer on its product page, wherever the page lists it (for
  // up to a minute the cached page may still show the sold-out offer first).
  const pageDate = await web.shopOfferArrival(visitor, "Tienda Sendero");
  check(
    arrival === `Llega ${pageDate}`,
    `the cart's date (${arrival}) is not the product page's (${pageDate})`,
  );
  await web.open(visitor, "/carrito");
  await visitor.screenshot({ path: SHOTS + "/sl2c-cart-sold-out.png", fullPage: true });
  await onPhone(visitorContext, WEB + "/carrito", "sl2d-cart-sold-out-390.png");
  await web.swapToOffer(visitor, "Tienda Sendero");
  check((await web.checkoutLinks(visitor)) === 1, "the cart cannot go on after the swap");
  log("swapped:", (await web.firstCartLine(visitor)).slice(0, 160));
  await visitorContext.close();
  await seller.setStockOf(ferreteria, "Botella térmica", 6);

  // ── 3. Sendero retires a size and brings it back ───────────────────────────
  const senderoContext = await desktop();
  const sendero = await senderoContext.newPage();
  watch(sendero);
  await seller.signInHome(sendero, "sendero@yuntera.example");
  await seller.open(sendero, "/productos");
  const shirtEdit = await seller.openEditOf(sendero, "Talla S");
  await seller.waitForVariants(sendero);
  log("retired:", await seller.retireVariant(sendero, "Talla S"));
  await sendero.screenshot({ path: SHOTS + "/sl3-variant-retired.png", fullPage: true });
  let look = await visit(SHIRT);
  const optionsOff = await web.mainText(look.page);
  check(
    !/Talla S/.test(optionsOff) && /Talla M/.test(optionsOff),
    "the retired size is still offered",
  );
  await look.context.close();
  await sendero.goto(shirtEdit, { waitUntil: "networkidle" });
  await seller.offerVariantAgain(sendero, "Talla S");
  look = await visit(SHIRT);
  check(/Talla S/.test(await web.mainText(look.page)), "the size did not come back");
  await look.context.close();
  await onPhone(senderoContext, shirtEdit, "sl3b-variants-390.png");
  // Its own offer on a size paused (nobody else sells it): the page says so
  // and offers to put it back, instead of "A la venta".
  await seller.open(sendero, "/productos");
  await seller.setOfferSale(sendero, "Talla M", "paused");
  await sendero.goto(shirtEdit, { waitUntil: "networkidle" });
  const mediumText = await seller.variantText(sendero, "Talla M");
  log("own offer paused:", mediumText);
  check(
    mediumText.includes("Su oferta en pausa") &&
      !mediumText.includes(word("offer_status", "active", { viewer: "seller" })),
    "a size whose own offer is paused is shown as on sale",
  );
  await seller.offerVariantAgain(sendero, "Talla M");

  // ── 4. A listing back to draft, and through review again ───────────────────
  await seller.open(sendero, "/productos");
  const puzzleEdit = await seller.openEditOf(sendero, "Rompecabezas");
  await seller.waitForDraftBox(sendero);
  log("to draft:", (await seller.backToDraft(sendero)).slice(0, 160));
  await sendero.screenshot({ path: SHOTS + "/sl3c-back-to-draft.png", fullPage: true });
  look = await visit(PUZZLE, { notFound: true });
  log("shop while in draft:", look.status);
  check(look.status === 404, `a draft is still in the shop (${look.status})`);
  await look.context.close();
  await sendero.goto(puzzleEdit, { waitUntil: "networkidle" });
  check(
    (await seller.editStatus(sendero)).includes(
      word("product_status", "draft", { viewer: "seller" }),
    ),
    "the edit page does not say it is a draft",
  );
  // The page then says where it stands (the form starts afresh for a new state).
  await seller.sendDraftForReview(sendero);

  const staffContext = await desktop();
  const staff = await staffContext.newPage();
  watch(staff);
  await ops.signInHome(staff, "central@yuntera.example");
  await ops.open(staff, "/catalogo");
  // Decided, it leaves the queue.
  await ops.publishListing(staff, PUZZLE_TITLE);
  look = await visit(PUZZLE);
  check(look.status === 200, `the listing did not come back to the shop (${look.status})`);
  await look.context.close();

  // ── 5. The shop's description and logo ─────────────────────────────────────
  await seller.sendDescription(sendero, DESCRIPTION);
  await seller.uploadLogo(sendero, logoJpeg);
  await seller.waitForLogoInReview(sendero);
  await sendero.screenshot({ path: SHOTS + "/sl4-shop-front-waiting.png", fullPage: true });
  await onPhone(senderoContext, SELLER + "/tienda", "sl4b-shop-front-390.png");

  // Staff approve both: the description where shop changes are decided, the
  // logo where photos are.
  await ops.open(staff, "/cambios-tienda");
  const request = await ops.changeCardText(staff, "description");
  log("request:", request.slice(0, 220));
  check(request.includes("<b>Envíos</b>"), "staff do not see the text as typed");
  await ops.approveChange(staff, "description");
  await ops.openLogoReview(staff, "Tienda Sendero");
  await staff.screenshot({ path: SHOTS + "/sl5-logo-review.png", fullPage: true });
  await onPhone(staffContext, OPS + "/catalogo/logotipos", "sl5b-logo-review-390.png");
  // Approved and published, it leaves the queue.
  await ops.approveLogo(staff, "Tienda Sendero");

  // The shop's page and the product page show them.
  look = await visit("/tienda/tienda-sendero");
  check(look.status === 200, `the shop page answered ${look.status}`);
  const front = await web.shopPage(look.page);
  log("shop page description:", front.about.slice(0, 160));
  check(front.about.includes("<b>Envíos</b>"), "the description's markup was not shown as text");
  check(front.bold === 0, "markup was rendered");
  check(front.logoLoaded === true, "the logo does not load on the shop page");
  check(front.products.includes("Botella"), "the shop page does not list what it sells");
  await look.page.screenshot({ path: SHOTS + "/sl6-shop-page.png", fullPage: true });
  await look.context.close();
  await onPhone(null, WEB + "/tienda/tienda-sendero", "sl6b-shop-page-390.png");
  look = await visit(BOTTLE);
  check(
    (await web.offerLogos(look.page, "Tienda Sendero")) === 1,
    "the product page shows no logo for the shop",
  );
  await web.openShopFromOffer(look.page, "Tienda Sendero", "tienda-sendero");
  await look.context.close();
  const missing = await visit("/tienda/no-existe-esta-tienda", { notFound: true });
  check(missing.status === 404, `an unknown shop answered ${missing.status}`);
  await missing.context.close();

  // ── 6. A package edit that would pause another shop's offer ────────────────
  // Sendero sells TecnoCasa's blender from the warehouse at a price that
  // covers today's fees; TecnoCasa then declares a much heavier package.
  await seller.open(sendero, "/productos/ofrecer?q=licuadora");
  await seller.addOffer(sendero, "Licuadora", { price: "4 000", fulfillment: "platform" });

  const tecnoContext = await desktop();
  const tecno = await tecnoContext.newPage();
  watch(tecno);
  await seller.signInHome(tecno, "vendedor@yuntera.example");
  await seller.chooseShop(tecno, "TecnoCasa");
  await seller.open(tecno, "/productos");
  await seller.openEditOf(tecno, "Licuadora");
  await seller.waitForWeight(tecno);
  await seller.typeWeight(tecno, "29000");
  await seller.sendForReview(tecno);
  await seller.waitForEditInReview(tecno);
  await tecnoContext.close();

  await ops.open(staff, "/catalogo");
  const warning = await ops.editPausesOffers(staff, "Licuadora");
  log("edit warning:", warning.slice(0, 220));
  check(
    warning.includes("se pausa la oferta de otra tienda") && warning.includes("Tienda Sendero"),
    "staff are not told the edit pauses another shop's offer",
  );
  await staff.screenshot({ path: SHOTS + "/sl7-edit-pauses-offers.png", fullPage: true });
  await onPhone(staffContext, OPS + "/catalogo", "sl7b-edit-pauses-offers-390.png");
  // Without the tick, the approval is refused with what to do.
  await ops.approveEditUnconfirmed(staff, "Licuadora");
  await ops.approveEditPausing(staff, "Licuadora");

  // Sendero sees its offer paused, why, and the lowest price that covers the fees.
  await seller.open(sendero, "/productos");
  const pausedList = await seller.pausedOffers(sendero);
  log("paused list:", pausedList.slice(0, 240));
  check(
    pausedList.includes("Licuadora") && pausedList.includes("se aprobó un cambio del paquete"),
    "the shop does not see why its offer was paused",
  );

  // ── 7. A paused offer holds nothing back; the shop stops selling for good ───
  const bottleEdit = await seller.editAddressOf(sendero, "Botella térmica");
  await seller.open(ferreteria, "/productos");
  await seller.setOfferSale(ferreteria, "Botella térmica", "paused");
  await sendero.goto(bottleEdit, { waitUntil: "networkidle" });
  const draftNow = await seller.draftBoxState(sendero);
  log("draft box with a paused offer elsewhere:", draftNow.text.slice(0, 240));
  check(
    draftNow.text.includes("oferta en pausa") && draftNow.buttons === 1,
    "another shop's paused offer still blocks going back to draft",
  );
  // The offering shop opening the listing's page is told whose it is.
  await ferreteria.goto(bottleEdit, { waitUntil: "networkidle" });
  check(
    (await seller.heading(ferreteria)).includes("Esta publicación es de otra tienda"),
    "the offering shop gets no explanation on the listing's page",
  );
  await seller.open(ferreteria, "/productos");
  await seller.stopSelling(ferreteria, "Botella térmica");
  await seller.open(ferreteria, "/productos");
  check(
    (await seller.productRows(ferreteria, "Botella térmica")) === 0,
    "the withdrawn offer is still in the shop's list",
  );
  look = await visit(BOTTLE);
  check(
    !(await web.mainText(look.page)).includes("Ferretería El Higuerón"),
    "the withdrawn offer is still on the product page",
  );
  await look.context.close();

  // ── 8. The description removed ─────────────────────────────────────────────
  // The page then says what waits for review (the form starts afresh for it).
  check(!(await seller.removeDescription(sendero)), "the description field cannot be left empty");

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
