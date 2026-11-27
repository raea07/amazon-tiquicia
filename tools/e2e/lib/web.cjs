// Screen steps of the shop (apps/web): everything a journey finds, clicks,
// fills or reads there. Journey files call these and keep the flow, the
// checks on data and the size checks. The shop's builder keeps this file
// passing when the screens change (rule 20.5.4 of docs/brand/system/SISTEMA.md).
//
// How things are found (rule 20.5.1): by role and accessible name, by
// [name=…] for a form field, or by data-testid. Never by a CSS class, never
// by a text match on a container (kit.withValue matches a data value only).

const { settledText } = require("./settle.cjs");
const kit = require("./kit.cjs");
const {
  squash,
  text,
  main,
  field,
  button,
  link,
  testid,
  withValue,
  fillSignIn,
  formError,
  mainText,
  heading,
  statusText,
  alertText,
  hydrated,
} = require("./kit.cjs");

const BASE = process.env.WEB_URL || "http://127.0.0.1:3000";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";

const open = (page, path, waitUntil = "networkidle") => page.goto(BASE + path, { waitUntil });

// ── Header and home ─────────────────────────────────────────────────────────

/** The header's account links (cart, orders, account) as one line. */
const accountNav = async (page) => text(page.getByRole("navigation", { name: "Su cuenta" }));

/** The cart link in the header, as one line («Carrito 2»). */
const cartBadge = async (page) =>
  text(link(page.getByRole("navigation", { name: "Su cuenta" }), "Carrito"));

/** What the home page shows first: its title, main heading and how many product cards. */
async function homeSummary(page) {
  return {
    title: await page.title(),
    heading: await page.getByRole("heading", { level: 1 }).first().innerText(),
    cards: await page.getByRole("article").count(),
  };
}

// ── Search and lists ───────────────────────────────────────────────────────

/** Types in the header's search box and presses Enter; waits for the results. */
async function search(page, words) {
  await field(page.getByRole("search"), "q").fill(words);
  await page.keyboard.press("Enter");
  await page.waitForURL(/buscar/);
  await page.getByRole("article").first().waitFor();
}

/** The names of the product cards on the page, in order. */
const cardTitles = (page) =>
  page.getByRole("article").getByRole("heading", { level: 3 }).allInnerTexts();

// ── Product page ───────────────────────────────────────────────────────────

const buyBox = (page) => page.getByRole("complementary", { name: "Comprar" });

/** The product page's heading, its buy box and how many other offers and reviews it lists. */
async function productSummary(page) {
  return {
    heading: await page.getByRole("heading", { level: 1 }).innerText(),
    buyBox: await text(buyBox(page)),
    otherOffers: await page
      .getByRole("region", { name: "Otras ofertas de este producto" })
      .getByRole("listitem")
      .count(),
    reviews: await page
      .getByRole("region", { name: "Reseñas de quienes lo compraron" })
      .getByRole("listitem")
      .count(),
  };
}

/** Puts the product of the buy box in the cart (with a quantity, if given) and waits for the confirmation. */
async function addToCart(page, { quantity } = {}) {
  const box = buyBox(page);
  if (quantity) await field(box, "quantity").selectOption(String(quantity));
  await button(box, "Agregar al carrito").click();
  await settledText(box.getByRole("status"), /Agregado al carrito/, { what: "the buy box" });
}

// ── Cart and checkout ──────────────────────────────────────────────────────

/** How many lines the cart has and what its summary says. */
async function cartSummary(page) {
  return {
    lines: await main(page).locator("ul > li").count(),
    summary: await text(page.getByRole("complementary", { name: "Resumen" })),
  };
}

/** «Continuar con la compra» from the cart. */
const continueToCheckout = (page) => link(main(page), "Continuar con la compra").click();

/** Signs in on the sign-in form the page shows now (the shop's own or after a redirect). */
const fillSignInForm = (page, email, password = PASSWORD) => fillSignIn(page, email, password);

/** The sign-in form's error, what is left in the e-mail field and whether the password was cleared. */
async function signInError(page) {
  const message = await formError(page);
  return {
    message,
    email: await field(main(page), "email").inputValue(),
    passwordCleared: (await field(main(page), "password").inputValue()) === "",
  };
}

/** Signs in from the shop's sign-in page (going to `next` afterwards, if given) and waits to leave it. */
async function signIn(page, email, { next, password = PASSWORD } = {}) {
  await open(page, `/ingresar${next ? `?siguiente=${encodeURIComponent(next)}` : ""}`);
  await fillSignIn(page, email, password);
  await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
  await page.waitForLoadState("networkidle");
}

const checkoutSummaryBox = (page) =>
  page.getByRole("complementary", { name: "Resumen del pedido" });

/** The checkout page once it shows its summary: the summary and how many payment methods start chosen. */
async function checkoutSummary(page) {
  await checkoutSummaryBox(page).waitFor();
  return {
    summary: await text(checkoutSummaryBox(page)),
    preselected: await page.locator('[name="paymentMethod"]:checked').count(),
  };
}

/** Chooses a payment method on the checkout page (by its value: sinpe_movil, card…). */
const choosePayment = (page, method) =>
  page.locator(`input[name="paymentMethod"][value="${method}"]`).check();

/** «Confirmar pedido». */
const confirmOrder = (page) => button(page, "Confirmar pedido").click();

// ── Orders ─────────────────────────────────────────────────────────────────

/** Waits for an order page after checkout and returns its heading. */
async function waitForOrderPage(page) {
  await page.waitForURL((u) => /^\/pedidos\/YT-/.test(new URL(u).pathname));
  const heading = page.getByRole("heading", { level: 1, name: "Pedido YT-" });
  await heading.waitFor();
  return heading.innerText();
}

/** How many h1 the document holds that are not visible (earlier pages kept hidden). */
const hiddenHeadings = async (page) =>
  (await page.locator("h1").count()) - (await page.getByRole("heading", { level: 1 }).count());

/** What the order page asks to pay, as one line. */
const paymentDue = (page) =>
  text(
    testid(page, "payment-due")
      .or(page.getByRole("region", { name: "Falta el pago" }))
      .first(),
  );

/** «Simular pago» (sandbox) and waits for the delivery code to appear. */
async function simulatePayment(page) {
  await button(page, "Simular pago").click();
  await testid(page, "delivery-code").waitFor({ timeout: 15000 });
}

/** The first heading of the order page, as one line. */
const orderHeading = async (page) =>
  squash(
    await page
      .getByRole("heading", { level: 1 })
      .first()
      .innerText()
      .catch(() => "?"),
  );

/** The delivery code the order page shows to its shopper. */
const deliveryPin = async (page) => (await testid(page, "delivery-pin").first().innerText()).trim();

/** How many orders «Mis pedidos» lists. */
const orderCount = (page) => main(page).locator("ul > li").count();

/** The first heading of main (h1 or h2), as a page that is not found shows it. */
const firstHeading = (page) => main(page).getByRole("heading").first().innerText();

// ── Account: sign-up, confirmation, deletion ──────────────────────────────

/** Opens a page and waits until React has taken over its forms. */
async function openReady(page, path) {
  await page.goto(BASE + path, { waitUntil: "load" });
  await hydrated(page);
}

/** Opens the sign-in page and sends e-mail and password (does not wait for the outcome). */
async function submitSignIn(page, email, password = PASSWORD) {
  await openReady(page, "/ingresar");
  await fillSignIn(page, email, password);
}

/** Creates an account from the sign-up form and waits for the confirmation code field. */
async function signUp(page, { email, name, password, next = "/cuenta" }) {
  await openReady(page, `/ingresar?modo=crear&siguiente=${encodeURIComponent(next)}`);
  const scope = main(page);
  await field(scope, "fullName").fill(name);
  await field(scope, "email").fill(email);
  await field(scope, "password").fill(password);
  await field(scope, "acepta").check();
  await button(scope, "Crear cuenta").click();
  await waitForCodeField(page);
}

/** Waits for the 6-digit code field of the e-mail confirmation. */
const waitForCodeField = (page) => field(main(page), "code").waitFor();

/** «Enviarme otro correo» on the confirmation step. */
const resendConfirmation = (page) => button(main(page), "Enviarme otro correo").click();

/** Types the code from the e-mail and confirms the address. */
async function confirmEmail(page, code) {
  await field(main(page), "code").fill(code);
  await button(main(page), "Confirmar mi correo").click();
}

/** From the account page, opens «Eliminar mi cuenta» and waits for what it explains. */
async function openDeletion(page) {
  await link(main(page), "Eliminar mi cuenta").click();
  await page.waitForURL((u) => new URL(u).pathname === "/cuenta/eliminar");
  await hydrated(page);
  await main(page).getByRole("heading", { name: "Qué borramos" }).first().waitFor();
}

/** Deletes the account with this password (ticks «entiendo» first). */
async function deleteAccount(page, password) {
  await field(main(page), "password").fill(password);
  await field(main(page), "entiendo").check();
  await button(main(page), "Eliminar mi cuenta para siempre").click();
}

/** Whether the deletion form's «entiendo» box is ticked. */
const deletionTicked = (page) => field(main(page), "entiendo").isChecked();

/** How many password fields main holds (0 when a form is not offered). */
const passwordFields = (page) => field(main(page), "password").count();

module.exports = {
  BASE,
  open,
  openReady,
  submitSignIn,
  signUp,
  waitForCodeField,
  resendConfirmation,
  confirmEmail,
  openDeletion,
  deleteAccount,
  deletionTicked,
  passwordFields,
  mainText,
  heading,
  statusText,
  alertText,
  accountNav,
  cartBadge,
  homeSummary,
  search,
  cardTitles,
  productSummary,
  addToCart,
  cartSummary,
  continueToCheckout,
  fillSignInForm,
  signInError,
  signIn,
  checkoutSummary,
  choosePayment,
  confirmOrder,
  waitForOrderPage,
  hiddenHeadings,
  paymentDue,
  simulatePayment,
  orderHeading,
  deliveryPin,
  orderCount,
  firstHeading,
};

// ── Order page ─────────────────────────────────────────────────────────────

/** Opens one of the shopper's orders. */
const openOrder = (page, number, waitUntil = "networkidle") =>
  open(page, `/pedidos/${number}`, waitUntil);

/** Why the order was cancelled, as the order page says it (waits for it). */
async function cancelReason(page, timeout = 30_000) {
  const why = testid(page, "order-cancel-reason");
  await why.waitFor({ timeout });
  return text(why);
}

/** The order page's history, as one line. */
const orderHistory = (page) => text(main(page).getByRole("region", { name: "Historial" }));

/** The «Presente un reclamo» link of the order page (for its size). */
const claimLink = (page) => link(page, "Presente un reclamo").first();

// ── Cart ───────────────────────────────────────────────────────────────────

const cartSummaryBox = (page) => page.getByRole("complementary", { name: "Resumen" });

/** The cart's summary once it says there is nothing to buy, as one line. */
async function cartNothingToBuy(page, timeout = 30_000) {
  await testid(cartSummaryBox(page), "cart-nothing-to-buy").waitFor({ timeout });
  return text(cartSummaryBox(page));
}

Object.assign(module.exports, {
  openOrder,
  cancelReason,
  orderHistory,
  claimLink,
  cartSummaryBox,
  cartNothingToBuy,
});

// ── Delivery date ──────────────────────────────────────────────────────────

/** The arrival date the product page's buy box gives now (opens the page, waits for the date). */
async function productArrival(page, slug) {
  await open(page, `/p/${slug}`, "load");
  const date = testid(buyBox(page), "offer-arrival").first();
  await date.waitFor({ timeout: 30_000 });
  return text(date);
}

/** The arrival date the cart's summary gives now (opens the cart, waits for the date). */
async function cartArrival(page) {
  await open(page, "/carrito", "load");
  const date = testid(cartSummaryBox(page), "cart-arrival").first();
  await date.waitFor({ timeout: 30_000 });
  return text(date);
}

Object.assign(module.exports, { buyBox, productArrival, cartArrival });

// ── Catalogue as a visitor sees it ────────────────────────────────────────

/** The departments of the header's category menu. */
const categoryMenu = (page) =>
  page
    .getByRole("banner")
    .getByRole("navigation", { name: "Categorías" })
    .getByRole("link")
    .allInnerTexts();

/** The names of the product cards in main. */
const resultTitles = (page) =>
  main(page).getByRole("article").getByRole("heading", { level: 3 }).allInnerTexts();

/** The links to sub-categories a category page lists. */
const subCategories = (page) => main(page).locator('a[href^="/c/"]').allInnerTexts();

/** The options of the brand filter. */
const brandOptions = (page) => field(page, "marca").locator("option").allInnerTexts();

/** Chooses a brand in the filter (by its label) and applies it. */
async function filterByBrand(page, label) {
  await field(page, "marca").selectOption({ label });
  await button(page, "Filtrar por marca").click();
}

/** The brand the filter has chosen (its value). */
const chosenBrand = (page) => field(page, "marca").inputValue();

/** What the list says it shows for the chosen brand («Mostrando 5 productos de Volcán»). */
const brandFilterSummary = (page) => text(testid(page, "brand-filter-summary").first());

/** The reviews section of the product page, as one line. */
const reviewsSection = (page) =>
  text(page.getByRole("region", { name: "Reseñas de quienes lo compraron" }));

/** The first product card that shows `name` (a product name from the seed), as one line. */
const resultCard = (page, name) => text(withValue(main(page).getByRole("article"), name).first());

/**
 * The notice on an order page that a review was withdrawn, once it is shown.
 * packages/ui's Alert takes no data-testid, so it is picked among the page's
 * status messages by its title.
 */
async function reviewWithdrawnNotice(page) {
  const title = "Retiramos su reseña";
  const deadline = Date.now() + 15000;
  for (;;) {
    const all = (await main(page).getByRole("status").allInnerTexts()).map(squash);
    const notice = all.find((t) => t.startsWith(title));
    if (notice || Date.now() >= deadline) return notice ?? "";
    await page.waitForTimeout(200);
  }
}

Object.assign(module.exports, {
  categoryMenu,
  resultTitles,
  subCategories,
  brandOptions,
  filterByBrand,
  chosenBrand,
  brandFilterSummary,
  reviewsSection,
  resultCard,
  reviewWithdrawnNotice,
});

Object.assign(module.exports, { text, squash });

// ── Checkout with the zone switched off ────────────────────────────────────

/** The first saved address offered at checkout: whether there is one and whether it can be chosen. */
async function firstCheckoutAddress(page) {
  const radio = field(page, "addressId").first();
  const count = await radio.count();
  return { count, disabled: count ? await radio.isDisabled() : true };
}

/** The order's heading block (the h1 and what stands beside it), as one line. */
const orderHeadingBlock = (page) =>
  text(main(page).getByRole("heading", { level: 1 }).locator(".."));

Object.assign(module.exports, { firstCheckoutAddress, orderHeadingBlock });

// ── Returns from the order page ───────────────────────────────────────────

/** Waits for the order page's heading (after opening it in a tab). */
const waitForOrderHeading = (page) =>
  main(page).getByRole("heading", { level: 1 }).first().waitFor();

/** An order line that can still be returned, by its product's title (seed data). */
const returnableLine = (page, title) =>
  withValue(main(page).locator("li"), title).filter({
    has: page.locator('[data-testid="return-open"]'),
  });

/** Asks to return a line (kind, and quantity if given, with a reason). Does not wait for the outcome. */
async function requestReturn(page, title, { kind, quantity, reason }) {
  const line = returnableLine(page, title);
  await testid(line, "return-open").first().click();
  await field(line, "kind").selectOption(kind);
  if (quantity !== undefined) await field(line, "quantity").selectOption(String(quantity));
  await field(line, "reason", "textarea").fill(reason);
  await button(line, "Solicitar devolución").click();
}

/** The confirmation that the return was received, once it shows. */
async function returnReceived(page) {
  await settledText(main(page), /Recibimos su solicitud/, { what: "the order page" });
  const said = [
    ...(await main(page).locator('[role="status"]').allInnerTexts()),
    ...(await testid(main(page), "return-request").allInnerTexts()),
  ].map(squash);
  return said.find((t) => t.includes("Recibimos su solicitud")) ?? "";
}

/** The first error the page shows, once it shows one. */
async function firstAlert(page) {
  await main(page).getByRole("alert").first().waitFor();
  return text(main(page).getByRole("alert").first());
}

/** The order line of this product (seed data), with its returns. */
const orderLine = (page, title) => withValue(main(page).locator("li"), title).first();

/** The first return request on the line of this product. */
const returnRequest = (page, title) => testid(orderLine(page, title), "return-request").first();

/** The opener of «Retirar la solicitud» on that return (for its size). */
const withdrawOpener = (page, title) => testid(returnRequest(page, title), "return-withdraw");

/** Withdraws the return (its opener already open) and waits for the page to say so. */
async function withdrawReturn(page, title) {
  await button(returnRequest(page, title), "Retirar la solicitud").click();
  // The page is redrawn with the request closed as the shopper's own doing.
  await settledText(main(page), /Retirada: usted retiró esta solicitud/, {
    what: "the order page",
  });
}

/** The return request on the line of this product, as one line. */
const returnRequestText = (page, title) => text(returnRequest(page, title));

/** How many returns can still be withdrawn on the page. */
const withdrawOffers = (page) => testid(main(page), "return-withdraw").count();

/** How many lines of this product can be returned (1 when the form is back). */
const returnableLines = (page, title) => returnableLine(page, title).count();

Object.assign(module.exports, {
  waitForOrderHeading,
  requestReturn,
  returnReceived,
  firstAlert,
  withdrawOpener,
  withdrawReturn,
  returnRequestText,
  withdrawOffers,
  returnableLines,
});

// ── Checkout refused; returns read by the shopper ─────────────────────────

/** Puts the product of the buy box in the cart and goes through sign-in to checkout. */
async function checkoutSignedOut(page, slug, email, password = PASSWORD) {
  await open(page, `/p/${slug}`);
  await addToCart(page);
  await open(page, "/carrito");
  await continueToCheckout(page);
  await page.waitForURL(/ingresar/);
  await fillSignIn(page, email, password);
  await page.waitForURL((u) => new URL(u).pathname === "/pagar");
}

/** Chooses SINPE Móvil and confirms; returns the refusal checkout shows for too many unpaid orders. */
async function confirmRefusedForUnpaid(page) {
  await choosePayment(page, "sinpe_movil");
  await confirmOrder(page);
  await kit.waitForMessage(main(page), "varios pedidos esperando el pago", { roles: "alert" });
  return alertText(page);
}

/** The last return request on the order page that says what happens next («Le contactaremos…»). */
async function returnNextStep(page) {
  await settledText(main(page), /Le contactaremos para recoger el producto/, {
    what: "the order page",
  });
  const all = (await testid(main(page), "return-request").allInnerTexts()).map(squash);
  return all.filter((t) => t.includes("Le contactaremos")).at(-1) ?? "";
}

/** Waits for the delivery code and returns it. */
async function deliveryPinShown(page) {
  await testid(page, "delivery-code").waitFor();
  return deliveryPin(page);
}

Object.assign(module.exports, {
  checkoutSignedOut,
  confirmRefusedForUnpaid,
  returnNextStep,
  deliveryPinShown,
});

// ── Checkout with a factura; the order's documents ────────────────────────

/** Opens checkout and waits for its summary. */
async function openCheckout(page) {
  await open(page, "/pagar");
  await checkoutSummaryBox(page).waitFor();
}

const facturaBox = (page) => field(main(page), "factura");

/** Whether checkout offers a factura (its box), whether it is ticked, and how many cédula fields show. */
async function facturaOffer(page) {
  const offered = await facturaBox(page).count();
  return {
    offered,
    ticked: offered ? await facturaBox(page).isChecked() : false,
    numberFields: await field(main(page), "facturaNumero").count(),
  };
}

/** Ticks «factura» and fills it in. */
async function askForFactura(page, { kind, number, name, email }) {
  await facturaBox(page).check();
  await field(main(page), "facturaTipo").selectOption(kind);
  await field(main(page), "facturaNumero").fill(number);
  await field(main(page), "facturaNombre").fill(name);
  if (email !== undefined) await field(main(page), "facturaCorreo").fill(email);
}

/** Types another cédula number in the factura fields. */
const typeFacturaNumber = (page, number) => field(main(page), "facturaNumero").fill(number);

/** What checkout keeps after a refusal: the factura name, the factura box, the payment method chosen. */
async function checkoutKept(page, method) {
  return {
    name: await field(main(page), "facturaNombre").inputValue(),
    factura: await facturaBox(page).isChecked(),
    method: await page.locator(`input[name="paymentMethod"][value="${method}"]`).isChecked(),
  };
}

/** The checkout summary, as one line. */
const checkoutSummaryText = (page) => text(checkoutSummaryBox(page));

/** Opens an order (by its path) and waits for its heading. */
async function openOrderPath(page, path) {
  await open(page, path, "load");
  await page.getByRole("heading", { level: 1, name: "Pedido" }).first().waitFor();
}

/** The order page's «Comprobantes electrónicos», as one line. */
const orderDocuments = (page) =>
  text(main(page).getByRole("region", { name: "Comprobantes electrónicos" }));

/** «Ver comprobante», and waits for the document's page. */
async function openDocument(page, title = "Factura electrónica") {
  await link(main(page), "Ver comprobante").first().click();
  await page.waitForURL(/\/comprobantes\//);
  await page.getByRole("heading", { level: 1, name: title }).waitFor();
}

/** Waits for a document's page by its heading. */
const waitForDocument = (page, title = "Factura electrónica") =>
  page.getByRole("heading", { level: 1, name: title }).waitFor();

/** The «Descargar el comprobante» link of a document's page (for its size). */
const downloadLink = (page) => link(main(page), "Descargar el comprobante").first();

/** «Cancelar pedido» on the order page, and waits for the button to go. */
async function cancelOrder(page) {
  await button(main(page), "Cancelar pedido").click();
  // The page redraws with the order cancelled: the button (and its form) are gone.
  await button(main(page), "Cancelar pedido").waitFor({ state: "detached", timeout: 20000 });
}

Object.assign(module.exports, {
  openCheckout,
  facturaOffer,
  askForFactura,
  typeFacturaNumber,
  checkoutKept,
  checkoutSummaryText,
  openOrderPath,
  orderDocuments,
  openDocument,
  waitForDocument,
  downloadLink,
  cancelOrder,
});

/** The order page's «Comprobantes electrónicos» as one line, or "" when the page has none. */
async function orderDocumentsIfAny(page) {
  const section = main(page).getByRole("region", { name: "Comprobantes electrónicos" });
  return (await section.count()) > 0 ? text(section) : "";
}

/** Waits for the order page's «Comprobantes electrónicos». */
const waitForOrderDocuments = (page) =>
  main(page).getByRole("region", { name: "Comprobantes electrónicos" }).waitFor();

Object.assign(module.exports, { orderDocumentsIfAny, waitForOrderDocuments });

// ── Reportar un problema ───────────────────────────────────────────────────

/** Fills the report form and sends it. */
async function sendReport(page, { reason, details, email }) {
  await field(main(page), "reason", "select").selectOption(reason);
  await field(main(page), "details", "textarea").fill(details);
  await field(main(page), "email").fill(email);
  await button(main(page), "Enviar el reporte").click();
}

/** The report form's reason, as chosen. */
const reportReason = (page) => field(main(page), "reason", "select").inputValue();

/** From a product page, «Reportar un problema», and waits for the form. */
async function openReport(page) {
  await link(main(page), "Reportar un problema").click();
  await page.waitForURL((u) => new URL(u).pathname === "/reportar");
  await field(main(page), "reason", "select").waitFor();
}

/** The first message of main (status or alert, as asked), once it shows. */
async function firstMessage(page, role) {
  await main(page).getByRole(role).first().waitFor();
  return text(main(page).getByRole(role).first());
}

Object.assign(module.exports, { sendReport, reportReason, openReport, firstMessage });

// ── Notification settings ──────────────────────────────────────────────────

Object.assign(module.exports, kit.notificationSettings);

// ── Mis pedidos: one order's row ──────────────────────────────────────────

/** Opens «Mis pedidos» and returns the row of this order, as one line, once it shows. */
async function orderRow(page, number) {
  // The list prefetches every order's page, so it is never idle for long: wait for the row.
  await open(page, "/pedidos", "load");
  const row = main(page).locator(`a[href="/pedidos/${number}"]`).first();
  await row.waitFor();
  return text(row);
}

/** What the order page says it refunds in total (when it lists more than one refund). */
const refundTotal = (page) => text(testid(page, "refund-total"));

/** Waits for the order page's cancellation notice and returns it. */
const cancelNotice = (page) => cancelReason(page);

Object.assign(module.exports, { orderRow, refundTotal, cancelNotice });
