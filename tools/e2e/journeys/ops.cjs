// Staff journey: access control, payment confirmation, review, verification, dispatch, care, audit.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = process.env.OPS_URL || "http://127.0.0.1:3002";
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

(async () => {
  // Seed the care queues the way a shopper would.
  const [orders] = await rpcAs("comprador@yuntera.example", [["my_orders", {}]]);
  const delivered = orders.find((o) => o.status === "delivered" || o.status === "completed");
  const [detail] = await rpcAs("comprador@yuntera.example", [
    ["get_order", { p_order_number: delivered.order_number }],
  ]);
  const made = await rpcAs("comprador@yuntera.example", [
    [
      "request_return",
      {
        p_order_item_id: detail.items[0].id,
        p_kind: "damaged",
        p_quantity: 1,
        p_reason: "La caja llegó abierta y el producto golpeado.",
      },
    ],
    [
      "file_complaint",
      {
        p_category: "delivery",
        p_description: "El repartidor llegó fuera del horario indicado.",
        p_order_number: delivered.order_number,
      },
    ],
  ]);
  log(
    "shopper created return + complaint:",
    made.map((x) => (typeof x === "string" ? "ok" : JSON.stringify(x).slice(0, 80))),
  );

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
  const signIn = async (page, email, expectPath) => {
    await page.goto(BASE + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === expectPath);
  };

  // 1. Visitors and non-staff are kept out
  const c0 = await browser.newContext({ locale: "es-CR" });
  const p0 = await c0.newPage();
  watch(p0);
  await p0.goto(BASE + "/pedidos", { waitUntil: "networkidle" });
  log("visitor on /pedidos ->", p0.url().replace(BASE, ""));
  await signIn(p0, "comprador@yuntera.example", "/sin-acceso");
  log(
    "shopper lands on:",
    await text(p0.locator("main h2:visible, main h1:visible").first()),
    "| nav links:",
    await p0.locator('nav[aria-label="Secciones"] a').count(),
  );
  await p0.goto(BASE + "/despacho", { waitUntil: "networkidle" });
  log("shopper on /despacho ->", new URL(p0.url()).pathname);
  await c0.close();

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const page = await context.newPage();
  watch(page);
  await signIn(page, "central@yuntera.example", "/");
  await page.waitForSelector("main h2:visible");
  log("nav:", await text(page.locator('nav[aria-label="Secciones"]')));
  log("overview:", (await text(page.locator("main:visible"))).slice(0, 420));
  await page.screenshot({ path: SHOTS + "/o1-overview.png", fullPage: true });

  // 2. Orders: find the pending transfer, confirm it
  await page.goto(BASE + "/pedidos?estado=pending_payment", { waitUntil: "networkidle" });
  log("pending payment rows:", await page.locator("main:visible tbody tr").count());
  await page.locator("main:visible tbody tr a").first().click();
  await page.waitForSelector('main h1:visible:has-text("Pedido YT-")');
  log(
    "order:",
    await text(page.locator("main h1:visible")),
    "| PIN visible to staff:",
    await page.locator("text=/código de entrega: \\d{4}/").count(),
  );
  const pay = page.locator('section:visible:has-text("Confirmar la transferencia")');
  await pay.locator('button[type="submit"]').click(); // empty -> browser validation
  await page.waitForTimeout(300);
  await pay.locator('input[name="bankReference"]').fill("BNCR-2026-000777");
  await pay.locator('button[type="submit"]').click();
  await page.waitForSelector("main:visible >> text=Pedido confirmado");
  log("after confirming:", await text(page.locator("main:visible header").first()));
  await page.screenshot({ path: SHOTS + "/o2-order.png", fullPage: true });

  // 3. Search
  await page.goto(BASE + "/pedidos?q=Andr%C3%A9s", { waitUntil: "networkidle" });
  log('search "Andrés" rows:', await page.locator("main:visible tbody tr").count());

  // 4. Catalogue review: reject needs a reason, typed text survives the error
  await page.goto(BASE + "/catalogo", { waitUntil: "networkidle" });
  const card = page.locator("main:visible ul > li").first();
  log("listing to review:", (await text(card)).slice(0, 110));
  await card.locator('textarea[name="note"]').fill("no");
  await card.locator('button:has-text("Rechazar")').click();
  await card.locator('[role="alert"]').waitFor();
  log(
    "reject without reason:",
    await text(card.locator('[role="alert"]')),
    "| note kept:",
    await card.locator('textarea[name="note"]').inputValue(),
  );
  await card.locator('textarea[name="note"]').fill("");
  await card.locator('button:has-text("Publicar")').click();
  await page.waitForSelector("main:visible >> text=No hay productos por revisar");
  log("after approving: queue empty");

  // 5. Seller verification
  await page.goto(BASE + "/vendedores", { waitUntil: "networkidle" });
  const seller = page.locator("main:visible ul.grid > li").first();
  log("pending seller:", (await text(seller)).slice(0, 150));
  await seller.locator('textarea[name="note"]').fill("Coincide con Hacienda.");
  await seller.locator('button:has-text("Verificar y activar")').click();
  await page.waitForSelector("main:visible >> text=Ningún vendedor en este estado");
  await page.goto(BASE + "/vendedores?estado=active", { waitUntil: "networkidle" });
  log("active sellers now:", await page.locator("main:visible ul.grid > li").count());
  await page.screenshot({ path: SHOTS + "/o3-sellers.png", fullPage: true });

  // 6. Dispatch: plan the day
  await page.goto(BASE + "/despacho", { waitUntil: "networkidle" });
  log("dispatch headings:", await page.locator("main:visible h2").allInnerTexts());
  const routesBefore = await page
    .locator('main:visible section[aria-labelledby="rutas"] > ul > li')
    .count();
  await page.screenshot({ path: SHOTS + "/o4-dispatch.png", fullPage: true });
  await page.click('main:visible button:has-text("Proponer y crear rutas")');
  await page.waitForFunction(
    (n) => document.querySelectorAll('main section[aria-labelledby="rutas"] > ul > li').length > n,
    routesBefore,
  );
  log(
    "ready after planning:",
    await text(page.locator('main:visible section[aria-labelledby="listos"]')),
  );
  const routes = page.locator('main:visible section[aria-labelledby="rutas"] > ul > li');
  log(
    "routes before/after:",
    routesBefore,
    "/",
    await routes.count(),
    "| newest:",
    (await text(routes.last())).slice(0, 170),
  );
  await page.screenshot({ path: SHOTS + "/o5-dispatch-after.png", fullPage: true });

  // 7. Care: return decision + refund, complaint answer
  await page.goto(BASE + "/atencion", { waitUntil: "networkidle" });
  log("care headings:", await page.locator("main:visible h2").allInnerTexts());
  const ret = page.locator('main:visible section[aria-labelledby="devoluciones"] li').first();
  log("return:", (await text(ret)).slice(0, 210));
  await ret.locator('button:has-text("Aprobar")').click();
  await page.waitForSelector("main:visible >> text=/Registrar reembolso de/");
  await page.screenshot({ path: SHOTS + "/o6-care.png", fullPage: true });
  await page.locator('main:visible button:has-text("Registrar reembolso de")').first().click();
  await page.waitForSelector("main:visible >> text=No hay devoluciones pendientes");
  log("return approved and refunded: queue empty");
  const complaint = page.locator('main:visible section[aria-labelledby="reclamos"] li').first();
  await complaint
    .locator('textarea[name="note"]')
    .fill("Le pedimos disculpas; ajustamos el horario de esa ruta.");
  await complaint.locator('button:has-text("Responder y cerrar")').click();
  await page.waitForSelector("main:visible >> text=No hay reclamos abiertos");
  log("complaint answered and closed");

  // 8. Settlements, drivers, audit
  await page.goto(BASE + "/liquidaciones", { waitUntil: "networkidle" });
  log(
    "settlements:",
    await page.locator("main:visible h2").allInnerTexts(),
    "| closed rows:",
    await page.locator("main:visible tbody tr").count(),
  );
  await page.goto(BASE + "/repartidores", { waitUntil: "networkidle" });
  const drv = page.locator("main:visible tbody tr").last();
  log("driver row:", (await text(drv)).slice(0, 150));
  await page.goto(BASE + "/auditoria", { waitUntil: "networkidle" });
  log(
    "audit rows:",
    await page.locator("main:visible tbody tr").count(),
    "| first:",
    (await text(page.locator("main:visible tbody tr").first())).slice(0, 150),
  );
  await page.screenshot({ path: SHOTS + "/o7-audit.png" });
  await context.close();

  // 9. Phone width
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const m = await phone.newPage();
  watch(m);
  await signIn(m, "central@yuntera.example", "/");
  for (const path of ["/", "/despacho", "/pedidos", "/atencion"]) {
    await m.goto(BASE + path, { waitUntil: "networkidle" });
    log(
      `mobile ${path} overflow px:`,
      await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    );
  }
  await m.screenshot({ path: SHOTS + "/o8-mobile.png" });

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
