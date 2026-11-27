// Screen steps of the warehouse app (apps/warehouse-native, "Yuntera
// Bodega"), for the native journeys. Journeys keep the flow and the checks;
// how a screen is found and worked lives here, so a rebuilt screen changes
// this file only (SISTEMA.md §20.5). Elements are found by testID
// (testids/warehouse.json and expo-kit.json) or by role and accessible name;
// the names are the words the screens show today.

const { on, shows } = require("./screen.cjs");

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

/** On a location: what the last move or count says («Se movió…», «ahora hay…»). */
const stockResult = (page, words, options) => shows(page, "stock-result", words, options);

module.exports = {
  locationOpen,
  openCountIn,
  openLocation,
  returnedRow,
  signIn,
  stockResult,
};
