// A single closed day: an administrator closes one day for one delivery zone with
// the console's own form (Operación → Cierres, a closure from that day to that
// day) on the day the shop promises a product in a district of the zone; the
// shop's product page and cart skip that day; the closure is ended from the page
// and the date comes back. Then a day closed on its own, outside any period (as
// the days closed before closure periods existed; no screen makes one, so the
// journey writes it as such a day was written), is listed under "Días cerrados
// uno por uno", the shop skips it, the administrator opens it again from the
// page and the shop's date comes back at once. At the end the zone's calendar of
// closed days is what it was before. The section is checked at 390 px.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { spawnSync } = require("node:child_process");
const { chromium, request } = require("playwright");
const { settledText } = require("../lib/settle.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const REFRESH_KEY = process.env.SHOP_REFRESH_KEY || "local-development-only";
const ZONE = "gam-core";
const DISTRICT = "10101"; // Carmen, San José: in gam-core in the seed.
const PRODUCT = "libreta-tapa-dura-a5";

const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

function sql(statement) {
  const run = spawnSync(
    "psql",
    [DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
  return run.stdout.trim();
}

/** What the shop promises for the product in the district: {earliest, latest} or null. */
async function promiseNow() {
  const ctx = await request.newContext();
  const r = await ctx.post(`${API}/rest/v1/rpc/get_product`, {
    headers: { apikey: KEY },
    data: { p_slug: PRODUCT, p_postal_code: DISTRICT },
  });
  const product = await r.json();
  await ctx.dispose();
  return product.skus[0].offers[0].promise ?? null;
}

/** The zone's closed days from today on, as the delivery promise reads them. */
const calendar = () =>
  sql(
    `select coalesce(string_agg(day::text || ':' || coalesce(period_id::text, 'single'), ',' order by day), '')
     from public.zone_closures where zone_id = '${ZONE}' and day >= private.cr_today()`,
  );

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
    else log(`  ok: ${message}`);
  };
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };

  // ── The administrator, in the console ───────────────────────────────────────
  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const staff = await staffContext.newPage();
  watch(staff);
  await staff.goto(OPS + "/ingresar", { waitUntil: "networkidle" });
  await staff.fill('main input[name="email"]', "central@yuntera.example");
  await staff.fill('main input[name="password"]', PASSWORD);
  await staff.click('main form button[type="submit"]');
  await staff.waitForURL((u) => new URL(u).pathname !== "/ingresar");
  const go = async (path) => {
    await staff.goto(OPS + path, { waitUntil: "networkidle" });
  };
  // Submits a form and waits for its new outcome (its own message, or the page's
  // notice once the form that sent it is gone).
  const submit = async (scope, button) => {
    const outcomes = () =>
      staff.locator(
        '[data-catalogue-outcome] [role="status"], main [role="status"], main [role="alert"]',
      );
    const before = (await outcomes().allInnerTexts()).join("|");
    await scope.locator(`button:has-text("${button}")`).last().click();
    const deadline = Date.now() + 15000;
    let now = "";
    while (Date.now() < deadline) {
      await staff.waitForTimeout(250);
      now = (await outcomes().allInnerTexts()).join("|");
      if (now && now !== before) break;
    }
    const all = await outcomes().allInnerTexts();
    return (all.find((t) => !before.includes(t)) ?? all.at(-1) ?? "").replace(/\s+/g, " ").trim();
  };

  // ── A visitor of the shop, delivering in Carmen, with the notebook in the cart ─
  const shopContext = await browser.newContext({ locale: "es-CR" });
  await shopContext.addCookies([{ name: "yt_cp", value: DISTRICT, url: WEB }]);
  const shop = await shopContext.newPage();
  watch(shop);
  await shop.goto(`${WEB}/p/${PRODUCT}`, { waitUntil: "networkidle" });
  await shop.locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")').click();
  await shop.waitForSelector("text=Agregado al carrito");
  /** The date the product page and the cart show now (each read fresh). */
  const shopDates = async () => {
    // Each page streams its date into the prepared shell: wait for the date itself.
    await shop.goto(`${WEB}/p/${PRODUCT}`, { waitUntil: "load" });
    const pageDate = shop.locator('aside[aria-label="Comprar"] dd.text-success').first();
    await pageDate.waitFor({ timeout: 30_000 });
    const page = await text(pageDate);
    await shop.goto(`${WEB}/carrito`, { waitUntil: "load" });
    const cartDate = shop.locator('aside[aria-label="Resumen"] p.text-success').first();
    await cartDate.waitFor({ timeout: 30_000 });
    const cart = await text(cartDate);
    return { page, cart };
  };

  const before = await promiseNow();
  const calendarBefore = calendar();
  const shownBefore = await shopDates();
  log("promised:", JSON.stringify(before), "| shown:", JSON.stringify(shownBefore));
  log("closed days of the zone before:", calendarBefore || "(none)");
  if (!before) throw new Error("the seed promises no date for the notebook in Carmen");
  const day = before.latest;
  check(
    shownBefore.cart.endsWith(shownBefore.page.replace(/^(el|entre el) /, "")) ||
      shownBefore.page.includes(shownBefore.cart.replace(/^Llega el /, "")),
    "the cart and the product page give the same date",
  );

  // ── 1. One day closed with the console's own form ──────────────────────────
  await go("/operacion/cierres");
  const form = staff.locator('section[aria-labelledby="nuevo-cierre"]');
  await form.locator('select[name="zoneId"]').selectOption(ZONE);
  await form.locator('input[name="startsOn"]').fill(day);
  await form.locator('input[name="endsOn"]').fill(day);
  await form.locator('select[name="reason"]').selectOption("weather");
  const opened = await submit(form, "Guardar el cierre");
  log("closed:", opened);
  check(opened.startsWith("Cierre guardado."), "the form closes the zone for that day");
  const row = staff.locator('section[aria-labelledby="cierres"] li[data-closure]').first();
  await row.waitFor();
  const rowText = await text(row);
  log("listed:", rowText.slice(0, 200));
  check(
    rowText.includes("GAM") && /\bEl [a-záéíóú]+, \d{1,2} de [a-z]+ ·/.test(rowText),
    "the closure is listed as one day",
  );
  await staff.screenshot({ path: SHOTS + "/csd1-closed.png", fullPage: true });

  const during = await promiseNow();
  log("promised with the day closed:", JSON.stringify(during));
  check(
    during && during.latest > day && during.earliest !== day,
    "the delivery promise skips the closed day",
  );
  const shownDuring = await shopDates();
  log("shown with the day closed:", JSON.stringify(shownDuring));
  check(shownDuring.page !== shownBefore.page, "the product page gives another date at once");
  check(shownDuring.cart !== shownBefore.cart, "the cart gives another date at once");

  // ── 2. The day opened again from the page ───────────────────────────────────
  await go("/operacion/cierres");
  const listed = staff.locator('section[aria-labelledby="cierres"] li[data-closure]').first();
  await listed.locator("summary", { hasText: "Terminar el cierre ahora" }).click();
  const ended = await submit(listed, "Terminar el cierre");
  log("ended:", ended);
  check(ended.startsWith("Cierre cancelado"), "ending a closure that has not started cancels it");
  check(
    JSON.stringify(await promiseNow()) === JSON.stringify(before),
    "the delivery promise is back to what it was",
  );
  const shownAfterEnd = await shopDates();
  check(
    shownAfterEnd.page === shownBefore.page && shownAfterEnd.cart === shownBefore.cart,
    "the product page and the cart give the first date again",
  );
  check(calendar() === calendarBefore, "the zone's closed days are what they were");

  // ── 3. A day closed on its own, outside any period ─────────────────────────
  // No screen or function makes one today: this is how days were closed before
  // 084000 (a row with no period), so the journey writes that row and asks the
  // shop to drop its cached pages, as the console does after its own changes.
  sql(
    `insert into public.zone_closures (zone_id, day, reason)
     values ('${ZONE}', '${day}', 'Cierre de un solo día (prueba de navegador)')`,
  );
  await fetch(`${WEB}/api/catalogo/refrescar`, {
    method: "POST",
    headers: { "x-refresh-key": REFRESH_KEY },
  });
  check(
    JSON.stringify(await promiseNow()) === JSON.stringify(during),
    "a day closed on its own is skipped like the form's",
  );
  const shownSingle = await shopDates();
  check(
    shownSingle.page === shownDuring.page && shownSingle.cart === shownDuring.cart,
    "the shop skips it too",
  );

  await go("/operacion/cierres");
  const singles = staff.locator('section[aria-labelledby="dias-sueltos"]');
  await settledText(singles.locator("h2"), "Días cerrados uno por uno (1)", {
    what: "the single days' heading",
  });
  const single = singles.locator("li").first();
  const singleText = await text(single);
  log("single day:", singleText);
  check(singleText.includes("GAM"), "the single day names its zone");
  await staff.screenshot({ path: SHOTS + "/csd2-single-day.png", fullPage: true });

  // At phone width: the section fits and its controls are big enough to tap.
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    storageState: await staffContext.storageState(),
  });
  const phone = await phoneContext.newPage();
  watch(phone);
  await phone.goto(OPS + "/operacion/cierres", { waitUntil: "networkidle" });
  const phoneSingle = phone.locator('section[aria-labelledby="dias-sueltos"] li').first();
  await phoneSingle.locator("summary").click();
  const width = await phone.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check(width <= 0, "the closures page has no sideways scrolling at 390 px");
  const targets = await phoneSingle.evaluate((li) =>
    [...li.querySelectorAll("summary, button")].map((el) =>
      Math.round(el.getBoundingClientRect().height),
    ),
  );
  check(
    targets.length >= 2 && targets.every((h) => h >= 44),
    `the day's controls are at least 44 px high at 390 px (${targets})`,
  );
  await phone.screenshot({ path: SHOTS + "/csd3-single-day-390.png", fullPage: true });
  await phoneContext.close();

  // The administrator opens the day again from the page.
  await single.locator("summary").click();
  const reopened = await submit(single, "Abrir ese día");
  log("opened:", reopened);
  check(reopened.startsWith("Día abierto de nuevo"), "the page opens the single day again");
  await go("/operacion/cierres");
  check(
    (await staff.locator('section[aria-labelledby="dias-sueltos"]').count()) === 0,
    "no single day is listed any more",
  );
  check(
    JSON.stringify(await promiseNow()) === JSON.stringify(before),
    "the delivery promise is back once the day is open",
  );
  // At once, as the page says ("la fecha de entrega que ve la tienda ya lo cuenta"):
  // nothing here asks the shop to refresh; the console's action must.
  const shownAfterSingle = await shopDates();
  log("shown after the single day opened:", JSON.stringify(shownAfterSingle));
  check(
    shownAfterSingle.page === shownBefore.page,
    `the product page gives the first date again at once (it says "${shownAfterSingle.page}")`,
  );
  check(shownAfterSingle.cart === shownBefore.cart, "and so does the cart");
  await staff.screenshot({ path: SHOTS + "/csd4-opened.png", fullPage: true });

  // ── 4. The calendar as it was ───────────────────────────────────────────────
  check(calendar() === calendarBefore, "the zone's closed days are what they were at the start");
  const audit = sql(
    `select string_agg(action, ',' order by id) from private.audit_log
     where table_name in ('zone_closure_periods', 'zone_closures') and at > now() - interval '30 minutes'`,
  );
  log("audit:", audit);
  check(
    audit.includes("closure_opened") && audit.includes("closure_day_removed"),
    "who closed and opened the days is in the audit trail",
  );

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
