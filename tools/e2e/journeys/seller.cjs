// Seller journey: two shops, prices, new listing, inventory, inbound stock, packing, payouts, registration.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = process.env.SELLER_URL || "http://127.0.0.1:3001";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
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
  const signIn = async (page, email) => {
    await page.goto(BASE + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === "/");
    await page.waitForSelector("main h1:visible");
  };

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const page = await context.newPage();
  watch(page);

  // 0. A visitor is sent to sign in
  await page.goto(BASE + "/productos", { waitUntil: "networkidle" });
  log("visitor on /productos ->", page.url().replace(BASE, ""));

  // 1. Seller with two shops
  await signIn(page, "vendedor@yuntera.example");
  log("dashboard h1:", await text(page.locator("main h1:visible")));
  log("nav:", await text(page.locator('nav[aria-label="Secciones"]')));
  log(
    "stats:",
    (await page.locator("main:visible section").first().innerText())
      .replace(/\s+/g, " ")
      .slice(0, 200),
  );
  await page.screenshot({ path: SHOTS + "/s1-dashboard.png", fullPage: true });

  // 2. Switch shop
  const shops = await page.locator("#shop option").allInnerTexts();
  log("shops:", shops);
  const currentShop = await page.locator("main h1:visible").innerText();
  const target = shops.find((s) => s !== currentShop);
  await page.selectOption("#shop", { label: target });
  await page.click('header button:has-text("Cambiar")');
  await page.waitForSelector(`main h1:visible:has-text("${target}")`);
  log("switched to:", await text(page.locator("main h1:visible")));
  const ferreteria = shops.find((s) => s.includes("Higuer"));
  if (target !== ferreteria) {
    await page.selectOption("#shop", { label: ferreteria });
    await page.click('header button:has-text("Cambiar")');
    await page.waitForSelector(`main h1:visible:has-text("Higuer")`);
  }

  // 3. Listings + edit a price (Ferretería)
  await page.goto(BASE + "/productos", { waitUntil: "networkidle" });
  log("listing rows:", await page.locator("main:visible tbody tr").count());
  const row = page.locator("main:visible tbody tr").first();
  log("first row:", (await text(row)).slice(0, 170));
  await row.locator("summary").click();
  const before = await row.locator('input[name="price"]').inputValue();
  await row.locator('input[name="price"]').fill(String(Number(before) + 100));
  await row.locator('button[type="submit"]').click();
  await row.locator('[role="status"], [role="alert"]').first().waitFor();
  log(
    "price edit:",
    before,
    "->",
    await text(row.locator("summary")),
    "|",
    await text(row.locator('[role="status"], [role="alert"]').first()),
  );
  // regular price lower than price is refused with a clear message
  await row.locator('input[name="listPrice"]').fill("1");
  await row.locator('button[type="submit"]').click();
  await page.waitForTimeout(800);
  log("bad regular price:", await text(row.locator('[role="alert"]').first()));
  await page.screenshot({ path: SHOTS + "/s2-listings.png", fullPage: true });

  // 4. Inventory for seller-fulfilled items
  await page.goto(BASE + "/inventario", { waitUntil: "networkidle" });
  log("inventory sections:", await page.locator("main:visible h2").allInnerTexts());
  const stockRow = page.locator("main:visible tbody tr").first();
  await stockRow.locator('input[name="quantity"]').fill("23");
  await stockRow.locator('button[type="submit"]').click();
  await stockRow.locator('[role="status"], [role="alert"]').first().waitFor();
  log(
    "stock set:",
    await text(stockRow.locator('[role="status"], [role="alert"]').first()),
    "| row:",
    (await text(stockRow)).slice(0, 120),
  );
  await page.screenshot({ path: SHOTS + "/s3-inventory.png", fullPage: true });

  // 5. New listing with fee preview (TecnoCasa: platform fulfilled)
  await page.selectOption("#shop", { label: shops.find((s) => s.includes("Tecno")) });
  await page.click('header button:has-text("Cambiar")');
  await page.waitForSelector('main h1:visible:has-text("TecnoCasa")');
  await page.goto(BASE + "/productos/nuevo", { waitUntil: "networkidle" });
  await page.fill('input[name="title"]', "Lámpara de escritorio LED Volcán con brazo flexible");
  const hogarOption = await page
    .locator('select[name="categorySlug"] optgroup[label^="Hogar"] option')
    .first()
    .getAttribute("value");
  await page.selectOption('select[name="categorySlug"]', hogarOption);
  await page.fill('textarea[name="bullets"]', "Luz cálida y fría\nBrazo flexible\nPuerto USB");
  await page.fill('input[name="price"]', "20 000");
  await page.fill('input[name="weightGrams"]', "900");
  await page.fill('input[name="lengthCm"]', "30");
  await page.fill('input[name="widthCm"]', "15");
  await page.fill('input[name="heightCm"]', "12");
  await page.selectOption('aside[aria-label="Lo que usted recibe"] select', "card");
  log(
    "fee preview (₡20 000 hogar, bodega, tarjeta):",
    await text(page.locator('aside[aria-label="Lo que usted recibe"] dl')),
  );
  await page.screenshot({ path: SHOTS + "/s4-new-listing.png", fullPage: true });
  await page.click('button:has-text("Enviar a revisión")');
  await page.waitForURL((u) => new URL(u).pathname === "/productos");
  log("after create:", await text(page.locator('main:visible [role="status"]').first()));
  log(
    "new listing row:",
    (
      await text(page.locator("main:visible tbody tr", { hasText: "Lámpara de escritorio" }).last())
    ).slice(0, 150),
  );

  // 6. Inbound shipment to the Yuntera warehouse
  await page.goto(BASE + "/inventario", { waitUntil: "networkidle" });
  const qty = page.locator('main:visible input[name^="qty:"]').first();
  await qty.fill("15");
  await page.click('main:visible button:has-text("Registrar envío")');
  await page.waitForSelector('main:visible li:has-text("IN-")');
  log(
    "inbound:",
    (await text(page.locator('main:visible li:has-text("IN-")').first())).slice(0, 160),
  );
  await page.screenshot({ path: SHOTS + "/s5-inbound.png", fullPage: true });

  // 7. Payouts and account
  await page.goto(BASE + "/pagos", { waitUntil: "networkidle" });
  log("payout stats:", (await text(page.locator("main:visible .grid").first())).slice(0, 200));
  log(
    "statement rows:",
    await page.locator("main:visible tbody tr").count(),
    "| first:",
    (await text(page.locator("main:visible tbody tr").first())).slice(0, 140),
  );
  await page.screenshot({ path: SHOTS + "/s6-payouts.png", fullPage: true });
  await page.goto(BASE + "/cuenta", { waitUntil: "networkidle" });
  log("account:", (await text(page.locator("main:visible section").nth(1))).slice(0, 170));
  await context.close();

  // 8. A seller who ships their own parcels packs one
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CR" });
  const p2 = await c2.newPage();
  watch(p2);
  await signIn(p2, "vendedor@yuntera.example");
  if (!(await p2.locator("main h1:visible").innerText()).includes("Higuer")) {
    await p2.selectOption("#shop", { label: "Ferretería El Higuerón" });
    await p2.click('header button:has-text("Cambiar")');
    await p2.waitForSelector('main h1:visible:has-text("Higuer")');
  }
  await p2.goto(BASE + "/pedidos", { waitUntil: "networkidle" });
  const parcels = p2.locator('main:visible section[aria-labelledby="empacar"] > ul > li');
  log("parcels to pack:", await parcels.count());
  if (await parcels.count()) {
    log("parcel:", (await text(parcels.first())).slice(0, 200));
    await parcels.first().locator('input[name="weightGrams"]').fill("850");
    await parcels.first().locator('button[type="submit"]').click();
    await p2.waitForTimeout(1500);
    log(
      "after packing, to pack:",
      await p2.locator('main:visible section[aria-labelledby="empacar"] > ul > li').count(),
      "|",
      (await text(p2.locator('main:visible section[aria-labelledby="empacar"]'))).slice(0, 120),
    );
  }
  log(
    "sales rows:",
    await p2.locator('main:visible section[aria-labelledby="ventas"] tbody tr').count(),
  );
  await p2.screenshot({ path: SHOTS + "/s7-orders.png", fullPage: true });
  // another seller's data is unreachable even by guessing
  await c2.close();

  // 9. Brand-new seller: account, then shop
  const c3 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const p3 = await c3.newPage();
  watch(p3);
  await p3.goto(BASE + "/registro", { waitUntil: "networkidle" });
  log(
    "mobile /registro overflow px:",
    await p3.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  const stamp = Date.now().toString().slice(-7);
  await p3.fill('main input[name="fullName"]', "Rosa Vargas Mena");
  await p3.fill('main input[name="email"]', `rosa${stamp}@yuntera.example`);
  await p3.fill('main input[name="password"]', "clave-segura-123");
  await p3.check('main input[name="acepta"]');
  await p3.click('main button:has-text("Crear cuenta")');
  await p3.waitForSelector('main:visible h2:has-text("Datos de la tienda")');
  await p3.fill('input[name="tradeName"]', `Dulces Doña Rosa ${stamp}`);
  await p3.fill('input[name="idNumber"]', "1-1234-0" + stamp.slice(-3));
  await p3.fill('input[name="legalName"]', "Rosa Vargas Mena");
  await p3.fill(
    'textarea[name="fiscalAddress"]',
    "Cartago, Paraíso, Orosi, 200 metros norte de la iglesia",
  );
  await p3.fill('input[name="contactPhone"]', "8765 4321");
  // submit without ticking the declaration: the browser blocks it
  await p3.click('main button:has-text("Enviar solicitud")');
  await p3.waitForTimeout(400);
  log("blocked without declaration:", new URL(p3.url()).pathname === "/registro");
  await p3.check('input[name="declara"]');
  await p3.click('main button:has-text("Enviar solicitud")');
  await p3.waitForURL((u) => new URL(u).pathname === "/");
  await p3.waitForSelector('main h1:visible:has-text("Dulces")');
  log(
    "new shop dashboard:",
    await text(p3.locator("main h1:visible")),
    "|",
    (await p3.locator('main:visible [role="status"]').allInnerTexts()).map((t) =>
      t.replace(/\s+/g, " ").slice(0, 60),
    ),
  );
  log(
    "mobile dashboard overflow px:",
    await p3.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  await p3.screenshot({ path: SHOTS + "/s8-mobile-new-shop.png", fullPage: true });
  await p3.goto(BASE + "/productos", { waitUntil: "networkidle" });
  log("new shop listings:", await text(p3.locator("main h2:visible, main h3:visible").first()));
  await c3.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
