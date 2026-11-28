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

// A channel's box is found as a checkbox with the channel's name: the
// sign-in form that leads to this page has a text field also named "email",
// and while the framework swaps the pages both can be in main at once.

/** Every box of a channel on the notification settings (email, whatsapp, sms, commercial). */
const channelBoxes = (page, channel) =>
  main(page).locator(`input[type="checkbox"][name="${channel}"]`);

/** A channel's box on the notification settings. */
const channelBox = (page, channel) => channelBoxes(page, channel).first();

/** What a channel's box says: whether it is offered, ticked and can be changed. */
async function channelState(page, channel) {
  const box = channelBox(page, channel);
  const offered = await channelBoxes(page, channel).count();
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

/**
 * Waits for the notification settings page: its heading, its e-mail box (on
 * every settings page) and the sign-in form that led here gone from view, so a
 * count of a channel's boxes is the page's own.
 */
async function waitForNotificationSettings(page) {
  await page.getByRole("heading", { level: 1, name: "Notificaciones" }).first().waitFor();
  await channelBox(page, "email").waitFor();
  await main(page).locator('input[name="password"]').first().waitFor({ state: "hidden" });
}

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

// ── Password recovery (next-kit account pages and forms) ───────────────────

/** From the sign-in page, «Olvidé mi contraseña», and waits for /recuperar. */
async function openForgotPassword(page) {
  await link(main(page), "Olvidé mi contraseña").click();
  await page.waitForURL((u) => new URL(u).pathname === "/recuperar");
}

/** «Enviarme un enlace» for this address; returns the answer (status). */
async function askResetLink(page, email) {
  await field(main(page), "email").fill(email);
  await button(main(page), "Enviarme un enlace").click();
  return text(main(page).getByRole("status").first());
}

/** «Enviarme un enlace» for this address, and waits for the code field. */
async function askResetCode(page, email) {
  await field(main(page), "email").fill(email);
  await button(main(page), "Enviarme un enlace").click();
  await field(main(page), "code").waitFor();
}

/** «Continuar» on the page an e-mail link opens. */
const continueFromLink = (page) => button(main(page), "Continuar", true).click();

/** The password rules the new-password form shows. */
const passwordRules = (page) =>
  text(main(page).getByRole("list", { name: "Requisitos de la contraseña" }));

/** Types the new password twice and saves it. */
async function saveNewPassword(page, password, repeat = password) {
  await field(main(page), "password").fill(password);
  await field(main(page), "repeat").fill(repeat);
  await button(main(page), "Guardar la contraseña nueva").click();
}

/** Types the 6-digit code and continues. */
async function continueWithCode(page, code) {
  await field(main(page), "code").fill(code);
  await button(main(page), "Continuar con el código").click();
}

/** How many «Pedir otro correo» links the page offers. */
const askAgainLinks = (page) => main(page).getByRole("link", { name: "Pedir otro correo" }).count();

/** Waits for the reset page's answer, whichever it is (a message, or the form). */
const waitForResetAnswer = (page) =>
  main(page).locator('[role="status"], [role="alert"], input[name="password"]').first().waitFor();

const passwordRecovery = {
  openForgotPassword,
  askResetLink,
  askResetCode,
  continueFromLink,
  passwordRules,
  saveNewPassword,
  continueWithCode,
  askAgainLinks,
  waitForResetAnswer,
};
module.exports.passwordRecovery = passwordRecovery;

/** The visible text of the whole page (for a screen without a main, as field's not-found). */
module.exports.pageText = (page) => text(page.locator("body"));

// ── Two-step verification (next-kit account pages and forms) ───────────────

const twoStep = (page) => main(page).getByRole("region", { name: "Verificación en dos pasos" });

/** The account page's two-step section, as one line. */
const twoStepSection = (page) => text(twoStep(page));

/** The two-step section's badge (what follows its heading), as one line. */
const twoStepBadge = (page) => text(twoStep(page).locator("h2 + *").first());

/** From the account page, «Activar la verificación», and waits for /dos-pasos. */
async function openTwoStep(page) {
  await link(main(page), "Activar la verificación").click();
  await page.waitForURL((u) => new URL(u).pathname === "/dos-pasos");
  await hydrated(page);
}

/** «Empezar» on /dos-pasos: returns the secret shown as text and the QR code's address. */
async function startEnrolment(page) {
  await button(main(page), "Empezar").click();
  const secretBox = main(page).locator("[data-secret]").first();
  await secretBox.waitFor();
  return {
    secret: await secretBox.getAttribute("data-secret"),
    qr: await main(page).getByRole("img", { name: "Código QR" }).first().getAttribute("src"),
  };
}

/** Types the authenticator's code and «Activar la verificación». */
async function activateTwoStep(page, code) {
  await field(main(page), "code").fill(code);
  await button(main(page), "Activar la verificación").click();
}

/** Types a code on /verificar and «Verificar». */
async function verifyCode(page, code) {
  await field(main(page), "code").fill(code);
  await button(main(page), "Verificar", true).click();
}

/** «Salir» in the header. */
const signOut = (page) => button(page.getByRole("banner"), "Salir").click();

/** How many links the main navigation has (0 when it is not offered). */
const navLinks = (page) =>
  page.getByRole("navigation", { name: "Secciones" }).getByRole("link").count();

const secondFactor = {
  twoStepSection,
  twoStepBadge,
  openTwoStep,
  startEnrolment,
  activateTwoStep,
  verifyCode,
  signOut,
  navLinks,
};
module.exports.secondFactor = secondFactor;

/**
 * The text a row (or any element) shows outside its form controls, white
 * space squashed: a select's options are part of innerText, but not of what
 * the row says.
 */
const shownText = (locator) =>
  locator.first().evaluate((el) => {
    const copy = el.cloneNode(true);
    for (const control of copy.querySelectorAll("select, option, input, textarea, button"))
      control.remove();
    return copy.textContent.replace(/\s+/g, " ").trim();
  });

/** Waits until an element shows `words` outside its form controls. */
async function waitForShown(locator, words, { timeout = 15000, what = "the element" } = {}) {
  const deadline = Date.now() + timeout;
  let last = "";
  for (;;) {
    last = await shownText(locator).catch(() => "");
    if (last.includes(words)) return last;
    if (Date.now() >= deadline) {
      throw new Error(
        `${what}: waited ${timeout} ms for "${words}"; it showed "${last.slice(0, 300)}"`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

module.exports.shownText = shownText;
module.exports.waitForShown = waitForShown;

// ── Sign-in attempts and reset codes (next-kit forms), for the limits ──────

/**
 * Sends the sign-in form the page shows and answers the alert it shows, or
 * null when it signed in (left /ingresar).
 */
async function trySignIn(page, email, password) {
  const form = main(page).locator("form").first();
  await field(form, "email").fill(email);
  await field(form, "password").fill(password);
  await form.locator('button[type="submit"]').click();
  const outcome = await Promise.race([
    main(page)
      .getByRole("alert")
      .first()
      .waitFor()
      .then(() => "alert"),
    page.waitForURL((u) => new URL(u).pathname !== "/ingresar").then(() => "in"),
  ]);
  if (outcome === "in") return null;
  return text(main(page).getByRole("alert").first());
}

/** The e-mail the sign-in form holds. */
const signInEmailTyped = (page) => field(main(page), "email").inputValue();

/** Asks for a reset e-mail on the page open now; returns the answer (status or alert). */
async function askResetAnswer(page, email) {
  await field(main(page), "email").fill(email);
  await button(main(page), "Enviarme un enlace").click();
  const answer = main(page).locator('[role="status"], [role="alert"]').first();
  await answer.waitFor();
  return text(answer);
}

/**
 * One reset code; answers the alert shown, or null when it led to the
 * new-password page. Waits for the action's own answer: the alert of the
 * previous try looks the same.
 */
async function tryResetCode(page, code) {
  await field(main(page), "code").fill(code);
  const answered = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/recuperar",
  );
  await button(main(page), "Continuar con el código").click();
  const response = await answered;
  if (response.headers()["x-action-redirect"]) {
    await page.waitForURL((u) => new URL(u).pathname === "/recuperar/nueva");
    return null;
  }
  await page.waitForFunction(
    () => !document.querySelector("main button[disabled], main button[aria-busy='true']"),
  );
  return text(main(page).getByRole("alert").first());
}

Object.assign(module.exports, { trySignIn, signInEmailTyped, askResetAnswer, tryResetCode });

// ── Error pages (next-kit error-reports: the same in the four websites) ────

/** The sign-in form of next-kit, filled but not sent (so something can happen while it is typed). */
async function typeSignIn(page, email, password) {
  await field(main(page), "email").fill(email);
  await field(main(page), "password").fill(password);
}

/** Sends the sign-in form typed with typeSignIn. */
const sendSignIn = (page) => button(main(page), "Ingresar", true).click();

/** Waits for a website's error page («Algo falló de nuestro lado»). */
const waitForErrorPage = (page, timeout = 15_000) =>
  page.getByRole("heading", { name: "Algo falló de nuestro lado" }).waitFor({ timeout });

/** Whether the error page says the team was told, waiting up to `timeout` ms for it to say so. */
async function teamToldShown(page, timeout = 0) {
  const told = (said) => said.includes("Ya le avisamos al equipo de Yuntera.");
  if (timeout > 0) {
    await settledText(page.locator("body"), told, { timeout, what: "the error page" }).catch(
      () => undefined,
    );
  }
  return told(await text(page.locator("body")));
}

/** «Intentar de nuevo» on the error page; whether the page then loaded again (the drill's words). */
async function retryErrorPage(page) {
  await button(page, "Intentar de nuevo").click();
  return settledText(page.locator("body"), (said) => said.includes("La página volvió a cargar."), {
    what: "the page tried again",
  })
    .then(() => true)
    .catch(() => false);
}

Object.assign(module.exports, {
  typeSignIn,
  sendSignIn,
  waitForErrorPage,
  teamToldShown,
  retryErrorPage,
});

// ── Sideways scroll, measured against the screen ───────────────────────────
// In a phone context (isMobile) a page that is too wide widens the layout
// viewport, and window.innerWidth with it, so `scrollWidth - innerWidth`
// reads 0 however wide the page is. overflowPx measures the document's
// scrollWidth against the width the context was opened with
// (page.viewportSize()), which the page cannot change.
//
// KNOWN_TOO_WIDE: pages that existed before wave 9 and are too wide until
// the stage of the rebuild that redraws them. Each is reported when it is
// measured, and is not a failure while it stays within the width listed. The
// list may only shrink: a page wider than listed fails, a page that fits
// again is reported so its line is taken out, and no line is added for a
// page wave 9 or later work made.
const KNOWN_TOO_WIDE = [
  // { route: /^\/example$/, screen: 390, measured: 412, stage: 2 },
];

/** How many px the page is wider than the context's screen (0 or less: it fits). */
async function overflowPx(page) {
  const screen = page.viewportSize()?.width;
  if (!screen) throw new Error("overflowPx: the page's context has no viewport width");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  const route = new URL(page.url()).pathname;
  const known = KNOWN_TOO_WIDE.find((k) => k.screen === screen && k.route.test(route));
  if (known && wide > screen && wide <= known.measured) {
    process.stdout.write(
      `  (known too wide until stage ${known.stage} of the rebuild: ${route} is ${wide} px at ${screen}, listed at ${known.measured})\n`,
    );
    return 0;
  }
  if (known && wide <= screen) {
    process.stdout.write(
      `  (${route} fits ${screen} px now: take its line out of KNOWN_TOO_WIDE in tools/e2e/lib/kit.cjs)\n`,
    );
  }
  return wide - screen;
}

Object.assign(module.exports, { overflowPx, KNOWN_TOO_WIDE });
