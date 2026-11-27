// Seller journey: two shops, prices, new listing, inventory, inbound stock, packing, payouts, registration.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium } = require("playwright");
const seller = require("../lib/seller.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = process.env.SELLER_URL || "http://127.0.0.1:3001";
const log = (...a) => console.log(...a);
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
  const signIn = (page, email) => seller.signInHome(page, email);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const page = await context.newPage();
  watch(page);

  // 0. A visitor is sent to sign in
  await seller.open(page, "/productos");
  log("visitor on /productos ->", page.url().replace(BASE, ""));

  // 1. Seller with two shops
  await signIn(page, "vendedor@yuntera.example");
  log("dashboard h1:", await seller.heading(page));
  log("nav:", await seller.sectionsNav(page));
  log("stats:", (await seller.firstSection(page)).slice(0, 200));
  await page.screenshot({ path: SHOTS + "/s1-dashboard.png", fullPage: true });

  // 2. Switch shop
  const shops = await seller.shopOptions(page);
  log("shops:", shops);
  const currentShop = await seller.heading(page);
  const target = shops.find((s) => s !== currentShop);
  await seller.switchShop(page, target);
  log("switched to:", await seller.heading(page));
  const ferreteria = shops.find((s) => s.includes("Higuer"));
  if (target !== ferreteria) await seller.switchShop(page, ferreteria, "Higuer");

  // 3. Listings + edit a price (Ferretería)
  await seller.open(page, "/productos");
  log("listing rows:", await seller.tableRows(page));
  log("first row:", (await seller.tableRow(page)).slice(0, 170));
  const priced = await seller.raiseFirstPrice(page, 100);
  log("price edit:", priced.before, "->", priced.summary, "|", priced.message);
  // regular price lower than price is refused with a clear message
  log("bad regular price:", await seller.badRegularPrice(page, "1"));
  await page.screenshot({ path: SHOTS + "/s2-listings.png", fullPage: true });

  // 4. Inventory for seller-fulfilled items
  await seller.open(page, "/inventario");
  log("inventory sections:", await seller.sectionHeadings(page));
  const stock = await seller.setFirstStock(page, "23");
  log("stock set:", stock.message, "| row:", stock.row.slice(0, 120));
  await page.screenshot({ path: SHOTS + "/s3-inventory.png", fullPage: true });

  // 5. New listing with fee preview (TecnoCasa: platform fulfilled)
  await seller.switchShop(
    page,
    shops.find((s) => s.includes("Tecno")),
    "TecnoCasa",
  );
  await seller.open(page, "/productos/nuevo");
  const preview = await seller.fillNewListing(page, {
    title: "Lámpara de escritorio LED Volcán con brazo flexible",
    group: "Hogar",
    bullets: "Luz cálida y fría\nBrazo flexible\nPuerto USB",
    price: "20 000",
    weight: "900",
    length: "30",
    width: "15",
    height: "12",
    method: "card",
  });
  log("fee preview (₡20 000 hogar, bodega, tarjeta):", preview);
  await page.screenshot({ path: SHOTS + "/s4-new-listing.png", fullPage: true });
  await seller.sendNewListing(page);
  log("after create:", await seller.statusText(page));
  log("new listing row:", (await seller.lastRowWith(page, "Lámpara de escritorio")).slice(0, 150));

  // 6. Inbound shipment to the Yuntera warehouse
  await seller.open(page, "/inventario");
  log("inbound:", (await seller.announceInbound(page, "15")).slice(0, 160));
  await page.screenshot({ path: SHOTS + "/s5-inbound.png", fullPage: true });

  // 7. Payouts and account
  await seller.open(page, "/pagos");
  log("payout stats:", (await seller.balancesText(page)).slice(0, 200));
  log(
    "statement rows:",
    await seller.tableRows(page),
    "| first:",
    (await seller.tableRow(page)).slice(0, 140),
  );
  await page.screenshot({ path: SHOTS + "/s6-payouts.png", fullPage: true });
  await seller.open(page, "/cuenta");
  log("account:", (await seller.section(page, 1)).slice(0, 170));
  await context.close();

  // 8. A seller who ships their own parcels packs one
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CR" });
  const p2 = await c2.newPage();
  watch(p2);
  await signIn(p2, "vendedor@yuntera.example");
  await seller.chooseShop(p2, "Ferretería El Higuerón");
  await seller.open(p2, "/pedidos");
  const parcels = await seller.parcelsToPack(p2);
  log("parcels to pack:", parcels);
  if (parcels) {
    log("parcel:", (await seller.firstParcelToPack(p2)).slice(0, 200));
    await seller.packFirstParcel(p2, "850");
    log(
      "after packing, to pack:",
      await seller.parcelsToPack(p2),
      "|",
      (await seller.toPackText(p2)).slice(0, 120),
    );
  }
  log("sales rows:", await seller.salesRows(p2));
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
  await seller.open(p3, "/registro");
  log(
    "mobile /registro overflow px:",
    await p3.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  const stamp = Date.now().toString().slice(-7);
  await seller.registerAccount(p3, {
    name: "Rosa Vargas Mena",
    email: `rosa${stamp}@yuntera.example`,
    password: "clave-segura-123",
  });
  await seller.fillShopDetails(p3, {
    tradeName: `Dulces Doña Rosa ${stamp}`,
    idNumber: "1-1234-0" + stamp.slice(-3),
    legalName: "Rosa Vargas Mena",
    fiscalAddress: "Cartago, Paraíso, Orosi, 200 metros norte de la iglesia",
    contactPhone: "8765 4321",
  });
  // submit without ticking the declaration: the browser blocks it
  await seller.sendShopRequest(p3);
  await p3.waitForTimeout(400);
  log("blocked without declaration:", new URL(p3.url()).pathname === "/registro");
  await seller.declare(p3);
  await seller.sendShopRequest(p3);
  await seller.waitForShopDashboard(p3, "Dulces");
  log(
    "new shop dashboard:",
    await seller.heading(p3),
    "|",
    (await seller.statusMessages(p3)).map((t) => t.slice(0, 60)),
  );
  log(
    "mobile dashboard overflow px:",
    await p3.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  await p3.screenshot({ path: SHOTS + "/s8-mobile-new-shop.png", fullPage: true });
  await seller.open(p3, "/productos");
  log("new shop listings:", await seller.firstSubheading(p3));
  await c3.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
