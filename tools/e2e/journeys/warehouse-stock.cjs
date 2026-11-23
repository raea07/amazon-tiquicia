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
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const FIELD = process.env.FIELD_URL || "http://127.0.0.1:3003";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const TARGET = "Y-93-01-A";
const SWITCHED_OFF = "Y-93-02-A";
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
  const outcome = async (wanted) => {
    const banner = field.locator('main [role="status"]', { hasText: wanted });
    await banner.waitFor();
    await field.waitForFunction(
      () => !/[?&](movidas|destino|contadas|diferencia)=/.test(window.location.search),
    );
    await field.waitForLoadState("networkidle");
    return text(banner);
  };

  // ── 1. The warehouse: the list, a location by its code ─────────────────────
  const field = await phone();
  await signIn(field, FIELD, "bodega@yuntera.example");
  await field.goto(FIELD + "/bodega", { waitUntil: "networkidle" });
  await field.click('main a:has-text("Ubicaciones")');
  await field.waitForURL((u) => new URL(u).pathname === "/bodega/ubicaciones");
  await field.waitForSelector(`a[data-location="${source.location_code}"]`);
  check(
    (await text(field.locator(`a[data-location="${TARGET}"]`))).includes("Vacía"),
    "the list shows the new shelf, empty",
  );
  await layout(field, "list");
  await field.fill("#codigo", source.location_code.toLowerCase());
  await field.click('main form button:has-text("Abrir")');
  await field.waitForURL((u) => new URL(u).pathname === "/bodega/ubicacion");
  const item = () => field.locator(`li[data-sku="${notebook.sku_code}"]`);
  await item().waitFor();
  const numbers = await text(item().locator("dl"));
  log("on the shelf:", numbers);
  check(
    numbers.includes(`En el estante ${source.quantity}`) &&
      numbers.includes(`Libres ${source.free}`),
    "the shelf shows the notebook with its units and the free ones",
  );
  check((await text(item())).includes("de Tienda Sendero"), "the shelf says whose units they are");

  // ── 2. A move: refused above what is free (kept), then three units ──────────
  await item().locator("summary", { hasText: "Mover" }).click();
  await item()
    .locator('input[name="quantity"]')
    .fill(String(source.free + 5));
  await item().locator('select[name="toLocationId"]').selectOption({ label: TARGET });
  await item().locator('button:has-text("Mover las unidades")').click();
  await item().locator('[role="alert"]').waitFor();
  const refusal = await text(item().locator('[role="alert"]'));
  log("refused:", refusal);
  check(
    refusal.includes("más unidades de las que están libres"),
    "a move above the free units is refused in words",
  );
  check(
    (await item().locator('input[name="quantity"]').inputValue()) === String(source.free + 5) &&
      (await item().locator('select[name="toLocationId"] option:checked').innerText()) === TARGET,
    "the refused move keeps what was typed",
  );
  await layout(field, "move-refused");
  await item().locator('input[name="quantity"]').fill("3");
  await item().locator('button:has-text("Mover las unidades")').click();
  const moved = await outcome("Se movieron 3 unidades");
  log("moved:", moved);
  check(
    moved.includes(`Se movieron 3 unidades a ${TARGET}. Guárdelas allí ahora.`),
    "the move is confirmed",
  );
  check(
    (await text(item().locator("dl"))).includes(`En el estante ${source.quantity - 3}`),
    "the source shelf shows three fewer",
  );

  // One more, to a shelf that operations switch off while the form is open:
  // refused, and the choice of shelf goes back to empty, never to another one.
  if (!(await item().locator("details:has(select[name='toLocationId'])").getAttribute("open"))) {
    await item().locator("summary", { hasText: "Mover" }).click();
  }
  await item().locator('input[name="quantity"]').fill("1");
  await item().locator('select[name="toLocationId"]').selectOption({ label: SWITCHED_OFF });
  const [switched] = await rpcAs("central@yuntera.example", [
    ["ops_set_location_active", { p_location_id: other.id, p_active: false }],
  ]);
  check(switched?.active === false, "operations switched the shelf off");
  await item().locator('button:has-text("Mover las unidades")').click();
  await item().locator('[role="alert"]').waitFor();
  await field.waitForLoadState("networkidle");
  const offRefusal = await text(item().locator('[role="alert"]'));
  log("refused (switched off):", offRefusal);
  check(offRefusal.includes("está desactivada"), "a move to a switched-off shelf is refused");
  const kept = await item()
    .locator('select[name="toLocationId"]')
    .evaluate((el) => ({ value: el.value, options: [...el.options].map((o) => o.text) }));
  log("after the refusal, the select:", JSON.stringify(kept));
  check(
    kept.value === "" && !kept.options.includes(SWITCHED_OFF),
    "the switched-off shelf leaves the choice and nothing else is chosen",
  );
  check(
    (await item().locator('input[name="quantity"]').inputValue()) === "1",
    "the refused move keeps the quantity",
  );
  check(
    (await field.locator('main [role="status"]', { hasText: "Unidades movidas" }).count()) === 0 &&
      !/[?&]movidas=/.test(new URL(field.url()).search),
    "the earlier confirmation is not shown next to the refusal",
  );
  await layout(field, "move-refused-switched-off");
  // Pressed again without choosing: the browser asks for a shelf, nothing moves.
  await item().locator('button:has-text("Mover las unidades")').click();
  await field.waitForTimeout(500);
  check(
    (await item()
      .locator('select[name="toLocationId"]')
      .evaluate((el) => el.validity.valueMissing)) &&
      (await text(item().locator("dl"))).includes(`En el estante ${source.quantity - 3}`),
    "with no shelf chosen, the form asks for one and nothing is moved",
  );
  await item().locator('select[name="toLocationId"]').selectOption({ label: TARGET });
  await item().locator('button:has-text("Mover las unidades")').click();
  const movedOne = await outcome("Se movió 1 unidad");
  log("moved one:", movedOne);
  check(
    movedOne.includes(`Se movió 1 unidad a ${TARGET}. Guárdela allí ahora.`),
    "one unit: the confirmation agrees with the number",
  );
  await field.reload({ waitUntil: "networkidle" });
  check(
    (await field.locator('main [role="status"]', { hasText: "Unidades movidas" }).count()) === 0,
    "a reload does not show the confirmation again",
  );

  // ── 3. The new shelf, from the list: a count ───────────────────────────────
  await field.goto(FIELD + "/bodega/ubicaciones", { waitUntil: "networkidle" });
  check(
    (await text(field.locator(`a[data-location="${TARGET}"]`))).includes("4 unidades"),
    "the list shows the new shelf holding four",
  );
  await field.click(`a[data-location="${TARGET}"]`);
  await field.waitForURL((u) => new URL(u).searchParams.get("codigo") === TARGET);
  await item().waitFor();
  check((await text(item().locator("dl"))).includes("En el estante 4"), "the new shelf holds four");
  await item().locator("summary", { hasText: "Corregir cantidad" }).click();
  await item().locator('input[name="counted"]').fill("3");
  const difference = await text(item().locator('[data-testid="count-difference"]'));
  log("before confirming:", difference);
  check(
    difference.includes("Diferencia: −1 unidad (faltan). Quedarán 3 unidades."),
    "the difference is shown before confirming",
  );
  check(
    (await text(item().locator('button:has-text("Corregir a")'))) === "Corregir a 3 unidades",
    "the button says what it will do",
  );
  await item().locator('details[open] input[name="note"]').fill("rota");
  await item().locator('button:has-text("Corregir a")').click();
  await item().locator('[role="alert"]').waitFor();
  check(
    (await text(item().locator('[role="alert"]'))).includes("al menos 5 letras"),
    "a reason too short is refused",
  );
  check(
    (await item().locator('input[name="counted"]').inputValue()) === "3" &&
      (await item().locator('details[open] input[name="note"]').inputValue()) === "rota",
    "the refused count keeps what was typed",
  );
  await layout(field, "count-refused");
  await item().locator('details[open] input[name="note"]').fill("Una libreta con la tapa rota");
  await item().locator('button:has-text("Corregir a")').click();
  const corrected = await outcome("Ahora hay 3 unidades");
  log("corrected:", corrected);
  check(corrected.includes("Ahora hay 3 unidades (−1)"), "the correction is confirmed");
  check((await text(item().locator("dl"))).includes("En el estante 3"), "the shelf shows three");
  // Two more found behind a box: a correction upwards.
  if (!(await item().locator("details:has(input[name='counted'])").getAttribute("open"))) {
    await item().locator("summary", { hasText: "Corregir cantidad" }).click();
  }
  await item().locator('input[name="counted"]').fill("5");
  check(
    (await text(item().locator('[data-testid="count-difference"]'))).includes(
      "Diferencia: +2 unidades (sobran). Quedarán 5 unidades.",
    ),
    "the difference upwards is shown before confirming",
  );
  await item().locator('details[open] input[name="note"]').fill("Dos libretas detrás de una caja");
  await item().locator('button:has-text("Corregir a")').click();
  const raised = await outcome("Ahora hay 5 unidades");
  log("corrected up:", raised);
  check(raised.includes("Ahora hay 5 unidades (+2)"), "the correction upwards is confirmed");
  check((await text(item().locator("dl"))).includes("En el estante 5"), "the shelf shows five");
  await layout(field, "location");

  // ── 4. The product's locations ─────────────────────────────────────────────
  await item().locator('a:has-text("Ver en qué ubicaciones está")').click();
  await field.waitForURL((u) => new URL(u).pathname === "/bodega/buscar");
  const found = field.locator("main section:visible").filter({ hasText: notebook.sku_code });
  await found.first().waitFor();
  const bins = await text(found.first());
  log("the product's locations:", bins.slice(0, 300));
  check(
    bins.includes(`${source.location_code}`) &&
      bins.includes(`${TARGET}`) &&
      bins.includes(`Total en bodega: ${source.quantity + 1} unidades`),
    "the product lists both shelves",
  );
  await layout(field, "product");

  // ── 5. The shop: the correction with its reason, never the move ───────────
  const seller = await phone();
  await signIn(seller, SELLER, "sendero@yuntera.example");
  await seller.goto(SELLER + "/inventario", { waitUntil: "networkidle" });
  await seller.waitForSelector("#historial");
  const history = seller.locator('section[aria-labelledby="historial"] li');
  const first = await text(history.first());
  const second = await text(history.nth(1));
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
  const allHistory = await text(seller.locator('section[aria-labelledby="historial"]'));
  check(!/Kattia|bodega@|Y-93-01-A/.test(allHistory), "the shop never sees who, nor the shelves");
  check(
    (await history.count()) ===
      (await seller.locator('section[aria-labelledby="historial"] li[data-kind]').count()) &&
      !allHistory.includes("+0") &&
      !allHistory.includes("−0"),
    "no move in the shop's history",
  );
  const [stockAfter] = await rpcAs("sendero@yuntera.example", [
    ["seller_stock", { p_seller_id: shop.id }],
  ]);
  const after = stockAfter.find(
    (row) => row.sku_id === notebook.sku_id && row.warehouse_kind === "platform",
  );
  check(after.on_hand === notebook.on_hand + 1, "the shop holds exactly one unit more");
  const row = seller
    .locator('section[aria-labelledby="bodega"] tr')
    .filter({ hasText: notebook.sku_code });
  const cells = await row.first().locator("td").allInnerTexts();
  log("the shop's row:", JSON.stringify(cells));
  check(
    cells[2]?.trim() === String(after.on_hand) && cells[4]?.trim() === String(after.available),
    "the seller centre shows the new total on the product's own row",
  );
  await layout(seller, "seller");

  // ── 6. The console: the staff list; a shelf with stock is emptied first ───
  const ops = await phone();
  await signIn(ops, OPS, "central@yuntera.example");
  await ops.goto(OPS + "/operacion/ubicaciones", { waitUntil: "networkidle" });
  const changes = ops.locator("section[aria-labelledby='movimientos'] li");
  const move = await text(
    changes.filter({ hasText: `3 unidades de ${source.location_code} a ${TARGET}` }).first(),
  );
  const correction = await text(
    changes.filter({ hasText: "Corrección" }).filter({ hasText: "−1 unidad" }).first(),
  );
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
  const shelf = () => ops.locator(`li[data-location="${TARGET}"]`);
  await shelf().locator("summary", { hasText: "Desactivar" }).click();
  check(
    (await text(shelf().locator("details[open]"))).includes("primero hay que vaciarla"),
    "the console says how to empty a shelf before switching it off",
  );
  await shelf().locator('button:has-text("Desactivar la ubicación")').click();
  await ops.waitForSelector(`li[data-location="${TARGET}"] [role="alert"]`);
  const refused = await text(shelf().locator('[role="alert"]'));
  log("switch-off refused:", refused);
  check(
    refused.includes("vacíela primero") && refused.includes("Mover"),
    "the refusal says how to empty it",
  );
  await layout(ops, "console");

  // A count typed on a stale page: while the worker counts the new shelf, a
  // colleague moves its five units back. The count is refused, and because the
  // product has left the shelf (its row and form go), the refusal is shown at
  // the top of the page: nothing was corrected, look again.
  await field.goto(`${FIELD}/bodega/ubicacion?codigo=${TARGET}`, { waitUntil: "networkidle" });
  await item().locator("summary", { hasText: "Corregir cantidad" }).click();
  await item().locator('input[name="counted"]').fill("7");
  await item().locator('details[open] input[name="note"]').fill("Dos más en otra caja");
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
  await item().locator('button:has-text("Corregir a")').click();
  const gone = field.locator('main [role="alert"]', { hasText: "Ya no está en esta ubicación" });
  await gone.waitFor();
  await field.waitForFunction(() => !/[?&](sin|accion)=/.test(window.location.search));
  await field.waitForLoadState("networkidle");
  const goneText = await text(gone);
  log("stale count:", goneText);
  check(
    goneText.includes(`No se corrigió nada: el producto ${notebook.sku_code} ya no está`) &&
      goneText.includes("Revise la ubicación y vuelva a contar"),
    "a count whose product left the shelf says at the top that nothing was corrected",
  );
  check(
    (await text(field.locator('[data-testid="location-summary"]'))).includes("Está vacía") &&
      (await item().count()) === 0,
    "the new shelf is empty again, as the database says",
  );
  await layout(field, "count-refused-gone");
  await ops.goto(OPS + "/operacion/ubicaciones", { waitUntil: "networkidle" });
  await shelf().locator("summary", { hasText: "Desactivar" }).click();
  await shelf().locator('button:has-text("Desactivar la ubicación")').click();
  await ops.waitForSelector(`li[data-location="${TARGET}"] >> text=Desactivada`);
  check(true, "the emptied shelf is switched off");
  await field.goto(FIELD + "/bodega/ubicaciones", { waitUntil: "networkidle" });
  check(
    (await field.locator(`a[data-location="${TARGET}"]`).count()) === 0,
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
