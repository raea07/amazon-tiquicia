// Screen steps of the seller centre (apps/seller): everything a journey finds, clicks,
// fills or reads there. Journey files call these and keep the flow, the
// checks on data and the size checks. The app's builder keeps this file
// passing when the screens change (rule 20.5.4 of docs/brand/system/SISTEMA.md).
//
// How things are found (rule 20.5.1): by role and accessible name, by
// [name=…] for a form field, or by data-testid. Never by a CSS class, never
// by a text match on a container (kit.withValue matches a data value only).

const { settledText } = require("./settle.cjs");
const kit = require("./kit.cjs");
const { text, main, field, button, link, testid, withValue, fillSignIn } = kit;

const BASE = process.env.SELLER_URL || "http://127.0.0.1:3001";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";

const open = (page, path, waitUntil = "networkidle") => page.goto(BASE + path, { waitUntil });

/** Signs in from the sign-in page (going to `next` afterwards, if given) and waits to leave it. */
async function signIn(page, email, { next, password = PASSWORD } = {}) {
  await open(page, `/ingresar${next ? `?siguiente=${encodeURIComponent(next)}` : ""}`);
  await fillSignIn(page, email, password);
  await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
  await page.waitForLoadState("networkidle");
}

module.exports = {
  BASE,
  open,
  signIn,
  text: kit.text,
  mainText: kit.mainText,
  heading: kit.heading,
  statusText: kit.statusText,
  alertText: kit.alertText,
};

// ── Inventario ─────────────────────────────────────────────────────────────

const stockHistory = (page) => main(page).getByRole("region", { name: "Historial de existencias" });

/** Opens Inventario and waits for its history. */
async function openInventory(page) {
  await open(page, "/inventario");
  await stockHistory(page).waitFor();
}

/** The first entry of the stock history, as one line. */
const firstHistoryEntry = (page) => text(stockHistory(page).getByRole("listitem").first());

/** The whole stock history, as one line. */
const historyText = (page) => text(stockHistory(page));

Object.assign(module.exports, { openInventory, firstHistoryEntry, historyText });

// ── Pagos: Yuntera's facturas for the shop's fees ─────────────────────────

const feeInvoices = (page) =>
  main(page).getByRole("region", { name: "Facturas de Yuntera por sus cargos" });

/** The fee factura of an order on Pagos, as one line, or null when it is not listed. */
async function feeInvoiceRow(page, orderNumber) {
  const row = withValue(feeInvoices(page).getByRole("listitem"), orderNumber).first();
  return (await row.count()) > 0 ? text(row) : null;
}

/** Opens that fee factura and waits for its page. */
async function openFeeInvoice(page, orderNumber) {
  await link(
    withValue(feeInvoices(page).getByRole("listitem"), orderNumber).first(),
    "Ver",
    true,
  ).click();
  await page.waitForURL(/\/comprobantes\//);
  await page.getByRole("heading", { level: 1, name: "Factura electrónica" }).waitFor();
}

/** Waits for the fee facturas to show. */
const waitForFeeInvoices = (page) => feeInvoices(page).waitFor();

Object.assign(module.exports, { feeInvoiceRow, openFeeInvoice, waitForFeeInvoices });

// ── Equipo, invitations ────────────────────────────────────────────────────

/** Signs in and waits to land on `landsOn` (the registration page for someone with no shop). */
async function signInLandingOn(page, email, landsOn, password = PASSWORD) {
  await open(page, "/ingresar");
  await fillSignIn(page, email, password);
  await page.waitForURL((u) => new URL(u).pathname === landsOn);
  await page.waitForLoadState("networkidle");
}

const inviteForm = (page) => main(page).getByRole("region", { name: "Invitar a alguien" });

/** Invites someone to the team (with a role, if given); returns the form's message. */
async function invite(page, email, role) {
  return sendInvitation(page, email, role, "status");
}

/** Invites an address that is refused; returns the refusal. */
const inviteRefused = (page, email) => sendInvitation(page, email, undefined, "alert");

async function sendInvitation(page, email, role, answer) {
  const form = inviteForm(page);
  await field(form, "email").fill(email);
  if (role) await field(form, "role").selectOption(role);
  await form.locator('button[type="submit"]').click();
  // A refusal is an alert; an invitation sent is a status.
  const message = form.getByRole(answer);
  await message.waitFor();
  return text(message);
}

/** «Invitaciones sin responder», as one line. */
const pendingInvitations = (page) =>
  text(main(page).getByRole("region", { name: "Invitaciones sin responder" }));

/** From the registration page, follows the notice to the invitation; returns what the notice said. */
async function followInvitationNotice(page) {
  const notice = await kit.findMessage(main(page), "Le invitaron", { roles: "status" });
  const said = await text(notice);
  await link(notice, "vea la invitación").click();
  await page.waitForURL((u) => new URL(u).pathname === "/invitaciones");
  return said;
}

/** Waits for the invitation of a shop (by its name) and returns the first invitation, as one line. */
async function invitationFrom(page, shop) {
  await withValue(main(page).getByRole("listitem"), shop).first().waitFor();
  return text(main(page).getByRole("listitem").first());
}

/** «Aceptar y unirme»; returns what the page says after joining, and goes to the shop's summary. */
async function acceptInvitation(page, shop) {
  await button(main(page), "Aceptar y unirme").click();
  await page.waitForURL((u) => new URL(u).search.includes("unido=1"));
  const joined = await kit.findMessage(main(page), "Ya es parte del equipo", { roles: "status" });
  const said = await text(joined);
  await link(joined, "Ir al resumen").click();
  await page.waitForURL((u) => new URL(u).pathname === "/");
  await main(page).getByRole("heading", { level: 1, name: shop }).waitFor();
  return said;
}

/** Leaves the team (ticking the confirmation); returns what the page says afterwards. */
async function leaveTeam(page) {
  const form = main(page)
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Salir del equipo" }) });
  await field(form, "confirma").check();
  await button(form, "Salir del equipo").click();
  await page.waitForURL((u) => new URL(u).search.includes("salio=1"));
  return kit.waitForMessage(main(page), "Salió del equipo", { roles: "status" });
}

// ── Cuenta: requests to change the shop's details ─────────────────────────

const shopDetails = (page) => testid(main(page), "shop-details");
const fiscalDetails = (page) => testid(main(page), "fiscal-details");
const payoutDetails = (page) => testid(main(page), "payout-details");

/** Asks for a new shop name that is refused; returns the refusal. */
async function askShopNameRefused(page, name) {
  const form = shopNameForm(page);
  await field(form, "tradeName").fill(name);
  await form.locator('button[type="submit"]').click();
  await form.getByRole("alert").waitFor();
  return text(form.getByRole("alert"));
}

/** Asks for a new shop name and waits for the request to wait for staff. */
async function askShopName(page, name) {
  const form = shopNameForm(page);
  await field(form, "tradeName").fill(name);
  await form.locator('button[type="submit"]').click();
  await settledText(shopDetails(page), /Cambio de nombre de la tienda en revisión/, {
    what: "the shop's details",
  });
}

const shopNameForm = (page) =>
  shopDetails(page)
    .locator("form")
    .filter({ has: page.locator('input[name="tradeName"]') });

/** Asks for a new contact phone and waits for the request to wait for staff. */
async function askContactPhone(page, phone) {
  const form = shopDetails(page)
    .locator("form")
    .filter({ has: page.locator('input[name="contactPhone"]') });
  await field(form, "contactPhone").fill(phone);
  await form.locator('button[type="submit"]').click();
  await settledText(shopDetails(page), /Cambio de correo y teléfono en revisión/, {
    what: "the shop's details",
  });
}

/** «Dónde le pagamos»: what it says and how many IBAN fields it offers. */
async function payoutSection(page) {
  return {
    text: await text(payoutDetails(page)),
    ibanFields: await field(payoutDetails(page), "iban").count(),
  };
}

const fiscalForm = (page) =>
  fiscalDetails(page)
    .locator("form")
    .filter({ has: page.locator('textarea[name="fiscalAddress"]') });

/** The postal code the fiscal form starts from. */
const fiscalPostalCode = (page) => field(fiscalForm(page), "postalCode").inputValue();

/** Asks for a new fiscal address and waits for the request to wait for staff. */
async function askFiscalAddress(page, address) {
  await field(fiscalForm(page), "fiscalAddress", "textarea").fill(address);
  await fiscalForm(page).locator('button[type="submit"]').click();
  await settledText(fiscalDetails(page), /Cambio de datos fiscales en revisión/, {
    what: "the fiscal details",
  });
}

/** The shop's details section, as one line, and its facts alone. */
async function shopDetailsText(page) {
  return {
    all: await text(shopDetails(page)),
    facts: await text(shopDetails(page).locator("dl").first()),
  };
}

Object.assign(module.exports, {
  signInLandingOn,
  invite,
  inviteRefused,
  pendingInvitations,
  followInvitationNotice,
  invitationFrom,
  acceptInvitation,
  leaveTeam,
  askShopNameRefused,
  askShopName,
  askContactPhone,
  payoutSection,
  fiscalPostalCode,
  askFiscalAddress,
  shopDetailsText,
});

// ── Sign-in to the summary; the shop chooser ───────────────────────────────

/** Signs in, lands on the summary and waits for its heading. */
async function signInHome(page, email, password = PASSWORD) {
  await open(page, "/ingresar");
  await fillSignIn(page, email, password);
  await page.waitForURL((u) => new URL(u).pathname === "/");
  await main(page).getByRole("heading").first().waitFor();
}

/** Switches to a shop (by its name) with the header's chooser, unless it is the one shown. */
async function chooseShop(page, name) {
  if ((await main(page).getByRole("heading", { level: 1 }).first().innerText()).includes(name))
    return;
  await field(page.getByRole("banner"), "shopId").selectOption({ label: name });
  await button(page.getByRole("banner"), "Cambiar").click();
  await main(page).getByRole("heading", { level: 1, name }).waitFor();
}

// ── Productos: the list and the edit page ──────────────────────────────────

/** A product's row in the list, by its title (data). */
const productRow = (page, title) => main(page).getByRole("row", { name: title }).first();

/** A product's row, as one line, and its state cell. */
async function productRowText(page, title) {
  const row = productRow(page, title);
  return { all: await text(row), state: await text(row.getByRole("cell").nth(1)) };
}

/** How many «Editar» links a product's row offers. */
const editOffered = (page, title) =>
  productRow(page, title).getByRole("link", { name: "Editar" }).count();

/** Opens a product's edit page from the list and waits for its heading. */
async function openEdit(page, title, heading = title) {
  await link(productRow(page, title), "Editar").click();
  await main(page).getByRole("heading", { level: 1, name: heading }).first().waitFor();
}

/** «Enviar cambios a revisión». */
const sendForReview = (page) => button(main(page), "Enviar cambios a revisión").click();

/** The edit form's first error, once it shows (with these words, if given). */
async function editFormError(page, words) {
  const form = main(page).locator("form");
  if (words) return kit.waitForMessage(form, words, { roles: "alert" });
  await form.getByRole("alert").first().waitFor();
  return text(form.getByRole("alert").first());
}

/** The category select of the edit form: its value, and another category it offers. */
async function categoryChoice(page) {
  const select = field(main(page), "categorySlug");
  const current = await select.inputValue();
  const other = await select.evaluate(
    (el, now) => [...el.options].find((o) => o.value && o.value !== now)?.value,
    current,
  );
  return { current, other };
}

/** Chooses a category in the edit form. */
const chooseCategory = (page, value) => field(main(page), "categorySlug").selectOption(value);

/** Types a title in the edit form. */
const typeTitle = (page, title) => field(main(page), "title").fill(title);

/** What the edit form holds: category and title. */
async function editTyped(page) {
  return {
    category: await field(main(page), "categorySlug").inputValue(),
    title: await field(main(page), "title").inputValue(),
  };
}

/** The «← Productos» link at the top of the edit page (for its size). */
const backToProducts = (page) => link(main(page), "← Productos");

/** Waits until the edit page says the product is published with its changes in review. */
const waitForEditInReview = (page) =>
  settledText(main(page), /Publicado; sus cambios están en revisión/, { what: "the edit page" });

/** The edit page's header, as one line. */
const editHeader = (page) => text(main(page).locator("header").first());

/** The first definition list of the edit page (old and new), as one line. */
const editProposal = (page) => text(main(page).locator("dl").first());

/** How many title fields the page has (0 once archived). */
const titleFields = (page) => main(page).locator('[name="title"]').count();

/** Archives the product (ticking the confirmation) and waits for the page to say so. */
async function archiveProduct(page) {
  const box = main(page).getByRole("region", { name: "Archivar el producto" });
  await field(box, "confirma").check();
  await button(box, "Archivar producto").click();
  await settledText(main(page), /Este producto está archivado/, { what: "the edit page" });
}

Object.assign(module.exports, {
  signInHome,
  chooseShop,
  productRowText,
  editOffered,
  openEdit,
  sendForReview,
  editFormError,
  categoryChoice,
  chooseCategory,
  typeTitle,
  editTyped,
  backToProducts,
  waitForEditInReview,
  editHeader,
  editProposal,
  titleFields,
  archiveProduct,
});

// ── Notification settings ──────────────────────────────────────────────────

Object.assign(module.exports, kit.notificationSettings);
