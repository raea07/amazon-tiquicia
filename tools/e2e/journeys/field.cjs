// Driver and warehouse journey on a phone-sized screen: route, delivery code, cash, picking, packing, receiving.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = process.env.FIELD_URL || "http://127.0.0.1:3003";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

async function rpcAs(email, calls) {
  const ctx = await request.newContext();
  const t = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await t.json();
  const out = [];
  for (const [fn, args] of calls) {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: args,
    });
    out.push(await r.json());
  }
  await ctx.dispose();
  return out;
}
async function pinFor(email, tracking) {
  const [orders] = await rpcAs(email, [["my_orders", {}]]);
  for (const o of orders) {
    const [d] = await rpcAs(email, [["get_order", { p_order_number: o.order_number }]]);
    if (d.shipments?.some((s) => s.tracking_code === tracking)) return d.delivery_pin;
  }
  return null;
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
  const phone = () =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
      geolocation: { latitude: 9.9336, longitude: -84.0513 },
      permissions: ["geolocation"],
    });
  const signIn = async (page, email) => {
    await page.goto(BASE + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => !["/ingresar", "/"].includes(new URL(u).pathname));
    await page.waitForLoadState("networkidle");
  };

  // 0. People who are neither drivers nor warehouse staff
  const c0 = await phone();
  const p0 = await c0.newPage();
  watch(p0);
  await p0.goto(BASE + "/ruta", { waitUntil: "networkidle" });
  log("visitor on /ruta ->", p0.url().replace(BASE, ""));
  await signIn(p0, "comprador@yuntera.example");
  log("shopper lands on:", new URL(p0.url()).pathname);
  await c0.close();

  // ── Driver ──
  const c1 = await phone();
  const page = await c1.newPage();
  watch(page);
  await signIn(page, "repartidor@yuntera.example");
  log(
    "driver lands on:",
    new URL(page.url()).pathname,
    "|",
    await text(page.locator("main h1:visible")),
  );
  log(
    "route card:",
    (await text(page.locator("main:visible section > div").first())).slice(0, 170),
  );
  const stops = page.locator("main:visible ol > li");
  log("stops:", await stops.count(), "| first:", (await text(stops.first())).slice(0, 150));
  log(
    "overflow px:",
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  await page.waitForTimeout(1500);
  log("position note:", await text(page.locator('main:visible p[aria-live="polite"]').first()));
  await page.screenshot({ path: SHOTS + "/f1-route.png", fullPage: true });

  // Stop 1: cash on delivery
  await stops.first().locator("a").click();
  // The route page has its own h1, so wait for the address to change first.
  await page.waitForURL((u) => /^\/ruta\/[^/]+$/.test(new URL(u).pathname));
  await page.waitForSelector("main h1:visible");
  const header = await text(page.locator("main:visible header:visible"));
  const tracking1 = /paquete (YT\d+)/.exec(header)[1];
  log(
    "stop 1:",
    header,
    "| page shows a PIN:",
    /código de entrega: \d{4}/i.test(await page.locator("main:visible").innerText()),
  );
  log(
    "links:",
    await page
      .locator(
        'main:visible a[href^="https://www.google.com/maps"], main:visible a[href^="tel:"], main:visible a[href^="https://wa.me"]',
      )
      .evaluateAll((a) => a.map((x) => x.getAttribute("href").slice(0, 60))),
  );
  await page.screenshot({ path: SHOTS + "/f2-stop.png", fullPage: true });
  await page.click('main:visible button:has-text("Llegué")');
  await page.waitForSelector("main:visible >> text=Llegada registrada");
  const pin1 = await pinFor("comprador@yuntera.example", tracking1);
  const wrong = pin1 === "0000" ? "1111" : "0000";
  const cashLabel = await text(page.locator('main:visible label:has-text("Efectivo recibido")'));
  const due = /debe ser ₡([\d\s  ]+)/.exec(cashLabel)[1].replace(/\D/g, "");
  await page.fill('main:visible input[name="collected"]', due);
  await page.fill('main:visible input[name="recipientName"]', "María Fernández");
  await page.fill('main:visible input[name="pin"]', wrong);
  await page.click('main:visible button:has-text("Entregar")');
  await page.waitForSelector('main:visible form [role="alert"]');
  log(
    "wrong PIN:",
    await text(page.locator('main:visible form [role="alert"]').first()),
    "| name kept:",
    await page.inputValue('main:visible input[name="recipientName"]'),
  );
  await page.fill('main:visible input[name="collected"]', "1000");
  await page.fill('main:visible input[name="pin"]', pin1);
  await page.click('main:visible button:has-text("Entregar")');
  await page.waitForFunction(() =>
    /exactamente/.test(document.querySelector("main")?.innerText ?? ""),
  );
  log("short cash:", await text(page.locator('main:visible form [role="alert"]').first()));
  await page.fill('main:visible input[name="collected"]', due);
  await page.fill('main:visible input[name="pin"]', pin1);
  await page.click('main:visible button:has-text("Entregar")');
  await page.waitForURL((u) => new URL(u).pathname === "/ruta");
  await page.waitForSelector("main:visible >> text=Entrega registrada");
  log(
    "after delivery:",
    await text(page.locator('main:visible [role="status"]').first()),
    "|",
    (await text(page.locator("main:visible section > div").first())).slice(0, 120),
  );

  // Stop 2: nobody home
  await page.locator("main:visible ol > li a").first().click();
  await page.waitForSelector("main:visible summary");
  await page.click("main:visible summary");
  await page.selectOption('main:visible select[name="reason"]', "nobody_home");
  await page.click('main:visible button:has-text("Registrar que no se entregó")');
  await page.waitForURL((u) => new URL(u).pathname === "/ruta");
  await page.waitForSelector("main:visible >> text=Terminó la ruta");
  log(
    "route finished:",
    (await text(page.locator("main:visible section > div").first())).slice(0, 190),
  );
  await page.screenshot({ path: SHOTS + "/f3-route-done.png", fullPage: true });
  await c1.close();

  const [ops] = await rpcAs("central@yuntera.example", [["ops_settlements", { p_status: "open" }]]);
  log(
    "open cash settlements for Central now:",
    ops.length,
    ops[0] ? `expects ${ops[0].cod_expected_minor / 100}` : "",
  );
  const [pos] = await rpcAs("central@yuntera.example", [["ops_dispatch_board", {}]]);
  log(
    "driver position seen by Central:",
    JSON.stringify(pos.drivers.find((d) => d.position)?.position ?? null).slice(0, 90),
  );

  // ── Warehouse ──
  const [roles] = await rpcAs("vendedor@yuntera.example", [["my_roles", {}]]);
  const tecno = roles.sellers.find((s) => s.slug === "tecnocasa");
  const [locs, listings] = await rpcAs("vendedor@yuntera.example", [
    ["seller_locations", { p_seller_id: tecno.id }],
    ["seller_listings", { p_seller_id: tecno.id }],
  ]);
  await rpcAs("vendedor@yuntera.example", [
    [
      "seller_create_inbound",
      {
        p_warehouse_id: locs.platform[0].id,
        p_seller_id: tecno.id,
        p_lines: [{ sku_id: listings[0].sku_id, quantity: 12 }],
      },
    ],
  ]);

  const c2 = await phone();
  const w = await c2.newPage();
  watch(w);
  await signIn(w, "bodega@yuntera.example");
  log(
    "warehouse lands on:",
    new URL(w.url()).pathname,
    "|",
    await text(w.locator("main h1:visible")),
  );
  log("board:", await w.locator("main:visible h2").allInnerTexts());
  log(
    "overflow px:",
    await w.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  await w.screenshot({ path: SHOTS + "/f4-warehouse.png", fullPage: true });

  await w
    .locator('main:visible section[aria-labelledby="paquetes"] li a', { hasText: "Por alistar" })
    .first()
    .click();
  // The board has its own header and h1: wait for the parcel's page itself.
  await w.waitForURL((u) => new URL(u).pathname.startsWith("/bodega/paquete/"));
  await w.waitForSelector("main h1:visible");
  log("parcel:", await text(w.locator("main:visible header:visible")));
  await w.click('main:visible button:has-text("Empezar a alistar")');
  await w.waitForSelector('main:visible input[name="code"]');
  const lines = await w.locator("main:visible ol > li").count();
  log("lines to pick:", lines);
  // wrong product first
  await w.locator('main:visible input[name="code"]').first().fill("YT-NOPE0000");
  await w.locator('main:visible ol > li button[type="submit"]').first().click();
  await w.waitForSelector('main:visible ol [role="alert"]');
  log("wrong scan:", await text(w.locator('main:visible ol [role="alert"]').first()));
  for (let i = 0; i < lines; i++) {
    const open = w.locator('main:visible ol > li:has(input[name="code"])').first();
    const sku = /(YT-[A-Z0-9]+|[A-Z0-9]+-[A-Z0-9-]+)/.exec(
      await open.locator("p.text-sm").first().innerText(),
    )[1];
    await open.locator('input[name="code"]').fill(sku);
    await open.locator('button[type="submit"]').click();
    await w.waitForFunction(
      (n) => document.querySelectorAll('main ol > li input[name="code"]').length === n,
      lines - i - 1,
    );
  }
  log("all lines:", await w.locator("main:visible h2#lineas").innerText());
  await w.screenshot({ path: SHOTS + "/f5-pick.png", fullPage: true });
  await w.click('main:visible button:has-text("Empacado")');
  await w.waitForSelector("main:visible >> text=/zona de despacho/");
  log("packed:", (await text(w.locator('main:visible [role="status"]').first())).slice(0, 120));

  // Receiving
  await w.goto(BASE + "/bodega", { waitUntil: "networkidle" });
  const inbound = w
    .locator('main:visible section[aria-labelledby="recepciones"] > ul > li')
    .first();
  log("inbound:", (await text(inbound)).slice(0, 150));
  await inbound.locator('input[name="good"]').fill("10");
  await inbound.locator('input[name="damaged"]').fill("1");
  await inbound.locator('button[type="submit"]').click();
  await inbound.locator('[role="status"], [role="alert"]').first().waitFor();
  log(
    "received:",
    await text(inbound.locator('[role="status"], [role="alert"]').first()),
    "|",
    (await text(inbound.locator("li").first())).slice(0, 110),
  );

  // Lookup
  const skuCode = /(YT-[A-Z0-9]+|[A-Z0-9]+-[A-Z0-9-]+) · esperadas/.exec(
    await inbound.innerText(),
  )[1];
  await w.goto(BASE + "/bodega/buscar?codigo=" + encodeURIComponent(skuCode), {
    waitUntil: "networkidle",
  });
  log(
    "lookup",
    skuCode,
    "->",
    (await text(w.locator("main:visible section").first())).slice(0, 170),
  );
  await w.goto(BASE + "/bodega/buscar?codigo=NOEXISTE", { waitUntil: "networkidle" });
  log(
    "lookup unknown ->",
    await text(w.locator('main:visible [role="status"], main:visible [role="alert"]').first()),
  );
  // A driver cannot open the warehouse half
  await c2.close();
  const c3 = await phone();
  const d = await c3.newPage();
  watch(d);
  await signIn(d, "repartidor2@yuntera.example");
  await d.goto(BASE + "/bodega", { waitUntil: "networkidle" });
  log("driver on /bodega ->", new URL(d.url()).pathname);
  await c3.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
