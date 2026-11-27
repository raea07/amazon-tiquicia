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

// ── Password recovery ──────────────────────────────────────────────────────

Object.assign(module.exports, kit.passwordRecovery);

/** Opens a full address (a link from an e-mail) and waits until React has taken over its forms. */
async function openLink(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await hydrated(page);
}

Object.assign(module.exports, { openLink });

// ── Paying an order (and the payment gateway's test page) ─────────────────

/** Buys one unit of a product with this payment method and lands on the order page; returns the order number. */
async function buy(page, slug, method) {
  await open(page, `/p/${slug}`, "load");
  await addToCart(page);
  await open(page, "/pagar", "load");
  const radio = page.locator(`input[name="paymentMethod"][value="${method}"]`);
  await radio.waitFor();
  await radio.check();
  await confirmOrder(page);
  await page.waitForURL((u) => /^\/pedidos\/YT-/.test(new URL(u).pathname));
  await page.getByRole("heading", { level: 1, name: "Pedido YT-" }).first().waitFor();
  return new URL(page.url()).pathname.split("/")[2];
}

/** Reloads an order page and waits until its streamed content is on screen. */
async function reloadOrder(page) {
  await page.reload({ waitUntil: "load" });
  await page.getByRole("heading", { level: 1, name: "Pedido YT-" }).first().waitFor();
  await page.waitForTimeout(300);
}

/** Opens (or reloads) an order page and tells whether it shows the delivery code, i.e. it is paid. */
async function orderShowsPaid(page, number) {
  if (!new URL(page.url()).pathname.endsWith(number)) {
    await open(page, `/pedidos/${number}`, "load");
  } else {
    await page.reload({ waitUntil: "load" });
  }
  await page.getByRole("heading", { level: 1, name: "Pedido YT-" }).first().waitFor();
  await page.waitForTimeout(300);
  return deliveryCodeShown(page);
}

/** Whether the page shows the delivery code now. */
const deliveryCodeShown = async (page) => (await testid(page, "delivery-code").count()) > 0;

/** The visible text of the whole page. */
const pageText = (page) => text(page.locator("body"));

/** How many visible times the page says `words` (product words, named by a helper). */
const timesSaid = async (page, words) => (await pageText(page)).split(words).length - 1;

/** Whether the order page offers to simulate the payment (only in the sandbox). */
const simulationOffered = async (page) =>
  (await page.getByRole("button", { name: "Simular pago" }).count()) > 0;

/** «Pagar … con tarjeta», and waits for the gateway's page. */
async function payByCard(page, gateway) {
  await button(main(page), "con tarjeta").click();
  await page.waitForURL((u) => u.href.startsWith(`${gateway}/pay/`));
}

/** «Intentar de nuevo» after a failed payment, and waits for the gateway's page. */
async function retryPayment(page, gateway) {
  await button(main(page), "Intentar de nuevo").click();
  await page.waitForURL((u) => u.href.startsWith(`${gateway}/pay/`));
}

/** «Pagar … con tarjeta» when the gateway cannot prepare a payment (no page to go to). */
const tryCardWithoutGateway = (page) => button(main(page), "con tarjeta").click();

/** On the gateway's test page: the bank's extra step, passed. */
async function gatewayChallengePass(page) {
  await testid(page, "fake-challenge").click();
  await testid(page, "fake-3ds").waitFor();
}

/** On the gateway's test page: the extra step's «pass». */
const gatewayPass3ds = (page) => testid(page, "fake-3ds-pass").click();

/** On the gateway's test page: the card is declined. */
const gatewayDecline = (page) => testid(page, "fake-decline").click();

/** On the gateway's test page: the card is approved. */
const gatewayApprove = (page) => testid(page, "fake-approve").click();

/** Whether the order page says the payment was received (once). */
const paymentReceivedNotices = (page) => timesSaid(page, "¡Pago recibido!");

/** Whether the order page says the payment did not go through. */
const paymentFailedShown = async (page) => (await timesSaid(page, "El pago no se completó")) > 0;

/** Whether the order page says the payment could not be prepared. */
const paymentNotPreparedShown = async (page) =>
  (await timesSaid(page, "No pudimos preparar el pago")) > 0;

/** The SINPE Móvil form: who pays (kind, number) and from which phone. Fields left out stay. */
async function fillSinpe(page, { kind, number, phone }) {
  if (kind !== undefined) await field(main(page), "kind").selectOption(kind);
  if (number !== undefined) await field(main(page), "number").fill(number);
  if (phone !== undefined) await field(main(page), "phone").fill(phone);
}

/** What the SINPE form holds: kind and number. */
async function sinpeTyped(page) {
  return {
    kind: await field(main(page), "kind").inputValue(),
    number: await field(main(page), "number").inputValue(),
  };
}

/** The SINPE form's «who pays» field (for its size). */
const sinpeKindField = (page) => field(main(page), "kind");

/** Waits for the SINPE form's button. */
const waitForSinpeForm = (page) => button(main(page), "Ver los datos para transferir").waitFor();

/** «Ver los datos para transferir». */
const askSinpeDetails = (page) => button(main(page), "Ver los datos para transferir").click();

/** Waits for the number to transfer to, and returns it. */
async function sinpeNumber(page) {
  await testid(page, "sinpe-number").waitFor();
  return text(testid(page, "sinpe-number"));
}

/** «Cancelar pedido» on a paid order, and waits for its refund to show. */
async function cancelPaidOrder(page) {
  await button(main(page), "Cancelar pedido").click();
  // The cancel form goes once the order is cancelled; its refund takes its place.
  await page.locator('[data-testid="refund"]:visible').first().waitFor();
}

/** The order's first refund, as one line. */
const firstRefund = (page) => text(testid(page, "refund").first());

/** The order page's summary, as one line. */
const orderSummary = (page) => text(page.getByRole("complementary", { name: "Resumen" }));

Object.assign(module.exports, {
  buy,
  reloadOrder,
  orderShowsPaid,
  deliveryCodeShown,
  pageText,
  simulationOffered,
  payByCard,
  retryPayment,
  tryCardWithoutGateway,
  gatewayChallengePass,
  gatewayPass3ds,
  gatewayDecline,
  gatewayApprove,
  paymentReceivedNotices,
  paymentFailedShown,
  paymentNotPreparedShown,
  fillSinpe,
  sinpeTyped,
  sinpeKindField,
  waitForSinpeForm,
  askSinpeDetails,
  sinpeNumber,
  cancelPaidOrder,
  firstRefund,
  orderSummary,
});

/** Signs in from the shop's sign-in page and waits to land on `landsOn`. */
async function signInLandingOn(page, email, landsOn, password = PASSWORD) {
  await open(page, "/ingresar");
  await fillSignIn(page, email, password);
  await page.waitForURL((u) => new URL(u).pathname === landsOn);
}

Object.assign(module.exports, { signInLandingOn });

// ── Limits: sign-in attempts, reset codes, sign-up; the delivery zone ──────

/** One sign-in attempt from the shop's sign-in page; the alert shown, or null when it signed in. */
async function tryPassword(page, email, password) {
  await openReady(page, "/ingresar");
  return kit.trySignIn(page, email, password);
}

/** Asks for a reset e-mail from /recuperar; returns the answer. */
async function askReset(page, email) {
  await openReady(page, "/recuperar");
  return kit.askResetAnswer(page, email);
}

/** Creates an account from the sign-up form and returns what the screen says once it asks to check the e-mail. */
async function signUpAnswer(page, { name, email, password }) {
  await openReady(page, "/ingresar?modo=crear");
  const form = main(page).locator("form").first();
  await field(form, "fullName").fill(name);
  await field(form, "email").fill(email);
  await field(form, "password").fill(password);
  await field(form, "acepta").check();
  await form.locator('button[type="submit"]').click();
  await settledText(main(page), /Revise su correo/, { what: "the sign-up page" });
  return text(main(page));
}

/** From a product page, the link to choose the delivery zone; waits for /zona. */
async function openZoneChooser(page) {
  await main(page).locator('a[href^="/zona?siguiente="]').first().click();
  await page.waitForURL((u) => new URL(u).pathname === "/zona");
  await hydrated(page);
}

/**
 * Chooses province, canton and district on /zona: in each, the first that is
 * served (the second one in the third list, so the district is not the one
 * the page assumed).
 */
async function chooseOtherDistrict(page) {
  for (let i = 0; i < 3; i++) {
    const select = main(page).locator("select").nth(i);
    await select.waitFor();
    const options = await select.locator("option").allTextContents();
    const usable = options
      .map((option, index) => ({ option, index }))
      .filter(({ option, index }) => index > 0 && !option.includes("aún no"));
    await select.selectOption({ index: ((i === 2 && usable[1]) || usable[0]).index });
  }
}

/** «Usar esta zona». */
const useZone = (page) => button(main(page), "Usar esta zona").click();

const ZONE_UPDATING = "Actualizando la fecha de entrega y el envío para su zona";

/** Waits for the notice that the date and price are being updated for the zone. */
const waitForZoneUpdating = (page, timeout) =>
  kit.findMessage(main(page), ZONE_UPDATING, { roles: "status", timeout });

/** Waits for that notice to go. */
async function waitForZoneUpdated(page, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const all = await main(page).getByRole("status").allInnerTexts();
    if (!all.some((t) => t.includes(ZONE_UPDATING))) return;
    if (Date.now() >= deadline) throw new Error(`the zone notice did not go within ${timeout} ms`);
    await page.waitForTimeout(200);
  }
}

/** Waits until the product page shows its delivery price; tells whether it still asks for a zone. */
async function zoneApplied(page) {
  await settledText(main(page), /Envío ₡/, { what: "the product page" });
  return !(await mainText(page)).includes("Elija su zona para confirmar la fecha");
}

/** How many values the page marks as being updated. */
const busyValues = (page) => main(page).locator('[aria-busy="true"]').count();

Object.assign(module.exports, {
  tryPassword,
  askReset,
  tryResetCode: kit.tryResetCode,
  signInEmailTyped: kit.signInEmailTyped,
  signUpAnswer,
  openZoneChooser,
  chooseOtherDistrict,
  useZone,
  waitForZoneUpdating,
  waitForZoneUpdated,
  zoneApplied,
  busyValues,
});

// ── Two shops on one product: offers, the cart's swap, the shop's page ─────

const otherOffers = (page) => page.getByRole("region", { name: "Otras ofertas de este producto" });

/** The other offers of a product page, as one line. */
const otherOffersText = (page) => text(otherOffers(page));

/** The first line of the cart, as one line. */
const firstCartLine = (page) => text(main(page).locator("ul > li").first());

/** When the cart says the other shop's offer would arrive. */
const cartAlternativeArrival = (page) =>
  text(testid(main(page).locator("ul > li").first(), "cart-alternative-arrival"));

/** A shop's arrival date on the product page, wherever the page lists that shop's offer (data). */
const shopOfferArrival = (page, shop) =>
  text(
    testid(
      withValue(buyBox(page).or(otherOffers(page).getByRole("listitem")), shop).first(),
      "offer-arrival",
    ).first(),
  );

/** In the cart, swaps to the other shop's offer and waits for the line to name it. */
async function swapToOffer(page, shop) {
  await button(main(page), `Cambiar a la oferta de ${shop}`).click();
  await settledText(
    main(page).locator("ul > li").first(),
    (t) => t.includes(`Vendido por ${shop}`),
    {
      what: "the cart line",
    },
  );
}

/** How many «Continuar con la compra» links the cart offers. */
const checkoutLinks = (page) =>
  main(page).getByRole("link", { name: "Continuar con la compra" }).count();

/**
 * From the cart: «Continuar con la compra», signs in, pays by this method,
 * confirms and simulates the payment; returns the order page's main as one line.
 */
async function checkoutSignedOutAndPay(page, email, method) {
  await continueToCheckout(page);
  await page.waitForURL(/ingresar/);
  await fillSignIn(page, email, PASSWORD);
  await page.waitForURL((u) => new URL(u).pathname === "/pagar");
  await choosePayment(page, method);
  await confirmOrder(page);
  await waitForOrderPage(page);
  await simulatePayment(page);
  return mainText(page);
}

const aboutShop = (page) => page.getByRole("region", { name: "Sobre la tienda" });

/** A shop's public page: its description, how many bold marks it renders, whether its logo loaded and what it sells. */
async function shopPage(page) {
  return {
    about: await text(aboutShop(page)),
    bold: await aboutShop(page).locator("b").count(),
    logoLoaded: await main(page)
      .locator("header img")
      .first()
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    products: await text(main(page).getByRole("region", { name: "Lo que vende" })),
  };
}

/** A shop's offer among the other offers (data): how many logos it shows. */
const offerLogos = (page, shop) =>
  withValue(otherOffers(page).getByRole("listitem"), shop).first().locator("img").count();

/** Follows a shop's link from its offer and waits for the shop's page. */
async function openShopFromOffer(page, shop, slug) {
  await link(withValue(otherOffers(page).getByRole("listitem"), shop).first(), shop).click();
  await page.waitForURL((u) => new URL(u).pathname === `/tienda/${slug}`);
}

Object.assign(module.exports, {
  otherOffersText,
  firstCartLine,
  cartAlternativeArrival,
  shopOfferArrival,
  swapToOffer,
  checkoutLinks,
  checkoutSignedOutAndPay,
  shopPage,
  offerLogos,
  openShopFromOffer,
});

// ── Product photos: the gallery and the search thumbnail ──────────────────

const galleryOf = (page) => main(page).getByRole("region", { name: "Fotos de" }).first();

/** Alternative texts of the gallery's photos, in order, and whether each loaded. */
const galleryPhotos = (page) =>
  galleryOf(page)
    .locator("li img")
    .evaluateAll((imgs) =>
      imgs.map((img) => ({
        alt: img.alt,
        loaded: img.complete && img.naturalWidth > 0,
        src: img.currentSrc || img.src,
        srcset: img.srcset,
        fetchpriority: img.getAttribute("fetchpriority"),
        loading: img.getAttribute("loading"),
      })),
    );

/** Waits for the gallery's counter to say this («Foto 2 de 2»). */
const waitForGalleryAt = (page, words) =>
  settledText(galleryOf(page).locator("[aria-live]"), (t) => t.includes(words), {
    what: "the gallery's counter",
  });

/** Moves the gallery one photo on with the keyboard's right arrow. */
async function nextPhotoByKeyboard(page) {
  await galleryOf(page).getByRole("list").first().focus();
  await page.keyboard.press("ArrowRight");
}

/** Chooses a photo by its thumbnail («Ver foto n»). */
const showPhoto = (page, n) => button(main(page), `Ver foto ${n}`).click();

/** The address of a search result's picture (the result by its title, data). */
const resultPictureSrc = (page, title) =>
  withValue(main(page).getByRole("article"), title)
    .locator("img")
    .first()
    .evaluate((img) => img.currentSrc || img.src)
    .catch(() => "");

Object.assign(module.exports, {
  galleryPhotos,
  waitForGalleryAt,
  nextPhotoByKeyboard,
  showPhoto,
  resultPictureSrc,
});

// ── Wave 9: the complaint form, «Sus consultas», a category's breadcrumb ────

/** Where the footer's «Presentar un reclamo» leads. */
const footerComplaintHref = (page) =>
  link(page.getByRole("contentinfo"), "Presentar un reclamo").getAttribute("href");

/** From an order's page, «Presente un reclamo», and waits for the form. */
async function startComplaintFromOrder(page) {
  await claimLink(page).click();
  await page.waitForURL((u) => new URL(u).pathname === "/reclamo");
  await page.waitForLoadState("networkidle");
}

/** Opens the complaint form for an order. */
const openComplaintForm = (page, orderNumber) =>
  open(page, `/reclamo?pedido=${encodeURIComponent(orderNumber)}`);

/** The order number the complaint form carries. */
const complaintOrderNumber = (page) => field(main(page), "orderNumber").inputValue();

/** What the complaint form promises (the times of the acknowledgement and the answer). */
const complaintPromise = (page) => text(testid(main(page), "complaint-promise"));

/** Chooses what the complaint is about and types it. */
async function fillComplaint(page, { category, description }) {
  await field(main(page), "category", "select").selectOption(category);
  await field(main(page), "description", "textarea").fill(description);
}

/** «Enviar el reclamo», and returns what the page says once it is filed. */
async function sendComplaint(page) {
  await button(main(page), "Enviar el reclamo").click();
  const filed = testid(main(page), "complaint-filed");
  await filed.waitFor({ timeout: 30_000 });
  return text(filed);
}

/** Opens «Sus consultas» in the account. */
const openMyCases = (page) => open(page, "/cuenta/casos");

/** The shopper's cases on an order's page, as one line. */
const orderCasesText = (page) =>
  text(main(page).getByRole("region", { name: "Sus consultas sobre este pedido" }));

/** Opens a category page. */
const openCategory = (page, slug) => open(page, `/c/${slug}`);

const breadcrumb = (page) => page.getByRole("navigation", { name: "Ruta" });

/** The breadcrumb's «Inicio» (for its size). */
const breadcrumbHome = (page) => link(breadcrumb(page), "Inicio");

/** The breadcrumb's second link, the parent category (for its size). */
const breadcrumbParent = (page) => breadcrumb(page).getByRole("link").nth(1);

/** The breadcrumb's list (for the height of its line). */
const breadcrumbLine = (page) => breadcrumb(page).getByRole("list").first();

Object.assign(module.exports, {
  footerComplaintHref,
  startComplaintFromOrder,
  openComplaintForm,
  complaintOrderNumber,
  complaintPromise,
  fillComplaint,
  sendComplaint,
  openMyCases,
  orderCasesText,
  openCategory,
  breadcrumbHome,
  breadcrumbParent,
  breadcrumbLine,
});
