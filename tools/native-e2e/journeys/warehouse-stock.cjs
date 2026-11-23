// Yuntera Bodega (the warehouse app), web export, at phone size: warehouse
// stock. The lead opens Ubicaciones from the board, opens the notebook's shelf
// by typing its code into the scanner field, tries to move more units than are
// free (refused before sending, what was typed kept), moves three to a new
// shelf, opens that shelf from the list and counts it: a reason too short is
// refused; meanwhile operations corrects the same shelf, so the count made
// from the old number is refused by the database ("count again"), the screen
// reads the shelf again with the typed count kept, shows the new difference,
// and the count is confirmed. The product's lookup lists both shelves. Then
// the shop's stock and its history (what the seller centre reads) show the
// correction with its reason and never the move, and the staff list (what the
// console reads) shows both with who. Every screen at 390 px with no sideways
// scroll, photographed; the screen says moves and counts need signal.
//
// Fails on any console error, uncaught exception or 5xx (the database's
// refusal of the stale count is a 400 the browser logs, expected once).

const { chromium, request } = require("playwright");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const BASE = process.env.NATIVE_WAREHOUSE_URL || "http://127.0.0.1:3013";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const TARGET = "Y-92-01-A";
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
  const [target] = await rpcAs("central@yuntera.example", [
    [
      "ops_create_location",
      { p_warehouse_id: notebook.warehouse_id, p_code: TARGET, p_kind: "storage" },
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
  const byId = (id) => page.getByTestId(id).first();
  const textOf = async (id) => squash(await byId(id).innerText());
  const item = () => page.getByTestId(`item-${notebook.sku_code}`).first();
  const inItem = (id) => item().getByTestId(id).first();
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
    check(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      `no sideways scrolling at 390 px: ${where}`,
    );
  const shot = (name) =>
    page.screenshot({ path: `${SHOTS}/native-warehouse-stock-${name}.png`, fullPage: true });

  // ── Sign in; the board offers the locations ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await byId("sign-in-email").fill("bodega@yuntera.example");
  await byId("sign-in-password").fill(PASSWORD);
  await byId("sign-in-submit").click();
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
    (await page.getByText(/necesitan señal/).count()) > 0,
    "the screen says moves and counts need signal",
  );
  await noSideways("location");
  await shot("02-location");

  // ── A move: more than is free is refused before sending; then three ──
  await inItem("open-move").click();
  await inItem("move-quantity").fill(String(source.free + 5));
  await item().getByTestId(`move-target-${target.id}`).first().click();
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
  await page
    .getByText(/3 unidades · 1 producto/)
    .first()
    .waitFor();
  await byId(`location-${TARGET}`).click();
  await page.getByTestId("location-title").filter({ hasText: TARGET }).first().waitFor();
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
  await item()
    .getByText(/cambió mientras usted contaba/)
    .first()
    .waitFor();
  check(true, "the count made from the old number is refused by the database");
  await item()
    .getByText("Diferencia: −2 unidades (faltan). Quedarán 2 unidades.")
    .first()
    .waitFor();
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
  await page.getByTestId("location-title").filter({ hasText: TARGET }).first().waitFor();
  check(true, "a shelf of the lookup opens its location");
  await shot("06-lookup");

  // ── What the shop and the staff list read ──
  const [history, stockAfter] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock_history", { p_seller_id: shop.id, p_limit: 10 }],
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  check(
    history[0].kind === "warehouse_count" &&
      history[0].change === -2 &&
      history[0].note === "Una libreta con la tapa rota",
    "the shop's history shows the correction with its reason",
  );
  check(
    history.every((entry) => entry.change !== 0) && !/Kattia|bodega@/.test(JSON.stringify(history)),
    "and never the move, nor who",
  );
  const after = stockAfter.find(
    (row) => row.sku_id === notebook.sku_id && row.warehouse_kind === "platform",
  );
  check(after.on_hand === notebook.on_hand - 1, "the shop holds one unit fewer (+1 −2)");
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
