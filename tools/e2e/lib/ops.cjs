// Screen steps of the staff console (apps/ops): everything a journey finds, clicks,
// fills or reads there. Journey files call these and keep the flow, the
// checks on data and the size checks. The app's builder keeps this file
// passing when the screens change (rule 20.5.4 of docs/brand/system/SISTEMA.md).
//
// How things are found (rule 20.5.1): by role and accessible name, by
// [name=…] for a form field, or by data-testid. Never by a CSS class, never
// by a text match on a container (kit.withValue matches a data value only).

const { settledText } = require("./settle.cjs");
const kit = require("./kit.cjs");
const { word } = require("./words.cjs");
const { text, main, field, button, link, testid, withValue, fillSignIn } = kit;

const BASE = process.env.OPS_URL || "http://127.0.0.1:3002";
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

// ── Orders ─────────────────────────────────────────────────────────────────

/** Opens an order's page in the console. */
const openOrder = (page, number, waitUntil = "networkidle") =>
  open(page, `/pedidos/${number}`, waitUntil);

/** The «← Pedidos» link at the top of an order page (for its size). */
const backToOrders = (page) => link(page, "← Pedidos").first();

Object.assign(module.exports, { openOrder, backToOrders });

// ── Operación › Cierres ────────────────────────────────────────────────────

const openClosures = (page) => open(page, "/operacion/cierres");

/** Closes a zone from «Cerrar una zona»; returns the form's outcome. */
async function saveClosure(page, { zone, startsOn, endsOn, reason }) {
  const form = main(page).getByRole("region", { name: "Cerrar una zona" });
  await field(form, "zoneId").selectOption(zone);
  await field(form, "startsOn").fill(startsOn);
  await field(form, "endsOn").fill(endsOn);
  await field(form, "reason", "select").selectOption(reason);
  return kit.submitAndRead(page, form, "Guardar el cierre");
}

/** The first closure listed under «Cierres en curso y por venir». */
const firstClosure = (page) =>
  main(page)
    .getByRole("region", { name: "Cierres en curso y por venir" })
    .locator("li[data-closure]")
    .first();

/** Ends the first listed closure now; returns the outcome. */
async function endFirstClosure(page) {
  const row = firstClosure(page);
  await testid(row, "closure-end-now").click();
  return kit.submitAndRead(page, row, "Terminar el cierre");
}

const singleDays = (page) => main(page).getByRole("region", { name: "Días cerrados uno por uno" });

/** Waits until «Días cerrados uno por uno» lists `count` days. */
const waitForSingleDays = (page, count) =>
  settledText(
    singleDays(page).getByRole("heading", { level: 2 }),
    `Días cerrados uno por uno (${count})`,
    {
      what: "the single days' heading",
    },
  );

/** The first day closed on its own. */
const firstSingleDay = (page) => singleDays(page).getByRole("listitem").first();

/** Opens the controls of a single day (its «Abrir el …» disclosure). */
const showSingleDay = (day) => day.locator("summary").click();

/** Opens a single day again; returns the outcome. */
async function reopenSingleDay(page, day) {
  await showSingleDay(day);
  return kit.submitAndRead(page, day, "Abrir ese día");
}

/** How many «Días cerrados uno por uno» sections the page shows (0 when there is none). */
const singleDaysShown = (page) => singleDays(page).count();

Object.assign(module.exports, {
  openClosures,
  saveClosure,
  firstClosure,
  endFirstClosure,
  waitForSingleDays,
  firstSingleDay,
  showSingleDay,
  reopenSingleDay,
  singleDaysShown,
});

// ── Catálogo ───────────────────────────────────────────────────────────────

const openCatalogue = (page, path, waitUntil = "networkidle") =>
  open(page, `/catalogo${path}`, waitUntil);

/** The names of the catalogue's sub-pages, as its navigation lists them. */
const catalogueNav = (page) =>
  page.getByRole("navigation", { name: "Catálogo" }).getByRole("link").allInnerTexts();

/** What the page says at its top once the form that did something is gone (CatalogueOutcome). */
const pageOutcome = (page, expected) =>
  kit.textOnceIncludes(page.locator("[data-catalogue-outcome]"), expected);

// Categorías

const newCategoryForm = (page) => main(page).getByRole("region", { name: "Nueva categoría" });

/** Types a name in «Nueva categoría» (and picks a parent, by its name, if given) and creates it; returns the outcome. */
async function createCategory(page, name, { parent } = {}) {
  const form = newCategoryForm(page);
  await field(form, "name").fill(name);
  if (parent) {
    const value = await withValue(field(form, "parentId").locator("option"), parent)
      .first()
      .getAttribute("value");
    await field(form, "parentId").selectOption(value);
  }
  return kit.submitInForm(page, form, "Crear categoría");
}

/** Empties the name field of «Nueva categoría». */
const clearNewCategory = (page) => field(newCategoryForm(page), "name").fill("");

/** A category's row in the tree, by its address (slug). */
const categoryRow = (page, slug) => page.locator(`li[data-category="${slug}"]`);

/** Opens the «Cambiar …» part of a category's row. */
const openCategoryChange = (page, slug) =>
  testid(categoryRow(page, slug), "category-change").first().click();

/** Moves a category under another (chosen by its name); returns the outcome. */
async function moveCategory(page, slug, parentLabel) {
  const form = categoryRow(page, slug)
    .locator("form")
    .filter({ has: page.locator('select[name="parentId"]') });
  await field(form, "parentId").selectOption({ label: parentLabel });
  return kit.submitInForm(page, form, "Mover");
}

/** Renames a category and its address; returns the outcome, read on the row at its new address. */
async function renameCategory(page, slug, { name, newSlug }) {
  const form = categoryRow(page, slug)
    .locator("form")
    .filter({ has: page.locator('input[name="slug"]') });
  await field(form, "name").fill(name);
  await field(form, "slug").fill(newSlug);
  const moved = categoryRow(page, newSlug)
    .locator("form")
    .filter({ has: page.locator('input[name="slug"]') });
  return kit.submitInForm(page, form, "Guardar nombre y dirección", moved);
}

/** Hides a category from the shop (its row's «Cambiar» part already open or not) and waits for «Mostrar en la tienda». */
async function hideCategory(page, slug, { opened = false } = {}) {
  const row = categoryRow(page, slug);
  if (!opened) await openCategoryChange(page, slug);
  await testid(row, "category-hide").click();
  await button(row, "Ocultar la categoría").click();
  await button(row, "Mostrar en la tienda").waitFor();
}

/** What a category's row says about whether the shop shows it («Oculta», «Se ve en la tienda»…). */
const categoryVisibility = (page, slug) =>
  text(testid(categoryRow(page, slug), "category-visibility").first());

/** How many rows the tree has for this address (1 when the category exists). */
const categoryRows = (page, slug) => categoryRow(page, slug).count();

/** The create form of «Nueva categoría», as a page without scripts gets it: its method and whether it posts to an action. */
const newCategoryFormMarkup = (page) =>
  newCategoryForm(page)
    .locator("form")
    .evaluate((f) => ({
      method: f.method,
      action: [...f.querySelectorAll('input[type="hidden"]')].some((i) =>
        i.name.startsWith("$ACTION"),
      ),
    }));

/** Creates a category on a page without scripts: the browser posts the form itself. */
async function createCategoryWithoutScripts(page, name) {
  const form = newCategoryForm(page).locator("form");
  await field(form, "name").fill(name);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    button(form, "Crear categoría").click(),
  ]);
}

/** Signs in on a page whose scripts never load: the browser posts the form and loads the next page. */
async function signInWithoutScripts(page, email, password = PASSWORD) {
  await open(page, "/ingresar", "load");
  await field(main(page), "email").fill(email);
  await field(main(page), "password").fill(password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    button(main(page), "Ingresar", true).click(),
  ]);
}

// Productos

/** The first sub-heading of the product found (its name), as one line. */
const productFound = (page) => text(main(page).getByRole("heading", { level: 2 }).first());

const correctionForm = (page) =>
  main(page).getByRole("region", { name: "Corregir categoría y marca" });

/** Corrects a product's category (chosen by its name) with a reason; returns the outcome. */
async function correctCategory(page, categoryName, note) {
  const form = correctionForm(page);
  const value = await withValue(
    field(form, "categoryId").locator("option"),
    categoryName,
  ).getAttribute("value");
  await field(form, "categoryId").selectOption(value);
  await field(form, "note", "textarea").fill(note);
  return kit.submitInForm(page, form, "Guardar la corrección");
}

/** Waits until the product page says the product is in this category (by its address). */
const waitForCurrentCategory = (page, slug) =>
  main(page).locator(`dd[data-current-category="${slug}"]`).waitFor();

// Marcas

const brandRow = (page, slug) => page.locator(`li[data-brand="${slug}"]`);

/** Merges a brand into another (chosen by its name) from the brand's row. */
async function mergeBrand(page, slug, intoLabel) {
  const row = brandRow(page, slug);
  await testid(row, "brand-change").click();
  await testid(row, "brand-merge").click();
  const form = row.locator("form").filter({ has: page.locator('select[name="intoId"]') });
  await field(form, "intoId").selectOption({ label: intoLabel });
  await button(form, "Unir").click();
}

/** The row of a brand under «Unidas a otra marca», by its name, once it is there. */
async function mergedBrand(page, name) {
  const row = withValue(
    main(page).getByRole("region", { name: "Unidas a otra marca" }).getByRole("listitem"),
    name,
  );
  await row.waitFor();
  return text(row);
}

// Búsqueda

/** What the search preview of «Probar una búsqueda» says. */
const searchPreview = (page) => text(testid(page, "search-preview"));

const synonymForm = (page) => main(page).getByRole("region", { name: "Nuevo sinónimo" });

/** Adds a synonym; returns the outcome. With `term` left out, only the expansions are typed again. */
async function addSynonym(page, { term, expansions }) {
  const form = synonymForm(page);
  if (term !== undefined) await field(form, "term").fill(term);
  await field(form, "expansions", "textarea").fill(expansions);
  return kit.submitInForm(page, form, "Agregar sinónimo");
}

// Reseñas

/** A review's card, by what it is about (a product name from the seed). */
const reviewCard = (page, product) => withValue(main(page).locator("li[data-review]"), product);

/** Opens «Ocultar la reseña» on a card and tells whether a reason must be chosen first. */
async function openHideReview(card) {
  await testid(card, "review-hide").click();
  const reason = field(card, "reason", "select");
  return reason.evaluate((select) => select.required && select.value === "");
}

/** Hides a review with a reason, and waits for «Mostrar la reseña de nuevo». */
async function hideReview(card, reason) {
  await field(card, "reason", "select").first().selectOption(reason);
  await button(card, "Ocultar la reseña").click();
  await button(card, "Mostrar la reseña de nuevo").waitFor();
}

/** Shows a hidden review again and waits for it to leave the list. */
async function showReview(card) {
  await button(card, "Mostrar la reseña de nuevo").click();
  await card.waitFor({ state: "detached" });
}

Object.assign(module.exports, {
  openCatalogue,
  catalogueNav,
  pageOutcome,
  createCategory,
  clearNewCategory,
  openCategoryChange,
  moveCategory,
  renameCategory,
  hideCategory,
  categoryVisibility,
  categoryRows,
  newCategoryFormMarkup,
  createCategoryWithoutScripts,
  signInWithoutScripts,
  productFound,
  correctCategory,
  waitForCurrentCategory,
  mergeBrand,
  mergedBrand,
  searchPreview,
  addSynonym,
  reviewCard,
  openHideReview,
  hideReview,
  showReview,
});

// ── Operación › Feriados, Distritos, Ajustes ───────────────────────────────

/** A holiday's row on Operación › Feriados, as one line. */
const holidayRow = (page, day) => text(page.locator(`li[data-holiday="${day}"]`));

const holidayForm = (page) => main(page).getByRole("region", { name: "Agregar un feriado" });

/** Fills «Agregar un feriado», ticks its confirmation and sends it; returns the outcome. */
async function addHoliday(page, { day, name }) {
  const form = holidayForm(page);
  await field(form, "day").fill(day);
  await field(form, "name").fill(name);
  await field(form, "confirm").check();
  return kit.submitAndRead(page, form, "Agregar el feriado");
}

/** Whether the holiday form's confirmation box is ticked. */
const holidayConfirmTicked = (page) => field(holidayForm(page), "confirm").isChecked();

/** «Revisar el cambio» on Operación › Distritos; returns the message about what is missing. */
async function reviewDistrictChange(page) {
  await button(page, "Revisar el cambio").click();
  await page.waitForLoadState("networkidle");
  return kit.messageWith(page, "Elija");
}

const districtBox = (page, code) =>
  page.locator(`li[data-district="${code}"] input[type="checkbox"]`);

/** Ticks a district on Operación › Distritos. */
const chooseDistrict = (page, code) => districtBox(page, code).check();

/** Whether a district is ticked on Operación › Distritos. */
const districtChosen = (page, code) => districtBox(page, code).isChecked();

const settingRow = (page, key) => page.locator(`li[data-setting="${key}"]`);

/** Opens a setting's change form, types a value, ticks the confirmation and sends it; returns the outcome. */
async function changeSetting(page, key, value) {
  const row = settingRow(page, key);
  await row.locator("summary").click();
  await field(row, "value").fill(value);
  await field(row, "confirm").check();
  return kit.submitAndRead(page, row, "Guardar el nuevo valor");
}

/** What a setting's form holds now: its value and whether the confirmation is ticked. */
async function settingForm(page, key) {
  const row = settingRow(page, key);
  return {
    value: await field(row, "value").inputValue(),
    confirmed: await field(row, "confirm").isChecked(),
  };
}

// ── Despacho and the order page ────────────────────────────────────────────

/** A route's card on Despacho, by its code, as one line. */
const dispatchRouteCard = (page, code) =>
  text(
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { level: 3, name: code, exact: true }) }),
  );

/** The «Paquetes» section of the console's order page, as one line. */
const orderParcels = (page) => text(main(page).getByRole("region", { name: "Paquetes" }));

/** The «Historial» section of the console's order page, as one line. */
const orderHistory = (page) => text(main(page).getByRole("region", { name: "Historial" }));

// ── Catálogo › Marcas: create and delete ───────────────────────────────────

/** Creates a brand from «Nueva marca»; returns the outcome. */
async function createBrand(page, name) {
  const form = main(page).getByRole("region", { name: "Nueva marca" });
  await field(form, "name").fill(name);
  return kit.submitAndRead(page, form, "Crear marca");
}

/** Opens a brand's «Cambiar» part. */
const openBrandChange = (page, slug) => testid(brandRow(page, slug), "brand-change").click();

/** Opens «Eliminar la marca» on a brand's row; returns the warning it gives. */
async function openBrandDeletion(page, slug) {
  const row = brandRow(page, slug);
  await testid(row, "brand-delete").click();
  return text(row.locator("details[open] details[open] p"));
}

/** Deletes a brand whose deletion is open; returns the outcome. */
const deleteBrand = (page, slug, name) =>
  kit.submitAndRead(page, brandRow(page, slug), `Eliminar «${name}»`);

/** How many «Eliminar la marca» a brand's row offers (0 for a brand with products). */
const brandDeletionOffered = (page, slug) => testid(brandRow(page, slug), "brand-delete").count();

/** A brand's row, as one line. */
const brandRowText = (page, slug) => text(brandRow(page, slug));

/** How many rows the brand list has for this address (0 once deleted). */
const brandRows = (page, slug) => brandRow(page, slug).count();

Object.assign(module.exports, {
  holidayRow,
  addHoliday,
  holidayConfirmTicked,
  reviewDistrictChange,
  chooseDistrict,
  districtChosen,
  changeSetting,
  settingForm,
  dispatchRouteCard,
  orderParcels,
  orderHistory,
  createBrand,
  openBrandChange,
  openBrandDeletion,
  deleteBrand,
  brandDeletionOffered,
  brandRowText,
  brandRows,
});

// ── Operación: the section and its zones ───────────────────────────────────

/** The pages of the Operación section, as its navigation lists them. */
const operationsNav = (page) =>
  page.getByRole("navigation", { name: "Operación" }).getByRole("link").allInnerTexts();

/** How many links to /operacion the console's header has. */
const headerOperationsLinks = (page) =>
  page.getByRole("banner").locator('a[href="/operacion"]').count();

/** A delivery zone's row on Operación, by its id. */
const zoneRow = (page, id) => page.locator(`li[data-zone="${id}"]`);

/** Opens «Apagar la zona» on a zone's row; returns the warning it gives. */
async function openZoneSwitchOff(page, id) {
  const row = zoneRow(page, id);
  await testid(row, "zone-switch-off").click();
  return text(row.locator("details[open] p").first());
}

/** «Apagar la zona» on an open switch-off; waits for «Encender la zona». Returns the outcome. */
async function switchZoneOff(page, id) {
  const outcome = await kit.submitAndRead(page, zoneRow(page, id), "Apagar la zona");
  await button(zoneRow(page, id), "Encender la zona").waitFor();
  return outcome;
}

/** «Encender la zona»; returns the outcome. */
const switchZoneOn = (page, id) => kit.submitAndRead(page, zoneRow(page, id), "Encender la zona");

/** How many «Encender la zona» a zone's row offers. */
const zoneSwitchOnOffered = (page, id) => button(zoneRow(page, id), "Encender la zona").count();

const newZoneForm = (page) => main(page).getByRole("region", { name: "Nueva zona" });

/** Fills «Nueva zona» (weekdays left as offered except those in `unticked`) and sends it; returns the outcome. */
async function createZone(page, { id, name, fee, unticked = [] }) {
  const form = newZoneForm(page);
  if (id !== undefined) await field(form, "zoneId").fill(id);
  if (name !== undefined) await field(form, "name").fill(name);
  for (const day of unticked) await weekdayBox(page, day).uncheck();
  await field(form, "shippingFee").fill(fee);
  return kit.submitAndRead(page, form, "Crear zona");
}

/** A weekday box of «Nueva zona» (1 = Monday). */
const weekdayBox = (page, day) =>
  newZoneForm(page).locator(`input[name="deliveryWeekdays"][value="${day}"]`);

/** Whether a weekday is ticked in «Nueva zona». */
const weekdayTicked = (page, day) => weekdayBox(page, day).isChecked();

/** Waits for a zone's row to be listed. */
const waitForZone = (page, id) => zoneRow(page, id).waitFor();

/** A zone's row, as one line. */
const zoneText = (page, id) => text(zoneRow(page, id));

/** Deletes a zone from its row; returns the outcome. */
async function deleteZone(page, id) {
  await testid(zoneRow(page, id), "zone-delete").click();
  return kit.submitAndRead(page, zoneRow(page, id), "Borrar la zona");
}

/** Opens «Cambiar …» on a zone's row. */
const openZoneChange = (page, id) => testid(zoneRow(page, id), "zone-change").click();

/** Types a new name in a zone's open change form. */
const typeZoneName = (page, id, name) => field(zoneRow(page, id), "name").fill(name);

/** «Guardar la zona» without waiting for its message (another person saving). */
async function saveZoneNow(page, id, expectedName) {
  await button(zoneRow(page, id), "Guardar la zona").click();
  await settledText(zoneRow(page, id).getByRole("heading", { level: 3 }), expectedName, {
    what: "the zone's name",
  });
}

/** «Guardar la zona»; returns the outcome. */
const saveZone = (page, id) => kit.submitAndRead(page, zoneRow(page, id), "Guardar la zona");

/** The revision the zone's open form was drawn from. */
const zoneRevision = (page, id) => field(zoneRow(page, id), "revision").first().inputValue();

/** Waits until the zone's form holds another revision than `before`. */
const waitForZoneRevision = (page, id, before) =>
  page.waitForFunction(
    ([zone, old]) =>
      document.querySelector(`li[data-zone="${zone}"] input[name="revision"]`)?.value !== old,
    [id, before],
  );

/** The zone's name (its row's heading) and what its name field holds. */
async function zoneNameShown(page, id) {
  return {
    heading: await text(zoneRow(page, id).getByRole("heading", { level: 3 })),
    typed: await field(zoneRow(page, id), "name").inputValue(),
  };
}

// ── Operación › Distritos: a move previewed and confirmed ──────────────────

/** A district's row, as one line. */
const districtText = (page, code) => text(page.locator(`li[data-district="${code}"]`));

/** Ticks a district, chooses where it goes and asks for the preview. */
async function previewDistrictMove(page, code, destination) {
  await chooseDistrict(page, code);
  await field(page, "destino").selectOption(destination);
  await Promise.all([
    page.waitForURL((u) => new URL(u).searchParams.get("destino") === destination),
    button(page, "Revisar el cambio").click(),
  ]);
  await page.waitForLoadState("networkidle");
}

const reviewBox = (page) => main(page).getByRole("region", { name: "Antes de confirmar" });

/** What the preview «Antes de confirmar» says. */
const districtPreview = (page) => text(reviewBox(page));

/** «Confirmar el cambio» on the preview; returns the outcome. */
const confirmDistrictMove = (page) =>
  kit.submitAndRead(page, reviewBox(page), "Confirmar el cambio");

// ── Operación › Feriados: remove ───────────────────────────────────────────

/** Removes a holiday from its row; returns the outcome. */
async function removeHoliday(page, day) {
  const row = page.locator(`li[data-holiday="${day}"]`);
  await row.locator("summary").click();
  return kit.submitAndRead(page, row, "Quitar el feriado");
}

/** Fills «Agregar un feriado» without ticking its confirmation and sends it; returns the outcome. */
async function tryHoliday(page, { day, name }) {
  const form = holidayForm(page);
  await field(form, "day").fill(day);
  await field(form, "name").fill(name);
  return kit.submitAndRead(page, form, "Agregar el feriado");
}

// ── Operación › Cierres: more ──────────────────────────────────────────────

/** How many closures «Cierres en curso y por venir» lists. */
const openClosureRows = (page) =>
  main(page)
    .getByRole("region", { name: "Cierres en curso y por venir" })
    .locator("li[data-closure]")
    .count();

const cancelledClosures = (page) =>
  main(page).getByRole("region", { name: "Cierres cancelados" }).locator("li[data-closure]");

/** How many closures «Cierres cancelados» lists. */
const cancelledClosureCount = (page) => cancelledClosures(page).count();

/** «Volver a cerrar» on the first cancelled closure; returns the outcome. */
const closeAgain = (page) =>
  kit.submitAndRead(page, cancelledClosures(page).first(), "Volver a cerrar");

// ── Operación › Ajustes: more ──────────────────────────────────────────────

/** A setting's row, as one line. */
const settingText = (page, key) => text(settingRow(page, key));

/** How many inputs, buttons or forms a setting's row has (0 when it is read-only). */
const settingControls = (page, key) => settingRow(page, key).locator("input, button, form").count();

/** Opens a setting's change form, types a value and sends it without the confirmation; returns the outcome. */
async function changeSettingUnconfirmed(page, key, value) {
  const row = settingRow(page, key);
  await row.locator("summary").click();
  await field(row, "value").fill(value);
  return kit.submitAndRead(page, row, "Guardar el nuevo valor");
}

/** In a setting's open form: types a value, ticks the confirmation and sends it; returns the outcome. */
async function confirmSetting(page, key, value) {
  const row = settingRow(page, key);
  await field(row, "value").fill(value);
  await field(row, "confirm").check();
  return kit.submitAndRead(page, row, "Guardar el nuevo valor");
}

// ── Operación › Ubicaciones ────────────────────────────────────────────────

/** Creates a location in a warehouse (by its code); returns the outcome. */
async function createLocation(page, warehouse, { code, kind }) {
  const box = main(page).getByRole("region", { name: warehouse });
  await field(box, "code").first().fill(code);
  await field(box, "kind").selectOption(kind);
  return kit.submitAndRead(page, box, "Crear la ubicación");
}

/** Switches a location off from its row; returns the outcome. */
async function switchLocationOff(page, code) {
  const row = page.locator(`li[data-location="${code}"]`);
  await testid(row, "location-switch-off").click();
  return kit.submitAndRead(page, row, "Desactivar la ubicación");
}

// ── Operación › Rutas detenidas ────────────────────────────────────────────

const routeRow = (page, code) => page.locator(`li[data-route="${code}"]`);

/** A route's row, as one line. */
const routeText = (page, code) => text(routeRow(page, code));

/** How many «Cerrar la ruta» a route's row offers. */
const routeCloseOffered = (page, code) => testid(routeRow(page, code), "route-close").count();

/** Takes a stop off a route with a reason; returns the outcome. */
async function removeStop(page, code, tracking, reason) {
  const stop = routeRow(page, code).locator(`li[data-stop="${tracking}"]`);
  await testid(stop, "stop-remove").click();
  await field(stop, "reason", "textarea").fill(reason);
  return kit.submitAndRead(page, stop, "Quitar la parada");
}

/** Closes a route with a reason; returns the outcome. */
async function closeRoute(page, code, reason) {
  const row = routeRow(page, code);
  await testid(row, "route-close").click();
  await field(row, "reason", "textarea").fill(reason);
  return kit.submitAndRead(page, row, "Cerrar la ruta");
}

/** Despacho's «Listos para salir», as one line. */
const dispatchReady = (page) => text(main(page).getByRole("region", { name: "Listos para salir" }));

Object.assign(module.exports, {
  operationsNav,
  headerOperationsLinks,
  openZoneSwitchOff,
  switchZoneOff,
  switchZoneOn,
  zoneSwitchOnOffered,
  createZone,
  weekdayTicked,
  waitForZone,
  zoneText,
  deleteZone,
  openZoneChange,
  typeZoneName,
  saveZoneNow,
  saveZone,
  zoneRevision,
  waitForZoneRevision,
  zoneNameShown,
  districtText,
  previewDistrictMove,
  districtPreview,
  confirmDistrictMove,
  removeHoliday,
  tryHoliday,
  openClosureCount: openClosureRows,
  cancelledClosureCount,
  closeAgain,
  settingText,
  settingControls,
  changeSettingUnconfirmed,
  confirmSetting,
  createLocation,
  switchLocationOff,
  routeText,
  routeCloseOffered,
  removeStop,
  closeRoute,
  dispatchReady,
});

// ── Operación › Ubicaciones: moves and corrections ─────────────────────────

/** The first entry of «Movimientos y correcciones de existencias» that shows `value`, as one line. */
const stockChange = (page, value) =>
  text(
    withValue(
      main(page)
        .getByRole("region", { name: "Movimientos y correcciones de existencias" })
        .getByRole("listitem"),
      value,
    ).first(),
  );

Object.assign(module.exports, { stockChange });

// ── Atención: returns ──────────────────────────────────────────────────────

/** A return in Atención's «Devoluciones», by its order number. */
const returnCard = (page, order) =>
  withValue(main(page).getByRole("region", { name: "Devoluciones" }).getByRole("listitem"), order);

/** Closes a return whose product never came, with a reason; waits for the outcome only when told. */
async function closeReturnUnarrived(page, order, note, { opened = false } = {}) {
  const card = returnCard(page, order);
  if (!opened) await testid(card, "return-not-arrived").click();
  await field(card, "note", "textarea").fill(note);
  await button(card, "Cerrar sin reembolso").click();
}

/** Waits for the refusal that asks why a return is closed; returns whether the reason typed is kept. */
async function closeReturnRefused(page, order) {
  await settledText(main(page), /Explique al cliente por qué se cierra/, { what: "Atención" });
  return field(returnCard(page, order), "note", "textarea").inputValue();
}

/** Waits for a return to leave the queue. */
const waitForReturnGone = (page, order) => returnCard(page, order).waitFor({ state: "detached" });

/** A return card, as one line. */
const returnCardText = (page, order) => text(returnCard(page, order));

/** How many «Registrar reembolso» a return card offers. */
const refundOffered = (page, order) =>
  button(returnCard(page, order), "Registrar reembolso").count();

/** Records that the returned product reached the warehouse (in this condition) and waits for the refund button. */
async function receiveReturn(page, order, condition) {
  const card = returnCard(page, order);
  await field(card, "condition").selectOption(condition);
  await button(card, "Registrar que llegó a bodega").click();
  await button(main(page), "Registrar reembolso de").first().waitFor();
}

/** Refunds the first return ready for it and waits for the empty queue. */
async function refundFirstReturn(page) {
  await button(main(page), "Registrar reembolso de").first().click();
  await settledText(main(page), /No hay devoluciones pendientes/, { what: "Atención" });
}

// ── The order page: a locked delivery code, a parcel back ──────────────────

/** The alert of a locked delivery code on the order page, once it shows. */
const lockedCodeAlert = (page) =>
  kit.waitForMessage(main(page), "Código de entrega bloqueado", { roles: "alert" });

/** Releases a locked delivery code with a note and waits for the alert to go. */
async function releaseCode(page, note) {
  await field(main(page), "note", "input").fill(note);
  await button(main(page), "Liberar y dar un código nuevo").click();
  // Once released the panel goes away with the lock.
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('main [role="alert"]')].some((el) =>
        el.textContent.includes("Código de entrega bloqueado"),
      ),
  );
}

const firstParcel = (page) =>
  main(page).getByRole("region", { name: "Paquetes" }).getByRole("listitem").first();

/** The first parcel of the order page, as one line. */
const firstParcelText = (page) => text(firstParcel(page));

/** Checks in the first parcel of the order page, returned in this condition; waits for the refund to be noted. */
async function receiveReturnedParcel(page, condition) {
  const parcel = firstParcel(page);
  await field(parcel, "condition").selectOption(condition);
  await button(parcel, "Recibir el paquete devuelto").click();
  // The page redraws: the parcel is back, and the history says the money goes back.
  await settledText(main(page), /le devolvemos lo que pagó/, { what: "the order page" });
}

/** The order page's first header (its number and status), as one line. */
const orderHeader = (page) => text(main(page).locator("header").first());

Object.assign(module.exports, {
  closeReturnUnarrived,
  closeReturnRefused,
  waitForReturnGone,
  returnCardText,
  refundOffered,
  receiveReturn,
  refundFirstReturn,
  lockedCodeAlert,
  releaseCode,
  firstParcelText,
  receiveReturnedParcel,
  orderHeader,
});

// ── Comprobantes ───────────────────────────────────────────────────────────

const rejectedDocuments = (page) =>
  main(page).getByRole("region", { name: "Rechazados por Hacienda" });

/** The first document rejected by Hacienda, as one line, or null when there is none. */
async function firstRejected(page) {
  const row = rejectedDocuments(page).getByRole("listitem").first();
  return (await row.count()) > 0 ? text(row) : null;
}

/** «Emitir reemplazo» on the first rejected document; returns what the new document's page says it replaces. */
async function replaceFirstRejected(page) {
  await button(rejectedDocuments(page).getByRole("listitem").first(), "Emitir reemplazo").click();
  // The new document's own page, which says what it replaces.
  await page.waitForURL(/\/comprobantes\/[0-9a-f-]{36}\?emitido=1$/, { timeout: 20000 });
  return kit.waitForMessage(main(page), "que reemplaza al rechazado", { roles: "status" });
}

/** «Rechazados por Hacienda», as one line. */
const rejectedText = (page) => text(rejectedDocuments(page));

/** Opens a document by its number from the list, and waits for its page. */
async function openDocumentNumbered(page, number, title) {
  await link(main(page), number).first().click();
  await page.waitForURL(/\/comprobantes\/[0-9a-f-]{36}$/);
  await page.getByRole("heading", { level: 1, name: title }).waitFor();
}

/** Waits for «Por día» on Comprobantes. */
const waitForDailyTotals = (page) => main(page).getByRole("region", { name: "Por día" }).waitFor();

Object.assign(module.exports, {
  firstRejected,
  replaceFirstRejected,
  rejectedText,
  openDocumentNumbered,
  waitForDailyTotals,
});

// ── The shell; Cambios de tienda; Repartidores ─────────────────────────────

/** The console's main navigation, as one line. */
const sectionsNav = (page) => text(page.getByRole("navigation", { name: "Secciones" }));

const changeQueue = (page) => main(page).getByRole("region", { name: "Por resolver" });

/** How many shop changes wait for a decision. */
const changesWaiting = (page) => changeQueue(page).locator("ul > li").count();

/** A waiting change by its kind (contact, fiscal, shop_name). */
const changeCard = (page, kind) => testid(changeQueue(page), `shop-change-${kind}`);

/** A waiting change, as one line. */
const changeCardText = (page, kind) => text(changeCard(page, kind));

/** Approves the contact change and waits for the page to say so. */
async function approveChange(page, kind) {
  const waiting = await changesWaiting(page);
  await button(changeCard(page, kind), "Aprobar el cambio").click();
  if (kind === "contact") {
    await page.waitForURL((u) => new URL(u).search.includes("resuelta=aprobada"));
    return;
  }
  await page
    .waitForFunction(
      (n) =>
        document.querySelectorAll('main section[aria-labelledby="por-resolver"] > ul > li').length <
        n,
      waiting,
      { timeout: 15000 },
    )
    .catch(async () => {
      throw new Error(`the ${kind} change was not approved: ${await changeCardText(page, kind)}`);
    });
}

/** Rejects a change without a reason; returns the refusal. */
async function rejectChangeWithoutReason(page, kind) {
  const card = changeCard(page, kind);
  await button(card, "Rechazar").click();
  await card.getByRole("alert").waitFor();
  return text(card.getByRole("alert"));
}

/** Rejects a change with a reason and waits for the empty queue. */
async function rejectChange(page, kind, note) {
  const card = changeCard(page, kind);
  await field(card, "note", "textarea").fill(note);
  await button(card, "Rechazar").click();
  await page.waitForURL((u) => new URL(u).search.includes("resuelta=rechazada"));
  await settledText(main(page), /No hay cambios por resolver\./, { what: "Cambios de tienda" });
}

/** Changes a driver's status from Repartidores (by the driver's name) and waits for the new word. */
async function setDriverStatus(page, name, status) {
  const row = main(page).getByRole("row", { name });
  await field(row, "status").selectOption(status);
  await button(row, "Guardar").click();
  const said = word("driver_status", status);
  await settledText(row, (t) => t.includes(said), { what: `${name}'s row` });
  return text(row);
}

Object.assign(module.exports, {
  sectionsNav,
  changesWaiting,
  changeCardText,
  approveChange,
  rejectChangeWithoutReason,
  rejectChange,
  setDriverStatus,
});

// ── Sign-in to the summary; Catálogo › Productos por revisar ───────────────

/** Signs in, lands on the summary and waits for its heading. */
async function signInHome(page, email, password = PASSWORD) {
  await open(page, "/ingresar");
  await fillSignIn(page, email, password);
  await page.waitForURL((u) => new URL(u).pathname === "/");
  await main(page).getByRole("heading").first().waitFor();
}

/** The summary's figure of products to review, as one line. */
const reviewFigure = (page) =>
  text(
    main(page)
      .locator("div")
      .filter({ has: page.getByRole("link", { name: "Nuevos y cambios a publicados" }) })
      .last(),
  );

/** The section headings of a page. */
const sectionHeadings = (page) => main(page).getByRole("heading", { level: 2 }).allInnerTexts();

const editsToReview = (page) =>
  main(page).getByRole("region", { name: "Cambios a productos publicados" });

/** The first change to a published product waiting for review, as one line. */
const firstEditCard = (page) => text(editsToReview(page).getByRole("article").first());

/** «Productos nuevos», as one line. */
const newProducts = (page) => text(main(page).getByRole("region", { name: "Productos nuevos" }));

/** Approves the first change and waits for the empty list. */
async function approveFirstEdit(page) {
  await button(editsToReview(page).getByRole("article").first(), "Aprobar cambio").click();
  await settledText(editsToReview(page), /No hay cambios por revisar/, {
    what: "the changes to review",
  });
}

/** Rejects the first change without a reason; returns the refusal. */
async function rejectFirstEditWithoutReason(page) {
  const card = editsToReview(page).getByRole("article").first();
  await button(card, "Rechazar cambio").click();
  await card.getByRole("alert").waitFor();
  return text(card.getByRole("alert"));
}

/** Rejects the first change with a reason and waits for the empty list. */
async function rejectFirstEdit(page, note) {
  const card = editsToReview(page).getByRole("article").first();
  await field(card, "note", "textarea").fill(note);
  await button(card, "Rechazar cambio").click();
  await settledText(editsToReview(page), /No hay cambios por revisar/, {
    what: "the changes to review",
  });
}

Object.assign(module.exports, {
  signInHome,
  reviewFigure,
  sectionHeadings,
  firstEditCard,
  newProducts,
  approveFirstEdit,
  rejectFirstEditWithoutReason,
  rejectFirstEdit,
});

// ── Mensajes and the order's messages ──────────────────────────────────────

// How the console names templates and channels (apps/ops/src/lib/notification-labels.ts).
const TEMPLATE = { order_placed: "Pedido recibido", payment_received: "Pago recibido" };
const CHANNEL = { email: "Correo", whatsapp: "WhatsApp" };

/** A stuck message on Mensajes: by template, channel and order number. */
const stuckMessage = (page, template, channel, orderNumber) =>
  withValue(testid(main(page), `stuck-${template}-${channel}`), orderNumber);

/** How many such stuck messages there are. */
const stuckCount = (page, template, channel, orderNumber) =>
  stuckMessage(page, template, channel, orderNumber).count();

/** A stuck message, as one line. */
const stuckText = (page, template, channel, orderNumber) =>
  text(stuckMessage(page, template, channel, orderNumber));

/** «Reenviar» on a stuck message, and waits for the page to say it went again. */
async function resend(page, template, channel, orderNumber) {
  await button(stuckMessage(page, template, channel, orderNumber), "Reenviar").click();
  await settledText(main(page), /Lo enviamos de nuevo/, { what: "Mensajes" });
}

/** The lines of the order page's «Mensajes», white space squashed. */
async function orderMessages(page) {
  return (
    await main(page).getByRole("region", { name: "Mensajes" }).getByRole("listitem").allInnerTexts()
  ).map((t) => t.replace(/\s+/g, " "));
}

/** The line of that list for this template, on this channel, to the shopper, delivered. */
const deliveredLine = (lines, template, channel) =>
  lines.find(
    (l) =>
      l.startsWith(`${TEMPLATE[template]} ${CHANNEL[channel]} · Cliente`) &&
      l.endsWith(word("notification_status", "delivered")),
  );

Object.assign(module.exports, { stuckCount, stuckText, resend, orderMessages, deliveredLine });

// ── The order page: stopping a parcel ──────────────────────────────────────

/** How many «Detener el paquete» the order page offers for this parcel (by its tracking code). */
const stopOffers = (page, tracking) =>
  withValue(testid(main(page), "parcel-stop"), tracking).count();

const stopForm = (page) =>
  main(page)
    .locator("form")
    .filter({ has: page.locator('input[name="shipmentId"]') })
    .first();

/** Opens «Detener el paquete» (of this parcel, or the first) and returns what its confirmation says. */
async function openStop(page, tracking) {
  const opener = tracking
    ? withValue(testid(main(page), "parcel-stop"), tracking)
    : testid(main(page), "parcel-stop");
  await opener.first().click();
  return text(
    stopForm(page)
      .locator("label")
      .filter({ has: page.locator('input[name="confirm"]') }),
  );
}

/** Types the reason for stopping the parcel. */
const typeStopReason = (page, reason) => field(stopForm(page), "reason", "textarea").fill(reason);

/** Ticks the stop's confirmation. */
const confirmStop = (page) => field(stopForm(page), "confirm").check();

/** «Detener y devolver a la zona de devoluciones»; returns the outcome. */
const sendStop = (page) =>
  kit.submitAndRead(page, stopForm(page), "Detener y devolver a la zona de devoluciones");

/** The reason the stop form holds. */
const stopReasonTyped = (page) => field(stopForm(page), "reason", "textarea").inputValue();

// ── Rutas detenidas, Despacho ──────────────────────────────────────────────

/** A stop of a route card on Operación › Rutas detenidas, by its tracking code, as one line. */
const routeStopText = (page, tracking) => text(page.locator(`li[data-stop="${tracking}"]`));

/** Despacho's failed and removed parcels, as one line. */
const dispatchFailed = (page) => text(testid(main(page), "dispatch-failed"));

Object.assign(module.exports, {
  stopOffers,
  openStop,
  typeStopReason,
  confirmStop,
  sendStop,
  stopReasonTyped,
  routeStopText,
  dispatchFailed,
});
