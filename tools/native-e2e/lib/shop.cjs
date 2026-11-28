// Screen steps of the shopper app (apps/shop-native, "Yuntera"), for the
// native journeys. Journeys keep the flow and the checks; how a screen is
// found and worked lives here, so a rebuilt screen changes this file only
// (SISTEMA.md §20.5). Elements are found by testID (testids/shop.json and
// expo-kit.json) or by role and accessible name; the names are the words the
// screens show today. Status words come from words.cjs.

const { button, heading, link, on, prefixed, shows, tab } = require("./screen.cjs");
const words = require("./words.cjs");

/** The home screen has drawn: its title is the shop's tagline. */
const home = (page) => heading(page, "Lo que ocupa, a su puerta.").waitFor();
/** The home screen's list of the products people take most. */
const popularHeading = (page) => heading(page, "Lo que más se está llevando");

/** The back button of a product opened by link, which leads to the shop's home. */
const backToHome = (page) => button(page, "Volver a Inicio");

/** The tabs of the tab bar, by their word. */
const tabs = {
  home: (page) => tab(page, "Inicio"),
  categories: (page) => tab(page, "Categorías"),
  search: (page) => tab(page, "Buscar"),
  cart: (page) => tab(page, "Carrito"),
  account: (page) => tab(page, "Cuenta"),
};

/** The departments of Categorías, and the product cards of any list. */
const departments = (page) => prefixed(page, "department-");
const productCards = (page) => prefixed(page, "product-");
const homeProducts = (page) => page.locator('[data-testid^="home-product"]');

/** The search screen without a query or a brand: its title says «Todos los productos». */
const allProducts = (page) => shows(page, "search-title", "Todos los productos");

/** A list filtered by a brand that has nothing there, and its button that takes the filter off. */
const brandEmpty = (page) => heading(page, "No hay productos de esa marca aquí");
const clearBrand = (page) => button(page, "Quitar el filtro de marca");

/** What a missing category and a missing product say (the website's not-found words). */
const categoryNotFound = (page) => heading(page, "No encontramos esa categoría");
const pageNotFound = (page) => heading(page, "No encontramos esa página");

/**
 * What a screen says when its data could not be read (expo-kit ErrorState),
 * and its retry buttons: every visible one, to count them or take `.first()`.
 */
const loadFailed = (page) =>
  page
    .getByRole("heading", { name: "No pudimos cargar esta información" })
    .filter({ visible: true });
const retryButtons = (page) =>
  page.getByRole("button", { name: "Intentar de nuevo" }).filter({ visible: true });

/** Types a search and sends it. */
async function search(page, text) {
  await on(page, "search-input").fill(text);
  await on(page, "search-input").press("Enter");
}

/** Fills the sign-in form and sends it. */
async function signIn(page, email, password) {
  await on(page, "sign-in-email").fill(email);
  await on(page, "sign-in-password").fill(password);
  await on(page, "sign-in-submit").click();
}

/** On a delivered order: opens the return form of the first line that has one and sends it. */
async function requestReturn(page) {
  await button(page, "Devolver o reclamar garantía").click();
  await button(page, "Solicitar devolución").click();
}

/** On an order: opens the withdrawal of a return waiting for a decision. */
const openWithdrawal = (page) => button(page, "¿La abrió por error? Retirar la solicitud").click();
/** Withdraws it. */
const confirmWithdrawal = (page) => button(page, "Retirar la solicitud", { exact: true }).click();
/** The order says the return was withdrawn. */
const withdrawn = (page, options) =>
  shows(page, "return-status", words.returnLine("withdrawn"), options);

/** The order screen of `orderNumber` has drawn: its title says «Pedido YT-…». */
const orderOpen = (page, orderNumber) => shows(page, "order-title", `Pedido ${orderNumber}`);

/** The account tab, signed out, offers to create an account. */
const signedOut = (page) => link(page, "Crear una cuenta").waitFor();

module.exports = {
  allProducts,
  backToHome,
  brandEmpty,
  categoryNotFound,
  clearBrand,
  loadFailed,
  pageNotFound,
  retryButtons,
  confirmWithdrawal,
  departments,
  home,
  homeProducts,
  openWithdrawal,
  orderOpen,
  popularHeading,
  productCards,
  requestReturn,
  search,
  signedOut,
  signIn,
  tabs,
  withdrawn,
};

// ── Wave 9: the complaint form, «Sus consultas», a stopped order ───────────

const { screenText, squash } = require("./screen.cjs");

/** Signs in from the sign-in screen and waits for the order `orderNumber` in «Sus pedidos». */
async function signInToOrders(page, base, email, password, orderNumber) {
  await page.goto(`${base}/ingresar?siguiente=%2Fpedidos`, { waitUntil: "networkidle" });
  await signIn(page, email, password);
  await on(page, `order-${orderNumber}`).waitFor();
}

/** Everything Ayuda says, as one line (for its promised times). */
const helpText = (page) => screenText(page);

/** Waits for Ayuda's button to the complaint form. */
const helpComplaintButton = (page) => on(page, "help-complaint").waitFor();

/** On an order: «Presente un reclamo», and waits for the form. */
async function openComplaintFromOrder(page) {
  await on(page, "order-complaint").click();
  await on(page, "complaint-form").waitFor();
}

/** The order number the complaint form carries. */
const complaintOrderNumber = (page) => on(page, "complaint-order").inputValue();

/** Types what happened. */
const typeComplaint = (page, description) => on(page, "complaint-description").fill(description);

/** Chooses what the complaint is about (`delivery`, `product`…). */
const chooseComplaintCategory = (page, category) =>
  on(page, `complaint-category-${category}`).click();

/** Sends the complaint. */
const sendComplaint = (page) => on(page, "complaint-submit").click();

/** What the complaint form says now (a refusal or the filed message), as one line. */
const complaintMessage = async (page) => squash(await on(page, "complaint-message").innerText());

/** After filing: waits for the button to «Sus consultas». */
const complaintFiled = (page) => on(page, "complaint-cases").waitFor();

/** From the filed message, opens «Sus consultas». */
const openMyCasesFromComplaint = (page) => on(page, "complaint-cases").click();

/** The shopper's cases with their answers (in «Sus consultas» or on an order), as one line. */
async function caseAnswersText(page) {
  await on(page, "case-answers").waitFor();
  return squash(await on(page, "case-answers").innerText());
}

/** Why an order was cancelled, as its screen says it. */
const cancelReasonText = async (page) => squash(await on(page, "order-cancel-reason").innerText());

Object.assign(module.exports, {
  signInToOrders,
  helpText,
  helpComplaintButton,
  openComplaintFromOrder,
  complaintOrderNumber,
  typeComplaint,
  chooseComplaintCategory,
  sendComplaint,
  complaintMessage,
  complaintFiled,
  openMyCasesFromComplaint,
  caseAnswersText,
  cancelReasonText,
});

// ── Owner decision D56: the service hours on Ayuda ─────────────────────────

/** The service hours Ayuda says, as one line (U+00A0 as a space). */
async function helpServiceHours(page) {
  await on(page, "help-hours").waitFor();
  return squash((await on(page, "help-hours").innerText()).replace(/ /g, " "));
}

Object.assign(module.exports, { helpServiceHours });
