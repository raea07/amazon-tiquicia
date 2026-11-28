// Password reset in the shop: ask for the e-mail (same answer for an unknown
// address), follow the link from the local mailbox, set a new password, see the
// old one refused and the other session ended (its open page goes to sign-in
// at once); an ordinary session cannot use the reset page; then the same with
// the 6-digit code; then a reused link, an expired link and a wrong code; and a
// link asked for with a disallowed address, which falls back to the shop.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const web = require("../lib/web.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = web.BASE;
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const EMAIL = "comprador2@yuntera.example";
const log = (...a) => console.log(...a);
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

/** Opens a full address and waits until React has taken over its forms. */
const go = (page, url) => web.openLink(page, url);

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
    await web.submitSignIn(page, email, password);
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
  await web.openReady(page, "/ingresar");
  await web.openForgotPassword(page);
  log("mobile /recuperar overflow px:", await kit.overflowPx(page));
  const unknown = await web.askResetLink(page, "nadie-aqui@yuntera.example");
  await web.openReady(page, "/recuperar");
  const known = await web.askResetLink(page, EMAIL);
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
  log("link page:", await web.heading(page));
  await page.screenshot({ path: SHOTS + "/r2-link.png", fullPage: true });
  await web.continueFromLink(page);
  await page.waitForURL((u) => new URL(u).pathname === "/recuperar/nueva");
  check(!page.url().includes("token"), "no token left in the address bar");

  // 4. New password: the rules are shown before sending; a mismatch is explained.
  log("rules:", await web.passwordRules(page));
  await web.saveNewPassword(page, "nueva-clave-2026", "nueva-clave-2027");
  log("mismatch:", await web.alertText(page));
  await web.saveNewPassword(page, "nueva-clave-2026");
  const done = await web.statusText(page);
  log("after saving:", done);
  check(/demás sesiones/.test(done), "the person is told the other sessions were ended");
  await page.screenshot({ path: SHOTS + "/r3-saved.png", fullPage: true });

  // 5. The other session cannot be renewed; the old password no longer works.
  const renewed = await api("POST", "/auth/v1/token?grant_type=refresh_token", {
    refresh_token: otherRefresh,
  });
  log("other session renewal:", renewed.status, renewed.body?.code);
  check(renewed.status === 400, "the other session was ended");
  // Not only its renewal: the page it still has open stops working at once
  // (the database refuses the token of an ended session) and goes to sign-in.
  await web.open(other.page, "/cuenta", "load");
  await other.page.waitForURL((u) => new URL(u).pathname === "/ingresar");
  log("other session, next page:", new URL(other.page.url()).pathname);
  const fresh = await newPage();
  await signIn(fresh.page, EMAIL, PASSWORD);
  log("old password:", await web.alertText(fresh.page));
  await signIn(fresh.page, EMAIL, "nueva-clave-2026");
  await fresh.page.waitForURL((u) => new URL(u).pathname === "/");
  log("new password: signed in");
  // An ordinary session (no reset link or code) cannot set a password without
  // the current one: the reset page sends it to the account page instead.
  await web.openReady(fresh.page, "/recuperar/nueva");
  // The answer streams in after the page's frame: wait for it, whichever it is.
  await web.waitForResetAnswer(fresh.page);
  const ordinary = await web.mainText(fresh.page);
  log("reset page for an ordinary session:", ordinary.slice(0, 160));
  check(/restablecer la contraseña/.test(ordinary), "the page explains it is for a reset");
  check(
    (await web.passwordFields(fresh.page)) === 0,
    "no new-password form for an ordinary session",
  );
  await fresh.context.close();
  await other.context.close();

  // 6. Again, typing the code instead of following the link.
  await context.clearCookies();
  await web.openReady(page, "/recuperar");
  await web.askResetCode(page, EMAIL);
  await web.continueWithCode(page, "000000");
  log("wrong code:", await web.alertText(page));
  const second = await mail(EMAIL, "recovery");
  await web.continueWithCode(page, `${second.token.slice(0, 3)} ${second.token.slice(3)}`);
  await page.waitForURL((u) => new URL(u).pathname === "/recuperar/nueva");
  await web.saveNewPassword(page, "otra-clave-2026");
  log("with the code:", await web.statusText(page));

  // 7. A used link, and an expired one, each get one clear message and a way to ask again.
  await context.clearCookies();
  await go(page, onBase(first.link));
  await web.continueFromLink(page);
  const reused = await web.alertText(page);
  log("reused link:", reused);
  check(await web.askAgainLinks(page), "offers to ask again");
  await page.screenshot({ path: SHOTS + "/r4-used-link.png", fullPage: true });

  await api("POST", "/dev/settings", { otp_expiry_seconds: "1" });
  await web.openReady(page, "/recuperar");
  await web.askResetCode(page, EMAIL);
  const third = await mail(EMAIL, "recovery");
  await page.waitForTimeout(2500);
  await go(page, onBase(third.link));
  await web.continueFromLink(page);
  log("expired link:", await web.alertText(page));
  await web.openReady(page, "/recuperar/nueva");
  log("new-password page without a session:", await web.alertText(page));

  // 8. A reset asked for with an address Auth does not allow: the e-mail link
  //    points at the shop itself, never at that address, and still reaches
  //    the page that verifies links.
  const evil = await api(
    "POST",
    `/auth/v1/recover?redirect_to=${encodeURIComponent("https://evil.example/x")}`,
    { email: EMAIL },
  );
  check(evil.status === 200, "the request is answered as usual");
  const fallback = await mail(EMAIL, "recovery");
  log("link for a disallowed address:", fallback.link.replace(/token_hash=\w+/, "token_hash=…"));
  check(!fallback.link.includes("evil.example"), "the disallowed address is not in the e-mail");
  await go(page, onBase(fallback.link));
  check(
    new URL(page.url()).pathname === "/auth/confirm",
    "the site's own address forwards the link to /auth/confirm",
  );

  await context.close();
  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
