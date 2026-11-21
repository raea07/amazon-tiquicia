// Account deletion in the shop, with e-mail confirmation switched on for this
// journey's database: a new shopper signs up, is told to check their e-mail,
// sees the resend limit, cannot sign in before confirming, confirms with the
// code, and deletes the account (wrong password first), after which the token
// and page of another device where the account was signed in stop working at
// once; the address can then
// sign up again from scratch. A shopper with an order on its way is refused,
// with the reason. The public page about deletion opens without signing in.
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
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
const check = (ok, what) => {
  if (!ok) throw new Error(`check failed: ${what}`);
};

async function api(method, path, data, token) {
  const ctx = await request.newContext();
  const r = await ctx.fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: KEY,
      "x-supabase-api-version": "2024-01-01",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    data,
  });
  const body = r.status() === 204 ? null : await r.json().catch(() => null);
  await ctx.dispose();
  return { status: r.status(), body };
}

/** The access token inside a browser context's session cookie. */
async function accessTokenOf(context) {
  const cookie = (await context.cookies()).find((c) => /^sb-.*-auth-token$/.test(c.name));
  check(cookie, "the session cookie exists");
  const json = Buffer.from(cookie.value.replace(/^base64-/, ""), "base64url").toString("utf8");
  return JSON.parse(json).access_token;
}

async function mail(to, kind) {
  const { status, body } = await api("GET", `/dev/mail?to=${encodeURIComponent(to)}&kind=${kind}`);
  check(status === 200, `an e-mail (${kind}) reached ${to}`);
  return body;
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

/** Opens a page and waits until React has taken over its forms. */
async function go(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await hydrated(page);
}
const path = (page) => new URL(page.url()).pathname;
const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

(async () => {
  await api("POST", "/dev/settings", { confirm_email: "on" });

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
  const phone = {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  };
  const newPage = async (options = phone) => {
    const context = await browser.newContext(options);
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
  const signUp = async (page, email, name) => {
    await go(page, BASE + "/ingresar?modo=crear&siguiente=%2Fcuenta");
    await page.fill('main:visible input[name="fullName"]', name);
    await page.fill('main:visible input[name="email"]', email);
    await page.fill('main:visible input[name="password"]', "mi-clave-nueva-1");
    await page.check('main:visible input[name="acepta"]');
    await page.click('main:visible button:has-text("Crear cuenta")');
    await page.locator('main:visible input[name="code"]').waitFor();
  };

  const stamp = Date.now().toString().slice(-7);
  const email = `lucia${stamp}@yuntera.example`;

  // 1. Sign-up with confirmation on: "revise su correo", the resend limit.
  const { context, page } = await newPage();
  await signUp(page, email, "Lucía Fernández Arias");
  log(
    "after sign-up:",
    (await text(page.locator('main:visible [role="status"]').first())).slice(0, 170),
  );
  log("mobile overflow px:", await overflow(page));
  await page.screenshot({ path: SHOTS + "/d1-check-email.png", fullPage: true });
  await page.click('main:visible button:has-text("Enviarme otro correo")');
  const limited = await text(page.locator('main:visible [role="alert"]'));
  log("resend at once:", limited);
  check(/Puede pedir otro en \d+ (segundos?|minutos?)\./.test(limited), "says when to try again");

  // 2. Signing in before confirming explains what is missing.
  const early = await newPage();
  await signIn(early.page, email, "mi-clave-nueva-1");
  await early.page.locator('main:visible input[name="code"]').waitFor();
  log(
    "sign-in before confirming:",
    (await text(early.page.locator('main:visible [role="alert"]').first())).slice(0, 150),
  );
  await early.context.close();

  // 3. Confirm with the code from the e-mail: signed in, back where they were going.
  const confirmation = await mail(email, "confirmation");
  log("e-mail:", confirmation.subject, "| link:", new URL(confirmation.link).pathname);
  await page.fill('main:visible input[name="code"]', confirmation.token);
  await page.click('main:visible button:has-text("Confirmar mi correo")');
  await page.waitForURL((u) => new URL(u).pathname === "/cuenta");
  log(
    "confirmed, now on:",
    path(page),
    "|",
    (await text(page.locator("main:visible h1:visible"))).slice(0, 30),
  );

  // The same person is also signed in on another device.
  const device = await newPage();
  await signIn(device.page, email, "mi-clave-nueva-1");
  await device.page.waitForURL((u) => new URL(u).pathname === "/");
  const deviceToken = await accessTokenOf(device.context);

  // 4. Delete the account.
  await page.click('main:visible a:has-text("Eliminar mi cuenta")');
  await page.waitForURL((u) => new URL(u).pathname === "/cuenta/eliminar");
  await hydrated(page);
  await page.locator('main:visible h2:visible:has-text("Qué borramos")').waitFor();
  const terms = await text(page.locator("main:visible"));
  check(
    /Qué borramos/.test(terms) && /Qué conservamos y por qué/.test(terms),
    "explains what is erased and kept",
  );
  log("deletion page overflow px:", await overflow(page));
  await page.screenshot({ path: SHOTS + "/d2-delete.png", fullPage: true });
  await page.fill('main:visible input[name="password"]', "no-es-esta-clave");
  await page.check('main:visible input[name="entiendo"]');
  await page.click('main:visible button:has-text("Eliminar mi cuenta para siempre")');
  log("wrong password:", await text(page.locator('main:visible [role="alert"]')));
  // The form starts over after a refusal: the box has to be ticked again on purpose.
  check(
    !(await page.isChecked('main:visible input[name="entiendo"]')),
    "the box is unticked again",
  );
  await page.fill('main:visible input[name="password"]', "mi-clave-nueva-1");
  await page.check('main:visible input[name="entiendo"]');
  await page.click('main:visible button:has-text("Eliminar mi cuenta para siempre")');
  await page.waitForURL((u) => new URL(u).pathname === "/cuenta-eliminada");
  log("deleted:", (await text(page.locator("main:visible"))).slice(0, 160));
  await page.screenshot({ path: SHOTS + "/d3-deleted.png", fullPage: true });
  await go(page, BASE + "/cuenta");
  // The redirect streams in after the page loaded.
  await page
    .waitForURL((u) => new URL(u).pathname === "/ingresar", { timeout: 10000 })
    .catch(() => {});
  log("account page afterwards ->", path(page));
  check(path(page) === "/ingresar", "signed out");

  // The other device's token has not expired, but nothing it sends is
  // accepted any more: neither a direct call to the API nor its next page.
  const late = await api(
    "POST",
    "/rest/v1/rpc/save_address",
    {
      p_recipient_name: "Lucía Fernández Arias",
      p_phone: "+50688887777",
      p_postal_code: "10101",
      p_senas: "Casa azul frente al parque",
      p_lat: 9.93,
      p_lng: -84.08,
    },
    deviceToken,
  );
  log("other device, direct API call:", late.status, late.body?.message);
  check(late.status >= 400 && late.body?.message === "session_ended", "the stale token is refused");
  await device.page.goto(BASE + "/cuenta", { waitUntil: "load" });
  await device.page.waitForURL((u) => new URL(u).pathname === "/ingresar");
  log("other device, next page ->", path(device.page));
  await device.context.close();

  // 5. The account is gone; the address can start again.
  await signIn(page, email, "mi-clave-nueva-1");
  log("sign-in with the deleted account:", await text(page.locator('main:visible [role="alert"]')));
  await signUp(page, email, "Lucía Fernández Arias");
  const again = await mail(email, "confirmation");
  check(again.token !== confirmation.token, "a new confirmation code");
  await page.fill('main:visible input[name="code"]', again.token);
  await page.click('main:visible button:has-text("Confirmar mi correo")');
  await page.waitForURL((u) => new URL(u).pathname === "/cuenta");
  await page.goto(BASE + "/pedidos", { waitUntil: "load" });
  log("the new account's orders:", (await text(page.locator("main:visible"))).slice(0, 120));
  await context.close();

  // 6. A shopper with an order on its way is refused, with the reason.
  const busy = await newPage();
  await signIn(busy.page, "comprador@yuntera.example", PASSWORD);
  await busy.page.waitForURL((u) => new URL(u).pathname === "/");
  await go(busy.page, BASE + "/cuenta/eliminar");
  const refused = await text(busy.page.locator('main:visible [role="status"]').first());
  log("shopper with an order in progress:", refused);
  check(/pedidos en curso/.test(refused), "the reason is given");
  check(
    (await busy.page.locator('main:visible input[name="password"]').count()) === 0,
    "no form while blocked",
  );
  await busy.page.screenshot({ path: SHOTS + "/d4-refused.png", fullPage: true });
  await busy.context.close();

  // 7. The public page, without signing in.
  const visitor = await newPage();
  await go(visitor.page, BASE + "/ayuda/eliminar-cuenta");
  log(
    "public page:",
    await text(visitor.page.locator("main:visible h1:visible")),
    "| overflow px:",
    await overflow(visitor.page),
  );
  await visitor.page.screenshot({ path: SHOTS + "/d5-public.png", fullPage: true });
  await visitor.context.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
