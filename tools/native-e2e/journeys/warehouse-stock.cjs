// Yuntera Bodega (the warehouse app), web export, at phone size: warehouse
// stock. The lead opens Ubicaciones from the board, opens the notebook's shelf
// by typing its code into the scanner field, tries to move more units than are
// free (refused before sending, what was typed kept), moves three to a new
// shelf, opens that shelf from the list and counts it: a reason too short is
// refused; meanwhile operations corrects the same shelf, so the count made
// from the old number is refused by the database ("count again"), the screen
// reads the shelf again with the typed count kept, shows the new difference,
// and the count is confirmed; then two more are found (a count upwards). One
// unit is moved back, first to a shelf operations switch off while the form
// is open (refused by the database, and that shelf is no longer chosen), then
// to its first shelf. The product's lookup lists both shelves and opens the
// new one; a move typed there while a colleague empties the shelf is refused,
// and since the product's card goes, the screen itself says nothing was
// moved. Then the shop's
// stock and its history (what the seller centre reads) show both corrections
// with their reasons and never the moves, and the staff list (what the
// console reads) shows both with who. Every screen at 390 px with no sideways
// scroll, photographed; the screen says moves and counts need signal.
//
// Fails on any console error, uncaught exception or 5xx (the database's
// refusals of the stale count and of the switched-off shelf are 400s the
// browser logs, expected there).

const { chromium, request } = require("playwright");
const { overflow, testIds } = require("../lib/screen.cjs");
const warehouseApp = require("../lib/warehouse.cjs");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const BASE = process.env.NATIVE_WAREHOUSE_URL || "http://127.0.0.1:3013";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const TARGET = "Y-92-01-A";
const SWITCHED_OFF = "Y-92-02-A";
const log = (...args) => console.log(...args);
const squash = (text) => text.replace(/\s+/g, " ").trim();

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

async function rpcAs(email, calls) {
  const context = await request.newContext();
  const token = await context.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await token.json();
  const out = [];
  for (const [fn, args] of calls) {
    const response = await context.post(`${API}/rest/v1/rpc/${fn}`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: args,
    });
    if (!response.ok()) throw new Error(`${fn}: HTTP ${response.status()}`);
    const body = await response.text();
    out.push(body ? JSON.parse(body) : null);
  }
  await context.dispose();
  return out;
}

(async () => {
  // The notebook of Tienda Sendero, its shelf, and a new shelf to move to.
  const [roles] = await rpcAs("sendero@yuntera.example", [["my_roles", {}]]);
  const shop = roles.sellers[0];
  const [stockBefore] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  const notebook = stockBefore.find(
    (row) => row.title.startsWith("Libreta") && row.warehouse_kind === "platform",
  );
  const [sku] = await rpcAs("bodega@yuntera.example", [
    ["wms_find_sku", { p_warehouse_id: notebook.warehouse_id, p_code: notebook.sku_code }],
  ]);
  const source = sku.bins[0];
  const [target, other] = await rpcAs("central@yuntera.example", [
    [
      "ops_create_location",
      { p_warehouse_id: notebook.warehouse_id, p_code: TARGET, p_kind: "storage" },
    ],
    [
      "ops_create_location",
      { p_warehouse_id: notebook.warehouse_id, p_code: SWITCHED_OFF, p_kind: "storage" },
    ],
  ]);
  log(`notebook ${notebook.sku_code}: ${source.quantity} on ${source.location_code}`);

  const browser = await chromium.launch();
  const errors = [];
  let expectRefusal = false;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (expectRefusal && /status of 400/.test(m.text())) return;
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const byId = (id) => testIds(page, id).first();
  const textOf = async (id) => squash(await byId(id).innerText());
  const item = () => testIds(page, `item-${notebook.sku_code}`).first();
  const inItem = (id) => testIds(item(), id).first();
  /** Waits until the product's card says `wanted` (its numbers are separate texts). */
  const itemSays = async (wanted) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (squash(await item().innerText()).includes(wanted)) return true;
      await page.waitForTimeout(200);
    }
    return false;
  };
  const noSideways = async (where) =>
    check((await overflow(page)) <= 0, `no sideways scrolling at 390 px: ${where}`);
  const shot = (name) =>
    page.screenshot({ path: `${SHOTS}/native-warehouse-stock-${name}.png`, fullPage: true });

  // ── Sign in; the board offers the locations ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await warehouseApp.signIn(page, "bodega@yuntera.example", PASSWORD);
  await byId("warehouse-board").waitFor();
  await byId("open-locations").click();
  await byId("location-scan-input").waitFor();
  check(
    (await textOf(`location-${TARGET}`)).includes("vacía"),
    "the list shows the new shelf, empty",
  );
  await noSideways("locations");
  await shot("01-locations");

  // ── A shelf by its code, typed into the scanner field ──
  await byId("location-scan-input").fill(source.location_code.toLowerCase());
  await byId("location-scan-submit").click();
  await byId("location-title").waitFor();
  check((await textOf("location-title")) === source.location_code, "the shelf opens by its code");
  const numbers = squash(await item().innerText());
  log("   ", numbers.slice(0, 200));
  check(
    numbers.includes("de Tienda Sendero") &&
      numbers.includes(`En el estante ${source.quantity}`) &&
      numbers.includes(`Libres ${source.free}`),
    "the shelf shows whose units, how many and how many are free",
  );
  check(
    (await warehouseApp.signalNote(page).count()) > 0,
    "the screen says moves and counts need signal",
  );
  await noSideways("location");
  await shot("02-location");

  // ── A move: more than is free is refused before sending; then three ──
  await inItem("open-move").click();
  await inItem("move-quantity").fill(String(source.free + 5));
  await testIds(item(), `move-target-${target.id}`).first().click();
  await inItem("move-submit").click();
  check(
    (await textOf("move-error")).includes(`Solo hay ${source.free} unidades libres`),
    "a move above the free units is refused, with how many are free",
  );
  check(
    (await inItem("move-quantity").inputValue()) === String(source.free + 5),
    "and what was typed is kept",
  );
  await shot("03-move-refused");
  await inItem("move-quantity").fill("3");
  await inItem("move-submit").click();
  await byId("stock-result").waitFor();
  check(
    (await textOf("stock-result")).includes(`Se movieron 3 unidades a ${TARGET}`),
    "the move is confirmed",
  );
  check(await itemSays(`En el estante ${source.quantity - 3}`), "the shelf shows three fewer");

  // ── The new shelf, from the list: a count ──
  await page.goBack();
  await byId(`location-${TARGET}`).waitFor();
  await warehouseApp.locationRowSays(page, TARGET, /3 unidades · 1 producto/);
  await byId(`location-${TARGET}`).click();
  await warehouseApp.locationOpen(page, TARGET);
  await inItem("open-count").click();
  await inItem("count-quantity").fill("2");
  check(
    (await squash(await inItem("count-difference").innerText())) ===
      "Diferencia: −1 unidad (faltan). Quedarán 2 unidades.",
    "the difference is shown before confirming",
  );
  await inItem("count-note").fill("rota");
  await inItem("count-submit").click();
  check(
    (await squash(await inItem("count-error").innerText())).includes("al menos 5 letras"),
    "a reason too short is refused",
  );
  // Meanwhile operations finds one more unit on that shelf.
  await rpcAs("central@yuntera.example", [
    [
      "wms_adjust_stock",
      {
        p_location_id: target.id,
        p_sku_id: notebook.sku_id,
        p_seller_id: shop.id,
        p_delta: 1,
        p_note: "Una unidad encontrada por operaciones",
      },
    ],
  ]);
  await inItem("count-note").fill("Una libreta con la tapa rota");
  expectRefusal = true;
  await inItem("count-submit").click();
  await warehouseApp.cardSays(item(), "count-error", /cambió mientras usted contaba/);
  check(true, "the count made from the old number is refused by the database");
  await warehouseApp.cardSays(
    item(),
    "count-difference",
    "Diferencia: −2 unidades (faltan). Quedarán 2 unidades.",
  );
  check(
    (await inItem("count-quantity").inputValue()) === "2" &&
      (await inItem("count-note").inputValue()) === "Una libreta con la tapa rota",
    "the shelf is read again, the count and its reason kept, the new difference shown",
  );
  expectRefusal = false;
  await shot("04-count-refused");
  await inItem("count-submit").click();
  await byId("stock-result").waitFor();
  check(
    (await textOf("stock-result")).includes("ahora hay 2 unidades (−2)"),
    "the count is confirmed",
  );
  check(await itemSays("En el estante 2"), "the shelf shows two");
  await noSideways("count");
  await shot("05-counted");

  // ── Two more found: a count upwards ──
  if ((await inItem("count-quantity").count()) === 0) await inItem("open-count").click();
  await inItem("count-quantity").fill("4");
  check(
    squash(await inItem("count-difference").innerText()) ===
      "Diferencia: +2 unidades (sobran). Quedarán 4 unidades.",
    "the difference upwards is shown before confirming",
  );
  await inItem("count-note").fill("Dos libretas detrás de una caja");
  await inItem("count-submit").click();
  await warehouseApp.stockResult(page, /ahora hay 4 unidades \(\+2\)/);
  check(true, "the count upwards is confirmed");
  check(await itemSays("En el estante 4"), "the shelf shows four");

  // ── One back: to a shelf switched off meanwhile (refused), then to its first shelf ──
  if ((await inItem("move-quantity").count()) === 0) await inItem("open-move").click();
  await inItem("move-quantity").fill("1");
  await testIds(item(), `move-target-${other.id}`).first().click();
  await rpcAs("central@yuntera.example", [
    ["ops_set_location_active", { p_location_id: other.id, p_active: false }],
  ]);
  expectRefusal = true;
  await inItem("move-submit").click();
  await warehouseApp.cardSays(item(), "move-error", /está desactivada/);
  check(true, "a move to a shelf switched off meanwhile is refused by the database");
  check(
    (await testIds(page, "stock-result").count()) === 0,
    "the earlier confirmation is not shown next to the refusal",
  );
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && (await testIds(item(), `move-target-${other.id}`).count()) > 0) {
    await page.waitForTimeout(200);
  }
  check(
    (await testIds(item(), `move-target-${other.id}`).count()) === 0 &&
      (await inItem("move-quantity").inputValue()) === "1",
    "the switched-off shelf leaves the choices, the quantity is kept",
  );
  expectRefusal = false;
  await inItem("move-submit").click();
  check(
    (await textOf("move-error")).includes("Elija a qué estante lo mueve"),
    "nothing stays chosen: a second press moves nothing",
  );
  await shot("05b-move-refused-switched-off");
  await testIds(item(), `move-target-${source.location_id}`).first().click();
  await inItem("move-submit").click();
  await warehouseApp.stockResult(
    page,
    `Se movió 1 unidad a ${source.location_code}. Guárdela allí ahora.`,
  );
  check(true, "one unit: the confirmation agrees with the number");
  check(await itemSays("En el estante 3"), "the shelf shows three");

  // ── The product's locations ──
  await page.goto(`${BASE}/buscar`, { waitUntil: "networkidle" });
  await byId("lookup-input").fill(notebook.sku_code);
  await byId("lookup-submit").click();
  await byId("lookup-result").waitFor();
  const lookup = await textOf("lookup-result");
  check(
    lookup.includes(source.location_code) && lookup.includes(TARGET),
    "the product's lookup lists both shelves",
  );
  await byId(`lookup-bin-${TARGET}`).click();
  await warehouseApp.locationOpen(page, TARGET);
  check(true, "a shelf of the lookup opens its location");
  await shot("06-lookup");

  // ── A move typed on a stale screen: the product leaves the shelf meanwhile ──
  // A colleague moves the three units back while the form is open. The move is
  // refused and the product's card (with the form) goes, so the screen itself
  // says nothing was moved and what to do.
  await item().waitFor();
  await inItem("open-move").click();
  await inItem("move-quantity").fill("2");
  await testIds(item(), `move-target-${source.location_id}`).first().click();
  const [emptied] = await rpcAs("bodega@yuntera.example", [
    [
      "wms_move_stock",
      {
        p_from_location_id: target.id,
        p_to_location_id: source.location_id,
        p_sku_id: notebook.sku_id,
        p_seller_id: shop.id,
        p_quantity: 3,
        p_note: "Para vaciar el estante",
      },
    ],
  ]);
  check(emptied?.quantity === 3, "a colleague moved the three units back meanwhile");
  expectRefusal = true;
  await inItem("move-submit").click();
  await byId("stock-gone").waitFor();
  const gone = await textOf("stock-gone");
  log("stale move:", gone);
  check(
    gone.includes(
      `No se movió nada: el producto ${notebook.sku_code} ya no está en esta ubicación`,
    ) && gone.includes("Búsquelo en «Buscar un producto» para ver dónde está"),
    "a move whose product left the shelf says on the screen that nothing was moved",
  );
  check(
    (await byId("stock-gone").first().getAttribute("role")) === "alert",
    "the refusal is an alert (announced at once), as on the web",
  );
  check(
    (await testIds(page, `item-${notebook.sku_code}`).count()) === 0 &&
      (await textOf("location-summary")).includes("Está vacía"),
    "the shelf reads empty, as the database says",
  );
  expectRefusal = false;
  await noSideways("a stale move refused");
  await shot("06b-move-refused-gone");

  // ── What the shop and the staff list read ──
  const [history, stockAfter] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock_history", { p_seller_id: shop.id, p_limit: 10 }],
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  check(
    history[0].kind === "warehouse_count" &&
      history[0].change === 2 &&
      history[0].note === "Dos libretas detrás de una caja" &&
      history[1].kind === "warehouse_count" &&
      history[1].change === -2 &&
      history[1].note === "Una libreta con la tapa rota",
    "the shop's history shows both corrections with their reasons",
  );
  check(
    history.every((entry) => entry.change !== 0) && !/Kattia|bodega@/.test(JSON.stringify(history)),
    "and never the move, nor who",
  );
  const after = stockAfter.find(
    (row) => row.sku_id === notebook.sku_id && row.warehouse_kind === "platform",
  );
  check(after.on_hand === notebook.on_hand + 1, "the shop holds one unit more (+1 −2 +2)");
  const [changes] = await rpcAs("central@yuntera.example", [
    ["ops_stock_changes", { p_limit: 10 }],
  ]);
  check(
    changes.some(
      (c) =>
        c.kind === "move" &&
        c.from_code === source.location_code &&
        c.to_code === TARGET &&
        c.quantity === 3 &&
        c.actor_name === "Kattia Rodríguez Salas",
    ) &&
      changes.some(
        (c) =>
          c.kind === "correction" &&
          c.change === -2 &&
          c.note === "Una libreta con la tapa rota" &&
          c.actor_name === "Kattia Rodríguez Salas",
      ),
    "the staff list shows the move and the correction, with who",
  );

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", error.message.slice(0, 700));
  process.exit(1);
});
