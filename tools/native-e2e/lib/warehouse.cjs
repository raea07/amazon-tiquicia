// Screen steps of the warehouse app (apps/warehouse-native, "Yuntera
// Bodega"), for the native journeys. Journeys keep the flow and the checks;
// how a screen is found and worked lives here, so a rebuilt screen changes
// this file only (SISTEMA.md §20.5). Elements are found by testID
// (testids/warehouse.json and expo-kit.json) or by role and accessible name;
// the names are the words the screens show today.

const { allText, heading, on, shows } = require("./screen.cjs");

const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";

/** Signs in on the kit's sign-in screen and waits for the board. */
async function signIn(page, email, password = PASSWORD) {
  await on(page, "sign-in-email").fill(email);
  await on(page, "sign-in-password").fill(password);
  await on(page, "sign-in-submit").click();
}

/** Ubicaciones: opens a location by its code, as the scanner field does. */
async function openLocation(page, base, code) {
  await page.goto(`${base}/ubicaciones`, { waitUntil: "networkidle" });
  await on(page, "location-scan-input").fill(code);
  await on(page, "location-scan-submit").click();
  await locationOpen(page, code);
}

/** The location screen of `code` has drawn. */
const locationOpen = (page, code) =>
  page.getByTestId("location-title").filter({ hasText: code }).first().waitFor();

/** On a location: «Contar un producto que no está en la lista», opened. */
async function openCountIn(page) {
  await page.getByTestId("count-in").first().waitFor();
  // The search (and on a phone its camera) opens only when asked for.
  if ((await page.getByTestId("count-in-open").count()) > 0)
    await page.getByTestId("count-in-open").first().click();
}

/** The board's row of a parcel that came back, by its tracking code. */
const returnedRow = (page, tracking) =>
  page.getByTestId("returned-row").filter({ hasText: tracking }).first();

/** The board's title: the name of the warehouse chosen. */
const boardTitle = (page, name) => page.getByRole("heading", { name, exact: true }).first();

/** Waits until the row of location `code` in Ubicaciones says `words` («3 unidades · 1 producto»). */
const locationRowSays = (page, code, words) =>
  page.getByTestId(`location-${code}`).filter({ hasText: words }).first().waitFor();

/** The board of a warehouse with no parcel on the floor says so. */
const noShipments = (page) => shows(page, "board-no-shipments", "No hay pedidos en el piso ahora.");
/** The board's list of announced stock, with how many are announced. */
const inboundHeading = (page, count) =>
  heading(page, new RegExp(`Mercadería por recibir \\(${count}\\)`));

/** True when nothing on the page speaks of a camera (the web export has none). */
const speaksOfCamera = async (page) => /linterna|Permitir la cámara/.test(await allText(page));

/** Waits until a scanner's answer (testID `<scanner>-feedback`) says `words`. */
const scannerSays = (page, scanner, words, options) =>
  shows(page, `${scanner}-feedback`, words, options);

/** Waits until a line of a receipt says `words` («esperadas 12 · recibidas 10 …»). */
const receiveLineSays = (page, words) =>
  page
    .getByTestId(/^receive-line/)
    .filter({ hasText: words })
    .first()
    .waitFor();

/** A location says that moves and counts need signal. */
const signalNote = (page) =>
  page.getByTestId("location-signal-note").filter({ hasText: /necesitan señal/ });

/** Waits until the form `id` (move-error, count-error, count-difference) of a card says `words`. */
const cardSays = (card, id, words) =>
  card.getByTestId(id).filter({ hasText: words }).first().waitFor();

/** On a location: what the last move or count says («Se movió…», «ahora hay…»). */
const stockResult = (page, words, options) => shows(page, "stock-result", words, options);

module.exports = {
  boardTitle,
  cardSays,
  inboundHeading,
  locationOpen,
  locationRowSays,
  noShipments,
  receiveLineSays,
  scannerSays,
  signalNote,
  speaksOfCamera,
  openCountIn,
  openLocation,
  returnedRow,
  signIn,
  stockResult,
};
