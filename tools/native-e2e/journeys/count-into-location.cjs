// Yuntera Bodega (the warehouse app), web export, at phone size: counting a
// product into a location that has no record of it. The lead opens a new,
// empty shelf from Ubicaciones. In «Contar un producto que no está en la
// lista» they type the drill's code into the scanner field (no shop keeps it
// in this warehouse: the screen says its first units come in with a receipt),
// then the earphones' (TecnoCasa keeps them here; Tienda Sendero sells them
// from its own site and the screen says so), then search the notebook by its
// name: a reason too short is refused before sending (kept), and two units
// are counted in; the notebook's card is on the shelf at once. The
// earphones' form is filled while a colleague counts one earphone onto the
// same shelf: the save is refused by the database (nothing changes, count
// on the product's own line), what was typed is kept, and the shelf shows
// the colleague's one, not the sum. On a second shelf that operations switch
// off while the form is open, the count is refused (kept), and once read
// again the shelf offers no count. The shop's history (what the seller
// centre reads) shows the count with its reason and never who; the staff
// list (what the console reads) shows it with who. Then the stock is put
// back as it was through the cards' own count correction, and the shop's
// totals are what they were. Every screen at 390 px with no sideways
// scroll, photographed.
//
// Fails on any console error, uncaught exception or 5xx (the database's
// refusals are 400s the browser logs, expected there).

const { chromium, request } = require("playwright");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const BASE = process.env.NATIVE_WAREHOUSE_URL || "http://127.0.0.1:3013";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHELF = "Y-74-01-A";
const SWITCHED_OFF = "Y-74-02-A";
const NOTE = "Dos libretas detrás de una caja sin etiqueta";
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
  // The products, the shop's totals before, and two new shelves.
  const [roles] = await rpcAs("sendero@yuntera.example", [["my_roles", {}]]);
  const shop = roles.sellers[0];
  const [stockBefore] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  const notebook = stockBefore.find(
    (row) => row.title.startsWith("Libreta") && row.warehouse_kind === "platform",
  );
  const [shelf, other] = await rpcAs("central@yuntera.example", [
    [
      "ops_create_location",
      { p_warehouse_id: notebook.warehouse_id, p_code: SHELF, p_kind: "storage" },
    ],
    [
      "ops_create_location",
      { p_warehouse_id: notebook.warehouse_id, p_code: SWITCHED_OFF, p_kind: "storage" },
    ],
  ]);
  const [earphoneList, drillList] = await rpcAs("bodega@yuntera.example", [
    ["wms_count_candidates", { p_location_id: shelf.id, p_query: "audífonos" }],
    ["wms_count_candidates", { p_location_id: shelf.id, p_query: "YT-D844513A" }],
  ]);
  const earphones = earphoneList.find((c) => c.shops.length > 1);
  const drill = drillList[0];
  const keeper = earphones.shops.find((s) => s.stock_record);
  const away = earphones.shops.find((s) => !s.stock_record);
  const [keeperStock] = await rpcAs("central@yuntera.example", [
    ["wms_location_stock", { p_warehouse_id: notebook.warehouse_id, p_code: SHELF }],
  ]);
  check(keeperStock.items.length === 0, "the new shelf lists nothing");

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
  const result = (sku) => page.getByTestId(`count-in-result-${sku}`).first();
  const inResult = (sku, id) => result(sku).getByTestId(id).first();
  const card = (sku) => page.getByTestId(`item-${sku}`).first();
  const says = async (locator, wanted) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if ((await locator.count()) > 0 && squash(await locator.innerText()).includes(wanted))
        return true;
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
    page.screenshot({ path: `${SHOTS}/native-count-into-location-${name}.png`, fullPage: true });
  const open = async (code) => {
    await page.goto(`${BASE}/ubicaciones`, { waitUntil: "networkidle" });
    await byId("location-scan-input").fill(code);
    await byId("location-scan-submit").click();
    await page.getByTestId("location-title").filter({ hasText: code }).first().waitFor();
    await byId("count-in").waitFor();
    // The search (and on a phone its camera) opens only when asked for.
    if ((await page.getByTestId("count-in-open").count()) > 0) await byId("count-in-open").click();
  };
  const scan = async (code) => {
    await byId("count-in-scan-input").fill(code);
    await byId("count-in-scan-submit").click();
  };

  // ── Sign in; the new shelf, empty ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await byId("sign-in-email").fill("bodega@yuntera.example");
  await byId("sign-in-password").fill(PASSWORD);
  await byId("sign-in-submit").click();
  await byId("warehouse-board").waitFor();
  await open(SHELF);
  check((await textOf("location-summary")).includes("Está vacía"), "the new shelf is empty");
  check(
    (await textOf("count-in")).includes("Contar un producto que no está en la lista"),
    "the shelf offers to count a product that is not in the list",
  );
  await noSideways("empty shelf");
  await shot("01-empty");

  // ── A product no shop keeps here: a receipt, not a count ──
  await scan(drill.sku_code);
  await result(drill.sku_code).waitFor();
  const receipt = squash(await result(drill.sku_code).innerText());
  log("drill:", receipt);
  check(
    receipt.includes("No se puede contar aquí") &&
      receipt.includes("Las primeras unidades de una tienda entran con una recepción") &&
      receipt.includes("Mercadería por recibir") &&
      (await inResult(drill.sku_code, "count-in-submit").count()) === 0,
    "a product no shop keeps here cannot be counted, and the screen says where to go",
  );
  await shot("02-no-record");

  // ── Two shops sell it, one keeps it here ──
  await scan(earphones.sku_code);
  await result(earphones.sku_code).waitFor();
  const shared = squash(await result(earphones.sku_code).innerText());
  check(
    shared.includes(`Unidades de ${keeper.seller_name}.`) &&
      shared.includes(`${away.seller_name} también vende este producto`),
    "only the shop with a stock record here can be counted; the other is named and why",
  );

  // ── The notebook, by its name: refused before sending, then two counted ──
  await byId("count-in-name").fill("libreta");
  await byId("count-in-name-submit").click();
  await result(notebook.sku_code).waitFor();
  check(
    squash(await result(notebook.sku_code).innerText()).includes("Unidades de Tienda Sendero."),
    "found by its name, with its shop",
  );
  await inResult(notebook.sku_code, "count-in-quantity").fill("2");
  check(
    squash(await inResult(notebook.sku_code, "count-in-submit").innerText()) ===
      `Sumar 2 unidades a ${SHELF}`,
    "the button says what it will do",
  );
  await inResult(notebook.sku_code, "count-in-note").fill("rota");
  await inResult(notebook.sku_code, "count-in-submit").click();
  check(
    squash(await inResult(notebook.sku_code, "count-in-error").innerText()).includes(
      "al menos 5 letras",
    ),
    "a reason too short is refused",
  );
  check(
    (await inResult(notebook.sku_code, "count-in-quantity").inputValue()) === "2" &&
      (await inResult(notebook.sku_code, "count-in-note").inputValue()) === "rota",
    "and what was typed is kept",
  );
  await noSideways("refused");
  await shot("03-refused");
  await inResult(notebook.sku_code, "count-in-note").fill(NOTE);
  await inResult(notebook.sku_code, "count-in-submit").click();
  await byId("stock-result").waitFor();
  check(
    (await textOf("stock-result")).includes(
      `Se sumaron 2 unidades de ${notebook.sku_code} a esta ubicación: ya aparece en la lista.`,
    ),
    "the count is confirmed",
  );
  check(
    await says(card(notebook.sku_code), "En el estante 2"),
    "the notebook's card is on the shelf at once, with two",
  );
  check(
    squash(await card(notebook.sku_code).innerText()).includes("de Tienda Sendero"),
    "with its shop",
  );
  await noSideways("counted");
  await shot("04-counted");

  // ── A colleague counts the same product here meanwhile ──
  await scan(earphones.sku_code);
  await result(earphones.sku_code).waitFor();
  await inResult(earphones.sku_code, "count-in-quantity").fill("2");
  await inResult(earphones.sku_code, "count-in-note").fill("Dos audífonos detrás de la caja");
  const [colleague] = await rpcAs("bodega@yuntera.example", [
    [
      "wms_count_into_location",
      {
        p_location_id: shelf.id,
        p_sku_id: earphones.sku_id,
        p_seller_id: keeper.seller_id,
        p_quantity: 1,
        p_note: "Un audífono contado por un colega",
      },
    ],
  ]);
  check(colleague?.on_shelf === 1, "a colleague counted one earphone onto the shelf meanwhile");
  expectRefusal = true;
  await inResult(earphones.sku_code, "count-in-submit").click();
  check(
    await says(inResult(earphones.sku_code, "count-in-error"), "No se guardó nada"),
    "the second count is refused",
  );
  const again = squash(await inResult(earphones.sku_code, "count-in-error").innerText());
  log("again:", again);
  check(
    again.includes("corrija la cantidad en su propia línea"),
    "and says to count on the product's own line",
  );
  check(
    (await inResult(earphones.sku_code, "count-in-quantity").inputValue()) === "2",
    "what was typed is kept",
  );
  check(
    await says(card(earphones.sku_code), "En el estante 1"),
    "the shelf shows the colleague's one, not the sum",
  );
  check(
    await says(result(earphones.sku_code), "Ya está en esta ubicación"),
    "the result says it is in the list now",
  );
  expectRefusal = false;
  await noSideways("refused, counted meanwhile");
  await shot("05-counted-meanwhile");

  // ── A shelf switched off while the form is open ──
  await open(SWITCHED_OFF);
  await byId("count-in-name").fill("libreta");
  await byId("count-in-name-submit").click();
  await result(notebook.sku_code).waitFor();
  await inResult(notebook.sku_code, "count-in-quantity").fill("2");
  await inResult(notebook.sku_code, "count-in-note").fill(NOTE);
  await rpcAs("central@yuntera.example", [
    ["ops_set_location_active", { p_location_id: other.id, p_active: false }],
  ]);
  expectRefusal = true;
  await inResult(notebook.sku_code, "count-in-submit").click();
  check(
    await says(inResult(notebook.sku_code, "count-in-error"), "Esa ubicación está desactivada"),
    "a count onto a switched-off shelf is refused",
  );
  check(
    (await inResult(notebook.sku_code, "count-in-quantity").inputValue()) === "2",
    "what was typed is kept",
  );
  expectRefusal = false;
  await shot("06-switched-off");
  // Read again (a switched-off, empty shelf leaves the list, so the screen is reloaded).
  await page.reload({ waitUntil: "networkidle" });
  await byId("count-in").waitFor();
  check(
    await says(byId("count-in-closed"), "Esta ubicación está desactivada"),
    "a switched-off shelf offers no count",
  );

  // ── What the shop and the staff list read ──
  const [history] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock_history", { p_seller_id: shop.id, p_limit: 5 }],
  ]);
  check(
    history[0].kind === "warehouse_count" && history[0].change === 2 && history[0].note === NOTE,
    "the shop's history shows the count with its reason",
  );
  check(!/Kattia|bodega@|Y-74/.test(JSON.stringify(history)), "and never who, nor the shelf");
  const [changes] = await rpcAs("central@yuntera.example", [
    ["ops_stock_changes", { p_limit: 10 }],
  ]);
  check(
    changes.some(
      (c) =>
        c.kind === "correction" &&
        c.change === 2 &&
        c.to_code === SHELF &&
        c.note === NOTE &&
        c.actor_name === "Kattia Rodríguez Salas",
    ),
    "the staff list shows the count, with who",
  );

  // ── The stock put back as it was, through the cards' own count ──
  await open(SHELF);
  for (const [sku, onShelf] of [
    [notebook.sku_code, 2],
    [earphones.sku_code, 1],
  ]) {
    await card(sku).waitFor();
    await card(sku).getByTestId("open-count").first().click();
    await card(sku).getByTestId("count-quantity").first().fill("0");
    await card(sku).getByTestId("count-note").first().fill("Fin de la prueba de conteo");
    await card(sku).getByTestId("count-submit").first().click();
    await page.getByText(`ahora hay 0 unidades (−${onShelf})`).first().waitFor();
    check(true, `${sku} counted back to 0`);
  }
  await page.getByTestId(`item-${earphones.sku_code}`).first().waitFor({ state: "detached" });
  check((await textOf("location-summary")).includes("Está vacía"), "the shelf is empty again");
  const [stockAfter] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  const after = stockAfter.find(
    (row) => row.sku_id === notebook.sku_id && row.warehouse_kind === "platform",
  );
  check(
    after.on_hand === notebook.on_hand && after.available === notebook.available,
    "the shop's total and what shoppers can buy are what they were",
  );
  await rpcAs("central@yuntera.example", [
    ["ops_set_location_active", { p_location_id: shelf.id, p_active: false }],
  ]);
  await noSideways("put back");
  await shot("07-put-back");

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", error.message.slice(0, 700));
  process.exit(1);
});
