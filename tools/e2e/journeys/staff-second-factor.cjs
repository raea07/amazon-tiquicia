// Staff second factor in the console: an administrator enrols an authenticator
// (the codes are computed here, as an authenticator app would), signs out and
// back in through the second step, with a wrong code first; the setting that
// requires a factor is switched on in this journey's own database, and a new
// colleague is taken to enrolment before anything else (while the database
// refuses them staff functions); finally the administrator resets the
// colleague's factor from the staff security screen.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { createHmac } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgres://postgres:postgres@127.0.0.1:5432/${process.env.PG_DB_NAME || "yuntera_local"}`;
const ADMIN = "central@yuntera.example";
const COLLEAGUE = "colega-soporte@yuntera.example";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
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
/** Waits briefly for a redirect that streams in after the page loaded. */
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
    await page.fill('main:visible input[name="email"]', email);
    await page.fill('main:visible input[name="password"]', PASSWORD);
    await page.click('main:visible form button[type="submit"]');
  };
  /** Enrols an authenticator on /dos-pasos and returns its secret. */
  const enrol = async (page) => {
    await page.click('main:visible button:has-text("Empezar")');
    const secretBox = page.locator("main:visible [data-secret]");
    await secretBox.waitFor();
    const secret = await secretBox.getAttribute("data-secret");
    check(/^[A-Z2-7]{32}$/.test(secret), "a 32-character secret is shown as text");
    const qr = await page.locator('main:visible img[alt^="Código QR"]').getAttribute("src");
    check(
      qr.startsWith("data:image/svg+xml;base64,"),
      "the QR code is drawn locally, as an inline SVG",
    );
    await page.fill('main:visible input[name="code"]', await freshCode(secret));
    await page.click('main:visible button:has-text("Activar la verificación")');
    return secret;
  };

  // 1. The administrator enrols from their account page.
  const admin = await newPage();
  await signIn(admin.page, ADMIN);
  await admin.page.waitForURL((u) => new URL(u).pathname === "/");
  await go(admin.page, BASE + "/cuenta");
  log(
    "account page:",
    (await text(admin.page.locator('main:visible section[aria-labelledby="dos-pasos"]'))).slice(
      0,
      120,
    ),
  );
  await admin.page.click('main:visible a:has-text("Activar la verificación")');
  await admin.page.waitForURL((u) => new URL(u).pathname === "/dos-pasos");
  await hydrated(admin.page);
  const adminSecret = await enrol(admin.page);
  await admin.page.waitForURL((u) => new URL(u).searchParams.get("estado") === "activada");
  log("enrolled:", await text(admin.page.locator('main:visible [role="status"]').first()));
  await admin.page.screenshot({ path: SHOTS + "/m1-enrolled.png", fullPage: true });
  await go(admin.page, BASE + "/cuenta");
  log(
    "badge now:",
    await text(admin.page.locator('main:visible section[aria-labelledby="dos-pasos"] h2 + *')),
  );

  // 2. Out and back in: the password alone leads to the second step.
  await admin.page.click('header button:has-text("Salir")');
  await admin.page.waitForURL((u) => new URL(u).pathname === "/ingresar");
  await signIn(admin.page, ADMIN);
  await admin.page.waitForURL((u) => new URL(u).pathname === "/verificar");
  log(
    "after password:",
    path(admin.page),
    "| nav links:",
    await admin.page.locator('nav[aria-label="Secciones"] a').count(),
  );
  await go(admin.page, BASE + "/pedidos");
  log("orders before the second step ->", await settle(admin.page, "/verificar"));
  check(path(admin.page) === "/verificar", "nothing else opens before the second step");
  await admin.page.fill('main:visible input[name="code"]', "000000");
  await admin.page.click('main:visible button:has-text("Verificar")');
  log("wrong code:", await text(admin.page.locator('main:visible [role="alert"]')));
  await admin.page.screenshot({ path: SHOTS + "/m2-wrong-code.png", fullPage: true });
  await admin.page.fill('main:visible input[name="code"]', await freshCode(adminSecret));
  await admin.page.click('main:visible button:has-text("Verificar")');
  await admin.page.waitForURL((u) => new URL(u).pathname === "/pedidos");
  log(
    "after the second step:",
    path(admin.page),
    "| nav links:",
    await admin.page.locator('nav[aria-label="Secciones"] a').count(),
  );

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
  log(
    "colleague lands on:",
    path(colleague.page),
    "|",
    await text(colleague.page.locator('main:visible [role="status"]').first()),
  );
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
    await colleague.page.locator('nav[aria-label="Secciones"] a').count(),
  );
  check(path(colleague.page) === "/dos-pasos", "enrolment before anything else");
  await hydrated(colleague.page);
  const colleagueSecret = await enrol(colleague.page);
  await colleague.page.waitForURL((u) => new URL(u).pathname === "/atencion");
  log(
    "colleague after enrolling:",
    path(colleague.page),
    "|",
    (await text(colleague.page.locator("main:visible h1:visible"))).slice(0, 40),
  );
  check(colleagueSecret !== adminSecret, "each enrolment has its own secret");

  // 4. The administrator recovers the colleague (lost phone) from the staff screen.
  await go(admin.page, BASE + "/seguridad");
  const card = admin.page.locator("main:visible li", { hasText: COLLEAGUE });
  log("colleague on the staff screen:", (await text(card)).slice(0, 120));
  check(
    (await admin.page
      .locator("main:visible li", { hasText: "(usted)" })
      .locator("button")
      .count()) === 0,
    "no reset button on one's own card",
  );
  await card.locator('button:has-text("Reiniciar su verificación")').click();
  log("reset:", await text(card.locator('[role="status"]')));
  await admin.page.screenshot({ path: SHOTS + "/m4-reset.png", fullPage: true });
  await go(admin.page, BASE + "/auditoria");
  log("audit:", (await text(admin.page.locator("main:visible tbody tr").first())).slice(0, 140));

  // The colleague's next sign-in starts again with enrolment.
  await colleague.context.clearCookies();
  await signIn(colleague.page, COLLEAGUE);
  await colleague.page.waitForURL((u) => new URL(u).pathname === "/dos-pasos");
  log("colleague signs in again ->", path(colleague.page));
  await colleague.context.close();

  // 5. The administrator's own session still works, at the second-factor level.
  await go(admin.page, BASE + "/");
  await admin.page.locator("main:visible h2:visible").first().waitFor();
  log(
    "admin overview:",
    path(admin.page),
    "| headings:",
    (await admin.page.locator("main:visible h2:visible").allInnerTexts()).slice(0, 3),
  );
  await admin.context.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
