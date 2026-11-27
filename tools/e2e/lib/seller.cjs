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

// ── Pagos: balances and history; Cuenta: the payout account ───────────────

/** The balance tiles of Pagos (each tile's text) and the sentence with the total owed. */
async function balanceTiles(page) {
  return {
    tiles: await testid(main(page), "balances").locator(":scope > div").allInnerTexts(),
    owed: await text(
      main(page).getByRole("region", { name: "Su saldo" }).locator(":scope > p").first(),
    ),
  };
}

/** «Cuándo le pagamos», as one line. */
const whenPaid = (page) => text(main(page).getByRole("region", { name: "Cuándo le pagamos" }));

/** «Pagos que le hemos hecho», as one line. */
const payoutHistory = (page) =>
  text(main(page).getByRole("region", { name: "Pagos que le hemos hecho" }));

/** The payout account on file (the first definition list of «Dónde le pagamos»), as one line. */
const payoutAccount = (page) => text(payoutDetails(page).locator("dl").first());

/** Types an IBAN that does not add up; returns the form's warning. */
async function typeWrongIban(page, iban) {
  await field(payoutDetails(page), "iban").fill(iban);
  await payoutDetails(page).getByRole("alert").waitFor();
  return text(payoutDetails(page).getByRole("alert"));
}

/** Types a valid IBAN and waits for the form to say so (with the account grouped). */
async function typeIban(page, iban, grouped) {
  await field(payoutDetails(page), "iban").fill(iban);
  await settledText(payoutDetails(page), (t) => t.includes(`Cuenta válida: ${grouped}`), {
    what: "the payout form",
  });
}

/** Types the account holder's name; returns the SINPE Móvil number the form offers. */
async function typeHolder(page, name) {
  await field(payoutDetails(page), "holderName").fill(name);
  return field(payoutDetails(page), "sinpe").inputValue();
}

/** Sends the payout account change and waits for it to wait for review. Returns the section, as one line. */
async function askPayoutAccount(page) {
  await payoutDetails(page).locator('button[type="submit"]').click();
  await settledText(payoutDetails(page), /Cambio de cuenta en revisión/, {
    what: "the payout form",
  });
  return text(payoutDetails(page));
}

/** «Dónde le pagamos», as one line. */
const payoutSectionText = (page) => text(payoutDetails(page));

Object.assign(module.exports, {
  balanceTiles,
  whenPaid,
  payoutHistory,
  payoutAccount,
  typeWrongIban,
  typeIban,
  typeHolder,
  askPayoutAccount,
  payoutSectionText,
});

// ── The seller journey: summary, shops, listings, stock, a new listing ─────

/** The console's main navigation, as one line. */
const sectionsNav = (page) => text(page.getByRole("navigation", { name: "Secciones" }));

/** The first section of main, as one line. */
const firstSection = (page) => text(main(page).locator("section").first());

/** The n-th section of main (from 0), as one line. */
const section = (page, n) => text(main(page).locator("section").nth(n));

/** The shops the header's chooser offers. */
const shopOptions = (page) =>
  field(page.getByRole("banner"), "shopId").locator("option").allInnerTexts();

/** Switches to a shop by its exact name with the header's chooser and waits for its summary. */
async function switchShop(page, name, heading = name) {
  await field(page.getByRole("banner"), "shopId").selectOption({ label: name });
  await button(page.getByRole("banner"), "Cambiar").click();
  await main(page).getByRole("heading", { level: 1, name: heading }).waitFor();
}

/** How many rows the page's table has. */
const tableRows = (page) => main(page).locator("tbody tr").count();

/** A row of the page's table (first by default), as one line. */
const tableRow = (page, n = 0) => text(main(page).locator("tbody tr").nth(n));

/** Raises the price of the first listing by `step` and returns what the row says. */
async function raiseFirstPrice(page, step) {
  const row = main(page).locator("tbody tr").first();
  await row.locator("summary").click();
  const before = await field(row, "price").inputValue();
  await field(row, "price").fill(String(Number(before) + step));
  await row.locator('button[type="submit"]').click();
  const message = row.locator('[role="status"], [role="alert"]').first();
  await message.waitFor();
  return { before, summary: await text(row.locator("summary")), message: await text(message) };
}

/** Types a regular price lower than the price on the first listing; returns the refusal. */
async function badRegularPrice(page, value) {
  const row = main(page).locator("tbody tr").first();
  await field(row, "listPrice").fill(value);
  await row.locator('button[type="submit"]').click();
  await page.waitForTimeout(800);
  return text(row.getByRole("alert").first());
}

/** The section headings of the page. */
const sectionHeadings = (page) => main(page).getByRole("heading", { level: 2 }).allInnerTexts();

/** Sets the stock of the first row of Inventario; returns its message and the row. */
async function setFirstStock(page, quantity) {
  const row = main(page).locator("tbody tr").first();
  await field(row, "quantity").fill(quantity);
  await row.locator('button[type="submit"]').click();
  const message = row.locator('[role="status"], [role="alert"]').first();
  await message.waitFor();
  return { message: await text(message), row: await text(row) };
}

const earnings = (page) => page.getByRole("complementary", { name: "Lo que usted recibe" });

/** Fills a new listing (category by the label its group starts with) and reads the fee preview for a payment method. */
async function fillNewListing(
  page,
  { title, group, bullets, price, weight, length, width, height, method },
) {
  await field(page, "title").fill(title);
  const category = await field(page, "categorySlug")
    .locator(`optgroup[label^="${group}"] option`)
    .first()
    .getAttribute("value");
  await field(page, "categorySlug").selectOption(category);
  await field(page, "bullets").fill(bullets);
  await field(page, "price").fill(price);
  await field(page, "weightGrams").fill(weight);
  await field(page, "lengthCm").fill(length);
  await field(page, "widthCm").fill(width);
  await field(page, "heightCm").fill(height);
  await earnings(page).locator("select").selectOption(method);
  return text(earnings(page).locator("dl"));
}

/** «Enviar a revisión», and waits for the product list. */
async function sendNewListing(page) {
  await button(page, "Enviar a revisión").click();
  await page.waitForURL((u) => new URL(u).pathname === "/productos");
}

/** The last row of the list that shows `value` (a title), as one line. */
const lastRowWith = (page, value) => text(withValue(main(page).locator("tbody tr"), value).last());

/** Announces an inbound shipment of the first product to the warehouse; returns its line once listed. */
async function announceInbound(page, quantity) {
  await main(page).locator('input[name^="qty:"]').first().fill(quantity);
  await button(main(page), "Registrar envío").click();
  const line = withValue(main(page).locator("li"), "IN-").first();
  await line.waitFor();
  return text(line);
}

/** The balances on Pagos, as one line. */
const balancesText = (page) => text(testid(main(page), "balances"));

// Pedidos: packing

const toPack = (page) =>
  main(page).getByRole("region", { name: "Por empacar" }).locator(":scope > ul > li");

/** How many parcels wait to be packed. */
const parcelsToPack = (page) => toPack(page).count();

/** The first parcel to pack, as one line. */
const firstParcelToPack = (page) => text(toPack(page).first());

/** Packs the first parcel with its weight. */
async function packFirstParcel(page, grams) {
  await field(toPack(page).first(), "weightGrams").fill(grams);
  await toPack(page).first().locator('button[type="submit"]').click();
  await page.waitForTimeout(1500);
}

/** «Por empacar», as one line (or "" once there is none). */
const toPackText = async (page) => {
  const region = main(page).getByRole("region", { name: "Por empacar" });
  return (await region.count()) ? text(region) : "";
};

/** How many rows «Ventas recientes» has. */
const salesRows = (page) =>
  main(page).getByRole("region", { name: "Ventas recientes" }).locator("tbody tr").count();

// Registro: a new seller

/** Creates the account on /registro and waits for the shop's details. */
async function registerAccount(page, { name, email, password }) {
  await field(main(page), "fullName").fill(name);
  await field(main(page), "email").fill(email);
  await field(main(page), "password").fill(password);
  await field(main(page), "acepta").check();
  await button(main(page), "Crear cuenta").click();
  await main(page).getByRole("heading", { level: 2, name: "Datos de la tienda" }).waitFor();
}

/** Fills the shop's details (without the declaration). */
async function fillShopDetails(
  page,
  { tradeName, idNumber, legalName, fiscalAddress, contactPhone },
) {
  await field(page, "tradeName").fill(tradeName);
  await field(page, "idNumber").fill(idNumber);
  await field(page, "legalName").fill(legalName);
  await field(page, "fiscalAddress").fill(fiscalAddress);
  await field(page, "contactPhone").fill(contactPhone);
}

/** «Enviar solicitud». */
const sendShopRequest = (page) => button(main(page), "Enviar solicitud").click();

/** Ticks the declaration. */
const declare = (page) => field(page, "declara").check();

/** Waits for a new shop's dashboard: the home page, headed by the shop's name. */
async function waitForShopDashboard(page, shopName) {
  await page.waitForURL((u) => new URL(u).pathname === "/");
  await page.getByRole("heading", { level: 1, name: shopName }).waitFor();
}

/** The status messages of main, each as one line. */
const statusMessages = async (page) =>
  (await main(page).getByRole("status").allInnerTexts()).map(kit.squash);

/** The first sub-heading of main (h2 or h3), as one line. */
const firstSubheading = (page) =>
  text(
    main(page)
      .getByRole("heading", { level: 2 })
      .or(main(page).getByRole("heading", { level: 3 }))
      .first(),
  );

Object.assign(module.exports, {
  sectionsNav,
  firstSection,
  section,
  shopOptions,
  switchShop,
  tableRows,
  tableRow,
  raiseFirstPrice,
  badRegularPrice,
  sectionHeadings,
  setFirstStock,
  fillNewListing,
  sendNewListing,
  lastRowWith,
  announceInbound,
  balancesText,
  parcelsToPack,
  firstParcelToPack,
  packFirstParcel,
  toPackText,
  salesRows,
  registerAccount,
  fillShopDetails,
  sendShopRequest,
  declare,
  waitForShopDashboard,
  statusMessages,
  firstSubheading,
});

// ── Inventario: the history in full and the warehouse table ────────────────

/** The first entries of the stock history, each as one line. */
const historyEntries = async (page) =>
  (await stockHistory(page).getByRole("listitem").allInnerTexts()).map(kit.squash);

/** How many history entries there are, and how many of them carry a kind. */
async function historyKinds(page) {
  return {
    entries: await stockHistory(page).getByRole("listitem").count(),
    withKind: await stockHistory(page).locator("li[data-kind]").count(),
  };
}

/** The cells of the row of «En la bodega de Yuntera» that shows this product code. */
const warehouseRowCells = (page, sku) =>
  withValue(main(page).getByRole("region", { name: "En la bodega de Yuntera" }).locator("tr"), sku)
    .first()
    .locator("td")
    .allInnerTexts();

Object.assign(module.exports, { historyEntries, historyKinds, warehouseRowCells });

// ── Listings shared between shops: offers, variants, draft, the shop front ─

/** From Productos, «Vender uno que ya existe»; waits for the search page. */
async function openOfferSearch(page) {
  await open(page, "/productos");
  await link(main(page), "Vender uno que ya existe").click();
  await page.waitForURL((u) => new URL(u).pathname === "/productos/ofrecer");
}

/** A product found to offer, by its title (data). */
const offerMatch = (page, title) => withValue(main(page).getByRole("listitem"), title).first();

/** Searches the catalogue for a product to offer; returns the result with this title, as one line. */
async function searchToOffer(page, words, title) {
  await field(main(page), "q").fill(words);
  await button(main(page), "Buscar", true).click();
  await offerMatch(page, title).waitFor();
  return text(offerMatch(page, title));
}

/**
 * Adds the shop's offer on a product found (the search page open now):
 * price, who keeps it (seller, platform), handling days; waits for the answer.
 */
async function addOffer(page, title, { price, fulfillment, handlingDays }) {
  const form = main(page)
    .getByRole("form", { name: `Su oferta: ${title}` })
    .first();
  await field(form, "price").fill(price);
  await field(form, "fulfillment").selectOption(fulfillment);
  if (handlingDays !== undefined) await field(form, "handlingDays").fill(handlingDays);
  await button(form, "Agregar mi oferta").click();
  return kit.waitForMessage(main(page), "Agregamos su oferta", { roles: "status" });
}

/** Sets the stock on hand of a product on Inventario (its row by title); returns the row's answer. */
async function setStockOf(page, title, units) {
  await open(page, "/inventario");
  const row = productRow(page, title);
  await field(row, "quantity").fill(String(units));
  await row.locator('button[type="submit"]').click();
  const answer = row.getByRole("status").or(row.getByRole("alert")).first();
  await answer.waitFor();
  return text(answer);
}

/** A product's row in the list: as one line, how many «Editar» links, and whether it says what the shop may change. */
async function sharedRow(page, title) {
  const row = productRow(page, title);
  return {
    text: await text(row),
    edits: await row.getByRole("link", { name: "Editar" }).count(),
    saysWhatChanges: (await text(row)).includes("Usted cambia su precio y sus existencias"),
  };
}

/** How many rows of the list show this product (data). */
const productRows = (page, title) => main(page).getByRole("row", { name: title }).count();

/** Opens a row's edit page from the list (row by title or variant, data) and waits for it; returns its address. */
async function openEditOf(page, rowName) {
  await link(productRow(page, rowName), "Editar").click();
  await page.waitForURL((u) => /^\/productos\/[0-9a-f-]{36}$/.test(new URL(u).pathname));
  await main(page).getByRole("heading", { level: 1 }).first().waitFor();
  return page.url();
}

/** The address of a row's edit page, without opening it. */
const editAddressOf = async (page, rowName) =>
  BASE + (await link(productRow(page, rowName), "Editar").getAttribute("href"));

/** Opens the price form of a row in the list and puts the offer on sale or in pause. */
async function setOfferSale(page, title, status) {
  const row = productRow(page, title);
  await row.locator("summary").click();
  const form = row.locator("form").filter({ has: page.locator('select[name="status"]') });
  await field(form, "status").selectOption(status);
  await button(form, "Guardar", true).click();
  await form.getByRole("status").first().waitFor();
}

/** Stops selling another shop's product for good, from the row's price form. */
async function stopSelling(page, title) {
  const row = productRow(page, title);
  await row.locator("summary").click();
  const form = row.getByRole("form", { name: "Dejar de vender" });
  await field(form, "confirma").check();
  await button(form, "Dejar de vender este producto").click();
  await kit.waitForMessage(row, "Dejó de venderlo", { roles: "status" });
}

const variants = (page) => main(page).getByRole("region", { name: "Variantes a la venta" });

/** A variant's line on the edit page (by its name, data). */
const variantLine = (page, name) => withValue(variants(page).getByRole("listitem"), name).first();

/** Waits for the edit page's variants. */
const waitForVariants = (page) => variants(page).waitFor();

/** A variant's line, as one line. */
const variantText = (page, name) => text(variantLine(page, name));

/** «Retirar» a variant and waits for the answer; returns the line. */
async function retireVariant(page, name) {
  const line = variantLine(page, name);
  await button(line, "Retirar la variante").click();
  await kit.waitForMessage(line, "Variante retirada", { roles: "status" });
  return text(line);
}

/** «Volver a ofrecer» a variant and waits for the answer. */
async function offerVariantAgain(page, name) {
  const line = variantLine(page, name);
  await button(line, "Volver a ofrecer").click();
  await kit.waitForMessage(line, "a la venta otra vez", { roles: "status" });
}

const draftBox = (page) => main(page).getByRole("region", { name: "Volver a borrador" });

/** Waits for the edit page's «Volver a borrador» box. */
const waitForDraftBox = (page) => draftBox(page).waitFor();

/** The «Volver a borrador» box: as one line, and how many buttons to go back it offers. */
async function draftBoxState(page) {
  return {
    text: await text(draftBox(page)),
    buttons: await draftBox(page).getByRole("button", { name: "Volver a borrador" }).count(),
  };
}

/** Takes a published listing back to draft; returns the page's answer. */
async function backToDraft(page) {
  await field(draftBox(page), "confirma").check();
  await button(draftBox(page), "Volver a borrador").click();
  return kit.waitForMessage(main(page), "Volvió a borrador", { roles: "status" });
}

/** The first status line of the edit page, as one line. */
const editStatus = (page) => text(main(page).getByRole("status").first());

/** «Guardar y enviar a revisión» on a draft, and waits for the page to say it is in review. */
async function sendDraftForReview(page) {
  await button(main(page), "Guardar y enviar a revisión").click();
  await settledText(main(page), /En revisión; todavía no está publicado/, {
    what: "the edit page",
  });
}

/** Types a package weight in grams in the edit form. */
const typeWeight = (page, grams) => field(main(page), "weightGrams").fill(grams);

/** Waits for the edit form's weight field. */
const waitForWeight = (page) => field(main(page), "weightGrams").waitFor();

const descriptionBox = (page) =>
  main(page).getByRole("region", { name: "Descripción", exact: true });
const logoBox = (page) => main(page).getByRole("region", { name: "Logotipo", exact: true });

/** Sends a new shop description to review from Tienda and waits for the page to say so. */
async function sendDescription(page, description) {
  await open(page, "/tienda");
  await field(descriptionBox(page), "description", "textarea").fill(description);
  await button(descriptionBox(page), "Enviar a revisión").click();
  await settledText(descriptionBox(page), /Descripción nueva en revisión/, { what: "Tienda" });
}

/** Asks to remove the description and waits for the page to say so; tells whether the field is still required. */
async function removeDescription(page) {
  await open(page, "/tienda");
  await button(descriptionBox(page), "Quitar la descripción").click();
  await settledText(descriptionBox(page), /Pidió quitar la descripción/, { what: "Tienda" });
  return (
    (await field(descriptionBox(page), "description", "textarea").getAttribute("required")) !== null
  );
}

/** Uploads a logo (a JPEG buffer) and waits for it to go to review. */
async function uploadLogo(page, buffer) {
  await testid(logoBox(page), "logo-file").setInputFiles({
    name: "logo-sendero.jpg",
    mimeType: "image/jpeg",
    buffer,
  });
  await kit.waitForMessage(logoBox(page), "Enviamos el logotipo a revisión", {
    roles: "status",
    timeout: 30000,
  });
}

/** Opens Tienda and waits until it says the logo is in review. */
async function waitForLogoInReview(page) {
  await open(page, "/tienda");
  await settledText(logoBox(page), /Logotipo en revisión/, { what: "Tienda" });
}

/** The offers paused for their price, as one line. */
const pausedOffers = (page) => text(testid(main(page), "paused-offers"));

Object.assign(module.exports, {
  openOfferSearch,
  searchToOffer,
  addOffer,
  setStockOf,
  sharedRow,
  productRows,
  openEditOf,
  editAddressOf,
  setOfferSale,
  stopSelling,
  waitForVariants,
  variantText,
  retireVariant,
  offerVariantAgain,
  waitForDraftBox,
  draftBoxState,
  backToDraft,
  editStatus,
  sendDraftForReview,
  typeWeight,
  waitForWeight,
  sendDescription,
  removeDescription,
  uploadLogo,
  waitForLogoInReview,
  pausedOffers,
});

// ── Product photos: the queue, the photos of a listing, rejected ones ─────

/** Fills the new-listing form's basics (category: the first in the group whose label starts so). */
async function fillListingBasics(
  page,
  { title, group, bullets, price, weight, length, width, height },
) {
  await field(page, "title").fill(title);
  const category = await field(page, "categorySlug")
    .locator(`optgroup[label^="${group}"] option`)
    .first()
    .getAttribute("value");
  await field(page, "categorySlug").selectOption(category);
  await field(page, "bullets").fill(bullets);
  await field(page, "price").fill(price);
  await field(page, "weightGrams").fill(weight);
  await field(page, "lengthCm").fill(length);
  await field(page, "widthCm").fill(width);
  await field(page, "heightCm").fill(height);
}

const queued = (page) => main(page).locator("[data-queued-photo]");
const photos = (page) => main(page).locator("[data-photo]");
const rejectedPhotos = (page) => main(page).locator("[data-rejected-photo]");

/** Chooses files with «Elegir fotos» (each { name, mimeType, buffer }). */
const choosePhotos = (page, files) =>
  main(page).locator('input[type="file"][multiple]').setInputFiles(files);

/** Waits for the files refused and returns what the page says about them. */
const refusedPhotos = (page) =>
  kit.waitForMessage(main(page), "no se pudieron agregar", { roles: "alert" });

/** Waits for the page to say a file chosen again is already in the list. */
const waitForAlreadyQueued = (page) =>
  kit.waitForMessage(main(page), "ya está en la lista", { roles: "alert" });

/** How many photos wait in the queue to be uploaded. */
const queuedCount = (page) => queued(page).count();

/** Waits until `n` photos wait in the queue; returns the first, as one line. */
async function waitForQueued(page, n) {
  await queued(page)
    .nth(n - 1)
    .waitFor();
  return text(queued(page).first());
}

/** Types the alternative text of the n-th queued photo (from 1). */
const typeQueuedAlt = (page, n, alt) =>
  main(page).getByLabel(`Texto alternativo de la foto nueva ${n}`).fill(alt);

/** «Guardar como borrador» with photos that have no text: the first error under them. */
async function saveDraftRefused(page) {
  await button(main(page), "Guardar como borrador").click();
  const error = queued(page).getByRole("alert").first();
  await error.waitFor();
  return text(error);
}

/** «Guardar como borrador», and waits for the product list; returns what it says. */
async function saveDraft(page) {
  await button(main(page), "Guardar como borrador").click();
  await page.waitForURL((u) => new URL(u).pathname === "/productos", { timeout: 30000 });
  return kit.statusText(page);
}

/** How many photos the listing has (approved, waiting or leaving). */
const photoCount = (page) => photos(page).count();

/** The n-th photo of the listing (from 0): as one line, its typed text and its id. */
async function photoAt(page, n) {
  const photo = photos(page).nth(n);
  return {
    text: await text(photo),
    alt: await photo.locator("input").inputValue(),
    id: await photo.getAttribute("data-photo"),
  };
}

/** The first photo's preview: its address and whether it loads (waits up to 20 s). */
async function firstPhotoPreview(page) {
  const img = photos(page).first().locator("img");
  return {
    src: await img.getAttribute("src"),
    loads: await img.evaluate(
      (el) =>
        new Promise((resolve) => {
          const done = () => resolve(el.complete && el.naturalWidth > 0);
          if (el.complete) done();
          else {
            el.addEventListener("load", done, { once: true });
            el.addEventListener("error", done, { once: true });
            setTimeout(done, 20000);
          }
        }),
    ),
  };
}

/** The photos refused, each as one line (with these words, data, if given: waits for one). */
async function rejectedPhotoTexts(page, words) {
  if (words) await withValue(rejectedPhotos(page), words).first().waitFor();
  return (await rejectedPhotos(page).allInnerTexts()).map(kit.squash);
}

/** «Quitar de la lista» on the first refused photo, and waits for it to go. */
async function dismissRejectedPhoto(page) {
  await button(rejectedPhotos(page).first(), "Quitar de la lista").click();
  await rejectedPhotos(page).first().waitFor({ state: "detached" });
}

/** «Subir n fotos», and waits until the listing shows `total` photos. */
async function uploadQueued(page, n, total) {
  await button(main(page), `Subir ${n} fotos`).click();
  await kit.findMessage(main(page), "Fotos subidas", { roles: "status", timeout: 30000 });
  await photos(page)
    .nth(total - 1)
    .waitFor();
}

/** Types the alternative text of the n-th photo of the listing (from 1). */
const typePhotoAlt = (page, n, alt) =>
  main(page).getByLabel(`Texto alternativo de la foto ${n}`, { exact: true }).fill(alt);

/** The alternative text the n-th photo's field holds (from 1). */
const photoAltTyped = (page, n) =>
  main(page).getByLabel(`Texto alternativo de la foto ${n}`, { exact: true }).inputValue();

/** «Quitar la foto n», and waits for it to be listed as leaving. */
async function removePhotoAt(page, n) {
  await button(main(page), `Quitar la foto ${n}`).click();
  await kit.findMessage(main(page), "se quitará cuando aprobemos", { roles: "status" });
  await main(page).locator("[data-leaving-photo]").first().waitFor();
}

/** «Deshacer» the changes not saved yet. */
const undoPhotoChanges = (page) => button(main(page), "Deshacer", true).click();

/** The edit page's «Fotos» section, as one line. */
const photosSection = (page) =>
  text(main(page).getByRole("region", { name: "Fotos", exact: true }));

Object.assign(module.exports, {
  fillListingBasics,
  choosePhotos,
  refusedPhotos,
  waitForAlreadyQueued,
  queuedCount,
  waitForQueued,
  typeQueuedAlt,
  saveDraftRefused,
  saveDraft,
  photoCount,
  photoAt,
  firstPhotoPreview,
  rejectedPhotoTexts,
  dismissRejectedPhoto,
  uploadQueued,
  typePhotoAlt,
  photoAltTyped,
  removePhotoAt,
  undoPhotoChanges,
  photosSection,
});
