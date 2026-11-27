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
const web = require("../lib/web.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
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
  const signIn = (page, email, password) => web.submitSignIn(page, email, password);
  const signUp = (page, email, name) =>
    web.signUp(page, { email, name, password: "mi-clave-nueva-1", next: "/cuenta" });

  const stamp = Date.now().toString().slice(-7);
  const email = `lucia${stamp}@yuntera.example`;

  // 1. Sign-up with confirmation on: "revise su correo", the resend limit.
  const { context, page } = await newPage();
  await signUp(page, email, "Lucía Fernández Arias");
  log("after sign-up:", (await web.statusText(page)).slice(0, 170));
  log("mobile overflow px:", await overflow(page));
  await page.screenshot({ path: SHOTS + "/d1-check-email.png", fullPage: true });
  await web.resendConfirmation(page);
  const limited = await web.alertText(page);
  log("resend at once:", limited);
  check(/Puede pedir otro en \d+ (segundos?|minutos?)\./.test(limited), "says when to try again");

  // 2. Signing in before confirming explains what is missing.
  const early = await newPage();
  await signIn(early.page, email, "mi-clave-nueva-1");
  await web.waitForCodeField(early.page);
  log("sign-in before confirming:", (await web.alertText(early.page)).slice(0, 150));
  await early.context.close();

  // 3. Confirm with the code from the e-mail: signed in, back where they were going.
  const confirmation = await mail(email, "confirmation");
  log("e-mail:", confirmation.subject, "| link:", new URL(confirmation.link).pathname);
  await web.confirmEmail(page, confirmation.token);
  await page.waitForURL((u) => new URL(u).pathname === "/cuenta");
  log("confirmed, now on:", path(page), "|", (await web.heading(page)).slice(0, 30));

  // The same person is also signed in on another device.
  const device = await newPage();
  await signIn(device.page, email, "mi-clave-nueva-1");
  await device.page.waitForURL((u) => new URL(u).pathname === "/");
  const deviceToken = await accessTokenOf(device.context);

  // 4. Delete the account.
  await web.openDeletion(page);
  const terms = await web.mainText(page);
  check(
    /Qué borramos/.test(terms) && /Qué conservamos y por qué/.test(terms),
    "explains what is erased and kept",
  );
  log("deletion page overflow px:", await overflow(page));
  await page.screenshot({ path: SHOTS + "/d2-delete.png", fullPage: true });
  await web.deleteAccount(page, "no-es-esta-clave");
  log("wrong password:", await web.alertText(page));
  // The form starts over after a refusal: the box has to be ticked again on purpose.
  check(!(await web.deletionTicked(page)), "the box is unticked again");
  await web.deleteAccount(page, "mi-clave-nueva-1");
  await page.waitForURL((u) => new URL(u).pathname === "/cuenta-eliminada");
  log("deleted:", (await web.mainText(page)).slice(0, 160));
  await page.screenshot({ path: SHOTS + "/d3-deleted.png", fullPage: true });
  await web.openReady(page, "/cuenta");
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
  await web.open(device.page, "/cuenta", "load");
  await device.page.waitForURL((u) => new URL(u).pathname === "/ingresar");
  log("other device, next page ->", path(device.page));
  await device.context.close();

  // 5. The account is gone; the address can start again.
  await signIn(page, email, "mi-clave-nueva-1");
  log("sign-in with the deleted account:", await web.alertText(page));
  await signUp(page, email, "Lucía Fernández Arias");
  const again = await mail(email, "confirmation");
  check(again.token !== confirmation.token, "a new confirmation code");
  await web.confirmEmail(page, again.token);
  await page.waitForURL((u) => new URL(u).pathname === "/cuenta");
  await web.open(page, "/pedidos", "load");
  log("the new account's orders:", (await web.mainText(page)).slice(0, 120));
  await context.close();

  // 6. A shopper with an order on its way is refused, with the reason.
  const busy = await newPage();
  await signIn(busy.page, "comprador@yuntera.example", PASSWORD);
  await busy.page.waitForURL((u) => new URL(u).pathname === "/");
  await web.openReady(busy.page, "/cuenta/eliminar");
  const refused = await web.statusText(busy.page);
  log("shopper with an order in progress:", refused);
  check(/pedidos en curso/.test(refused), "the reason is given");
  check((await web.passwordFields(busy.page)) === 0, "no form while blocked");
  await busy.page.screenshot({ path: SHOTS + "/d4-refused.png", fullPage: true });
  await busy.context.close();

  // 7. The public page, without signing in.
  const visitor = await newPage();
  await web.openReady(visitor.page, "/ayuda/eliminar-cuenta");
  log(
    "public page:",
    await web.heading(visitor.page),
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
