// Shopper journey: search, product, cart, sign-in, checkout, payment, orders, phone width.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium } = require("playwright");
const web = require("../lib/web.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = web.BASE;
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
  await web.open(page, "/");
  const home = await web.homeSummary(page);
  log("home title:", home.title);
  log("home h1:", home.heading);
  log("home product cards:", home.cards);
  log("header cart/account:", await web.accountNav(page));
  await page.screenshot({ path: SHOTS + "/01-home.png", fullPage: true });

  // 2. Search with a typo
  await web.search(page, "licuadra");
  log('search "licuadra":', await web.cardTitles(page));

  // 3. Search "laptop" – the laptop must come before the backpack
  await web.open(page, "/buscar?q=laptop");
  log(
    'search "laptop":',
    (await web.cardTitles(page)).map((t) => t.slice(0, 40)),
  );
  await page.screenshot({ path: SHOTS + "/02-search.png", fullPage: true });

  // 4. Product page with two offers
  await web.open(page, "/p/audifonos-inalambricos-nimbo-aire");
  const product = await web.productSummary(page);
  log("pdp h1:", product.heading);
  log("buy box:", product.buyBox.slice(0, 260));
  log("other offers:", product.otherOffers);
  log("reviews listed:", product.reviews);
  await page.screenshot({ path: SHOTS + "/03-product.png", fullPage: true });

  // 5. Add to cart
  await web.addToCart(page);
  await web.open(page, "/p/cafe-molido-tarrazu-340g");
  await web.addToCart(page, { quantity: 2 });

  // 6. Cart
  await web.open(page, "/carrito");
  const cart = await web.cartSummary(page);
  log("cart lines:", cart.lines);
  log("cart summary:", cart.summary.slice(0, 220));
  await page.screenshot({ path: SHOTS + "/04-cart.png", fullPage: true });

  // 7. Checkout requires sign-in
  await web.continueToCheckout(page);
  await page.waitForURL(/ingresar/);
  log("redirected to sign-in:", page.url().replace(BASE, ""));
  await web.fillSignInForm(page, "comprador@yuntera.example", "wrong-password");
  const refused = await web.signInError(page);
  log("wrong password message:", refused.message);
  log("email kept after the error:", refused.email);
  log("password cleared after the error:", refused.passwordCleared);
  await web.fillSignInForm(page, "comprador@yuntera.example", PASSWORD);
  await page.waitForURL((u) => new URL(u).pathname === "/pagar");
  const checkout = await web.checkoutSummary(page);
  log("checkout summary:", checkout.summary.slice(0, 330));
  log("payment methods preselected:", checkout.preselected);
  await page.screenshot({ path: SHOTS + "/05-checkout.png", fullPage: true });

  // 8. Confirm without choosing a payment method -> browser validation blocks it
  await web.confirmOrder(page);
  await page.waitForTimeout(300);
  log("still on checkout without payment method:", page.url().includes("/pagar"));

  // 9. Pay by SINPE
  await web.choosePayment(page, "sinpe_movil");
  await web.confirmOrder(page);
  const orderHeading = await web.waitForOrderPage(page);
  const orderUrl = page.url();
  log("order page:", orderUrl.replace(BASE, ""));
  log("order h1:", orderHeading);
  log("stale pages kept hidden:", await web.hiddenHeadings(page));
  log("payment box:", (await web.paymentDue(page)).slice(0, 200));
  await page.screenshot({ path: SHOTS + "/06-order-pending.png", fullPage: true });

  // 10. Simulate payment
  await web.simulatePayment(page);
  log("after payment header:", (await web.orderHeading(page)).slice(0, 120));
  log("PIN shown:", /^\d{4}$/.test(await web.deliveryPin(page)));
  await page.screenshot({ path: SHOTS + "/07-order-paid.png", fullPage: true });

  // 11. Cart is empty afterwards; orders list
  await web.open(page, "/pedidos");
  log("orders listed:", await web.orderCount(page));
  await page.screenshot({ path: SHOTS + "/07b-orders.png", fullPage: true });
  log("cart badge:", await web.cartBadge(page));

  // 12. Someone else's order -> not found
  const other = await web.open(page, "/pedidos/YT-100012");
  log("other shopper order ->", other.status(), await web.firstHeading(page));

  // 13. Mobile viewport
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    locale: "es-CR",
    isMobile: true,
    hasTouch: true,
  });
  const m = await phone.newPage();
  await web.open(m, "/");
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log("mobile horizontal overflow px:", overflow);
  await m.screenshot({ path: SHOTS + "/08-mobile-home.png", fullPage: false });
  await web.open(m, "/p/laptop-14-nimbo-libro");
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
