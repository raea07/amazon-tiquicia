// Screen steps of the drivers' and warehouse app (apps/field): everything a journey finds, clicks,
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

const BASE = process.env.FIELD_URL || "http://127.0.0.1:3003";
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

// ── Back links ─────────────────────────────────────────────────────────────

/** The «← Bodega» link at the top of a warehouse page (for its size). */
const backToWarehouse = (page) => link(page, "← Bodega").first();

/** The «← Ubicaciones» link at the top of a location page (for its size). */
const backToLocations = (page) => link(page, "← Ubicaciones").first();

/** The line of text around a back link (for its height). */
const lineAround = (backLink) => backLink.locator("..");

// ── Warehouse locations ────────────────────────────────────────────────────

/** The address of the first location the locations page lists. */
const firstLocationHref = (page) =>
  main(page).locator('a[href^="/bodega/ubicacion?codigo="]').first().getAttribute("href");

Object.assign(module.exports, { backToWarehouse, backToLocations, lineAround, firstLocationHref });

// ── Driver: the route ──────────────────────────────────────────────────────

const routeSection = (page, code) => main(page).getByRole("region", { name: code });

/** The summary at the top of a route on «Ruta» (counts, what to collect), as one line. */
const routeSummary = (page, code) =>
  text(testid(routeSection(page, code), "route-summary").first());

/** The first stop of a route on «Ruta», as one line. */
const firstStop = (page, code) => text(routeSection(page, code).locator("ol > li").first());

/** The stop of a route that shows this tracking code, as one line. */
const stopWith = (page, code, tracking) =>
  text(withValue(routeSection(page, code).locator("ol > li"), tracking).first());

/** What a closed stop's own page says. */
const closedStop = (page) => text(testid(page, "stop-closed"));

/** The whole page's text (to check a sentence appears nowhere). */
const pageText = (page) => text(page.locator("body"));

/** How many ways to reach the customer the page offers (directions, phone, WhatsApp). */
async function contactOffers(page) {
  return (
    (await link(page, "Cómo llegar").count()) +
    (await page.locator('a[href^="tel:"], a[href^="https://wa.me/"]').count())
  );
}

Object.assign(module.exports, {
  routeSummary,
  firstStop,
  stopWith,
  closedStop,
  pageText,
  contactOffers,
});

// ── Warehouse: receiving ───────────────────────────────────────────────────

/** The locations the receiving form offers. */
const receivingLocations = (page) => field(page, "locationId").locator("option").allInnerTexts();

Object.assign(module.exports, { receivingLocations });

// ── Warehouse: a location and «Contar un producto» ─────────────────────────

/** Opens a location's page by its code (and a search, if given). */
const openLocation = (page, code, search) =>
  open(page, `/bodega/ubicacion?codigo=${code}${search === undefined ? "" : `&buscar=${search}`}`);

/** What the location's summary says («Está vacía»…). */
const locationSummary = (page) => text(testid(page, "location-summary"));

const countIn = (page) => testid(page, "count-in");

/** What the count-in section says, as one line. */
const countInText = (page) => text(countIn(page));

/** The least number of characters the count-in search asks for. */
const countSearchMinLength = (page) => field(countIn(page), "buscar").getAttribute("minlength");

/** How many fields the count-in section has (0 when it offers no count). */
const countInFields = (page) => countIn(page).locator("input").count();

/** Searches a product to count and waits for the results. */
async function searchToCount(page, query) {
  await field(countIn(page), "buscar").fill(query);
  await button(countIn(page), "Buscar").click();
  await page.waitForURL((u) => new URL(u).searchParams.get("buscar") === query);
  await page.waitForLoadState("networkidle");
}

const countResult = (page, sku) => countIn(page).locator(`li[data-count-sku="${sku}"]`);
const countForm = (page, sku) => countResult(page, sku).locator("form");

/** A count result, as one line. */
const countResultText = (page, sku) => text(countResult(page, sku));

/** How many forms a count result offers, and how many links to the goods to receive. */
async function countResultOffers(page, sku) {
  return {
    forms: await countForm(page, sku).count(),
    receiveLinks: await countResult(page, sku).locator('a[href="/bodega#recepciones"]').count(),
  };
}

/** Waits for the count form of a result. */
const waitForCountForm = (page, sku) => countForm(page, sku).waitFor();

/** Types a quantity and a reason in a result's count form (either may be left out). */
async function typeCount(page, sku, { quantity, note }) {
  if (quantity !== undefined) await field(countForm(page, sku), "quantity").fill(quantity);
  if (note !== undefined) await field(countForm(page, sku), "note").fill(note);
}

/** What the count form's button says. */
const countButton = (page, sku) => text(countForm(page, sku).getByRole("button"));

/** Sends a result's count form (a double tap with `double`). */
async function sendCount(page, sku, { double = false } = {}) {
  const send = countForm(page, sku).getByRole("button");
  if (double) await send.dblclick();
  else await send.click();
}

/** The count form's error, once it shows one. */
async function countError(page, sku) {
  await countForm(page, sku).getByRole("alert").waitFor();
  return text(countForm(page, sku).getByRole("alert"));
}

/** The count form's error once it matches `wanted`. */
const countErrorSettled = (page, sku, wanted) =>
  settledText(countForm(page, sku).getByRole("alert"), wanted, { what: "the count form's error" });

/** What the count form holds: quantity and reason. */
async function countTyped(page, sku) {
  return {
    quantity: await field(countForm(page, sku), "quantity").inputValue(),
    note: await field(countForm(page, sku), "note").inputValue(),
  };
}

/** The page's notice that the product was counted, once it shows. */
const countedNotice = (page) =>
  kit.waitForMessage(main(page), "Producto contado", { roles: "status" });

/** The error of the count-in form that the location is switched off, once it shows. */
const switchedOffError = (page) =>
  kit.waitForMessage(countIn(page).locator("form"), "desactivada", { roles: "alert" });

/** What the first count-in quantity field holds. */
const countInQuantity = (page) =>
  field(main(page).locator('[data-testid="count-in"]'), "quantity").inputValue();

const stockLine = (page, sku) => page.locator(`li[data-sku="${sku}"]`);

/** Waits for a product's line in the location's list. */
const waitForStockLine = (page, sku) => stockLine(page, sku).waitFor();

/** A product's line in the location's list: all of it and its figures, as lines. */
async function stockLineText(page, sku) {
  return {
    all: await text(stockLine(page, sku)),
    figures: await text(stockLine(page, sku).locator("dl")),
  };
}

/** Corrects the quantity of a product's line with a reason, and waits for the notice. */
async function correctStock(page, sku, counted, note) {
  const row = stockLine(page, sku);
  await testid(row, "stock-correct").click();
  await field(row, "counted").fill(counted);
  await row.locator('details[open] input[name="note"]').fill(note);
  await button(row, "Corregir a").click();
  await kit.waitForMessage(main(page), `Ahora hay ${counted} unidades`, { roles: "status" });
}

Object.assign(module.exports, {
  openLocation,
  locationSummary,
  countInText,
  countSearchMinLength,
  countInFields,
  searchToCount,
  countResultText,
  countResultOffers,
  waitForCountForm,
  typeCount,
  countButton,
  sendCount,
  countError,
  countErrorSettled,
  countTyped,
  countedNotice,
  switchedOffError,
  countInQuantity,
  waitForStockLine,
  stockLineText,
  correctStock,
});

// ── Driver: today's route and a stop ──────────────────────────────────────

/** Signs in and waits for the person's own start page (not the sign-in, not the chooser). */
async function signInToOwnPage(page, email, password = PASSWORD) {
  await open(page, "/ingresar");
  await fillSignIn(page, email, password);
  await page.waitForURL((u) => !["/ingresar", "/"].includes(new URL(u).pathname));
  await page.waitForLoadState("networkidle");
}

/** The first route's summary on «Ruta», as one line. */
const todaySummary = (page) => text(testid(main(page), "route-summary").first());

const todayStops = (page) => main(page).locator("ol > li");

/** How many stops the route list shows, and the first one as one line. */
async function stopsShown(page) {
  return { count: await todayStops(page).count(), first: await text(todayStops(page).first()) };
}

/** The note about sharing the position. */
const positionNote = (page) => text(main(page).locator('p[aria-live="polite"]').first());

/** Opens the first stop of the list and waits for its page. */
async function openFirstStop(page) {
  await todayStops(page).first().getByRole("link").first().click();
  // The route page has its own h1, so wait for the address to change first.
  await page.waitForURL((u) => /^\/ruta\/[^/]+$/.test(new URL(u).pathname));
  await main(page).getByRole("heading", { level: 1 }).waitFor();
}

/** The stop page's header, as one line. */
const stopHeader = (page) => text(main(page).locator("header").first());

/** The addresses of the stop's directions, call and WhatsApp links. */
const stopContactLinks = (page) =>
  main(page)
    .locator('a[href^="https://www.google.com/maps"], a[href^="tel:"], a[href^="https://wa.me"]')
    .evaluateAll((a) => a.map((x) => x.getAttribute("href").slice(0, 60)));

/** «Llegué», and waits for the arrival to be noted. */
async function arrive(page) {
  await button(main(page), "Llegué").click();
  await kit.waitForMessage(main(page), "Llegada registrada");
}

/** The label of the cash field (it says how much to collect). */
const cashLabel = (page) =>
  field(main(page), "collected").evaluate((el) =>
    el.labels[0].innerText.replace(/\s+/g, " ").trim(),
  );

/** Fills the delivery form (cash, recipient, code; any may be left out) and presses «Entregar». */
async function deliver(page, { collected, recipient, pin }) {
  if (collected !== undefined) await field(main(page), "collected").fill(collected);
  if (recipient !== undefined) await field(main(page), "recipientName").fill(recipient);
  if (pin !== undefined) await field(main(page), "pin").fill(pin);
  await button(main(page), "Entregar", true).click();
}

/** The delivery form's error, once it shows one. */
async function deliveryError(page) {
  const alert = main(page).locator("form").getByRole("alert").first();
  await alert.waitFor();
  return text(alert);
}

/** Waits until the stop page says the cash must be exact, and returns the form's error. */
async function cashError(page) {
  await page.waitForFunction(() =>
    /exactamente/.test(document.querySelector("main")?.innerText ?? ""),
  );
  return text(main(page).locator("form").getByRole("alert").first());
}

/** The recipient's name the delivery form holds. */
const recipientTyped = (page) => field(main(page), "recipientName").inputValue();

/** After a delivery: back on «Ruta» with its notice. Returns the notice. */
async function deliveredNotice(page) {
  await page.waitForURL((u) => new URL(u).pathname === "/ruta");
  return kit.waitForMessage(main(page), "Entrega registrada");
}

/** Marks the first stop as not delivered, with a reason, and waits for the end of the route. */
async function failFirstStop(page, reason) {
  await todayStops(page).getByRole("link").first().click();
  await main(page).locator("summary").first().waitFor();
  await main(page).locator("summary").first().click();
  await field(main(page), "reason", "select").selectOption(reason);
  await button(main(page), "Registrar que no se entregó").click();
  await page.waitForURL((u) => new URL(u).pathname === "/ruta");
  await kit.waitForMessage(main(page), "Terminó la ruta");
}

// ── Warehouse: the board, picking, packing, receiving, lookup ──────────────

/** The section headings of the warehouse board. */
const boardSections = (page) => main(page).getByRole("heading", { level: 2 }).allInnerTexts();

/** Opens the first parcel waiting to be picked and waits for its page. */
async function openParcelToPick(page) {
  await main(page)
    .getByRole("region", { name: "Pedidos" })
    .getByRole("link", { name: word("shipment_status", "pending", { viewer: "warehouse" }) })
    .first()
    .click();
  // The board has its own header and h1: wait for the parcel's page itself.
  await page.waitForURL((u) => new URL(u).pathname.startsWith("/bodega/paquete/"));
  await main(page).getByRole("heading", { level: 1 }).waitFor();
}

/** The parcel page's header, as one line. */
const parcelHeader = (page) => text(main(page).locator("header").first());

/** «Empezar a alistar»; returns how many lines there are to pick. */
async function startPicking(page) {
  await button(main(page), "Empezar a alistar").click();
  await field(main(page), "code").first().waitFor();
  return main(page).locator("ol > li").count();
}

const openLines = (page) =>
  main(page)
    .locator("ol > li")
    .filter({ has: page.locator('input[name="code"]') });

/** Scans a code on the first line still to pick and returns the refusal. */
async function scanWrong(page, code) {
  await field(main(page), "code").first().fill(code);
  await main(page).locator('ol > li button[type="submit"]').first().click();
  const alert = main(page).locator("ol").getByRole("alert").first();
  await alert.waitFor();
  return text(alert);
}

/** Picks every line still open by scanning its own code. */
async function pickAll(page) {
  const lines = await openLines(page).count();
  for (let i = 0; i < lines; i++) {
    const line = openLines(page).first();
    const code = /(YT-[A-Z0-9]+|[A-Z0-9]+-[A-Z0-9-]+)/.exec(
      await testid(line, "pick-sku").first().innerText(),
    )[1];
    await field(line, "code").fill(code);
    await line.locator('button[type="submit"]').click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('main ol > li input[name="code"]').length === n,
      lines - i - 1,
    );
  }
}

/** The «Líneas» heading (how many are done). */
const linesHeading = (page) =>
  main(page).getByRole("heading", { level: 2, name: "Líneas" }).innerText();

/** «Empacado», and waits for the notice to take it to dispatch. Returns the notice. */
async function pack(page) {
  await button(main(page), "Empacado").click();
  return kit.waitForMessage(main(page), "zona de despacho", { roles: "status" });
}

const firstInbound = (page) =>
  main(page)
    .getByRole("region", { name: "Mercadería por recibir" })
    .locator(":scope > ul > li")
    .first();

/** The first shipment to receive, as one line. */
const firstInboundText = (page) => text(firstInbound(page));

/** The whole first shipment to receive, as the screen writes it. */
const firstInboundRaw = (page) => firstInbound(page).innerText();

/** Receives the first shipment (good and damaged units); returns its message and its first line. */
async function receiveFirst(page, { good, damaged }) {
  const box = firstInbound(page);
  await field(box, "good").fill(good);
  await field(box, "damaged").fill(damaged);
  await box.locator('button[type="submit"]').click();
  const message = box.locator('[role="status"], [role="alert"]').first();
  await message.waitFor();
  return { message: await text(message), line: await text(box.getByRole("listitem").first()) };
}

/** What the stock lookup shows first. */
const lookupResult = (page) => text(main(page).locator("section").first());

/** The lookup's message (when nothing is found). */
const lookupMessage = (page) => text(main(page).locator('[role="status"], [role="alert"]').first());

Object.assign(module.exports, {
  signInToOwnPage,
  todaySummary,
  stopsShown,
  positionNote,
  openFirstStop,
  stopHeader,
  stopContactLinks,
  arrive,
  cashLabel,
  deliver,
  deliveryError,
  cashError,
  recipientTyped,
  deliveredNotice,
  failFirstStop,
  boardSections,
  openParcelToPick,
  parcelHeader,
  startPicking,
  scanWrong,
  pickAll,
  linesHeading,
  pack,
  firstInboundText,
  firstInboundRaw,
  receiveFirst,
  lookupResult,
  lookupMessage,
});

// ── Driver and warehouse: more ────────────────────────────────────────────

/** The stop of today's list for this recipient (seed data), as one line. */
const stopFor = (page, recipient) => text(withValue(todayStops(page), recipient).first());

/** The code of the first line still to pick, as its line shows it. */
const firstOpenSku = async (page) =>
  testid(openLines(page).first(), "pick-sku").first().innerText();

/** How many lines are still to pick. */
const openLineCount = (page) => openLines(page).count();

/** Types a code on the first line still to pick and waits for the line to close. */
async function pickFirstWith(page, code) {
  const lines = await openLineCount(page);
  const line = openLines(page).first();
  await field(line, "code").fill(code);
  await line.locator('button[type="submit"]').click();
  await page.waitForFunction(
    (n) => document.querySelectorAll('main ol > li input[name="code"]').length === n,
    lines - 1,
  );
}

/** Opens the first parcel waiting to be picked, without waiting for its page's heading. */
async function openParcelToPickNow(page) {
  await main(page)
    .getByRole("region", { name: "Pedidos" })
    .getByRole("link", { name: word("shipment_status", "pending", { viewer: "warehouse" }) })
    .first()
    .click();
  await page.waitForURL((u) => new URL(u).pathname.startsWith("/bodega/paquete/"));
}

Object.assign(module.exports, {
  stopFor,
  firstOpenSku,
  openLineCount,
  pickFirstWith,
  openParcelToPickNow,
});

// ── Warehouse: parcels on their way back ───────────────────────────────────

const returningParcels = (page) =>
  main(page).getByRole("region", { name: "Paquetes devueltos por recibir" });

/** Waits until the board lists `count` parcels on their way back; returns the first, as one line. */
async function firstReturningParcel(page, count) {
  await settledText(
    returningParcels(page).getByRole("heading", { level: 2 }),
    `Paquetes devueltos por recibir (${count})`,
    { what: "the returned parcels' heading" },
  );
  return text(returningParcels(page).getByRole("listitem").first());
}

Object.assign(module.exports, { firstReturningParcel });

// ── No access ──────────────────────────────────────────────────────────────

/** Signs in and waits to land on `landsOn`. */
async function signInLandingOn(page, email, landsOn, password = PASSWORD) {
  await open(page, "/ingresar");
  await fillSignIn(page, email, password);
  await page.waitForURL((u) => new URL(u).pathname === landsOn);
  await page.waitForLoadState("networkidle");
}

/** What the no-access page says, once it says the driver's account is suspended. */
const suspendedNotice = (page) =>
  settledText(main(page), /Su cuenta de repartidor está suspendida/, {
    what: "the no-access page",
  });

Object.assign(module.exports, { signInLandingOn, suspendedNotice });

// ── Warehouse: a parcel returned ───────────────────────────────────────────

/** The board's row of a returned parcel (by its tracking code) that can be checked in. */
const returnedRow = (page, tracking) =>
  withValue(main(page).getByRole("listitem"), tracking).filter({
    has: page.locator('select[name="condition"]'),
  });

/** That row, as one line. */
const returnedRowText = (page, tracking) => text(returnedRow(page, tracking));

/** Checks the returned parcel in, in this condition, and waits for the board to say where it went. */
async function receiveReturned(page, tracking, condition, back = "venta") {
  const row = returnedRow(page, tracking);
  await field(row, "condition").selectOption(condition);
  await button(row, "Recibir el paquete devuelto").click();
  await page.waitForURL((u) => new URL(u).searchParams.get("devuelto") === back);
  await page.waitForLoadState("networkidle");
}

Object.assign(module.exports, { returnedRowText, receiveReturned });

// ── Warehouse: locations, moving and counting stock ───────────────────────

/** From the warehouse board, «Ubicaciones», and waits for a location of the list. */
async function openLocationsFromBoard(page, someCode) {
  await link(main(page), "Ubicaciones").click();
  await page.waitForURL((u) => new URL(u).pathname === "/bodega/ubicaciones");
  await page.locator(`a[data-location="${someCode}"]`).waitFor();
}

/** A location of the list, as one line. */
const locationListEntry = (page, code) => text(page.locator(`a[data-location="${code}"]`));

/** How many entries of the list are this location (0 once it left). */
const locationListed = (page, code) => page.locator(`a[data-location="${code}"]`).count();

/** Opens a location from the list. */
async function openListedLocation(page, code) {
  await page.locator(`a[data-location="${code}"]`).click();
  await page.waitForURL((u) => new URL(u).searchParams.get("codigo") === code);
}

/** Opens a location by typing its code. */
async function openLocationByCode(page, code) {
  await field(main(page), "codigo").fill(code);
  await button(main(page), "Abrir").click();
  await page.waitForURL((u) => new URL(u).pathname === "/bodega/ubicacion");
}

/** Waits for the confirmation saying `wanted`, which is then taken out of the address; returns it. */
async function stockOutcome(page, wanted) {
  const said = await kit.waitForMessage(main(page), wanted, { roles: "status" });
  await page.waitForFunction(
    () => !/[?&](movidas|destino|contadas|diferencia)=/.test(window.location.search),
  );
  await page.waitForLoadState("networkidle");
  return said;
}

/** How many confirmations of moved units the page shows (0 when none). */
async function movedNotices(page) {
  const all = await main(page).getByRole("status").allInnerTexts();
  return all.filter((t) => t.includes("Unidades movidas")).length;
}

/** Opens a stock line's «Mover», unless it is open already. */
async function openMove(page, sku) {
  const row = stockLine(page, sku);
  const open = await row
    .locator("details")
    .filter({ has: page.locator('select[name="toLocationId"]') })
    .getAttribute("open");
  if (open === null) await testid(row, "stock-move").click();
}

/** Fills the move form (quantity, destination by its code; either may be left out) and sends it. */
async function moveStock(page, sku, { quantity, to }) {
  const row = stockLine(page, sku);
  if (quantity !== undefined) await field(row, "quantity").fill(quantity);
  if (to !== undefined) await field(row, "toLocationId").selectOption({ label: to });
  await button(row, "Mover las unidades").click();
}

/** The stock line's error, once it shows. */
async function stockLineError(page, sku) {
  const row = stockLine(page, sku);
  await row.getByRole("alert").first().waitFor();
  return text(row.getByRole("alert").first());
}

/** What the move form holds: quantity, the destination chosen (its label and value) and the destinations offered. */
async function moveTyped(page, sku) {
  const row = stockLine(page, sku);
  const select = await field(row, "toLocationId").evaluate((el) => ({
    value: el.value,
    label: el.selectedOptions[0]?.text ?? "",
    options: [...el.options].map((o) => o.text),
    missing: el.validity.valueMissing,
  }));
  return { quantity: await field(row, "quantity").inputValue(), ...select };
}

/** Opens a stock line's «Corregir cantidad», unless it is open already. */
async function openCount(page, sku) {
  const row = stockLine(page, sku);
  const open = await row
    .locator("details")
    .filter({ has: page.locator('input[name="counted"]') })
    .getAttribute("open");
  if (open === null) await testid(row, "stock-correct").click();
}

/** Types the counted quantity; returns the difference the form shows and what its button says. */
async function typeCounted(page, sku, counted) {
  const row = stockLine(page, sku);
  await field(row, "counted").fill(counted);
  return {
    difference: await text(testid(row, "count-difference")),
    button: await text(button(row, "Corregir a")),
  };
}

/** Types the count's reason and «Corregir a …». */
async function sendCountCorrection(page, sku, note) {
  const row = stockLine(page, sku);
  await row.locator('details[open] input[name="note"]').fill(note);
  await button(row, "Corregir a").click();
}

/** What the count form holds: the counted quantity and the reason. */
async function countCorrectionTyped(page, sku) {
  const row = stockLine(page, sku);
  return {
    counted: await field(row, "counted").inputValue(),
    note: await row.locator('details[open] input[name="note"]').inputValue(),
  };
}

/** How many stock lines of this product the location shows (0 once it left). */
const stockLineCount = (page, sku) => stockLine(page, sku).count();

/** «Ver en qué ubicaciones está» from a stock line; returns what the product's page says about it. */
async function productLocations(page, sku) {
  await link(stockLine(page, sku), "Ver en qué ubicaciones está").click();
  await page.waitForURL((u) => new URL(u).pathname === "/bodega/buscar");
  const found = withValue(main(page).locator("section"), sku).first();
  await found.waitFor();
  return text(found);
}

/** The page's refusal that a product left the location, once it shows, after its address is cleaned. */
async function goneNotice(page) {
  const said = await kit.waitForMessage(main(page), "Ya no está en esta ubicación", {
    roles: "alert",
  });
  await page.waitForFunction(() => !/[?&](sin|accion)=/.test(window.location.search));
  await page.waitForLoadState("networkidle");
  return said && kit.waitForMessage(main(page), "Ya no está en esta ubicación", { roles: "alert" });
}

/** How many refusals that a product left the location the page shows. */
async function goneNotices(page) {
  const all = await main(page).getByRole("alert").allInnerTexts();
  return all.filter((t) => t.includes("Ya no está en esta ubicación")).length;
}

/** Waits for a location's summary. */
const waitForLocationSummary = (page) => testid(page, "location-summary").waitFor();

Object.assign(module.exports, {
  openLocationsFromBoard,
  locationListEntry,
  locationListed,
  openListedLocation,
  openLocationByCode,
  stockOutcome,
  movedNotices,
  openMove,
  moveStock,
  stockLineError,
  moveTyped,
  openCount,
  typeCounted,
  sendCountCorrection,
  countCorrectionTyped,
  stockLineCount,
  productLocations,
  goneNotice,
  goneNotices,
  waitForLocationSummary,
});

/** Fills the move form (quantity, destination by its code) without sending it. */
async function typeMove(page, sku, { quantity, to }) {
  const row = stockLine(page, sku);
  if (quantity !== undefined) await field(row, "quantity").fill(quantity);
  if (to !== undefined) await field(row, "toLocationId").selectOption({ label: to });
}

Object.assign(module.exports, { typeMove });
