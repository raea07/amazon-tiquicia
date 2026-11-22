// Follow-ups to the web security review of 21 November 2026, in the browser:
//
//   1. Sign-in limit (WEB-2): wrong passwords for one account until the limit,
//      the message with the wait, the same answer for an address without an
//      account, the owner's own browser still let in, one visitor guessing
//      many accounts stopped while another visitor signs in, and after the wait
//      the account works again.
//   2. Sign-up (WEB-M1), with e-mail confirmation on: an address that has an
//      account gets exactly the screen a new address gets.
//   3. Session lifetime (WEB-5): the console's session cookie lasts no more
//      than 12 hours; a console session idle past half an hour is sent to
//      sign in, told why, and brought back to the page it was on; its old
//      token no longer works.
//   4. Order search (WEB-4): a shopper's name typed in the console never
//      reaches the address bar or any request's address.
//   5. Navigation (WEB-9 small finding): every console section is reachable at
//      1280 px and at 390 px, with the keyboard.
//   6. Delivery zone: while the product page still shows the date and price
//      of the old zone, it says an update is coming.
//
// The visitor's address is given in X-Forwarded-For, which the lane's apps are
// told to trust (tools/dev/stack.sh); a deployment trusts only its own proxy.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { spawn, spawnSync } = require("node:child_process");
const { createHmac } = require("node:crypto");
const { chromium, request } = require("playwright");

const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
// The apps' key for signed cookies: the lane's, or the local default (packages/next-kit/src/guard.ts).
const GUARD_KEY = process.env.AUTH_GUARD_KEY || "local-development-only-auth-guard";

const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
const check = (ok, what) => {
  if (!ok) throw new Error(`check failed: ${what}`);
  log(`  ok: ${what}`);
};

function sql(statement) {
  const run = spawnSync(
    "psql",
    [DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
  return run.stdout.trim();
}

async function api(method, path, data, token) {
  const ctx = await request.newContext();
  const r = await ctx.fetch(`${API}${path}`, {
    method,
    headers: { apikey: KEY, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    data,
  });
  const body = r.status() === 204 ? null : await r.json().catch(() => null);
  await ctx.dispose();
  return { status: r.status(), body };
}

/** The session inside a browser context's cookie. */
async function sessionOf(context) {
  const cookie = (await context.cookies()).find((c) => /^sb-.*-auth-token$/.test(c.name));
  if (!cookie) return null;
  const json = Buffer.from(cookie.value.replace(/^base64-/, ""), "base64url").toString("utf8");
  const session = JSON.parse(json);
  const claims = JSON.parse(
    Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"),
  );
  return { cookie, accessToken: session.access_token, claims };
}

/** Waits until React has taken over the visible page's form (the previous page stays hidden). */
function hydrated(page) {
  return page.waitForFunction(() => {
    const main = [...document.querySelectorAll("main")].find((m) => m.checkVisibility());
    const el = main?.querySelector("form") ?? main;
    return el && Object.keys(el).some((key) => key.startsWith("__react"));
  });
}
async function go(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await hydrated(page);
}
const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  /** A browser as one visitor, at one address. */
  const visitor = async (address, viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({
      viewport,
      locale: "es-CR",
      extraHTTPHeaders: { "x-forwarded-for": address },
    });
    const page = await context.newPage();
    watch(page);
    return { context, page };
  };
  /** One sign-in attempt; answers the alert shown, or null when it signed in. */
  const tryPassword = async (page, base, email, password) => {
    await go(page, `${base}/ingresar`);
    const form = page.locator("main:visible form").first();
    await form.locator('input[name="email"]').fill(email);
    await form.locator('input[name="password"]').fill(password);
    await form.locator('button[type="submit"]').click();
    const outcome = await Promise.race([
      page
        .locator('main:visible [role="alert"]')
        .first()
        .waitFor()
        .then(() => "alert"),
      page.waitForURL((u) => new URL(u).pathname !== "/ingresar").then(() => "in"),
    ]);
    if (outcome === "in") return null;
    return text(page.locator('main:visible [role="alert"]').first());
  };
  // Leaves the browser signed out, keeping its other cookies (as a closed tab would).
  const signOut = (page) => page.context().clearCookies({ name: /^sb-/ });
  const wrong = "una-clave-equivocada";
  const comprador = "comprador@yuntera.example";

  // ── 1. The sign-in limit ────────────────────────────────────────────────
  log("1. sign-in limit");
  // The owner signed in on this browser earlier (a phone they always use).
  const owner = await visitor("198.51.100.40");
  check((await tryPassword(owner.page, WEB, comprador, PASSWORD)) === null, "the owner signs in");
  await signOut(owner.page);

  const attacker = await visitor("203.0.113.10");
  for (let attempt = 1; attempt <= 5; attempt++) {
    const answer = await tryPassword(attacker.page, WEB, comprador, wrong);
    check(
      answer === "El correo o la contraseña no coinciden.",
      `wrong password ${attempt} is refused`,
    );
  }
  const limited = await tryPassword(attacker.page, WEB, comprador, PASSWORD);
  log("   limit message:", limited);
  check(/demasiados intentos/i.test(limited ?? ""), "the sixth try is held by the limit");
  check(/espere 1[45] minutos/i.test(limited ?? ""), "the message says how long to wait");
  check(/Olvidé mi contraseña/.test(limited ?? ""), "and points to the reset");
  check(
    (await attacker.page.locator('main:visible input[name="email"]').inputValue()) === comprador,
    "the form keeps the address typed",
  );
  await attacker.page.screenshot({ path: `${SHOTS}/wf01-sign-in-limit.png`, fullPage: true });

  // An address without an account: the same answer, word for word.
  for (let attempt = 1; attempt <= 5; attempt++) {
    await tryPassword(attacker.page, WEB, "nadie.aqui@correo.example", wrong);
  }
  const unknown = await tryPassword(attacker.page, WEB, "nadie.aqui@correo.example", wrong);
  const words = (value) => (value ?? "").replace(/\d+/g, "N");
  check(words(unknown) === words(limited), "an address without an account gets the same answer");

  // The owner's own browser is not locked out by someone guessing elsewhere.
  check(
    (await tryPassword(owner.page, WEB, comprador, PASSWORD)) === null,
    "the owner's usual browser still signs in during the attack",
  );
  await signOut(owner.page);
  // A new browser of the owner's waits, like the attacker: the limit is the account's.
  const newPhone = await visitor("198.51.100.41");
  check(
    /demasiados intentos/i.test((await tryPassword(newPhone.page, WEB, comprador, PASSWORD)) ?? ""),
    "a browser that never signed in to the account waits too",
  );

  // One visitor guessing many accounts is stopped after 20 wrong passwords…
  const sprayer = await visitor("203.0.113.20");
  for (let n = 1; n <= 20; n++) {
    await tryPassword(sprayer.page, WEB, `persona${n}@correo.example`, wrong);
  }
  const sprayed = await tryPassword(sprayer.page, WEB, "persona21@correo.example", wrong);
  check(
    /demasiados intentos/i.test(sprayed ?? ""),
    "the 21st wrong password from one visitor waits",
  );
  // …while another visitor signs in as usual: the limit counts the visitor, not the server.
  const neighbour = await visitor("203.0.113.21");
  check(
    (await tryPassword(neighbour.page, WEB, "comprador2@yuntera.example", PASSWORD)) === null,
    "another visitor signs in as usual",
  );
  const rows = sql(
    "select count(*) from private.auth_attempts where address_hash ~ '^[0-9a-f]{64}$'",
  );
  check(Number(rows) > 0, "the database holds only hashes of the addresses");
  check(
    sql("select count(*) from private.auth_attempts where address_hash like '%203.0.113%'") === "0",
    "and never an address itself",
  );

  // The wait: fifteen minutes pass.
  sql("update private.auth_attempts set attempted_at = attempted_at - interval '16 minutes'");
  check(
    (await tryPassword(newPhone.page, WEB, comprador, PASSWORD)) === null,
    "after the wait the account signs in again",
  );

  // ── 2. Sign-up does not tell who has an account ─────────────────────────
  log("2. sign-up with an existing address");
  check(
    (await api("POST", "/dev/settings", { confirm_email: "on" })).status < 300,
    "e-mail confirmation is on, as on a production project",
  );
  const signUp = async (address, email) => {
    const { page } = await visitor(address);
    await go(page, `${WEB}/ingresar?modo=crear`);
    const form = page.locator("main:visible form").first();
    await form.locator('input[name="fullName"]').fill("Ana Prueba Mora");
    await form.locator('input[name="email"]').fill(email);
    await form.locator('input[name="password"]').fill("una-clave-nueva-larga-7");
    await form.locator('input[name="acepta"]').check();
    await form.locator('button[type="submit"]').click();
    await page.locator("main:visible >> text=Revise su correo").first().waitFor();
    const screen = await text(page.locator("main:visible").first());
    return { page, screen: screen.replaceAll(email, "<correo>") };
  };
  const existing = await signUp("198.51.100.50", comprador);
  const fresh = await signUp("198.51.100.51", "ana.prueba.nueva@correo.example");
  log("   existing:", existing.screen.slice(0, 160));
  check(existing.screen === fresh.screen, "an existing address sees exactly what a new one sees");
  check(
    !/ya existe una cuenta|ya tiene una cuenta/i.test(existing.screen),
    "nothing says the address has an account",
  );
  await existing.page.screenshot({ path: `${SHOTS}/wf02-sign-up-existing.png`, fullPage: true });
  await fresh.page.screenshot({ path: `${SHOTS}/wf03-sign-up-new.png`, fullPage: true });
  await api("POST", "/dev/settings", { confirm_email: "off" });

  // ── 3. The console's session lifetime ───────────────────────────────────
  log("3. console session lifetime");
  const staff = await visitor("198.51.100.60");
  check(
    (await tryPassword(staff.page, OPS, "central@yuntera.example", PASSWORD)) === null,
    "staff sign in",
  );
  await go(staff.page, `${OPS}/pedidos`);
  const before = await sessionOf(staff.context);
  check(before !== null, "the console holds a session");
  const lifetime = before.cookie.expires - Date.now() / 1000;
  log("   session cookie lasts (hours):", (lifetime / 3600).toFixed(2));
  check(
    lifetime > 0 && lifetime <= 12 * 3600 + 60,
    "the console's session cookie lasts 12 hours at most",
  );
  const activity = (await staff.context.cookies()).find((c) => c.name === "yt-actividad");
  check(
    activity && activity.expires - Date.now() / 1000 <= 30 * 60 + 60,
    "activity is tracked for half an hour",
  );

  // Thirty-one minutes without a request (the cookie as the proxy would have signed it then).
  const sessionId = before.claims.session_id;
  const then = Math.floor(Date.now() / 1000) - 31 * 60;
  const mark = createHmac("sha256", GUARD_KEY)
    .update(`activity:${sessionId}:${then}`)
    .digest("hex")
    .slice(0, 32);
  // Replaces the proxy's own cookie, which is Secure and HttpOnly like every one of ours.
  await staff.context.addCookies([
    { ...activity, value: `${then}.${mark}`, expires: Math.floor(Date.now() / 1000) + 600 },
  ]);
  await staff.page.goto(`${OPS}/pedidos`, { waitUntil: "load" });
  await staff.page.waitForURL((u) => new URL(u).pathname === "/ingresar");
  await hydrated(staff.page);
  check(
    new URL(staff.page.url()).searchParams.get("siguiente") === "/pedidos",
    "an idle console session is sent to sign in, keeping where it was",
  );
  await staff.page
    .locator("main:visible >> text=/sin actividad/")
    .first()
    .waitFor({ timeout: 10000 });
  const notice = await text(staff.page.locator("main:visible").first());
  check(/sin actividad/.test(notice), "and is told why");
  await staff.page.screenshot({ path: `${SHOTS}/wf04-console-idle.png`, fullPage: true });
  check((await sessionOf(staff.context)) === null, "the session cookie is gone from the browser");
  const old = await api("POST", "/rest/v1/rpc/my_roles", {}, before.accessToken);
  log("   old token:", old.status, JSON.stringify(old.body).slice(0, 80));
  check(old.status >= 400, "and the old token no longer works");
  const form = staff.page.locator("main:visible form").first();
  await form.locator('input[name="email"]').fill("central@yuntera.example");
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.locator('button[type="submit"]').click();
  await staff.page.waitForURL((u) => new URL(u).pathname === "/pedidos");
  check(true, "signing in again comes back to the orders page");

  // ── 4. The order search keeps names out of addresses ────────────────────
  log("4. order search");
  const seen = [];
  staff.page.on("request", (r) => seen.push(decodeURIComponent(r.url())));
  await hydrated(staff.page);
  await staff.page.fill("main:visible #q", "Andrés");
  await staff.page.click('main:visible button:has-text("Buscar pedidos")');
  await staff.page.locator("main:visible >> text=Quitar la búsqueda").waitFor();
  const found = await staff.page.locator("main:visible tbody tr").count();
  log("   rows for the name:", found);
  check(found > 0, "the search finds the shopper's orders");
  check(!/Andr/i.test(decodeURIComponent(staff.page.url())), "the name is not in the address bar");
  check(!seen.some((url) => /Andr/i.test(url)), "nor in the address of any request");
  await staff.page.screenshot({ path: `${SHOTS}/wf05-order-search.png`, fullPage: true });
  await staff.page.click('main:visible button:has-text("Quitar la búsqueda")');
  await staff.page
    .locator("main:visible >> text=Quitar la búsqueda")
    .waitFor({ state: "detached" });
  check(
    (await staff.page.inputValue("main:visible #q")) === "",
    "clearing the search empties the field",
  );

  // ── 5. Every console section is reachable ───────────────────────────────
  log("5. console navigation");
  // An administrator sees all fifteen sections (apps/ops/src/lib/staff.ts).
  const sections = 15;
  const nav = staff.page.locator('nav[aria-label="Secciones"]');
  check((await nav.locator("a:visible").count()) === sections, "1280 px: all 15 sections show");
  const fits = await nav.evaluate((el) => {
    const right = [...el.querySelectorAll("a")]
      .filter((a) => a.checkVisibility())
      .map((a) => a.getBoundingClientRect().right);
    return el.scrollWidth <= el.clientWidth && Math.max(...right) <= window.innerWidth;
  });
  check(fits, "1280 px: none is cut off or scrolled out of sight");
  // The keyboard reaches every one of them.
  await staff.page.locator("header a").first().focus();
  const reached = new Set();
  for (let i = 0; i < 40; i++) {
    await staff.page.keyboard.press("Tab");
    const href = await staff.page.evaluate(() =>
      document.activeElement?.closest('nav[aria-label="Secciones"]')
        ? document.activeElement.getAttribute("href")
        : null,
    );
    if (href) reached.add(href);
  }
  check(reached.size === sections, "1280 px: Tab reaches every section");
  await staff.page.screenshot({ path: `${SHOTS}/wf06-console-nav-1280.png` });

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.61" },
  });
  const small = await phone.newPage();
  watch(small);
  check(
    (await tryPassword(small, OPS, "central@yuntera.example", PASSWORD)) === null,
    "staff sign in on a phone",
  );
  const menu = small.locator('nav[aria-label="Secciones"] summary');
  check(await menu.isVisible(), "390 px: the sections fold into one button");
  await menu.focus();
  await small.keyboard.press("Enter");
  const phoneLinks = small.locator('nav[aria-label="Secciones"] a:visible');
  check(
    (await phoneLinks.count()) === sections,
    "390 px: opened from the keyboard, it lists all 15",
  );
  check((await overflow(small)) <= 0, "390 px: no sideways scrolling");
  await small.screenshot({ path: `${SHOTS}/wf07-console-nav-390.png`, fullPage: true });
  await phoneLinks.filter({ hasText: "Auditoría" }).click();
  await small.waitForURL((u) => new URL(u).pathname === "/auditoria");
  await small.waitForFunction(
    () => !document.querySelector('nav[aria-label="Secciones"] details')?.open,
  );
  check(true, "390 px: choosing a section goes there and folds the menu");

  // ── 6. The delivery zone shows that an update is coming ─────────────────
  log("6. delivery zone");
  const shopper = await visitor("198.51.100.70");
  const slug = sql(
    "select p.slug from public.products p where p.status = 'active' order by p.slug limit 1",
  );
  await go(shopper.page, `${WEB}/p/${slug}`);
  await shopper.page.click('main:visible a[href^="/zona?siguiente="]');
  await shopper.page.waitForURL((u) => new URL(u).pathname === "/zona");
  await hydrated(shopper.page);
  // A district other than the one the page assumed (San José centre, 10101).
  for (let i = 0; i < 3; i++) {
    const select = shopper.page.locator("main:visible select").nth(i);
    await select.waitFor();
    const options = await select.locator("option").allTextContents();
    const usable = options
      .map((option, index) => ({ option, index }))
      .filter(({ option, index }) => index > 0 && !option.includes("aún no"));
    // San José, Central, and its second district (Merced) rather than the first.
    await select.selectOption({ index: ((i === 2 && usable[1]) || usable[0]).index });
  }
  // A slow database, as on the hosted preview: the new date takes seconds to come.
  const slow = spawn("psql", [
    DATABASE_URL,
    "-X",
    "-q",
    "-c",
    "begin; lock table public.offers in access exclusive mode; select pg_sleep(4); commit;",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shopper.page.click('main:visible button:has-text("Usar esta zona")');
  const updating = "Actualizando la fecha de entrega y el envío para su zona";
  const pending = shopper.page.locator('main:visible [role="status"]', { hasText: updating });
  await pending.waitFor({ timeout: 4000 });
  check(true, "while the new date is on its way, the page says an update is coming");
  await shopper.page.screenshot({ path: `${SHOTS}/wf08-zone-pending.png`, fullPage: true });
  await new Promise((resolve) => slow.on("exit", resolve));
  await shopper.page.waitForURL((u) => new URL(u).pathname === `/p/${slug}`);
  await pending.waitFor({ state: "detached", timeout: 15000 });
  await shopper.page.locator("main:visible >> text=/Envío ₡/").first().waitFor();
  check(
    !(await shopper.page
      .locator("main:visible >> text=Elija su zona para confirmar la fecha")
      .count()),
    "then the page shows the chosen zone's date and price",
  );
  check(
    (await shopper.page.evaluate(() => sessionStorage.getItem("yt-zona-pendiente"))) === null,
    "and stops waiting once the page is drawn for the new zone",
  );
  // The copy of the page the framework keeps from before, drawn for the old zone,
  // while a new zone is on its way (what the hosted preview showed for seconds).
  await shopper.page.evaluate(() =>
    sessionStorage.setItem(
      "yt-zona-pendiente",
      JSON.stringify({ postalCode: "30101", at: Date.now() }),
    ),
  );
  await shopper.page.reload({ waitUntil: "load" });
  const stale = shopper.page.locator('main:visible [role="status"]', { hasText: updating });
  await stale.waitFor({ timeout: 5000 });
  check(
    (await shopper.page.locator('main:visible [aria-busy="true"]').count()) > 0,
    "a page still drawn for the old zone says an update is coming and marks its values busy",
  );
  await shopper.page.screenshot({ path: `${SHOTS}/wf10-zone-stale-copy.png`, fullPage: true });
  await stale.waitFor({ state: "detached", timeout: 15000 });
  check(true, "and gives up waiting after a while rather than for ever");
  await shopper.page.screenshot({ path: `${SHOTS}/wf09-zone-updated.png`, fullPage: true });

  await browser.close();
  if (errors.length > 0) {
    console.error(`Errors in the browser or the server:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  log("web follow-ups journey: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
