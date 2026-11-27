// Screen steps on what packages/next-kit draws the same way in all four web
// apps (the sign-in form, form outcomes) and small readers the app helpers
// share. The app helpers (web.cjs, seller.cjs, ops.cjs, field.cjs) call these;
// journey files do not. Whoever changes next-kit's sign-in form or its form
// outcome changes this file.
//
// How things are found (rule 20.5.1 of docs/brand/system/SISTEMA.md): by role
// and accessible name, by [name=…] for a form field, or by data-testid. Never
// by a CSS class, never by a text match on a container.

const { settledText } = require("./settle.cjs");

/** White space squashed, as the journeys compare texts. */
const squash = (value) => value.replace(/\s+/g, " ").trim();

/** The visible text of a locator, white space squashed. */
const text = async (locator) => squash(await locator.innerText());

/** The page's main landmark (hidden copies of earlier pages are not in the accessibility tree). */
const main = (page) => page.getByRole("main");

// field, button and link take the first match, as the page methods the
// journeys used before (page.fill, page.click…) did; .count() on them is
// 0 or 1, so a helper counts with the full locator when it needs a number.

/**
 * A form field by its name attribute, inside `scope` (the first one). `tag`
 * (input, select, textarea) narrows it where two fields of a scope share a name.
 */
const field = (scope, name, tag = "") => scope.locator(`${tag}[name="${name}"]`).first();

/** A button by its accessible name, inside `scope` (the first one). */
const button = (scope, name, exact = false) => scope.getByRole("button", { name, exact }).first();

/** A link by its accessible name, inside `scope` (the first one). */
const link = (scope, name, exact = false) => scope.getByRole("link", { name, exact }).first();

/** An element by its data-testid, inside `scope`. */
const testid = (scope, id) => scope.locator(`[data-testid="${id}"]`);

/**
 * Rows of a list (or any locator) that show `value`: a data value such as an
 * order number, a tracking code or an e-mail address — never a product word.
 * This is the one place the journeys match a container by what it shows,
 * because data values do not change when screens are redrawn.
 */
const withValue = (locator, value) => locator.filter({ hasText: value });

/** The sign-in form of next-kit: e-mail, password, «Ingresar». */
async function fillSignIn(page, email, password) {
  const scope = main(page);
  await field(scope, "email").fill(email);
  await field(scope, "password").fill(password);
  await button(scope, "Ingresar", true).click();
}

/** The error the sign-in form (or any form in main) shows, or null. */
async function formError(page, timeout = 10_000) {
  const alert = main(page).getByRole("alert").first();
  try {
    await alert.waitFor({ timeout });
  } catch {
    return null;
  }
  return text(alert);
}

/** The visible text of main, white space squashed. */
const mainText = (page) => text(main(page));

/** The main heading (h1) of the page, white space squashed. */
const heading = (page) => text(main(page).getByRole("heading", { level: 1 }).first());

/** The first status message (role status) in main, white space squashed. */
const statusText = (page) => text(main(page).getByRole("status").first());

/** The first error message (role alert) in main, white space squashed. */
const alertText = (page) => text(main(page).getByRole("alert").first());

/**
 * Waits until React has taken over the visible page's form (or the page). The
 * framework keeps the previous page in the document, hidden, during a
 * navigation, so only what is visible counts.
 */
function hydrated(page) {
  return page.waitForFunction(() => {
    const main = [...document.querySelectorAll("main")].find((m) => m.checkVisibility());
    const el = main?.querySelector("form") ?? main;
    return el && Object.keys(el).some((key) => key.startsWith("__react"));
  });
}

/**
 * Clicks the button named `name` inside `scope` (the last one, when a form
 * repeats it) and waits for the page's new outcome: the form's own message,
 * or the page's notice once the form that sent it is gone. Returns that
 * outcome as one line ("" if none came within 15 s).
 */
async function submitAndRead(page, scope, name) {
  const outcomes = () =>
    page.locator(
      '[data-catalogue-outcome] [role="status"], main [role="status"], main [role="alert"]',
    );
  const before = (await outcomes().allInnerTexts()).join("|");
  await scope.getByRole("button", { name }).last().click();
  const deadline = Date.now() + 15000;
  let now = "";
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    now = (await outcomes().allInnerTexts()).join("|");
    if (now && now !== before) break;
  }
  const all = await outcomes().allInnerTexts();
  return squash(all.find((t) => !before.includes(t)) ?? all.at(-1) ?? "");
}

/**
 * Clicks the button named `name` inside the form `scope` and waits for that
 * form's new message (role status or alert) once it differs from before.
 * `after` is where to read it when the change itself moves the form (a
 * renamed row has a new address). Returns the last message, as one line.
 */
async function submitInForm(page, scope, name, after = scope) {
  const messages = (where) => where.locator('[role="status"], [role="alert"]');
  const before = (await messages(scope).allInnerTexts()).join("|");
  await scope.getByRole("button", { name }).last().click();
  const deadline = Date.now() + 15000;
  let now = "";
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    now = (await messages(after).allInnerTexts()).join("|");
    if (now && now !== before) break;
  }
  const last = (await messages(after).allInnerTexts()).at(-1);
  return last === undefined ? "" : squash(last);
}

/**
 * The text of `locator` once it includes `expected` (waiting up to `timeout`
 * ms), or whatever it says when the time is up. Never throws for the wait.
 */
async function textOnceIncludes(locator, expected, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const now = await text(locator).catch(() => "");
    if (now.includes(expected) || Date.now() >= deadline) return now;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * The first message (role status or alert) in main whose text includes
 * `words`, as one line, or "" when there is none. Only for messages drawn by
 * packages/ui's Alert, which takes no data-testid (asked of its owner); a
 * helper names the words, a journey never does.
 */
async function messageWith(page, words) {
  const all = await main(page).locator('[role="status"], [role="alert"]').allInnerTexts();
  return squash(all.find((t) => t.includes(words)) ?? "");
}

/**
 * Waits (up to `timeout` ms) for a message (role status or alert) inside
 * `scope` whose text includes `words`, and returns it as one line. Throws
 * with the messages seen when none comes. Same reason as messageWith.
 */
async function waitForMessage(scope, words, options = {}) {
  return text(await findMessage(scope, words, options));
}

/** As waitForMessage, but returns the message itself (a locator), to act inside it. */
async function findMessage(scope, words, { timeout = 15000, roles = "status, alert" } = {}) {
  const selector = roles
    .split(",")
    .map((role) => `[role="${role.trim()}"]`)
    .join(", ");
  const deadline = Date.now() + timeout;
  let all = [];
  for (;;) {
    all = (await scope.locator(selector).allInnerTexts()).map(squash);
    const index = all.findIndex((t) => t.includes(words));
    if (index >= 0) return scope.locator(selector).nth(index);
    if (Date.now() >= deadline) {
      throw new Error(
        `waited ${timeout} ms for a message with "${words}"; saw ${JSON.stringify(all)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

module.exports = {
  findMessage,
  waitForMessage,
  messageWith,
  submitInForm,
  textOnceIncludes,
  submitAndRead,
  squash,
  text,
  main,
  field,
  button,
  link,
  testid,
  withValue,
  fillSignIn,
  formError,
  mainText,
  heading,
  statusText,
  alertText,
  hydrated,
};

// ── Notification settings (next-kit NotificationSettingsForm: shop and seller centre) ──

/** A channel's box on the notification settings (email, whatsapp, sms, commercial). */
const channelBox = (page, channel) => field(main(page), channel);

/** What a channel's box says: whether it is offered, ticked and can be changed. */
async function channelState(page, channel) {
  const box = channelBox(page, channel);
  const offered = await main(page).locator(`[name="${channel}"]`).count();
  return {
    offered,
    checked: offered ? await box.isChecked() : false,
    disabled: offered ? await box.isDisabled() : false,
  };
}

/** The label of a channel's box (for its size). */
const channelLabel = (page, channel) => page.locator(`label[for="aviso-${channel}"]`);

/** Ticks or unticks a channel. */
const setChannel = (page, channel, on) =>
  on ? channelBox(page, channel).check() : channelBox(page, channel).uncheck();

/** Types the mobile number for WhatsApp and SMS. */
const typeMobile = (page, phone) => field(main(page), "phone").fill(phone);

/** The mobile number the settings hold. */
const mobileTyped = (page) => field(main(page), "phone").inputValue();

/** «Guardar preferencias». */
const savePreferences = (page) => button(main(page), "Guardar preferencias").click();

/** «Guardar preferencias», then the first error. */
async function savePreferencesRefused(page) {
  await savePreferences(page);
  await main(page).getByRole("alert").first().waitFor();
  return text(main(page).getByRole("alert").first());
}

/** «Guardar preferencias», then waits until main says `said`. */
async function savePreferencesUntil(page, said) {
  await savePreferences(page);
  await settledText(main(page), said, { what: "the notification settings" });
}

/** Waits for the notification settings page. */
const waitForNotificationSettings = (page) =>
  page.getByRole("heading", { level: 1, name: "Notificaciones" }).first().waitFor();

const notificationSettings = {
  channelState,
  channelLabel,
  setChannel,
  typeMobile,
  mobileTyped,
  savePreferencesRefused,
  savePreferencesUntil,
  waitForNotificationSettings,
};
module.exports.notificationSettings = notificationSettings;
