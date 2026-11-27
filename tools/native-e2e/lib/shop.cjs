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
