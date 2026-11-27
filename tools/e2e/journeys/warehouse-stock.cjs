// Warehouse stock journey, on a phone: the warehouse lead opens the list of
// locations, opens the notebook's shelf by typing its code, tries to move more
// units than are free (refused, what was typed kept), moves three to a new
// shelf, tries to move one more to a shelf operations switched off meanwhile
// (refused, the choice of shelf goes back to empty, the earlier confirmation
// is gone) and moves it to the new shelf instead; opens that shelf from the
// list, counts it with a reason too short (refused, kept), sees the
// difference before confirming and corrects it down by one, then counts two
// more found behind a box; the product's own page lists both shelves. The
// shop (seller centre) sees both corrections with their reasons in its stock
// history and one unit more in the warehouse on the product's own row, never
// the move. In the console, the staff list shows the move and
// the correction with who did them; a shelf holding stock cannot be switched
// off and the refusal says how to empty it; once the warehouse moved its units
// back (while the worker was counting it: that stale count is refused at the
// top of the page, since the product has left the shelf), it is switched
// off. Every screen is checked at 390 px (no sideways
// scroll, controls of at least 44 px, one page title) and photographed.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const field = require("../lib/field.cjs");
const seller = require("../lib/seller.cjs");
const ops = require("../lib/ops.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const TARGET = "Y-93-01-A";
const SWITCHED_OFF = "Y-93-02-A";
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
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        // Visible ones only: a page left by a link can stay in the document, hidden.
        h1: [...document.querySelectorAll("h1")].filter(visible).length,
        small,
      };
    });
    log(`${name}:`, JSON.stringify(found));
    check(found.overflow <= 0, `${name}: no sideways scroll at 390 px`);
    check(found.h1 === 1, `${name}: one page title`);
    check(found.small.length === 0, `${name}: controls of at least 44 px (${found.small})`);
    await page.screenshot({ path: `${SHOTS}/warehouse-stock-${name}.png`, fullPage: true });
  };

  // ── The notebook: its shop, its shelf, what the shop holds before ─────────
  const [roles] = await rpcAs("sendero@yuntera.example", [["my_roles", {}]]);
  const shop = roles.sellers[0];
  const [stockBefore] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  const notebook = stockBefore.find(
    (row) => row.title.startsWith("Libreta") && row.warehouse_kind === "platform",
  );
  check(Boolean(notebook), "the seed has the notebook in the warehouse");
  const [sku] = await rpcAs("bodega@yuntera.example", [
    ["wms_find_sku", { p_warehouse_id: notebook.warehouse_id, p_code: notebook.sku_code }],
  ]);
  const source = sku.bins[0];
  log("notebook:", notebook.sku_code, "on", source.location_code, "x", source.quantity);
  // A new shelf to move to, made by operations.
  const [created, other] = await rpcAs("central@yuntera.example", [
    [
      "ops_create_location",
      { p_warehouse_id: notebook.warehouse_id, p_code: TARGET, p_kind: "storage" },
    ],
    [
      "ops_create_location",
      { p_warehouse_id: notebook.warehouse_id, p_code: SWITCHED_OFF, p_kind: "storage" },
    ],
  ]);
  check(
    created?.code === TARGET && other?.code === SWITCHED_OFF,
    "operations created the new shelves",
  );
  /** The confirmation of a move or a count saying `wanted`, shown once and then taken out of the address. */
  const outcome = (wanted) => field.stockOutcome(worker, wanted);
  const skuCode = notebook.sku_code;
  /** The notebook's line on the location open now: all of it and its figures. */
  const line = () => field.stockLineText(worker, skuCode);

  // ── 1. The warehouse: the list, a location by its code ─────────────────────
  const worker = await phone();
  await field.signIn(worker, "bodega@yuntera.example");
  await field.open(worker, "/bodega");
  await field.openLocationsFromBoard(worker, source.location_code);
  check(
    (await field.locationListEntry(worker, TARGET)).includes("Vacía"),
    "the list shows the new shelf, empty",
  );
  await layout(worker, "list");
  await field.openLocationByCode(worker, source.location_code.toLowerCase());
  await field.waitForStockLine(worker, skuCode);
  const numbers = (await line()).figures;
  log("on the shelf:", numbers);
  check(
    numbers.includes(`En el estante ${source.quantity}`) &&
      numbers.includes(`Libres ${source.free}`),
    "the shelf shows the notebook with its units and the free ones",
  );
  check((await line()).all.includes("de Tienda Sendero"), "the shelf says whose units they are");

  // ── 2. A move: refused above what is free (kept), then three units ──────────
  await field.openMove(worker, skuCode);
  await field.moveStock(worker, skuCode, { quantity: String(source.free + 5), to: TARGET });
  const refusal = await field.stockLineError(worker, skuCode);
  log("refused:", refusal);
  check(
    refusal.includes("más unidades de las que están libres"),
    "a move above the free units is refused in words",
  );
  const keptMove = await field.moveTyped(worker, skuCode);
  check(
    keptMove.quantity === String(source.free + 5) && keptMove.label === TARGET,
    "the refused move keeps what was typed",
  );
  await layout(worker, "move-refused");
  await field.moveStock(worker, skuCode, { quantity: "3" });
  const moved = await outcome("Se movieron 3 unidades");
  log("moved:", moved);
  check(
    moved.includes(`Se movieron 3 unidades a ${TARGET}. Guárdelas allí ahora.`),
    "the move is confirmed",
  );
  check(
    (await line()).figures.includes(`En el estante ${source.quantity - 3}`),
    "the source shelf shows three fewer",
  );

  // One more, to a shelf that operations switch off while the form is open:
  // refused, and the choice of shelf goes back to empty, never to another one.
  await field.openMove(worker, skuCode);
  await field.typeMove(worker, skuCode, { quantity: "1", to: SWITCHED_OFF });
  const [switched] = await rpcAs("central@yuntera.example", [
    ["ops_set_location_active", { p_location_id: other.id, p_active: false }],
  ]);
  check(switched?.active === false, "operations switched the shelf off");
  await field.moveStock(worker, skuCode, {});
  const offRefusal = await field.stockLineError(worker, skuCode);
  await worker.waitForLoadState("networkidle");
  log("refused (switched off):", offRefusal);
  check(offRefusal.includes("está desactivada"), "a move to a switched-off shelf is refused");
  const kept = await field.moveTyped(worker, skuCode);
  log(
    "after the refusal, the select:",
    JSON.stringify({ value: kept.value, options: kept.options }),
  );
  check(
    kept.value === "" && !kept.options.includes(SWITCHED_OFF),
    "the switched-off shelf leaves the choice and nothing else is chosen",
  );
  check(kept.quantity === "1", "the refused move keeps the quantity");
  check(
    (await field.movedNotices(worker)) === 0 && !/[?&]movidas=/.test(new URL(worker.url()).search),
    "the earlier confirmation is not shown next to the refusal",
  );
  await layout(worker, "move-refused-switched-off");
  // Pressed again without choosing: the browser asks for a shelf, nothing moves.
  await field.moveStock(worker, skuCode, {});
  await worker.waitForTimeout(500);
  check(
    (await field.moveTyped(worker, skuCode)).missing &&
      (await line()).figures.includes(`En el estante ${source.quantity - 3}`),
    "with no shelf chosen, the form asks for one and nothing is moved",
  );
  await field.moveStock(worker, skuCode, { to: TARGET });
  const movedOne = await outcome("Se movió 1 unidad");
  log("moved one:", movedOne);
  check(
    movedOne.includes(`Se movió 1 unidad a ${TARGET}. Guárdela allí ahora.`),
    "one unit: the confirmation agrees with the number",
  );
  await worker.reload({ waitUntil: "networkidle" });
  check((await field.movedNotices(worker)) === 0, "a reload does not show the confirmation again");

  // ── 3. The new shelf, from the list: a count ───────────────────────────────
  await field.open(worker, "/bodega/ubicaciones");
  check(
    (await field.locationListEntry(worker, TARGET)).includes("4 unidades"),
    "the list shows the new shelf holding four",
  );
  await field.openListedLocation(worker, TARGET);
  await field.waitForStockLine(worker, skuCode);
  check((await line()).figures.includes("En el estante 4"), "the new shelf holds four");
  await field.openCount(worker, skuCode);
  const down = await field.typeCounted(worker, skuCode, "3");
  log("before confirming:", down.difference);
  check(
    down.difference.includes("Diferencia: −1 unidad (faltan). Quedarán 3 unidades."),
    "the difference is shown before confirming",
  );
  check(down.button === "Corregir a 3 unidades", "the button says what it will do");
  await field.sendCountCorrection(worker, skuCode, "rota");
  check(
    (await field.stockLineError(worker, skuCode)).includes("al menos 5 letras"),
    "a reason too short is refused",
  );
  const keptCount = await field.countCorrectionTyped(worker, skuCode);
  check(
    keptCount.counted === "3" && keptCount.note === "rota",
    "the refused count keeps what was typed",
  );
  await layout(worker, "count-refused");
  await field.sendCountCorrection(worker, skuCode, "Una libreta con la tapa rota");
  const corrected = await outcome("Ahora hay 3 unidades");
  log("corrected:", corrected);
  check(corrected.includes("Ahora hay 3 unidades (−1)"), "the correction is confirmed");
  check((await line()).figures.includes("En el estante 3"), "the shelf shows three");
  // Two more found behind a box: a correction upwards.
  await field.openCount(worker, skuCode);
  check(
    (await field.typeCounted(worker, skuCode, "5")).difference.includes(
      "Diferencia: +2 unidades (sobran). Quedarán 5 unidades.",
    ),
    "the difference upwards is shown before confirming",
  );
  await field.sendCountCorrection(worker, skuCode, "Dos libretas detrás de una caja");
  const raised = await outcome("Ahora hay 5 unidades");
  log("corrected up:", raised);
  check(raised.includes("Ahora hay 5 unidades (+2)"), "the correction upwards is confirmed");
  check((await line()).figures.includes("En el estante 5"), "the shelf shows five");
  await layout(worker, "location");

  // ── 4. The product's locations ─────────────────────────────────────────────
  const bins = await field.productLocations(worker, skuCode);
  log("the product's locations:", bins.slice(0, 300));
  check(
    bins.includes(`${source.location_code}`) &&
      bins.includes(`${TARGET}`) &&
      bins.includes(`Total en bodega: ${source.quantity + 1} unidades`),
    "the product lists both shelves",
  );
  await layout(worker, "product");

  // ── 5. The shop: the correction with its reason, never the move ───────────
  const shopPage = await phone();
  await seller.signIn(shopPage, "sendero@yuntera.example");
  await seller.openInventory(shopPage);
  const [first, second] = await seller.historyEntries(shopPage);
  log("the shop's history:", first, "|", second);
  check(
    first.includes("Corrección de conteo de la bodega") &&
      first.includes("+2") &&
      first.includes("Motivo: Dos libretas detrás de una caja"),
    "the shop sees the correction upwards and its reason",
  );
  check(
    second.includes("Corrección de conteo de la bodega") &&
      second.includes("−1") &&
      second.includes("Motivo: Una libreta con la tapa rota"),
    "the shop sees the correction downwards and its reason",
  );
  const allHistory = await seller.historyText(shopPage);
  check(!/Kattia|bodega@|Y-93-01-A/.test(allHistory), "the shop never sees who, nor the shelves");
  const kinds = await seller.historyKinds(shopPage);
  check(
    kinds.entries === kinds.withKind && !allHistory.includes("+0") && !allHistory.includes("−0"),
    "no move in the shop's history",
  );
  const [stockAfter] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  const after = stockAfter.find(
    (row) => row.sku_id === notebook.sku_id && row.warehouse_kind === "platform",
  );
  check(after.on_hand === notebook.on_hand + 1, "the shop holds exactly one unit more");
  const cells = await seller.warehouseRowCells(shopPage, skuCode);
  log("the shop's row:", JSON.stringify(cells));
  check(
    cells[2]?.trim() === String(after.on_hand) && cells[4]?.trim() === String(after.available),
    "the seller centre shows the new total on the product's own row",
  );
  await layout(shopPage, "seller");

  // ── 6. The console: the staff list; a shelf with stock is emptied first ───
  const staff = await phone();
  await ops.signIn(staff, "central@yuntera.example");
  await ops.open(staff, "/operacion/ubicaciones");
  const move =
    (await ops.stockChangesWith(staff, source.location_code, TARGET)).find((t) =>
      t.includes(`3 unidades de ${source.location_code} a ${TARGET}`),
    ) ?? "";
  const correction = await ops.stockChangeWith(staff, TARGET, "Una libreta con la tapa rota");
  log("staff list:", move, "|", correction);
  check(
    move.includes(`3 unidades de ${source.location_code} a ${TARGET}`) &&
      move.includes("Kattia Rodríguez Salas"),
    "the staff list shows the move, with who",
  );
  check(
    correction.includes(`−1 unidad en ${TARGET}`) &&
      correction.includes("Motivo: Una libreta con la tapa rota") &&
      correction.includes("Kattia Rodríguez Salas"),
    "the staff list shows the correction, with who and why",
  );
  check(
    (await ops.openLocationSwitchOff(staff, TARGET)).includes("primero hay que vaciarla"),
    "the console says how to empty a shelf before switching it off",
  );
  const refused = await ops.switchLocationOffRefused(staff, TARGET);
  log("switch-off refused:", refused);
  check(
    refused.includes("vacíela primero") && refused.includes("Mover"),
    "the refusal says how to empty it",
  );
  await layout(staff, "console");

  // A count typed on a stale page: while the worker counts the new shelf, a
  // colleague moves its five units back. The count is refused, and because the
  // product has left the shelf (its row and form go), the refusal is shown at
  // the top of the page: nothing was corrected, look again.
  await field.openLocation(worker, TARGET);
  await field.openCount(worker, skuCode);
  await field.typeCounted(worker, skuCode, "7");
  const [emptied] = await rpcAs("bodega@yuntera.example", [
    [
      "wms_move_stock",
      {
        p_from_location_id: created.id,
        p_to_location_id: source.location_id,
        p_sku_id: notebook.sku_id,
        p_seller_id: shop.id,
        p_quantity: 5,
        p_note: "Para vaciar el estante",
      },
    ],
  ]);
  check(emptied?.quantity === 5, "a colleague moved the five units back meanwhile");
  await field.sendCountCorrection(worker, skuCode, "Dos más en otra caja");
  const goneText = await field.goneNotice(worker);
  log("stale count:", goneText);
  check(
    goneText.includes(`No se corrigió nada: el producto ${notebook.sku_code} ya no está`) &&
      goneText.includes("Revise la ubicación y vuelva a contar"),
    "a count whose product left the shelf says at the top that nothing was corrected",
  );
  check(
    (await field.locationSummary(worker)).includes("Está vacía") &&
      (await field.stockLineCount(worker, skuCode)) === 0,
    "the new shelf is empty again, as the database says",
  );
  await layout(worker, "count-refused-gone");
  // The address alone never says a product left: not for one the location
  // still lists, nor for a code that is not a product code.
  for (const [code, sin] of [
    [source.location_code, notebook.sku_code],
    [source.location_code, "llame-al-8888-0000"],
  ]) {
    await field.open(
      worker,
      `/bodega/ubicacion?codigo=${encodeURIComponent(code)}&sin=${encodeURIComponent(sin)}&accion=mover`,
    );
    await field.waitForLocationSummary(worker);
    check(
      (await field.goneNotices(worker)) === 0,
      `a link with sin=${sin === notebook.sku_code ? "a listed product" : "a made-up code"} shows no refusal`,
    );
  }
  await ops.open(staff, "/operacion/ubicaciones");
  await ops.switchLocationOffNow(staff, TARGET);
  check(true, "the emptied shelf is switched off");
  await field.open(worker, "/bodega/ubicaciones");
  check(
    (await field.locationListed(worker, TARGET)) === 0,
    "a switched-off, empty shelf leaves the warehouse's list",
  );

  // ── 7. Nobody else ─────────────────────────────────────────────────────────
  const [shopper] = await rpcAs("comprador@yuntera.example", [
    ["wms_stock_locations", { p_warehouse_id: notebook.warehouse_id }],
  ]);
  check(JSON.stringify(shopper).includes("forbidden"), "a shopper cannot read the locations");
  const [driver] = await rpcAs("repartidor@yuntera.example", [["ops_stock_changes", {}]]);
  check(JSON.stringify(driver).includes("forbidden"), "a driver cannot read the staff list");

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
