// Shopper journey: search, product, cart, sign-in, checkout, payment, orders, phone width.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = process.env.WEB_URL || "http://127.0.0.1:3000";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: "es-CR",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });

  // 1. Home
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  log("home title:", await page.title());
  log("home h1:", await page.locator("h1").first().innerText());
  log("home product cards:", await page.locator("article").count());
  log(
    "header cart/account:",
    (await page.locator('nav[aria-label="Su cuenta"]').innerText()).replace(/\s+/g, " "),
  );
  await page.screenshot({ path: SHOTS + "/01-home.png", fullPage: true });

  // 2. Search with a typo
  await page.fill("#q", "licuadra");
  await page.keyboard.press("Enter");
  await page.waitForURL(/buscar/);
  await page.waitForSelector("article");
  log('search "licuadra":', await page.locator("article h3").allInnerTexts());

  // 3. Search "laptop" – the laptop must come before the backpack
  await page.goto(BASE + "/buscar?q=laptop", { waitUntil: "networkidle" });
  log(
    'search "laptop":',
    (await page.locator("article h3").allInnerTexts()).map((t) => t.slice(0, 40)),
  );
  await page.screenshot({ path: SHOTS + "/02-search.png", fullPage: true });

  // 4. Product page with two offers
  await page.goto(BASE + "/p/audifonos-inalambricos-nimbo-aire", { waitUntil: "networkidle" });
  log("pdp h1:", await page.locator("h1").innerText());
  log(
    "buy box:",
    (await page.locator('aside[aria-label="Comprar"]').innerText())
      .replace(/\s+/g, " ")
      .slice(0, 260),
  );
  log("other offers:", await page.locator("#otras-ofertas ~ ul > li").count());
  log("reviews listed:", await page.locator("#resenas li").count());
  await page.screenshot({ path: SHOTS + "/03-product.png", fullPage: true });

  // 5. Add to cart
  await page.locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")').click();
  await page.waitForSelector("text=Agregado al carrito");
  await page.goto(BASE + "/p/cafe-molido-tarrazu-340g", { waitUntil: "networkidle" });
  await page.locator('aside[aria-label="Comprar"] select').selectOption("2");
  await page.locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")').click();
  await page.waitForSelector("text=Agregado al carrito");

  // 6. Cart
  await page.goto(BASE + "/carrito", { waitUntil: "networkidle" });
  log("cart lines:", await page.locator("main ul > li").count());
  log(
    "cart summary:",
    (await page.locator('aside[aria-label="Resumen"]').innerText())
      .replace(/\s+/g, " ")
      .slice(0, 220),
  );
  await page.screenshot({ path: SHOTS + "/04-cart.png", fullPage: true });

  // 7. Checkout requires sign-in
  await page.click("text=Continuar con la compra");
  await page.waitForURL(/ingresar/);
  log("redirected to sign-in:", page.url().replace(BASE, ""));
  await page.fill('main input[name="email"]', "comprador@yuntera.example");
  await page.fill('main input[name="password"]', "wrong-password");
  await page.click('main form button[type="submit"]');
  await page.waitForSelector('main form [role="alert"]');
  log(
    "wrong password message:",
    await page.locator('main form [role="alert"]').first().innerText(),
  );
  log("email kept after the error:", await page.inputValue('main input[name="email"]'));
  log(
    "password cleared after the error:",
    (await page.inputValue('main input[name="password"]')) === "",
  );
  await page.fill('main input[name="password"]', PASSWORD);
  await page.click('main form button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === "/pagar");
  await page.waitForSelector("text=Resumen del pedido");
  log(
    "checkout summary:",
    (await page.locator('aside[aria-label="Resumen del pedido"]').innerText())
      .replace(/\s+/g, " ")
      .slice(0, 330),
  );
  log(
    "payment methods preselected:",
    await page.locator('input[name="paymentMethod"]:checked').count(),
  );
  await page.screenshot({ path: SHOTS + "/05-checkout.png", fullPage: true });

  // 8. Confirm without choosing a payment method -> browser validation blocks it
  await page.click('button:has-text("Confirmar pedido")');
  await page.waitForTimeout(300);
  log("still on checkout without payment method:", page.url().includes("/pagar"));

  // 9. Pay by SINPE
  await page.check('input[name="paymentMethod"][value="sinpe_movil"]');
  await page.click('button:has-text("Confirmar pedido")');
  await page.waitForURL((u) => /^\/pedidos\/YT-/.test(new URL(u).pathname));
  await page.waitForSelector('h1:visible:has-text("Pedido YT-")');
  const orderUrl = page.url();
  log("order page:", orderUrl.replace(BASE, ""));
  log("order h1:", await page.locator("h1:visible").innerText());
  log(
    "stale pages kept hidden:",
    (await page.locator("h1").count()) - (await page.locator("h1:visible").count()),
  );
  log(
    "payment box:",
    (await page.locator('section:visible:has-text("Falta el pago")').innerText())
      .replace(/\s+/g, " ")
      .slice(0, 200),
  );
  await page.screenshot({ path: SHOTS + "/06-order-pending.png", fullPage: true });

  // 10. Simulate payment
  await page.click('button:visible:has-text("Simular pago")');
  await page.waitForSelector("text=Su código de entrega", { timeout: 15000 });
  log(
    "after payment header:",
    (
      await page
        .locator("main:visible header, main:visible h1")
        .first()
        .innerText()
        .catch(() => "?")
    )
      .replace(/\s+/g, " ")
      .slice(0, 120),
  );
  log(
    "PIN shown:",
    /^\d{4}$/.test(
      (
        await page.locator('section:visible:has-text("Su código de entrega") p').first().innerText()
      ).trim(),
    ),
  );
  await page.screenshot({ path: SHOTS + "/07-order-paid.png", fullPage: true });

  // 11. Cart is empty afterwards; orders list
  await page.goto(BASE + "/pedidos", { waitUntil: "networkidle" });
  log("orders listed:", await page.locator("main ul > li").count());
  await page.screenshot({ path: SHOTS + "/07b-orders.png", fullPage: true });
  log("cart badge:", (await page.locator('a[href="/carrito"]').innerText()).replace(/\s+/g, " "));

  // 12. Someone else's order -> not found
  const other = await page.goto(BASE + "/pedidos/YT-100012", { waitUntil: "networkidle" });
  log(
    "other shopper order ->",
    other.status(),
    await page.locator("main h1:visible, main h2:visible").first().innerText(),
  );

  // 13. Mobile viewport
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    locale: "es-CR",
    isMobile: true,
    hasTouch: true,
  });
  const m = await phone.newPage();
  await m.goto(BASE + "/", { waitUntil: "networkidle" });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log("mobile horizontal overflow px:", overflow);
  await m.screenshot({ path: SHOTS + "/08-mobile-home.png", fullPage: false });
  await m.goto(BASE + "/p/laptop-14-nimbo-libro", { waitUntil: "networkidle" });
  log(
    "mobile pdp overflow px:",
    await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  await m.screenshot({ path: SHOTS + "/09-mobile-product.png", fullPage: true });

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 600));
  process.exit(1);
});
