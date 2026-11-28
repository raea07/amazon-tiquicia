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
const field = require("../lib/field.cjs");
const seller = require("../lib/seller.cjs");
const ops = require("../lib/ops.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHELF = "Y-73-01-A";
const SWITCHED_OFF = "Y-73-02-A";
const NOTE = "Dos libretas detrás de una caja sin etiqueta";
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
        h1: [...document.querySelectorAll("h1")].filter(visible).length,
        small,
      };
    });
    found.overflow = await kit.overflowPx(page);
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

  const worker = await phone();
  await field.signIn(worker, "bodega@yuntera.example");
  const sku = notebook.sku_code;

  // ── 1. The new shelf: empty; a product no shop keeps here ─────────────────
  await field.openLocation(worker, SHELF);
  check((await field.locationSummary(worker)).includes("Está vacía"), "the new shelf is empty");
  check(
    (await field.countInText(worker)).includes("Contar un producto que no está en la lista"),
    "the shelf offers to count a product that is not in the list",
  );
  await layout(worker, "empty");
  // One letter: the field asks for two, and an address with one says so too.
  check(
    (await field.countSearchMinLength(worker)) === "2",
    "the search field asks for at least 2 characters",
  );
  await field.openLocation(worker, SHELF, "a");
  const tooShort = await field.countInText(worker);
  check(
    tooShort.includes("Escriba al menos 2 letras o números") &&
      !tooShort.includes("No encontramos ese producto"),
    "one letter asks for more, instead of saying no product has it",
  );
  await field.searchToCount(worker, drill[0].sku_code);
  const receipt = await field.countResultText(worker, drill[0].sku_code);
  const drillOffers = await field.countResultOffers(worker, drill[0].sku_code);
  log("drill:", receipt);
  check(
    receipt.includes("No se puede contar aquí") &&
      receipt.includes("Las primeras unidades de una tienda entran con una recepción") &&
      receipt.includes("Mercadería por recibir") &&
      drillOffers.forms === 0,
    "a product no shop keeps here cannot be counted, and the screen says where to go",
  );
  check(drillOffers.receiveLinks === 1, "a link to the goods to receive");
  await layout(worker, "no-record");

  // ── 2. Two shops sell it, one keeps it here ───────────────────────────────
  await field.searchToCount(worker, twoShops.sku_code);
  const shared = await field.countResultText(worker, twoShops.sku_code);
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
  await field.searchToCount(worker, "libreta");
  await field.waitForCountForm(worker, sku);
  check(
    (await field.countResultText(worker, sku)).includes("Unidades de Tienda Sendero."),
    "found by its name, with its shop",
  );
  await field.typeCount(worker, sku, { quantity: "2" });
  check(
    (await field.countButton(worker, sku)) === `Sumar 2 unidades a ${SHELF}`,
    "the button says what it will do",
  );
  await field.typeCount(worker, sku, { note: "rota" });
  await field.sendCount(worker, sku);
  check(
    (await field.countError(worker, sku)).includes("al menos 5 letras"),
    "a reason too short is refused",
  );
  const keptShort = await field.countTyped(worker, sku);
  check(
    keptShort.quantity === "2" && keptShort.note === "rota",
    "the refused count keeps what was typed",
  );
  await layout(worker, "refused");
  await field.typeCount(worker, sku, { note: NOTE });
  // The same page, open on a second phone (or a second tap that arrives late).
  const stale = await phone();
  await field.signIn(stale, "bodega@yuntera.example");
  await stale.goto(worker.url(), { waitUntil: "networkidle" });
  await field.typeCount(stale, sku, { quantity: "2", note: NOTE });

  // A real double tap on the button: one count, never two.
  await field.sendCount(worker, sku, { double: true });
  await field.countedNotice(worker);
  await worker.waitForFunction(() => !/[?&](nuevas|producto|buscar)=/.test(window.location.search));
  await worker.waitForLoadState("networkidle");
  const done = await field.countedNotice(worker);
  log("counted:", done);
  check(
    done.includes(
      `Se sumaron 2 unidades de ${notebook.sku_code} a esta ubicación: ya aparece en la lista.`,
    ),
    "the count is confirmed",
  );
  await field.waitForStockLine(worker, sku);
  const countedLine = await field.stockLineText(worker, sku);
  check(
    countedLine.figures.includes("En el estante 2") &&
      countedLine.all.includes("de Tienda Sendero"),
    "the notebook's line is in the list straight away, with its shop",
  );
  await layout(worker, "counted");
  // The same units everywhere: the shop's figures rose by exactly 2, and the
  // staff list holds one count, not two.
  const [stockCounted] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  const counted = stockCounted.find(
    (row) => row.sku_id === notebook.sku_id && row.warehouse_id === notebook.warehouse_id,
  );
  check(
    counted.on_hand === notebook.on_hand + 2 && counted.available === notebook.available + 2,
    `the shop's total and what shoppers can buy rose by 2 (${notebook.on_hand} → ${counted.on_hand}, ${notebook.available} → ${counted.available})`,
  );
  const countsOf = async () => {
    const [list] = await rpcAs("central@yuntera.example", [["ops_stock_changes", { p_limit: 50 }]]);
    return list.filter((c) => c.to_code === SHELF && c.note === NOTE).length;
  };
  check((await countsOf()) === 1, "the double tap left one count in the staff list");

  // The page left open saves the same count: refused, nothing changes.
  await field.sendCount(stale, sku);
  await field.countError(stale, sku);
  await stale.waitForLoadState("networkidle");
  const again = await field.countErrorSettled(stale, sku, /No se guardó nada/);
  log("again:", again);
  check(
    again.includes("No se guardó nada") && again.includes("corrija la cantidad en su propia línea"),
    "a second save of the same count is refused, and says where to count",
  );
  const keptStale = await field.countTyped(stale, sku);
  check(
    keptStale.quantity === "2" && keptStale.note === NOTE,
    "the refused save keeps what was typed",
  );
  check(
    (await field.stockLineText(stale, sku)).figures.includes("En el estante 2"),
    "the page behind shows the line with two, not four",
  );
  check((await countsOf()) === 1, "and the staff list still holds one count");
  check(
    (await field.countResultText(stale, sku)).includes(
      "Ya está en esta ubicación, de Tienda Sendero (2 en el estante)",
    ),
    "the result says it is in the list now",
  );
  await layout(stale, "double-save");
  await stale.context().close();

  // ── 4. A shelf switched off while the form is open ─────────────────────────
  await field.openLocation(worker, SWITCHED_OFF);
  await field.searchToCount(worker, "libreta");
  await field.typeCount(worker, sku, { quantity: "2", note: NOTE });
  const [switched] = await rpcAs("central@yuntera.example", [
    ["ops_set_location_active", { p_location_id: other.id, p_active: false }],
  ]);
  check(switched?.active === false, "operations switched the shelf off");
  await field.sendCount(worker, sku);
  await worker.waitForLoadState("networkidle");
  const off = await field.switchedOffError(worker);
  log("switched off:", off);
  check(
    off.includes("Esa ubicación está desactivada"),
    "a count onto a switched-off shelf is refused",
  );
  check((await field.countInQuantity(worker)) === "2", "the refused count keeps what was typed");
  await layout(worker, "switched-off");
  await field.openLocation(worker, SWITCHED_OFF);
  check(
    (await field.countInText(worker)).includes(
      "Esta ubicación está desactivada: aquí no se cuentan productos nuevos.",
    ) && (await field.countInFields(worker)) === 0,
    "a switched-off shelf offers no count",
  );

  // ── 5. The shop: the count with its reason, never who ─────────────────────
  const shopPage = await phone();
  await seller.signIn(shopPage, "sendero@yuntera.example");
  await seller.openInventory(shopPage);
  const first = await seller.firstHistoryEntry(shopPage);
  log("the shop's history:", first);
  check(
    first.includes("Corrección de conteo de la bodega") &&
      first.includes("+2") &&
      first.includes(`Motivo: ${NOTE}`),
    "the shop sees the count and its reason",
  );
  check(
    !/Kattia|bodega@|Y-73-01-A/.test(await seller.historyText(shopPage)),
    "the shop never sees who, nor the shelf",
  );
  await layout(shopPage, "seller");

  // ── 6. The console: the list of moves and corrections, with who ──────────
  const staff = await phone();
  await ops.signIn(staff, "central@yuntera.example");
  await ops.open(staff, "/operacion/ubicaciones");
  const correction = await ops.stockChange(staff, SHELF);
  log("staff list:", correction);
  check(
    correction.includes("Kattia Rodríguez Salas") && correction.includes(`Motivo: ${NOTE}`),
    "the staff list shows the count, with who and why",
  );
  await layout(staff, "console");

  // ── 7. The stock put back as it was ───────────────────────────────────────
  await field.openLocation(worker, SHELF);
  await field.correctStock(worker, sku, "0", "Fin de la prueba de conteo");
  await worker.waitForLoadState("networkidle");
  check((await field.locationSummary(worker)).includes("Está vacía"), "the shelf is empty again");
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
