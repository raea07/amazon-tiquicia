// Counting a product into a location that has no record of it, on a phone.
// The warehouse lead opens a new, empty shelf: its list shows nothing. In
// «Contar un producto que no está en la lista» they look up the drill by its
// code (no shop keeps it in this warehouse: the screen says the first units
// come in with a receipt and where to go), the earphones (TecnoCasa keeps
// them here; Tienda Sendero sells them from its own site and the screen
// says so), then the notebook by its name. A reason too short is refused
// (what was typed kept); two units are counted in and the notebook's line is
// in the list at once. The same save from a page left open (a double tap, or
// a colleague's count meanwhile) is refused: nothing changes and the screen
// says to count on the product's own line. A count onto a shelf operations
// switch off while the form is open is refused (kept), and the switched-off
// shelf then offers no count at all. The shop (seller centre) sees the count
// with its reason in its stock history, never who; the console's list of
// moves and corrections shows it with who did it. Then the stock is put back
// as it was: counted back to 0 on its own line, the shop's total is what it
// was before, and the shelf is switched off. Every screen is checked at
// 390 px (no sideways scroll, controls of at least 44 px, one page title)
// and photographed.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const { settledText } = require("../lib/settle.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const FIELD = process.env.FIELD_URL || "http://127.0.0.1:3003";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHELF = "Y-73-01-A";
const SWITCHED_OFF = "Y-73-02-A";
const NOTE = "Dos libretas detrás de una caja sin etiqueta";
const log = (...a) => console.log(...a);
const squash = (t) => t.replace(/\s+/g, " ").trim();
const text = async (loc) => squash(await loc.innerText());

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
    const body = await r.text();
    out.push(body ? JSON.parse(body) : null);
  }
  await ctx.dispose();
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (condition, message) => {
    if (condition) log("  ok:", message);
    else errors.push(message);
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
  const phone = async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    });
    const page = await context.newPage();
    watch(page);
    return page;
  };
  const signIn = async (page, base, email) => {
    await page.goto(base + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
    await page.waitForLoadState("networkidle");
  };
  /** No sideways scroll, one page title, every control at least 44 px tall; then a photo. */
  const layout = async (page, name) => {
    const found = await page.evaluate(() => {
      const visible = (el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden";
      };
      const small = [];
      for (const el of document.querySelectorAll(
        "main button, main select, main input, main textarea, main summary",
      )) {
        if (!visible(el) || el.type === "hidden") continue;
        const box = el.getBoundingClientRect();
        if (box.height < 44)
          small.push(
            `${el.tagName}:${(el.innerText || el.name || "").trim().slice(0, 30)}:${Math.round(box.height)}`,
          );
      }
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        h1: [...document.querySelectorAll("h1")].filter(visible).length,
        small,
      };
    });
    log(`${name}:`, JSON.stringify(found));
    check(found.overflow <= 0, `${name}: no sideways scroll at 390 px`);
    check(found.h1 === 1, `${name}: one page title`);
    check(found.small.length === 0, `${name}: controls of at least 44 px (${found.small})`);
    await page.screenshot({ path: `${SHOTS}/count-into-location-${name}.png`, fullPage: true });
  };

  // ── The products, the shop's totals before, two new shelves ──────────────
  const [roles] = await rpcAs("sendero@yuntera.example", [["my_roles", {}]]);
  const shop = roles.sellers[0];
  const [stockBefore] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  const notebook = stockBefore.find(
    (row) => row.title.startsWith("Libreta") && row.warehouse_kind === "platform",
  );
  check(Boolean(notebook), "the seed has the notebook in the warehouse");
  const [created, other] = await rpcAs("central@yuntera.example", [
    [
      "ops_create_location",
      { p_warehouse_id: notebook.warehouse_id, p_code: SHELF, p_kind: "storage" },
    ],
    [
      "ops_create_location",
      { p_warehouse_id: notebook.warehouse_id, p_code: SWITCHED_OFF, p_kind: "storage" },
    ],
  ]);
  check(created?.code === SHELF && other?.code === SWITCHED_OFF, "operations created two shelves");
  // The earphones (two shops) and the drill (no Yuntera warehouse), by code.
  const [earphones, drill] = await rpcAs("bodega@yuntera.example", [
    ["wms_count_candidates", { p_location_id: created.id, p_query: "audífonos" }],
    ["wms_count_candidates", { p_location_id: created.id, p_query: "YT-D844513A" }],
  ]);
  const twoShops = earphones.find((c) => c.shops.length > 1);
  check(Boolean(twoShops) && drill?.[0]?.title.startsWith("Taladro"), "the lookup finds both");

  const field = await phone();
  await signIn(field, FIELD, "bodega@yuntera.example");
  const section = () => field.locator('[data-testid="count-in"]');
  const search = async (query) => {
    await section().locator('input[name="buscar"]').fill(query);
    await section().locator('button:has-text("Buscar")').click();
    await field.waitForURL((u) => new URL(u).searchParams.get("buscar") === query);
    await field.waitForLoadState("networkidle");
  };
  const result = (sku) => section().locator(`li[data-count-sku="${sku}"]`);
  const line = () => field.locator(`li[data-sku="${notebook.sku_code}"]`);

  // ── 1. The new shelf: empty; a product no shop keeps here ─────────────────
  await field.goto(`${FIELD}/bodega/ubicacion?codigo=${SHELF}`, { waitUntil: "networkidle" });
  check(
    (await text(field.locator('[data-testid="location-summary"]'))).includes("Está vacía"),
    "the new shelf is empty",
  );
  check(
    (await text(section())).includes("Contar un producto que no está en la lista"),
    "the shelf offers to count a product that is not in the list",
  );
  await layout(field, "empty");
  await search(drill[0].sku_code);
  const receipt = await text(result(drill[0].sku_code));
  log("drill:", receipt);
  check(
    receipt.includes("No se puede contar aquí") &&
      receipt.includes("Las primeras unidades de una tienda entran con una recepción") &&
      receipt.includes("Mercadería por recibir") &&
      (await result(drill[0].sku_code).locator("form").count()) === 0,
    "a product no shop keeps here cannot be counted, and the screen says where to go",
  );
  check(
    (await result(drill[0].sku_code).locator('a[href="/bodega#recepciones"]').count()) === 1,
    "a link to the goods to receive",
  );
  await layout(field, "no-record");

  // ── 2. Two shops sell it, one keeps it here ───────────────────────────────
  await search(twoShops.sku_code);
  const shared = await text(result(twoShops.sku_code));
  log("earphones:", shared);
  const keeper = twoShops.shops.find((s) => s.stock_record);
  const away = twoShops.shops.find((s) => !s.stock_record);
  check(
    shared.includes(`Unidades de ${keeper.seller_name}.`) &&
      shared.includes(
        `${away.seller_name} también vende este producto, pero no tiene existencias registradas`,
      ),
    "only the shop with a stock record here can be counted; the other is named and why",
  );

  // ── 3. The notebook, by its name: refused, then two counted ───────────────
  await search("libreta");
  const form = () => result(notebook.sku_code).locator("form");
  await form().waitFor();
  check(
    (await text(result(notebook.sku_code))).includes("Unidades de Tienda Sendero."),
    "found by its name, with its shop",
  );
  await form().locator('input[name="quantity"]').fill("2");
  check(
    (await text(form().locator("button[type=submit]"))) === `Sumar 2 unidades a ${SHELF}`,
    "the button says what it will do",
  );
  await form().locator('input[name="note"]').fill("rota");
  await form().locator("button[type=submit]").click();
  await form().locator('[role="alert"]').waitFor();
  check(
    (await text(form().locator('[role="alert"]'))).includes("al menos 5 letras"),
    "a reason too short is refused",
  );
  check(
    (await form().locator('input[name="quantity"]').inputValue()) === "2" &&
      (await form().locator('input[name="note"]').inputValue()) === "rota",
    "the refused count keeps what was typed",
  );
  await layout(field, "refused");
  await form().locator('input[name="note"]').fill(NOTE);
  // The same page, open on a second phone (or a second tap that arrives late).
  const stale = await phone();
  await signIn(stale, FIELD, "bodega@yuntera.example");
  await stale.goto(field.url(), { waitUntil: "networkidle" });
  const staleForm = stale.locator(`li[data-count-sku="${notebook.sku_code}"] form`);
  await staleForm.locator('input[name="quantity"]').fill("2");
  await staleForm.locator('input[name="note"]').fill(NOTE);

  await form().locator("button[type=submit]").click();
  const banner = field.locator('main [role="status"]', { hasText: "Producto contado" });
  await banner.waitFor();
  await field.waitForFunction(() => !/[?&](nuevas|producto|buscar)=/.test(window.location.search));
  await field.waitForLoadState("networkidle");
  const done = await text(banner);
  log("counted:", done);
  check(
    done.includes(
      `Se sumaron 2 unidades de ${notebook.sku_code} a esta ubicación: ya aparece en la lista.`,
    ),
    "the count is confirmed",
  );
  await line().waitFor();
  check(
    (await text(line().locator("dl"))).includes("En el estante 2") &&
      (await text(line())).includes("de Tienda Sendero"),
    "the notebook's line is in the list straight away, with its shop",
  );
  await layout(field, "counted");

  // The page left open saves the same count: refused, nothing changes.
  await staleForm.locator("button[type=submit]").click();
  await staleForm.locator('[role="alert"]').waitFor();
  await stale.waitForLoadState("networkidle");
  const again = await settledText(staleForm.locator('[role="alert"]'), /No se guardó nada/, {
    what: "the refusal of the second save",
  });
  log("again:", again);
  check(
    again.includes("No se guardó nada") && again.includes("corrija la cantidad en su propia línea"),
    "a second save of the same count is refused, and says where to count",
  );
  check(
    (await staleForm.locator('input[name="quantity"]').inputValue()) === "2" &&
      (await staleForm.locator('input[name="note"]').inputValue()) === NOTE,
    "the refused save keeps what was typed",
  );
  check(
    (await text(stale.locator(`li[data-sku="${notebook.sku_code}"] dl`))).includes(
      "En el estante 2",
    ),
    "the page behind shows the line with two, not four",
  );
  check(
    (await text(stale.locator(`li[data-count-sku="${notebook.sku_code}"]`))).includes(
      "Ya está en esta ubicación, de Tienda Sendero (2 en el estante)",
    ),
    "the result says it is in the list now",
  );
  await layout(stale, "double-save");
  await stale.context().close();

  // ── 4. A shelf switched off while the form is open ─────────────────────────
  await field.goto(`${FIELD}/bodega/ubicacion?codigo=${SWITCHED_OFF}`, {
    waitUntil: "networkidle",
  });
  await search("libreta");
  await form().locator('input[name="quantity"]').fill("2");
  await form().locator('input[name="note"]').fill(NOTE);
  const [switched] = await rpcAs("central@yuntera.example", [
    ["ops_set_location_active", { p_location_id: other.id, p_active: false }],
  ]);
  check(switched?.active === false, "operations switched the shelf off");
  await form().locator("button[type=submit]").click();
  await field.waitForLoadState("networkidle");
  const offAlert = section().locator('form [role="alert"]', { hasText: "desactivada" }).first();
  await offAlert.waitFor();
  const off = await text(offAlert);
  log("switched off:", off);
  check(
    off.includes("Esa ubicación está desactivada"),
    "a count onto a switched-off shelf is refused",
  );
  check(
    (await field.locator('main [data-testid="count-in"] input[name="quantity"]').inputValue()) ===
      "2",
    "the refused count keeps what was typed",
  );
  await layout(field, "switched-off");
  await field.goto(`${FIELD}/bodega/ubicacion?codigo=${SWITCHED_OFF}`, {
    waitUntil: "networkidle",
  });
  check(
    (await text(section())).includes(
      "Esta ubicación está desactivada: aquí no se cuentan productos nuevos.",
    ) && (await section().locator("input").count()) === 0,
    "a switched-off shelf offers no count",
  );

  // ── 5. The shop: the count with its reason, never who ─────────────────────
  const seller = await phone();
  await signIn(seller, SELLER, "sendero@yuntera.example");
  await seller.goto(SELLER + "/inventario", { waitUntil: "networkidle" });
  await seller.waitForSelector("#historial");
  const history = seller.locator('section[aria-labelledby="historial"] li');
  const first = await text(history.first());
  log("the shop's history:", first);
  check(
    first.includes("Corrección de conteo de la bodega") &&
      first.includes("+2") &&
      first.includes(`Motivo: ${NOTE}`),
    "the shop sees the count and its reason",
  );
  check(
    !/Kattia|bodega@|Y-73-01-A/.test(
      await text(seller.locator('section[aria-labelledby="historial"]')),
    ),
    "the shop never sees who, nor the shelf",
  );
  await layout(seller, "seller");

  // ── 6. The console: the list of moves and corrections, with who ──────────
  const ops = await phone();
  await signIn(ops, OPS, "central@yuntera.example");
  await ops.goto(OPS + "/operacion/ubicaciones", { waitUntil: "networkidle" });
  const changes = ops.locator("section[aria-labelledby='movimientos'] li");
  const correction = await text(changes.filter({ hasText: `+2 unidades en ${SHELF}` }).first());
  log("staff list:", correction);
  check(
    correction.includes("Kattia Rodríguez Salas") && correction.includes(`Motivo: ${NOTE}`),
    "the staff list shows the count, with who and why",
  );
  await layout(ops, "console");

  // ── 7. The stock put back as it was ───────────────────────────────────────
  await field.goto(`${FIELD}/bodega/ubicacion?codigo=${SHELF}`, { waitUntil: "networkidle" });
  await line().locator("summary", { hasText: "Corregir cantidad" }).click();
  await line().locator('input[name="counted"]').fill("0");
  await line().locator('details[open] input[name="note"]').fill("Fin de la prueba de conteo");
  await line().locator('button:has-text("Corregir a")').click();
  await field.locator('main [role="status"]', { hasText: "Ahora hay 0 unidades" }).waitFor();
  await field.waitForLoadState("networkidle");
  check(
    (await text(field.locator('[data-testid="location-summary"]'))).includes("Está vacía"),
    "the shelf is empty again",
  );
  const [stockAfter, offShelf] = await Promise.all([
    rpcAs("sendero@yuntera.example", [["seller_stock", { p_seller_id: shop.id }]]),
    rpcAs("central@yuntera.example", [
      ["ops_set_location_active", { p_location_id: created.id, p_active: false }],
    ]),
  ]);
  const after = stockAfter[0].find(
    (row) => row.sku_id === notebook.sku_id && row.warehouse_kind === "platform",
  );
  check(
    after.on_hand === notebook.on_hand && after.available === notebook.available,
    "the shop's total and what shoppers can buy are what they were",
  );
  check(offShelf[0]?.active === false, "the test shelf is switched off");

  // ── 8. Nobody else ─────────────────────────────────────────────────────────
  const [shopper] = await rpcAs("comprador@yuntera.example", [
    ["wms_count_candidates", { p_location_id: created.id, p_query: "libreta" }],
  ]);
  check(JSON.stringify(shopper).includes("forbidden"), "a shopper cannot search the warehouse");

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
