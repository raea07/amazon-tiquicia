// Screen steps of the seller app (apps/seller-native, "Yuntera Vende"), for
// the native journeys. Journeys keep the flow and the checks; how a screen is
// found and worked lives here, so a rebuilt screen changes this file only
// (SISTEMA.md §20.5). Elements are found by testID (testids/seller.json and
// expo-kit.json) or by role and accessible name; the names are the words the
// screens show today. Status words come from words.cjs.

const {
  button,
  heading,
  link,
  notice,
  on,
  prefixed,
  rowWith,
  shows,
  tab,
} = require("./screen.cjs");
const words = require("./words.cjs");

const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";

/** Opens the app and signs in on the kit's sign-in screen. */
async function signIn(page, base, email, password = PASSWORD) {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByTestId("sign-in-email").first().waitFor();
  await page.getByTestId("sign-in-email").first().fill(email);
  await page.getByTestId("sign-in-password").first().fill(password);
  await page.getByTestId("sign-in-submit").first().click();
}

/** The tabs of the tab bar, by their word. */
const tabs = {
  home: (page) => tab(page, "Inicio"),
  orders: (page) => tab(page, "Pedidos"),
  listings: (page) => tab(page, "Productos"),
  inventory: (page) => tab(page, "Inventario"),
  payouts: (page) => tab(page, "Pagos"),
};

/**
 * The element with this testID on the screen in front. The tabs keep their
 * screens (and each one's header) in the page; the one in front is the one
 * whose centre is not covered by another screen.
 */
async function inFront(page, id) {
  const all = page.getByTestId(id);
  const index = await all.evaluateAll((elements) =>
    elements.findIndex((el) => {
      const box = el.getBoundingClientRect();
      if (box.width === 0) return false;
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top !== null && el.contains(top);
    }),
  );
  if (index < 0) throw new Error(`Nothing called ${id} is on screen`);
  return all.nth(index);
}

/** The sheet that asks which shop to work in. */
const shopSheet = (page) =>
  page.getByRole("heading", { name: "¿En qué tienda va a trabajar?" }).first();

/**
 * Opens the shop sheet from the header and chooses the shop `name`; resolves
 * once the header and the home screen are that shop's. `whileOpen` runs with
 * the sheet up (a screenshot).
 */
async function chooseShop(page, name, whileOpen) {
  await (await inFront(page, "change-shop")).click();
  const sheet = shopSheet(page);
  await sheet.waitFor();
  await page.waitForTimeout(400); // the sheet slides up
  if (whileOpen) await whileOpen();
  await page
    .getByRole("radio", { name: new RegExp(name) })
    .first()
    .click();
  await sheet.waitFor({ state: "hidden" });
  await page.waitForFunction(
    (shopName) =>
      [...document.querySelectorAll('[data-testid="current-shop"]')].every((el) =>
        el.textContent.includes(shopName),
      ),
    name,
    { timeout: 10_000 },
  );
  await shows(page, "seller-overview", name);
}

/** The home screen says it is the shop `name`'s. */
const overviewOf = (page, name) => shows(page, "seller-overview", name);

/** The home screen's figure «Pedidos por empacar: n», which opens the orders. */
const toPackLink = (page, count) => link(page, new RegExp(`^Pedidos por empacar: ${count}`));

/** The «Volver» button of a stack screen. */
const back = (page) => button(page, "Volver");

// ── Productos ──────────────────────────────────────────────────────────────

/** The rows of the list of products (testID listing-<offer id>). */
const listingRows = (page) =>
  page.getByTestId(/^listing-[0-9a-f]{8}-[0-9a-f]{4}-/).filter({ visible: true });
/** The row of a product, by its title. */
const listingRow = (page, title) => listingRows(page).filter({ hasText: title }).first();

/** The offer screen's answer to a save says `wanted` (a string or a pattern). */
const offerResult = (page, wanted) => rowWith(page, "offer-result", wanted).first();
/** The answer of the stock form of one place says `wanted`. */
const stockResult = (page, wanted) =>
  page
    .getByTestId(/^stock-result-/)
    .filter({ visible: true, hasText: wanted })
    .first();
/** The row of an offer in Productos once it no longer reads «En pausa». */
const listingNotPaused = (page, offerId) =>
  page
    .getByTestId(`listing-${offerId}`)
    .filter({ visible: true, hasNotText: words.word("offer_status", "paused", "seller") })
    .first();
/** The offer screen marks the product's change as waiting for review. */
const changeInReview = (page) =>
  shows(page, "offer-badges", words.word("listing_edit", "pending", "seller"));

// ── Pedidos, Inventario ───────────────────────────────────────────────────

/** The orders tab has drawn its list of parcels to pack. */
const toPackHeading = (page) => heading(page, "Por empacar", { exact: true });
/** The cards of the places where the shop keeps stock (testID location-<id>). */
const placeCards = (page) =>
  page.getByTestId(/^location-[0-9a-f]{8}-[0-9a-f]{4}-/).filter({ visible: true });
/** The card of a place, by its name. */
const placeCard = (page, name) => placeCards(page).filter({ hasText: name }).first();

/** The new shop's home screen welcomes it: «Recibimos su solicitud». */
const welcome = (page) => notice(page, "Recibimos su solicitud");
/** The pickup place form says the point is marked. */
const pointMarked = (page) => notice(page, "Punto marcado");

// ── Team (Equipo) ──────────────────────────────────────────────────────────

/** The row of the team list for a member, told apart by what it says (e-mail, «(usted)»). */
const memberRow = (page, words) => rowWith(page, "team-member", words);
/** The row of a pending invitation, by its e-mail. */
const invitationRow = (page, email) => rowWith(page, "team-invitation", email);
/** Waits until the message of a member's row says `words`. */
const rowMessage = (row, words, options) =>
  row.getByTestId("member-message").filter({ hasText: words }).waitFor(options);

/** Sends an invitation from the team screen. */
async function invite(page, email) {
  await on(page, "invite-email").fill(email);
  await on(page, "invite-submit").click();
}

module.exports = {
  back,
  changeInReview,
  chooseShop,
  inFront,
  invitationRow,
  invite,
  listingNotPaused,
  listingRow,
  listingRows,
  memberRow,
  offerResult,
  overviewOf,
  placeCard,
  pointMarked,
  prefixed,
  rowMessage,
  signIn,
  stockResult,
  tabs,
  toPackHeading,
  toPackLink,
  welcome,
};
