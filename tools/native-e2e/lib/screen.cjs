// How every native journey finds things on a screen (SISTEMA.md §20.5).
// The helpers of each app (shop.cjs, seller.cjs, driver.cjs, warehouse.cjs)
// and accounts.cjs build on these; journey files call the helpers.
//
// Rules this file keeps:
// - an element is found by its testID (`on`, `all`, `prefixed`, and
//   `testIds`, `testIdsFrom`, `testIdsEndingIn` for counts and scoped steps
//   in the journeys) or by its
//   role and accessible name (`role`, `button`, `link`, `tab`, `heading`,
//   `roleAll`);
// - words are read from an element found that way and checked: a word on
//   screen never finds an element by itself, and no element is found by a
//   class, a tag or its place on the page;
// - the one exception is a row of a list (`rowWith`): an element with a
//   testID, told apart from its siblings by what it says (an e-mail, a code).
// Kept out of journeys/ so the runner does not take it for a journey.

const { settledText, squash } = require("../../e2e/lib/settle.cjs");

/** The visible elements with this testID. */
const all = (page, id) => page.getByTestId(id).filter({ visible: true });
/** The first visible element with this testID. */
const on = (page, id) => all(page, id).first();
/** Visible elements whose testID starts with `prefix` (lists such as `product-<slug>`). */
const prefixed = (page, prefix, more = "") =>
  page.locator(`[data-testid^="${prefix}"]${more}`).filter({ visible: true });
/** The visible elements with this testID that say `words` (rows of a list). */
const rowWith = (page, id, words) => page.getByTestId(id).filter({ visible: true, hasText: words });
/** Waits until an element with this testID says `words`. */
const shows = (page, id, words, options) => rowWith(page, id, words).first().waitFor(options);

/**
 * Every element with this testID inside `scope` (a page or an element found
 * by testID), shown or not: for counts ("there is no delete button") and for
 * steps that pick `.first()` or filter by visibility themselves.
 */
const testIds = (scope, id) => scope.getByTestId(id);
/**
 * Every element inside `scope` whose testID starts with `prefix`, shown or
 * not; `more` adds an attribute condition (`[aria-checked="true"]`).
 */
const testIdsFrom = (scope, prefix, more = "") =>
  scope.locator(`[data-testid^="${prefix}"]${more}`);
/** Every element inside `scope` whose testID ends with `suffix`, shown or not. */
const testIdsEndingIn = (scope, suffix) => scope.locator(`[data-testid$="${suffix}"]`);
/** Every element with this role inside `scope` (no name: for counts and the selected tab). */
const roleAll = (scope, kind, options) => scope.getByRole(kind, options);

/** The first visible element with this role and accessible name. */
const role = (page, kind, name, options = {}) =>
  page
    .getByRole(kind, { name, ...options })
    .filter({ visible: true })
    .first();
const button = (page, name, options) => role(page, "button", name, options);
const link = (page, name, options) => role(page, "link", name, options);
const heading = (page, name, options) => role(page, "heading", name, options);
/** A tab of the tab bar, by the start of its name (the name ends with its badge). */
const tab = (page, name) => page.getByRole("tab", { name: new RegExp(`^${name}`) }).first();

/**
 * The visible message boxes (expo-kit `Alert`: role status, or alert for
 * errors) that say `words`. A box has no name of its own, so it is found by
 * its role and checked by its words.
 */
const notice = (page, words) =>
  page
    .getByRole("status")
    .or(page.getByRole("alert"))
    .filter({ visible: true, hasText: words })
    .first();

/** Everything the screen says, white space squashed: for checks, never to find an element. */
const screenText = async (page) => squash(await page.locator("body").innerText());
/** Every word in the page, screens kept behind the one in front included, squashed: for checks. */
const allText = async (page) => squash(await page.locator("body").textContent());

/** How many pixels the page scrolls sideways (0 or less: none). */
const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** The same functions, bound to one page. */
function screen(page) {
  return {
    all: (id) => all(page, id),
    on: (id) => on(page, id),
    prefixed: (prefix, more) => prefixed(page, prefix, more),
    rowWith: (id, words) => rowWith(page, id, words),
    shows: (id, words, options) => shows(page, id, words, options),
    role: (kind, name, options) => role(page, kind, name, options),
    button: (name, options) => button(page, name, options),
    link: (name, options) => link(page, name, options),
    heading: (name, options) => heading(page, name, options),
    tab: (name) => tab(page, name),
    notice: (words) => notice(page, words),
    screenText: () => screenText(page),
    overflow: () => overflow(page),
  };
}

module.exports = {
  all,
  allText,
  button,
  heading,
  link,
  notice,
  on,
  overflow,
  prefixed,
  role,
  roleAll,
  rowWith,
  screen,
  screenText,
  settledText,
  shows,
  squash,
  tab,
  testIds,
  testIdsEndingIn,
  testIdsFrom,
};
