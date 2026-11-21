// Shopper app (apps/shop-native), web export, at phone size.
//
// A signed-out visitor browses and searches (with a typo), opens a product,
// adds it to the cart, is sent to sign in at checkout, gets one clear message
// for a wrong password, signs in as the demo shopper, pays by SINPE Móvil,
// simulates the payment, sees the delivery code, finds the order in the list
// and signs out. It starts with a product opened by link, which must have a
// way back to the shop.
//
// Fails on any browser console error, uncaught exception or 5xx response. The
// one expected failure is the auth server's 400 for the wrong password: a
// browser logs every refused request to the console, so that single request
// is allowed by URL and status, at that step only.

const { chromium } = require("playwright");

const BASE = process.env.NATIVE_SHOP_URL || "http://127.0.0.1:3010";
const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHOPPER = "comprador@yuntera.example";
const log = (...args) => console.log(...args);

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    timezoneId: "America/Costa_Rica",
  });
  const page = await context.newPage();
  const errors = [];
  let expectRefusedSignIn = false;
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const url = message.location()?.url ?? "";
    if (
      expectRefusedSignIn &&
      /status of 400/.test(message.text()) &&
      /\/auth\/v1\/token\?grant_type=password/.test(url)
    ) {
      log("  (expected: the auth server refused the wrong password with 400)");
      return;
    }
    errors.push(`console: ${message.text().slice(0, 300)} ${url}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 300)}`));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });

  const visible = (testId) => page.getByTestId(testId).filter({ visible: true }).first();
  const shot = (name) => page.screenshot({ path: `${SHOTS}/native-shop-${name}.png` });
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const tab = (name) => page.getByRole("tab", { name: new RegExp(`^${name}`) }).first();

  // 0. A link that opens a product directly still has a way back to the shop
  await page.goto(`${BASE}/p/camiseta-algodon-sendero`, { waitUntil: "networkidle" });
  await visible("buy-box").waitFor();
  check((await page.getByRole("tab").count()) === 0, "a product opened by link fills the screen");
  const back = page
    .getByRole("button", { name: "Volver a Inicio" })
    .filter({ visible: true })
    .first();
  const backBox = await back.boundingBox();
  check(
    backBox !== null && backBox.width >= 44 && backBox.height >= 44,
    "its back button is named in Spanish and at least 44 px",
  );
  await back.click();
  await page.waitForURL((url) => new URL(url).pathname === "/");
  check(
    (await page.getByRole("tab").filter({ visible: true }).count()) === 5,
    "its back button leads to the shop's home, with the tabs",
  );

  // 1. Home, signed out
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByText("Lo que ocupa, a su puerta.").first().waitFor();
  check((await overflow()) <= 0, "home has no sideways scrolling at 390 px");
  await shot("01-home");
  await page.getByText("Lo que más se está llevando").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot("01b-home-products");

  // 2. Browse a category
  await tab("Categorías").click();
  const firstDepartment = page.locator('[data-testid^="department-"]').first();
  await firstDepartment.waitFor();
  const departmentName = (await firstDepartment.innerText()).split("\n")[0];
  await firstDepartment.click();
  await page.waitForURL(/\/c\//);
  await page.locator('[data-testid^="product-"]').filter({ visible: true }).first().waitFor();
  log("  category:", departmentName, "→", page.url().replace(BASE, ""));
  check((await overflow()) <= 0, "category has no sideways scrolling");
  await shot("02-category");
  await page.goBack();
  await page.waitForURL(/\/categorias/);

  // 3. Search with a typo
  await tab("Buscar").click();
  await page.waitForURL(/\/buscar/);
  await visible("search-input").fill("licuadra");
  await visible("search-input").press("Enter");
  await page.waitForURL(/q=licuadra/);
  await page.locator('[data-testid^="product-"]').filter({ visible: true }).first().waitFor();
  const typoResults = await page
    .locator('[data-testid^="product-"]')
    .filter({ visible: true })
    .allInnerTexts();
  check(
    typoResults.some((text) => /Licuadora/.test(text)),
    'the search "licuadra" finds the blender despite the typo',
  );
  await shot("03-search-typo");

  // 4. Product page with competing offers and a delivery date
  await visible("search-input").fill("audífonos");
  await visible("search-input").press("Enter");
  await page.waitForURL(/q=aud/);
  await visible("product-audifonos-inalambricos-nimbo-aire").click();
  await page.waitForURL(/\/p\/audifonos-inalambricos-nimbo-aire/);
  await visible("buy-box").waitFor();
  const buyBox = (await visible("buy-box").innerText()).replace(/\s+/g, " ");
  log("  buy box:", buyBox.slice(0, 220));
  check(
    /Vendido por/.test(buyBox) && /Llega/.test(buyBox),
    "the buy box says who sells it and when it arrives",
  );
  const otherOffers = await page.getByTestId("other-offer").filter({ visible: true }).count();
  check(otherOffers >= 1, `competing offers are listed (${otherOffers})`);
  check((await overflow()) <= 0, "product page has no sideways scrolling");
  await shot("04-product");

  // 5. Add to the cart
  await visible("add-to-cart").click();
  await visible("added-message").waitFor();
  check(true, "added to the cart");
  await page.goBack();
  await page.waitForURL(/\/buscar/);
  check(/1/.test(await tab("Carrito").innerText()), "the cart tab shows one unit");
  await tab("Carrito").click();
  await page.waitForURL(/\/carrito/);
  await visible("cart-summary").waitFor();
  check(
    (await page.getByTestId("cart-line").filter({ visible: true }).count()) === 1,
    "the cart has one line",
  );
  await shot("05-cart");

  // 6. Checkout asks a visitor to sign in
  await visible("cart-continue").click();
  await page.waitForURL(/\/ingresar\?siguiente=%2Fpagar/);
  check(true, "a visitor is sent to sign in at checkout");
  await visible("sign-in-email").fill(SHOPPER);
  await visible("sign-in-password").fill("contrasena-equivocada");
  expectRefusedSignIn = true;
  await visible("sign-in-submit").click();
  await visible("sign-in-message").waitFor();
  const wrong = (await visible("sign-in-message").innerText()).trim();
  expectRefusedSignIn = false;
  check(
    wrong === "El correo o la contraseña no coinciden.",
    `one clear message for a wrong password: "${wrong}"`,
  );
  check(
    (await page.getByRole("alert").filter({ visible: true }).count()) === 1,
    "exactly one message is shown",
  );
  check((await visible("sign-in-email").inputValue()) === SHOPPER, "the e-mail is kept");
  check((await visible("sign-in-password").inputValue()) === "", "the password is cleared");
  await shot("06-wrong-password");

  // 7. Sign in and check out with SINPE Móvil
  await visible("sign-in-password").fill(PASSWORD);
  await visible("sign-in-submit").click();
  await page.waitForURL((url) => new URL(url).pathname === "/pagar");
  await visible("checkout-summary").waitFor();
  const preselected = await page
    .locator('[data-testid^="payment-"][aria-checked="true"]')
    .filter({ visible: true })
    .count();
  check(preselected === 0, "no payment method is pre-selected");
  const address = await page
    .locator('[data-testid^="address-"][aria-checked="true"]')
    .filter({ visible: true })
    .count();
  check(address === 1, "the shopper's own address is the one thing pre-selected");
  log(
    "  summary:",
    (await visible("checkout-summary").innerText()).replace(/\s+/g, " ").slice(0, 260),
  );
  check((await overflow()) <= 0, "checkout has no sideways scrolling");
  await shot("07-checkout");
  await visible("checkout-confirm").click();
  await visible("checkout-message").waitFor();
  check(
    (await visible("checkout-message").innerText()).includes("Elija cómo desea pagar."),
    "confirming without a payment method asks for one",
  );
  await visible("payment-sinpe_movil").click();
  await visible("checkout-confirm").click();
  await page.waitForURL((url) => /^\/pedidos\/YT-/.test(new URL(url).pathname));
  await visible("payment-instructions").waitFor();
  const orderNumber = decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
  log("  order:", orderNumber);
  const reference = (await visible("sinpe-reference").innerText()).trim();
  check(reference.length > 0, `SINPE instructions with reference ${reference}`);
  await shot("08-order-pending");

  // 8. Simulate the payment; the delivery code appears
  await visible("simulate-payment").click();
  await visible("delivery-pin").waitFor({ timeout: 15000 });
  const pin = (await visible("delivery-pin").innerText()).trim();
  check(/^\d{4}$/.test(pin), "the delivery code (4 digits) is shown to the shopper");
  await shot("09-order-paid");

  // 9. The order is in the list
  await page.goBack();
  await page.waitForURL((url) => !/^\/pedidos\//.test(new URL(url).pathname));
  await tab("Cuenta").click();
  await page.waitForURL(/\/cuenta/);
  await visible("account-orders").click();
  await page.waitForURL(/\/pedidos$/);
  await visible(`order-${orderNumber}`).waitFor();
  check(true, `${orderNumber} is in "Sus pedidos"`);
  check((await overflow()) <= 0, "orders list has no sideways scrolling");
  await shot("10-orders");

  // 10. The cart was emptied by the order
  await page.goBack();
  await page.waitForURL(/\/cuenta/);
  check(!(await tab("Carrito").innerText()).match(/\d/), "the cart badge is gone after ordering");

  // 11. Sign out
  await visible("sign-out").click();
  await page.getByText("Crear una cuenta").filter({ visible: true }).first().waitFor();
  check(true, "signed out");
  await shot("11-signed-out");

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
