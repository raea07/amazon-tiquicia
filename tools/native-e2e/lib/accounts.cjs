// What the account journeys (journeys/accounts-*.cjs) share: talking to the
// lane's API as a person would (sign-up, a token, a database function, the
// local mailbox), an authenticator app in a few lines, and a phone-sized
// browser page that fails the journey on any console error, uncaught
// exception or 5xx, except refusals the journey announces it expects.
//
// Kept out of journeys/ so the runner does not take it for a journey.
// node:crypto computes the authenticator's codes in this test code only.

const { createHmac, randomUUID } = require("node:crypto");
const { request } = require("playwright");
const { overflow, shows } = require("./screen.cjs");

const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...args) => console.log(...args);

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

/** One call to the API's HTTP interface. */
async function http(method, path, { data, token, headers = {} } = {}) {
  const ctx = await request.newContext();
  try {
    const r = await ctx.fetch(`${API}${path}`, {
      method,
      headers: {
        apikey: KEY,
        "x-supabase-api-version": "2024-01-01",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      data,
    });
    const text = await r.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: r.status(), body };
  } finally {
    await ctx.dispose();
  }
}

/** A new account nobody else uses, signed up through Auth (confirmation is off locally). */
async function throwaway(label, fullName = "Persona de Prueba") {
  const email = `${label}-${randomUUID().slice(0, 8)}@prueba.example`;
  const r = await http("POST", "/auth/v1/signup", {
    data: { email, password: PASSWORD, data: { full_name: fullName } },
  });
  if (r.status !== 200)
    throw new Error(`sign-up of ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return email;
}

async function token(email, password = PASSWORD) {
  const r = await http("POST", "/auth/v1/token?grant_type=password", {
    data: { email, password },
  });
  if (r.status !== 200) throw new Error(`token for ${email}: ${r.status}`);
  return r.body.access_token;
}

/** A database function called as `email`, as the apps call it. */
async function rpcAs(email, fn, args = {}) {
  const r = await http("POST", `/rest/v1/rpc/${fn}`, { data: args, token: await token(email) });
  if (r.status >= 400) throw new Error(`${fn} as ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** The latest e-mail "sent" to an address, from the local API's mailbox, or null. */
async function mail(to, kind) {
  const r = await http(
    "GET",
    `/dev/mail?to=${encodeURIComponent(to)}${kind ? `&kind=${kind}` : ""}`,
  );
  return r.status === 200 ? r.body : null;
}

// An authenticator app (RFC 6238: SHA-1, 6 digits, 30 s), as in seller.cjs.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text.replace(/\s+/g, "").toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n =
    ((mac[offset] & 127) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(n % 1e6).padStart(6, "0");
}
const lastStep = new Map();
/** A code Auth has not taken yet for this secret: the current step, or the next one. */
async function freshCode(secret) {
  let step = Math.floor(Date.now() / 30000);
  const used = lastStep.get(secret) ?? -1;
  if (step <= used) step = used + 1;
  while (step > Math.floor(Date.now() / 30000) + 1) await new Promise((r) => setTimeout(r, 1000));
  lastStep.set(secret, step);
  return codeAt(secret, step);
}

/** Turns on an authenticator app for `email` through Auth, as the website does. Returns its secret. */
async function enrolAuthenticator(email) {
  const aal1 = await token(email);
  const factor = (
    await http("POST", "/auth/v1/factors", { data: { factor_type: "totp" }, token: aal1 })
  ).body;
  const challenge = (
    await http("POST", `/auth/v1/factors/${factor.id}/challenge`, { data: {}, token: aal1 })
  ).body;
  const verified = await http("POST", `/auth/v1/factors/${factor.id}/verify`, {
    data: { challenge_id: challenge.id, code: await freshCode(factor.totp.secret) },
    token: aal1,
  });
  if (verified.status !== 200) throw new Error(`enrolling a factor: ${verified.status}`);
  return factor.totp.secret;
}

/**
 * A phone-sized page, 360 px wide. `expect(pattern)` allows console errors matching it
 * (a refusal the step provokes on purpose: the browser logs every 4xx) until
 * `expect(null)`; everything else fails the journey at the end.
 */
async function phone(browser, name, errors) {
  // 360 px: the narrowest phone the native apps are made for.
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    timezoneId: "America/Costa_Rica",
  });
  const page = await context.newPage();
  let allowed = null;
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const where = m.location()?.url ?? "";
    const line = `${m.text()} ${where}`;
    if (allowed?.test(line)) {
      log(`    (expected refusal: ${line.slice(0, 160)})`);
      return;
    }
    errors.push(`${name} console: ${line.slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`${name} pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${name} HTTP ${r.status()} ${r.url()}`);
  });
  const on = (id) => page.getByTestId(id).filter({ visible: true }).first();
  return {
    context,
    page,
    on,
    said: async (id) => (await on(id).innerText()).replace(/\s+/g, " ").trim(),
    shot: (file, fullPage = false) =>
      page.screenshot({ path: `${SHOTS}/native-${file}.png`, fullPage }),
    /** Waits until an element with this testID says `words`. */
    shows: (id, words, options) => shows(page, id, words, options),
    noSideways: async (where) =>
      check((await overflow(page)) <= 0, `${where}: no sideways scrolling at 360 px`),
    /** Keys the app keeps in the browser's storage (the web export's secure store and app storage). */
    stored: () => page.evaluate(() => Object.keys(localStorage)),
    expect: (pattern) => {
      allowed = pattern;
    },
  };
}

/** Fills the kit's sign-in form. */
async function signIn(p, email, password = PASSWORD) {
  await p.on("sign-in-email").fill(email);
  await p.on("sign-in-password").fill(password);
  await p.on("sign-in-submit").click();
}

/** From the kit's sign-in screen: «Olvidé mi contraseña», an address, send. */
async function requestReset(p, email) {
  await p.on("forgot-password").click();
  await p.on("reset-email").fill(email);
  await p.on("reset-submit").click();
}

/** The kit's password change: the current password, the new one twice, send. */
async function changePassword(p, current, next) {
  await p.on("password-current").fill(current);
  await p.on("password-new").fill(next);
  await p.on("password-repeat").fill(next);
  await p.on("password-submit").click();
}

/** Su cuenta of the seller, driver and warehouse apps, from their home screen. */
async function openAccount(p) {
  await p.on("open-account").scrollIntoViewIfNeeded();
  await p.on("open-account").click();
}

/**
 * The shop's website (apps/web), opened from the reset e-mail's link: it asks
 * to continue, then takes the new password twice, and says it changed. These
 * are the website's screens: when the website is rebuilt, its journey owner
 * keeps this step working (tools/e2e/lib/web.cjs has the same screens).
 */
async function newPasswordOnWebsite(page, confirmUrl, password) {
  await page.goto(confirmUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/recuperar\/nueva/);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="repeat"]').fill(password);
  await page
    .getByRole("button", { name: /contraseña/i })
    .last()
    .click();
  // The website's success box (packages/ui Alert, role status), found by its
  // role and checked by its words (README rule 2).
  await page.getByRole("status").filter({ hasText: "su contraseña cambió" }).first().waitFor();
}

/**
 * The kit's deletion screen, from the terms to the deletion: checks that it
 * says what is erased and kept, refuses an unticked box and a wrong password,
 * then deletes. Leaves the page on whatever the app shows next.
 */
async function deleteThroughScreen(p, email, label, password = PASSWORD) {
  await p.on("deletion-terms").waitFor();
  const terms = await p.said("deletion-terms");
  check(
    terms.includes("Qué borramos") &&
      terms.includes("Qué conservamos y por qué") &&
      terms.includes("cinco años para los comprobantes electrónicos"),
    `${label}: the screen says what is erased, what is kept and why`,
  );
  check(
    (await p.on("delete-understood").getAttribute("aria-checked")) === "false",
    `${label}: the confirmation box starts unticked`,
  );
  await p.on("delete-password").fill(password);
  await p.on("delete-submit").click();
  await p.on("delete-message").waitFor();
  check(
    /Marque la casilla/.test(await p.said("delete-message")),
    `${label}: nothing happens without the box ticked`,
  );
  await p.on("delete-understood").click();
  p.expect(/status of 400.*\/auth\/v1\/token/);
  await p.on("delete-password").fill("no-es-la-clave");
  await p.on("delete-submit").click();
  await p.shows("delete-message", "La contraseña no coincide");
  check(
    (await http("POST", "/auth/v1/token?grant_type=password", { data: { email, password } }))
      .status === 200,
    `${label}: a wrong password is refused and nothing is deleted`,
  );
  await p.noSideways(`${label} deletion screen`);
  await p.shot(`${label}-delete-confirm`, true);
  // The database has ended every session of the account before the phone
  // signs out locally, so Auth answers that sign-out with 403: expected.
  p.expect(/status of 403.*\/auth\/v1\/logout/);
  await p.on("delete-password").fill(password);
  await p.on("delete-submit").click();
  await p.on("account-deleted").waitFor();
  p.expect(null);
  check(true, `${label}: the account is deleted and the start screen says so`);
  const keys = await p.stored();
  check(
    !keys.some((key) => key.startsWith("sb-")),
    `${label}: no session is left on the phone (${keys.join(", ") || "nothing stored"})`,
  );
  const gone = await http("POST", "/auth/v1/token?grant_type=password", {
    data: { email, password },
  });
  check(gone.status === 400, `${label}: the old e-mail and password no longer sign in`);
  return keys;
}

module.exports = {
  API,
  KEY,
  PASSWORD,
  SHOTS,
  changePassword,
  check,
  codeAt,
  deleteThroughScreen,
  enrolAuthenticator,
  freshCode,
  http,
  log,
  mail,
  newPasswordOnWebsite,
  openAccount,
  phone,
  requestReset,
  rpcAs,
  signIn,
  throwaway,
  token,
};
