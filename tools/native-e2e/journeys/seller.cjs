// Seller app (apps/seller-native, "Yuntera Vende"), web export, at phone size.
//
// The demo seller, who owns two shops, signs in and chooses Ferretería El
// Higuerón; sees what needs doing today; changes a price and a stock count;
// creates a listing and checks the fee preview against the documented example
// (₡20 000, hogar, card, shipped by the seller: ₡16 203,20); edits the title of
// a published listing and sees it waiting for review; checks that the three
// balances on the payouts screen add up; sees the payout account masked and a
// wrong IBAN refused before anything is sent; and packs an order. Then a shop
// in review sees what the web shows it, and an account with no shop registers
// one (a wrong identification first).
//
// Fails on any console error, uncaught exception or 5xx response. Takes a
// screenshot at each step; they are meant to be looked at.

const { chromium } = require("playwright");

const BASE = process.env.NATIVE_SELLER_URL || "http://127.0.0.1:3011";
const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...args) => console.log(...args);
// A Costa Rican IBAN with two digits swapped: the check digits catch it.
const SWAPPED_IBAN = "CR05 0152 0200 1026 2846 06";
// Prices are written with a narrow no-break space between thousands (₡16 203,20);
// `textOf` turns every kind of space into a plain one.
const NNBSP = "\u202f";

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

/** "₡16 203,20" or "−₡1 500" → céntimos. */
function colones(text) {
  const clean = text.replace(/[^\d,−-]/g, "");
  const negative = /^[−-]/.test(clean);
  const [whole, minor = "0"] = clean.replace(/[−-]/g, "").split(",");
  const amount = Number(whole) * 100 + Number(minor.padEnd(2, "0"));
  return negative ? -amount : amount;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const payoutRequests = [];

  const open = async (name) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
      timezoneId: "America/Costa_Rica",
    });
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => errors.push(`${name} pageerror: ${String(e).slice(0, 300)}`));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`${name} HTTP ${r.status()} ${r.url()}`);
    });
    page.on("request", (r) => {
      if (/\/rpc\/seller_request_payout_details/.test(r.url())) payoutRequests.push(r.url());
    });
    return { context, page };
  };

  const { context, page } = await open("seller");
  const visible = (id) => page.getByTestId(id).filter({ visible: true }).first();
  // The tabs keep their screens (and each one's header) in the page; the one
  // in front is the one whose centre is not covered by another screen.
  const front = async (id) => {
    const all = page.getByTestId(id);
    const index = await all.evaluateAll((elements) =>
      elements.findIndex((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0) return false;
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top !== null && el.contains(top);
      }),
    );
    if (index < 0) throw new Error(`Nothing called ${id} is on screen`);
    return all.nth(index);
  };
  const textOf = async (id) => (await visible(id).innerText()).replace(/\s+/g, " ").trim();
  const shot = (name) => page.screenshot({ path: `${SHOTS}/native-seller-${name}.png` });
  const shotFull = (name) =>
    page.screenshot({ path: `${SHOTS}/native-seller-${name}.png`, fullPage: true });
  const noSideways = async (where) =>
    check(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      `${where}: no sideways scrolling at 390 px`,
    );
  const tab = (name) => page.getByRole("tab", { name: new RegExp(`^${name}`) }).first();
  const signIn = async (p, email) => {
    await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await p.getByTestId("sign-in-email").first().fill(email);
    await p.getByTestId("sign-in-password").first().fill(PASSWORD);
    await p.getByTestId("sign-in-submit").first().click();
  };

  // 1. Sign in as the seller with two shops
  await signIn(page, "vendedor@yuntera.example");
  await visible("seller-overview").waitFor();
  const firstShop = await textOf("current-shop");
  check(firstShop.length > 0, `the header names the shop the seller is in (${firstShop})`);
  await shot("01-home-first-shop");

  // 2. Choose a shop: first the other one, then Ferretería El Higuerón, whose
  // products the seller ships and whose parcel waits to be packed.
  const chooseShop = async (name) => {
    await (await front("change-shop")).click();
    const sheet = page.getByText("¿En qué tienda va a trabajar?").first();
    await sheet.waitFor();
    await page.waitForTimeout(400); // the sheet slides up
    if (name === "Ferretería El Higuerón") await shot("02-choose-shop");
    await page
      .getByRole("radio", { name: new RegExp(name) })
      .first()
      .click();
    await sheet.waitFor({ state: "hidden" });
    await page.waitForFunction(
      (shopName) =>
        [...document.querySelectorAll('[data-testid="current-shop"]')].every((el) =>
          el.textContent.includes(shopName),
        ),
      name,
      { timeout: 10_000 },
    );
    await visible("seller-overview").getByText(name).first().waitFor();
    check(true, `after choosing ${name}, the header and the home screen are that shop's`);
  };
  await chooseShop(firstShop.includes("Tecno") ? "Ferretería El Higuerón" : "TecnoCasa");
  if (!(await textOf("current-shop")).includes("Higuerón")) {
    await chooseShop("Ferretería El Higuerón");
  }

  // 3. What needs doing today
  const today = await textOf("today-summary");
  log("   ", today);
  check(/1 paquete por empacar/.test(today), "the home screen says one parcel waits to be packed");
  check((await textOf("stat-to-pack")) === "1", "and shows it as the figure to deal with");
  await noSideways("home");
  await shotFull("03-home-today");

  // 4. Change a price and a stock count
  await tab("Productos").click();
  const firstListing = page.locator('[data-testid^="listing-"]').filter({ visible: true }).first();
  await firstListing.waitFor();
  const listingTitle = (await firstListing.innerText()).split("\n")[0];
  log("    listing:", listingTitle);
  await noSideways("listings");
  await shot("04-listings");
  await firstListing.click();
  await visible("offer-price").waitFor();
  const before = await visible("offer-price").inputValue();
  const after = String(Number(before) + 100);
  await visible("offer-price").fill(after);
  await visible("offer-save").click();
  await page.getByText("Cambios guardados.").first().waitFor();
  check(true, `price changed from ₡${before} to ₡${after}`);
  const stockField = page.locator('[data-testid^="stock-quantity-"]').filter({ visible: true });
  await stockField.first().fill("23");
  await page.locator('[data-testid^="stock-save-"]').filter({ visible: true }).first().click();
  await page.getByText("Existencias actualizadas.").first().waitFor();
  check(true, "stock at the seller's own place set to 23");
  await noSideways("offer");
  await shotFull("05-offer-price-stock");
  await page.getByRole("button", { name: "Volver" }).filter({ visible: true }).first().click();
  await page.waitForFunction(
    (price) =>
      [...document.querySelectorAll('[data-testid="listing-price"]')].some((el) =>
        el.textContent.replace(/\D/g, "").startsWith(price),
      ),
    after,
    { timeout: 10_000 },
  );
  check(true, "the list of products shows the new price");

  // 5. A new listing, with the fee preview of the documented example
  await visible("new-listing").click();
  await visible("listing-title").waitFor();
  await visible("listing-title").fill("Lámpara de escritorio LED Volcán con brazo flexible");
  await visible("category").click();
  await page.getByTestId("category-filter").filter({ visible: true }).first().fill("cocina");
  await page.getByTestId("category-option-cocina").filter({ visible: true }).first().click();
  await visible("listing-bullets").fill("Luz cálida y fría\nBrazo flexible\nPuerto USB");
  await visible("listing-price").fill("20 000");
  await visible("listing-fulfillment-seller").click();
  await visible("package-weightGrams").fill("900");
  await visible("package-lengthCm").fill("30");
  await visible("package-widthCm").fill("15");
  await visible("package-heightCm").fill("12");
  await visible("fee-method-card").click();
  const preview = await textOf("fee-preview");
  log("   ", preview.slice(0, 260));
  check(
    // Read as drawn: the shared formatting puts a narrow no-break space between thousands.
    (await visible("fee-payout").innerText()).trim() === `₡16${NNBSP}203,20`,
    "fee preview: ₡20 000, hogar, card, shipped by the seller → ₡16 203,20",
  );
  check(
    preview.includes("Comisión (12 %)") &&
      preview.includes("− ₡2 400") &&
      preview.includes("− ₡960") &&
      preview.includes("− ₡436,80") &&
      !preview.includes("Bodega y despacho"),
    "itemised: 12 % commission ₡2 400, payment ₡960, IVA on fees ₡436,80, no warehouse fee",
  );
  await visible("fee-preview").scrollIntoViewIfNeeded();
  await shot("06-new-listing-fee-preview");
  await visible("listing-submit").click();
  await visible("created-message").waitFor();
  check(
    /enviado a revisión/.test(await textOf("created-message")),
    "the listing is sent for review and the list says so",
  );
  await page
    .getByText("Lámpara de escritorio LED Volcán")
    .filter({ visible: true })
    .first()
    .waitFor();
  check(true, "and it is in the list");
  await shot("07-listing-created");

  // 6. Edit the title of a published listing: it waits for review
  await page.locator('[data-testid^="listing-"]').filter({ hasText: listingTitle }).first().click();
  await visible("edit-listing").click();
  await visible("edit-state").waitFor();
  check(/Publicado y a la venta/.test(await textOf("edit-state")), "the listing is published");
  const newTitle = `${listingTitle} (empaque nuevo)`;
  await visible("edit-title").fill(newTitle);
  await visible("edit-submit").click();
  await visible("edit-result").waitFor();
  check(
    /sigue a la venta tal como está/.test(await textOf("edit-result")),
    "sending the change says the listing stays on sale as it is until approved",
  );
  await visible("edit-pending").waitFor();
  check(
    /sus cambios están en revisión/.test(await textOf("edit-pending")),
    "the listing now shows its change waiting for review",
  );
  const changes = await textOf("listing-changes");
  check(
    changes.includes("PUBLICADO AHORA") && changes.includes(newTitle),
    "old and new title side by side, labelled in words",
  );
  check((await textOf("edit-heading")) === listingTitle, "shoppers still see the old title");
  await noSideways("edit");
  await visible("edit-pending").scrollIntoViewIfNeeded();
  await shot("08-edit-in-review");
  await page.getByRole("button", { name: "Volver" }).filter({ visible: true }).first().click();
  await page.getByText("Cambios en revisión").filter({ visible: true }).first().waitFor();
  check(true, "the product's screen marks the change in review");
  await page.getByRole("button", { name: "Volver" }).filter({ visible: true }).first().click();

  // 7. Payouts: the three balances add up to the total
  await tab("Pagos").click();
  await visible("balance-total").waitFor();
  const available = colones(await textOf("balance-available"));
  const pending = colones(await textOf("balance-pending"));
  const inTransit = colones(await textOf("balance-in-transit"));
  const total = colones(await textOf("balance-total"));
  log("    available", available, "pending", pending, "in transit", inTransit, "total", total);
  check(available + pending + inTransit === total, "available + pending + in transit = total");
  check(
    /queda disponible 10 días después de que entregamos/.test(await textOf("payout-hold")),
    "the hold is explained in plain words",
  );
  await noSideways("payouts");
  await shot("09-payouts");

  // 8. Account: the payout account is masked, a wrong IBAN is refused before sending
  await (await front("open-account")).click();
  await visible("payout-account").waitFor();
  const masked = await textOf("payout-iban-masked");
  log("    payout account:", masked);
  check(/^CR•• •••• •••• •••• \d{4}$/.test(masked), "the payout account is shown masked");
  check(
    !/CR\d{20}/.test(await page.locator("body").innerText()),
    "no full account number on screen",
  );
  await visible("payout-iban").fill(SWAPPED_IBAN);
  await visible("payout-holder").fill("Ana Mora Solís");
  await visible("payout-request-submit").click();
  await visible("payout-request-error").waitFor();
  check(
    /no coinciden/.test(await textOf("payout-request-error")),
    "a wrong IBAN is refused with the reason",
  );
  check(payoutRequests.length === 0, "and nothing was sent to the API");
  await noSideways("account");
  await visible("payout-iban").scrollIntoViewIfNeeded();
  await shot("10-account-wrong-iban");
  await page.getByRole("button", { name: "Volver" }).filter({ visible: true }).first().click();

  // 9. Mark an order packed, reached from what the home screen says needs doing
  await tab("Inicio").click();
  await page
    .getByRole("link", { name: /^Pedidos por empacar: 1/ })
    .filter({ visible: true })
    .first()
    .click();
  await page.waitForURL((url) => new URL(url).pathname === "/pedidos");
  check(
    (await page.getByRole("tab", { selected: true }).first().innerText()).includes("Pedidos"),
    "the figure on the home screen opens the orders tab",
  );
  const parcel = page.locator('[data-testid^="parcel-"]').filter({ visible: true }).first();
  await parcel.waitFor();
  const tracking = (await parcel.getAttribute("data-testid")).slice("parcel-".length);
  await shotFull("11-orders-to-pack");
  await visible(`pack-weight-${tracking}`).fill("850");
  await visible(`pack-submit-${tracking}`).click();
  await visible("pack-result").waitFor();
  check(/listo/.test(await textOf("pack-result")), `parcel ${tracking} marked as packed`);
  check(
    (await textOf("parcels-waiting")).includes(tracking),
    "it now waits for the driver, and nothing is left to pack",
  );
  await visible("nothing-to-pack").waitFor();
  await noSideways("orders");
  await shot("12-orders-packed");

  // 10. Inventory: the seller's own place, then stock sent to the warehouse (TecnoCasa)
  await tab("Inventario").click();
  await page.locator('[data-testid^="location-"]').filter({ visible: true }).first().waitFor();
  await noSideways("inventory");
  await shot("12b-inventory-own-place");
  await chooseShop("TecnoCasa");
  await tab("Inventario").click();
  await visible("new-inbound").click();
  await page.locator('[data-testid^="inbound-qty-"]').filter({ visible: true }).first().fill("15");
  await visible("inbound-submit").click();
  await visible("inbound-result").waitFor();
  const inbound = await textOf("inbound-result");
  check(/referencia IN-/.test(inbound), `an inbound shipment is registered: ${inbound}`);
  await shot("12c-inbound-registered");
  await context.close();

  // 11. A shop still in review sees what the web shows it
  const pendingShop = await open("pending");
  await signIn(pendingShop.page, "bazar@yuntera.example");
  await pendingShop.page.getByTestId("shop-pending").first().waitFor();
  check(true, "a shop in review is told so on its home screen");
  await pendingShop.page.screenshot({ path: `${SHOTS}/native-seller-13-pending-shop.png` });
  await pendingShop.context.close();

  // 12. An account with no shop registers one
  const newcomer = await open("newcomer");
  const p = newcomer.page;
  const by = (id) => p.getByTestId(id).filter({ visible: true }).first();
  await signIn(p, "comprador@yuntera.example");
  await by("no-access").waitFor();
  await p.screenshot({ path: `${SHOTS}/native-seller-14a-no-shop.png` });
  await by("start-registration").click();
  await by("shop-trade-name").fill("Cerámica La Guaria");
  await by("shop-id-number").fill("123");
  await by("shop-legal-name").fill("Ana Mora Solís");
  await by("shop-fiscal-address").fill("Cartago, Paraíso, Orosi, 200 m norte de la iglesia");
  await by("shop-phone").fill("8812-3456");
  await by("shop-declare").click();
  await by("shop-submit").click();
  await by("shop-result").waitFor();
  check(
    /no es válido/.test(await by("shop-result").innerText()),
    "a wrong identification is refused",
  );
  await p.screenshot({ path: `${SHOTS}/native-seller-14-register-error.png` });
  await by("shop-id-number").fill("3-0456-0789");
  await by("shop-submit").click();
  await p.getByTestId("seller-overview").filter({ visible: true }).first().waitFor();
  await p.getByText("Recibimos su solicitud").first().waitFor();
  check(
    (await by("current-shop").innerText()).includes("Cerámica La Guaria"),
    "the new shop opens, in review, with a welcome",
  );
  await p.screenshot({ path: `${SHOTS}/native-seller-15-registered.png` });

  // The new shop saves a draft it will ship itself, then registers where we collect
  await p
    .getByRole("tab", { name: /^Productos/ })
    .first()
    .click();
  await by("new-listing").click();
  await by("listing-title").fill("Taza de cerámica pintada a mano 350 ml");
  await by("category").click();
  await p.getByTestId("category-filter").filter({ visible: true }).first().fill("cocina y");
  await p.getByTestId("category-option-cocina").filter({ visible: true }).first().click();
  await by("listing-price").fill("6 500");
  await by("listing-fulfillment-seller").click();
  await by("package-weightGrams").fill("450");
  await by("package-lengthCm").fill("12");
  await by("package-widthCm").fill("12");
  await by("package-heightCm").fill("12");
  await by("listing-draft").click();
  await by("created-message").waitFor();
  check(/Borrador guardado/.test(await by("created-message").innerText()), "a draft is saved");
  await p
    .getByRole("tab", { name: /^Inventario/ })
    .first()
    .click();
  await by("add-location").click();
  await by("location-name").fill("Taller Orosi");
  await by("province").click();
  await by("province-option-3").click();
  await by("canton").click();
  await by("canton-option-302").click();
  await by("district").click();
  await by("district-option-30203").click();
  await by("location-address").fill("Orosi centro, 200 m norte de la iglesia, portón verde");
  await by("location-save").click();
  await by("location-result").waitFor();
  check(
    /código Plus/.test(await by("location-result").innerText()),
    "without the exact point it asks for the Plus Code",
  );
  await by("location-plus-code").fill("66XRQ4XR+RH");
  await by("location-plus-apply").click();
  await p.getByText("Punto marcado").first().waitFor();
  await p.waitForTimeout(500); // the district sheet slides away
  await p.screenshot({ path: `${SHOTS}/native-seller-16-pickup-place.png` });
  await by("location-save").click();
  await p.getByText("Taller Orosi").filter({ visible: true }).first().waitFor();
  check(true, "the pickup place is saved and the inventory lists it, ready for a stock count");
  await p.screenshot({ path: `${SHOTS}/native-seller-17-inventory-new-place.png` });
  await newcomer.context.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
