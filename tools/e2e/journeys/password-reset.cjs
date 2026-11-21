// Password reset in the shop: ask for the e-mail (same answer for an unknown
// address), follow the link from the local mailbox, set a new password, see the
// old one refused and the other session ended; then the same with the 6-digit
// code; then a reused link, an expired link and a wrong code.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = process.env.WEB_URL || "http://127.0.0.1:3000";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const EMAIL = "comprador2@yuntera.example";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
const check = (ok, what) => {
  if (!ok) throw new Error(`check failed: ${what}`);
};

async function api(method, path, data) {
  const ctx = await request.newContext();
  const r = await ctx.fetch(`${API}${path}`, {
    method,
    headers: { apikey: KEY, "x-supabase-api-version": "2024-01-01" },
    data,
  });
  const body = r.status() === 204 ? null : await r.json().catch(() => null);
  await ctx.dispose();
  return { status: r.status(), body };
}

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
 * Opens a page and waits until React has taken over its forms. ("networkidle"
 * never comes on a phone-sized shop page: it keeps prefetching the links.)
 */
async function go(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await hydrated(page);
}

/** The latest e-mail of a kind sent to an address, from the stand-in's local mailbox. */
async function mail(to, kind) {
  const { status, body } = await api("GET", `/dev/mail?to=${encodeURIComponent(to)}&kind=${kind}`);
  check(status === 200, `an e-mail (${kind}) reached ${to}`);
  return body;
}

/** The e-mail link, on the address this journey's browser uses for the shop. */
const onBase = (link) => {
  const url = new URL(link);
  return `${BASE}${url.pathname}${url.search}`;
};

/** The refresh token inside a browser context's session cookie. */
async function refreshTokenOf(context) {
  const cookie = (await context.cookies()).find((c) => /^sb-.*-auth-token$/.test(c.name));
  check(cookie, "the session cookie exists");
  check(cookie.httpOnly, "the session cookie is HttpOnly");
  const json = Buffer.from(cookie.value.replace(/^base64-/, ""), "base64url").toString("utf8");
  return JSON.parse(json).refresh_token;
}

(async () => {
  // Another e-mail within a minute is allowed for this journey; the 60-second
  // limit is shown elsewhere. Links last an hour unless changed below.
  await api("POST", "/dev/settings", { email_max_frequency_seconds: "0" });

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  const newPage = async (options = {}) => {
    const context = await browser.newContext({ locale: "es-CR", ...options });
    const page = await context.newPage();
    watch(page);
    return { context, page };
  };
  const signIn = async (page, email, password) => {
    await go(page, BASE + "/ingresar");
    await page.fill('main:visible input[name="email"]', email);
    await page.fill('main:visible input[name="password"]', password);
    await page.click('main:visible form button[type="submit"]');
  };

  // 1. The same person is signed in somewhere else.
  const other = await newPage();
  await signIn(other.page, EMAIL, PASSWORD);
  await other.page.waitForURL((u) => new URL(u).pathname === "/");
  const otherRefresh = await refreshTokenOf(other.context);
  log("other session signed in");

  // 2. Ask for the e-mail, from the sign-in page's link.
  const { context, page } = await newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await go(page, BASE + "/ingresar");
  await page.click('main:visible a:has-text("Olvidé mi contraseña")');
  await page.waitForURL((u) => new URL(u).pathname === "/recuperar");
  log(
    "mobile /recuperar overflow px:",
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  await page.fill('main:visible input[name="email"]', "nadie-aqui@yuntera.example");
  await page.click('main:visible button:has-text("Enviarme un enlace")');
  const unknown = await text(page.locator('main:visible [role="status"]').first());
  await go(page, BASE + "/recuperar");
  await page.fill('main:visible input[name="email"]', EMAIL);
  await page.click('main:visible button:has-text("Enviarme un enlace")');
  const known = await text(page.locator('main:visible [role="status"]').first());
  log("answer for an unknown address:", unknown);
  check(unknown === known, "the same answer whether or not the address has an account");
  await page.screenshot({ path: SHOTS + "/r1-requested.png", fullPage: true });

  // 3. Follow the link from the e-mail.
  const first = await mail(EMAIL, "recovery");
  log(
    "e-mail:",
    first.subject,
    "| has code:",
    /^\d{6}$/.test(first.token),
    "| link:",
    first.link.replace(/token_hash=\w+/, "token_hash=…"),
  );
  check(first.body.includes(first.token), "the e-mail shows the 6-digit code");
  check(
    new URL(first.link).pathname === "/auth/confirm",
    "the link lands on the app's /auth/confirm",
  );
  await go(page, onBase(first.link));
  log("link page:", await text(page.locator("main:visible h1:visible")));
  await page.screenshot({ path: SHOTS + "/r2-link.png", fullPage: true });
  await page.click('main:visible button:has-text("Continuar")');
  await page.waitForURL((u) => new URL(u).pathname === "/recuperar/nueva");
  check(!page.url().includes("token"), "no token left in the address bar");

  // 4. New password: the rules are shown before sending; a mismatch is explained.
  log(
    "rules:",
    await text(page.locator('main:visible ul[aria-label="Requisitos de la contraseña"]')),
  );
  await page.fill('main:visible input[name="password"]', "nueva-clave-2026");
  await page.fill('main:visible input[name="repeat"]', "nueva-clave-2027");
  await page.click('main:visible button:has-text("Guardar la contraseña nueva")');
  log("mismatch:", await text(page.locator('main:visible [role="alert"]')));
  await page.fill('main:visible input[name="password"]', "nueva-clave-2026");
  await page.fill('main:visible input[name="repeat"]', "nueva-clave-2026");
  await page.click('main:visible button:has-text("Guardar la contraseña nueva")');
  const done = await text(page.locator('main:visible [role="status"]').first());
  log("after saving:", done);
  check(/demás sesiones/.test(done), "the person is told the other sessions were ended");
  await page.screenshot({ path: SHOTS + "/r3-saved.png", fullPage: true });

  // 5. The other session cannot be renewed; the old password no longer works.
  const renewed = await api("POST", "/auth/v1/token?grant_type=refresh_token", {
    refresh_token: otherRefresh,
  });
  log("other session renewal:", renewed.status, renewed.body?.code);
  check(renewed.status === 400, "the other session was ended");
  const fresh = await newPage();
  await signIn(fresh.page, EMAIL, PASSWORD);
  log("old password:", await text(fresh.page.locator('main:visible [role="alert"]')));
  await signIn(fresh.page, EMAIL, "nueva-clave-2026");
  await fresh.page.waitForURL((u) => new URL(u).pathname === "/");
  log("new password: signed in");
  await fresh.context.close();
  await other.context.close();

  // 6. Again, typing the code instead of following the link.
  await context.clearCookies();
  await go(page, BASE + "/recuperar");
  await page.fill('main:visible input[name="email"]', EMAIL);
  await page.click('main:visible button:has-text("Enviarme un enlace")');
  await page.locator('main:visible input[name="code"]').waitFor();
  await page.fill('main:visible input[name="code"]', "000000");
  await page.click('main:visible button:has-text("Continuar con el código")');
  log("wrong code:", await text(page.locator('main:visible [role="alert"]')));
  const second = await mail(EMAIL, "recovery");
  await page.fill(
    'main:visible input[name="code"]',
    `${second.token.slice(0, 3)} ${second.token.slice(3)}`,
  );
  await page.click('main:visible button:has-text("Continuar con el código")');
  await page.waitForURL((u) => new URL(u).pathname === "/recuperar/nueva");
  await page.fill('main:visible input[name="password"]', "otra-clave-2026");
  await page.fill('main:visible input[name="repeat"]', "otra-clave-2026");
  await page.click('main:visible button:has-text("Guardar la contraseña nueva")');
  log("with the code:", await text(page.locator('main:visible [role="status"]').first()));

  // 7. A used link, and an expired one, each get one clear message and a way to ask again.
  await context.clearCookies();
  await go(page, onBase(first.link));
  await page.click('main:visible button:has-text("Continuar")');
  const reused = await text(page.locator('main:visible [role="alert"]'));
  log("reused link:", reused);
  check(
    await page.locator('main:visible a:has-text("Pedir otro correo")').count(),
    "offers to ask again",
  );
  await page.screenshot({ path: SHOTS + "/r4-used-link.png", fullPage: true });

  await api("POST", "/dev/settings", { otp_expiry_seconds: "1" });
  await go(page, BASE + "/recuperar");
  await page.fill('main:visible input[name="email"]', EMAIL);
  await page.click('main:visible button:has-text("Enviarme un enlace")');
  await page.locator('main:visible input[name="code"]').waitFor();
  const third = await mail(EMAIL, "recovery");
  await page.waitForTimeout(2500);
  await go(page, onBase(third.link));
  await page.click('main:visible button:has-text("Continuar")');
  log("expired link:", await text(page.locator('main:visible [role="alert"]')));
  await go(page, BASE + "/recuperar/nueva");
  log(
    "new-password page without a session:",
    await text(page.locator('main:visible [role="alert"]')),
  );

  await context.close();
  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
