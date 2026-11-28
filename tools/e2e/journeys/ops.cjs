// Staff journey: access control, payment confirmation, review, verification, dispatch, care, audit.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const ops = require("../lib/ops.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = ops.BASE;
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);

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
  const signIn = (page, email, expectPath) => ops.signInLandingOn(page, email, expectPath);

  // 1. Visitors and non-staff are kept out
  const c0 = await browser.newContext({ locale: "es-CR" });
  const p0 = await c0.newPage();
  watch(p0);
  await ops.open(p0, "/pedidos");
  log("visitor on /pedidos ->", p0.url().replace(BASE, ""));
  await signIn(p0, "comprador@yuntera.example", "/sin-acceso");
  log("shopper lands on:", await ops.firstHeading(p0), "| nav links:", await ops.sectionLinks(p0));
  await ops.open(p0, "/despacho");
  log("shopper on /despacho ->", new URL(p0.url()).pathname);
  await c0.close();

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const page = await context.newPage();
  watch(page);
  await signIn(page, "central@yuntera.example", "/");
  await ops.waitForSummary(page);
  log("nav:", await ops.sectionsNav(page));
  log("overview:", (await ops.mainText(page)).slice(0, 420));
  await page.screenshot({ path: SHOTS + "/o1-overview.png", fullPage: true });

  // 2. Orders: find the pending transfer, confirm it
  await ops.open(page, "/pedidos?estado=pending_payment");
  log("pending payment rows:", await ops.tableRows(page));
  await ops.openFirstOrder(page);
  log(
    "order:",
    await ops.heading(page),
    "| PIN visible to staff:",
    await ops.deliveryCodesShown(page),
  );
  await ops.confirmTransfer(page, "BNCR-2026-000777");
  log("after confirming:", await ops.orderHeader(page));
  await page.screenshot({ path: SHOTS + "/o2-order.png", fullPage: true });

  // 3. Search
  // Sent by POST, so the shopper's name never reaches the address bar (WEB-4).
  await ops.open(page, "/pedidos");
  await ops.searchOrders(page, "Andrés");
  if (/Andr/i.test(decodeURIComponent(page.url()))) throw new Error("the name went into the URL");
  log('search "Andrés" rows:', await ops.tableRows(page));

  // 4. Catalogue review: reject needs a reason, typed text survives the error
  await ops.open(page, "/catalogo");
  log("listing to review:", (await ops.firstReviewCard(page)).slice(0, 110));
  const rejected = await ops.rejectFirstListing(page, "no");
  log("reject without reason:", rejected.refusal, "| note kept:", rejected.kept);
  // The listing's shop is still being verified, so it cannot go on sale yet.
  log("publish before the shop is verified:", await ops.publishFirstListingRefused(page));

  // 5. Seller verification
  await ops.open(page, "/vendedores");
  log("pending seller:", (await ops.firstSeller(page)).slice(0, 150));
  await ops.verifyFirstSeller(page, "Coincide con Hacienda.");
  await ops.open(page, "/vendedores?estado=active");
  log("active sellers now:", await ops.sellerCount(page));
  await page.screenshot({ path: SHOTS + "/o3-sellers.png", fullPage: true });

  // With the shop verified, its listing can be published.
  await ops.open(page, "/catalogo");
  await ops.publishFirstListing(page);
  log("after verifying the shop and approving: queue empty");

  // 6. Dispatch: plan the day
  await ops.open(page, "/despacho");
  log("dispatch headings:", await ops.sectionHeadings(page));
  const routesBefore = await ops.dispatchRouteCount(page);
  await page.screenshot({ path: SHOTS + "/o4-dispatch.png", fullPage: true });
  await ops.planRoutes(page);
  log("ready after planning:", await ops.dispatchReady(page));
  log(
    "routes before/after:",
    routesBefore,
    "/",
    await ops.dispatchRouteCount(page),
    "| newest:",
    (await ops.newestRoute(page)).slice(0, 170),
  );
  await page.screenshot({ path: SHOTS + "/o5-dispatch-after.png", fullPage: true });

  // 7. Care: return decision + refund, complaint answer
  await ops.open(page, "/atencion");
  log("care headings:", await ops.sectionHeadings(page));
  log("return:", (await ops.firstReturnText(page)).slice(0, 210));
  await ops.approveAndReceiveFirstReturn(page, "damaged");
  await page.screenshot({ path: SHOTS + "/o6-care.png", fullPage: true });
  await ops.refundFirstReturn(page);
  log("return approved and refunded: queue empty");
  await ops.answerFirstComplaint(page, "Le pedimos disculpas; ajustamos el horario de esa ruta.");
  log("complaint answered and closed");

  // 8. Settlements, drivers, audit
  await ops.open(page, "/liquidaciones");
  log("settlements:", await ops.sectionHeadings(page), "| closed rows:", await ops.tableRows(page));
  await ops.open(page, "/repartidores");
  log("driver row:", (await ops.tableRow(page, "last")).slice(0, 150));
  await ops.open(page, "/auditoria");
  log(
    "audit rows:",
    await ops.tableRows(page),
    "| first:",
    (await ops.tableRow(page)).slice(0, 150),
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
    await ops.open(m, path);
    log(`mobile ${path} overflow px:`, await kit.overflowPx(m));
  }
  await m.screenshot({ path: SHOTS + "/o8-mobile.png" });

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
