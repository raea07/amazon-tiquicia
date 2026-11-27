// Staff second factor in the console: an administrator enrols an authenticator
// (the codes are computed here, as an authenticator app would), and from then
// on a password-only token is refused by the API even with the setting off;
// signs out and back in through the second step, with a wrong code first; the setting that
// requires a factor is switched on in this journey's own database, and a new
// colleague is taken to enrolment before anything else (while the database
// refuses them staff functions); finally the administrator resets the
// colleague's factor from the staff security screen, which ends the session
// on the colleague's lost phone at once. Last, a shopper with a factor is held
// at the second step in the shop, and the database refuses the deletion.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { createHmac } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { chromium, request } = require("playwright");
const ops = require("../lib/ops.cjs");
const web = require("../lib/web.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = process.env.OPS_URL || "http://127.0.0.1:3002";
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgres://postgres:postgres@127.0.0.1:5432/${process.env.PG_DB_NAME || "yuntera_local"}`;
const ADMIN = "central@yuntera.example";
const COLLEAGUE = "colega-soporte@yuntera.example";
const log = (...a) => console.log(...a);
const check = (ok, what) => {
  if (!ok) throw new Error(`check failed: ${what}`);
};

// ── An authenticator app, in a few lines (RFC 6238: SHA-1, 6 digits, 30 s) ──
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
/** A code Auth has not seen yet for this secret: the current step, or the next one. */
const lastStep = new Map();
async function freshCode(secret) {
  let step = Math.floor(Date.now() / 30000);
  const used = lastStep.get(secret) ?? -1;
  if (step <= used) step = used + 1; // the next step is accepted too
  while (step > Math.floor(Date.now() / 30000) + 1) await new Promise((r) => setTimeout(r, 1000));
  lastStep.set(secret, step);
  return codeAt(secret, step);
}

function sql(statement) {
  const run = spawnSync(
    "psql",
    [DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
    {
      encoding: "utf8",
    },
  );
  if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
  return run.stdout.trim();
}

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

/** Opens a page and waits until React has taken over its forms. */
async function go(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await ops.hydrated(page);
}
const path = (page) => new URL(page.url()).pathname;
/** Waits briefly for a redirect that streams in after the page loaded. */
/** The access token inside a browser context's session cookie. */
async function accessTokenOf(context) {
  const cookie = (await context.cookies()).find((c) => /^sb-.*-auth-token$/.test(c.name));
  check(cookie, "the session cookie exists");
  const json = Buffer.from(cookie.value.replace(/^base64-/, ""), "base64url").toString("utf8");
  return JSON.parse(json).access_token;
}

async function settle(page, expected) {
  await page
    .waitForURL((u) => new URL(u).pathname === expected, { timeout: 10000 })
    .catch(() => {});
  return path(page);
}

(async () => {
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
    const context = await browser.newContext({
      locale: "es-CR",
      viewport: { width: 1280, height: 900 },
      ...options,
    });
    const page = await context.newPage();
    watch(page);
    return { context, page };
  };
  const signIn = async (page, email) => {
    await go(page, BASE + "/ingresar");
    await ops.fillSignIn(page, email, PASSWORD);
  };
  /** Enrols an authenticator on /dos-pasos and returns its secret. */
  const enrol = async (page) => {
    const { secret, qr } = await ops.startEnrolment(page);
    check(/^[A-Z2-7]{32}$/.test(secret), "a 32-character secret is shown as text");
    check(
      qr.startsWith("data:image/svg+xml;base64,"),
      "the QR code is drawn locally, as an inline SVG",
    );
    await ops.activateTwoStep(page, await freshCode(secret));
    return secret;
  };

  // 1. The administrator enrols from their account page.
  const admin = await newPage();
  await signIn(admin.page, ADMIN);
  await admin.page.waitForURL((u) => new URL(u).pathname === "/");
  await go(admin.page, BASE + "/cuenta");
  log("account page:", (await ops.twoStepSection(admin.page)).slice(0, 120));
  await ops.openTwoStep(admin.page);
  const adminSecret = await enrol(admin.page);
  await admin.page.waitForURL((u) => new URL(u).searchParams.get("estado") === "activada");
  log("enrolled:", await ops.statusText(admin.page));
  await admin.page.screenshot({ path: SHOTS + "/m1-enrolled.png", fullPage: true });
  await go(admin.page, BASE + "/cuenta");
  log("badge now:", await ops.twoStepBadge(admin.page));

  // With the setting still off, the factor protects the account against
  // someone who has only the password and calls the API directly: the token
  // from a password sign-in (aal1) opens nothing but the second step.
  const passwordOnly = (
    await api("POST", "/auth/v1/token?grant_type=password", { email: ADMIN, password: PASSWORD })
  ).body.access_token;
  for (const fn of ["ops_staff_security", "audit_entries", "ops_overview"]) {
    const direct = await api("POST", `/rest/v1/rpc/${fn}`, {}, passwordOnly);
    log(`${fn} with the password only:`, direct.status, direct.body?.message);
    check(
      direct.status >= 400 && direct.body?.message === "second_factor_required",
      `${fn} refused at aal1 for an account with a factor`,
    );
  }
  const step = await api("POST", "/rest/v1/rpc/my_security", {}, passwordOnly);
  check(step.status === 200, "what the second-step screen needs still answers");

  // 2. Out and back in: the password alone leads to the second step.
  await ops.signOut(admin.page);
  await admin.page.waitForURL((u) => new URL(u).pathname === "/ingresar");
  await signIn(admin.page, ADMIN);
  await admin.page.waitForURL((u) => new URL(u).pathname === "/verificar");
  log("after password:", path(admin.page), "| nav links:", await ops.navLinks(admin.page));
  await go(admin.page, BASE + "/pedidos");
  log("orders before the second step ->", await settle(admin.page, "/verificar"));
  check(path(admin.page) === "/verificar", "nothing else opens before the second step");
  await ops.verifyCode(admin.page, "000000");
  log("wrong code:", await ops.alertText(admin.page));
  await admin.page.screenshot({ path: SHOTS + "/m2-wrong-code.png", fullPage: true });
  await ops.verifyCode(admin.page, await freshCode(adminSecret));
  await admin.page.waitForURL((u) => new URL(u).pathname === "/pedidos");
  log("after the second step:", path(admin.page), "| nav links:", await ops.navLinks(admin.page));

  // 3. The setting goes on (only in this journey's database). A new colleague
  //    signs in: enrolment comes before anything else.
  const signup = await api("POST", "/auth/v1/signup", {
    email: COLLEAGUE,
    password: PASSWORD,
    data: { full_name: "Laura Colega Soporte" },
  });
  check(signup.status === 200, "colleague account created");
  sql(`insert into public.staff_members (user_id, role)
       select id, 'support' from auth.users where email = '${COLLEAGUE}'`);
  sql("update public.app_settings set value = 'true' where key = 'require_staff_mfa'");
  log(
    "require_staff_mfa:",
    sql("select value from public.app_settings where key = 'require_staff_mfa'"),
  );

  // The database refuses a password-only staff session, whatever the screens do.
  const token = (
    await api("POST", "/auth/v1/token?grant_type=password", {
      email: COLLEAGUE,
      password: PASSWORD,
    })
  ).body.access_token;
  const refused = await api("POST", "/rest/v1/rpc/ops_overview", {}, token);
  log("ops_overview at aal1 with the setting on:", refused.status, refused.body?.message);
  check(refused.body?.message === "forbidden", "staff functions refused without the second factor");

  const colleague = await newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await signIn(colleague.page, COLLEAGUE);
  await colleague.page.waitForURL((u) => new URL(u).pathname === "/dos-pasos");
  log("colleague lands on:", path(colleague.page), "|", await ops.statusText(colleague.page));
  log(
    "mobile /dos-pasos overflow px:",
    await colleague.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  await colleague.page.screenshot({ path: SHOTS + "/m3-forced-enrolment.png", fullPage: true });
  await go(colleague.page, BASE + "/atencion");
  log(
    "colleague on /atencion ->",
    await settle(colleague.page, "/dos-pasos"),
    "| nav links:",
    await ops.navLinks(colleague.page),
  );
  check(path(colleague.page) === "/dos-pasos", "enrolment before anything else");
  await ops.hydrated(colleague.page);
  const colleagueSecret = await enrol(colleague.page);
  await colleague.page.waitForURL((u) => new URL(u).pathname === "/atencion");
  log(
    "colleague after enrolling:",
    path(colleague.page),
    "|",
    (await ops.heading(colleague.page)).slice(0, 40),
  );
  check(colleagueSecret !== adminSecret, "each enrolment has its own secret");

  // The colleague's phone is lost with the console open on it.
  const stolenToken = await accessTokenOf(colleague.context);

  // 4. The administrator recovers the colleague (lost phone) from the staff screen.
  await go(admin.page, BASE + "/seguridad");
  log(
    "colleague on the staff screen:",
    (await ops.securityCardText(admin.page, COLLEAGUE)).slice(0, 120),
  );
  check((await ops.ownCardButtons(admin.page)) === 0, "no reset button on one's own card");
  log("reset:", await ops.resetTwoStep(admin.page, COLLEAGUE));
  await admin.page.screenshot({ path: SHOTS + "/m4-reset.png", fullPage: true });
  await go(admin.page, BASE + "/auditoria");
  log("audit:", (await ops.tableRow(admin.page)).slice(0, 140));

  // The session on the lost phone ends at once, not when its token expires:
  // the token is refused by the database and the open page goes to sign-in.
  const afterReset = await api("POST", "/rest/v1/rpc/ops_overview", {}, stolenToken);
  log("lost phone's token after the reset:", afterReset.status, afterReset.body?.message);
  check(afterReset.body?.message === "session_ended", "the lost phone's session is over");
  await colleague.page.goto(BASE + "/atencion", { waitUntil: "load" });
  log("lost phone, next page ->", await settle(colleague.page, "/ingresar"));
  check(path(colleague.page) === "/ingresar", "the lost phone is signed out");

  // The colleague's next sign-in starts again with enrolment.
  await colleague.context.clearCookies();
  await signIn(colleague.page, COLLEAGUE);
  await colleague.page.waitForURL((u) => new URL(u).pathname === "/dos-pasos");
  log("colleague signs in again ->", path(colleague.page));
  await colleague.context.close();

  // 5. The administrator's own session still works, at the second-factor level.
  await go(admin.page, BASE + "/");
  log(
    "admin overview:",
    path(admin.page),
    "| headings:",
    (await ops.summaryHeadings(admin.page)).slice(0, 3),
  );
  await admin.context.close();

  // 6. A shopper who turned the factor on (here through the API, as any app
  //    would) is held at the second step in the shop as well: the account
  //    page and the deletion page do not open with the password alone, and
  //    the database refuses the deletion to a password-only token.
  const SHOPPER = "comprador3@yuntera.example";
  const shopperToken = (
    await api("POST", "/auth/v1/token?grant_type=password", { email: SHOPPER, password: PASSWORD })
  ).body.access_token;
  const factor = (await api("POST", "/auth/v1/factors", { factor_type: "totp" }, shopperToken))
    .body;
  const challenge = (await api("POST", `/auth/v1/factors/${factor.id}/challenge`, {}, shopperToken))
    .body;
  const verified = await api(
    "POST",
    `/auth/v1/factors/${factor.id}/verify`,
    { challenge_id: challenge.id, code: await freshCode(factor.totp.secret) },
    shopperToken,
  );
  check(verified.status === 200, "the shopper's factor is verified");
  const shopperAal1 = (
    await api("POST", "/auth/v1/token?grant_type=password", { email: SHOPPER, password: PASSWORD })
  ).body.access_token;
  const deletion = await api("POST", "/rest/v1/rpc/delete_my_account", {}, shopperAal1);
  log("delete_my_account with the password only:", deletion.status, deletion.body?.message);
  check(deletion.body?.message === "second_factor_required", "deletion needs the second step");
  const shopper = await newPage();
  await web.submitSignIn(shopper.page, SHOPPER, PASSWORD);
  await shopper.page.waitForURL((u) => new URL(u).pathname === "/verificar");
  for (const page of ["/cuenta", "/cuenta/eliminar"]) {
    await shopper.page.goto(WEB + page, { waitUntil: "load" });
    log(`shop ${page} before the second step ->`, await settle(shopper.page, "/verificar"));
    check(path(shopper.page) === "/verificar", `${page} waits for the second step`);
  }
  await shopper.context.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
