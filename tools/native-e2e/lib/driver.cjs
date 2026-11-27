// Screen steps of the drivers' app (apps/driver-native, "Yuntera Ruta"), for
// the native journeys. Journeys keep the flow and the checks; how a screen is
// found and worked lives here, so a rebuilt screen changes this file only
// (SISTEMA.md §20.5). Elements are found by testID (testids/driver.json and
// expo-kit.json) or by role and accessible name; the names are the words the
// screens show today.

const { button, on, rowWith, shows } = require("./screen.cjs");

const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";

/** Signs in on the kit's sign-in screen. */
async function signIn(page, email, password = PASSWORD) {
  await on(page, "sign-in-email").fill(email);
  await on(page, "sign-in-password").fill(password);
  await on(page, "sign-in-submit").click();
}

/** The card of a route on the day's screen, by its code («Ruta R-1003»). */
const routeCard = (page, code) => rowWith(page, "driver-route", `Ruta ${code}`).first();

/** A suspended driver's screen: «Ya me dieron acceso: revisar de nuevo». */
const checkAccessAgain = (page) => button(page, "Ya me dieron acceso: revisar de nuevo").click();

/** Waits until the answer to a delivery attempt says `words`. */
const deliveryAnswer = (page, words, options) => shows(page, "deliver-message", words, options);

/** The links on screen that open an address containing `fragment` (a stop's id). */
const linksTo = (page, fragment) => page.locator(`a[href*="${fragment}"]`);

module.exports = { checkAccessAgain, deliveryAnswer, linksTo, routeCard, signIn };
