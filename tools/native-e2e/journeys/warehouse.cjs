// Yuntera Bodega (the warehouse app), web export, at phone size.
//
// The warehouse lead signs in and sees the board; opens a parcel and starts
// picking; a wrong code is refused; the right codes are entered typed (and
// sent with the button) and as a hand scanner sends them (characters, then
// Enter, into the field that kept its focus); the parcel is packed; a line of
// stock a seller announced is received after scanning it; and a product is
// looked up by its code. The web export has no camera, so the scan screens
// must offer the typing path, and they must not show a camera at all.
//
// Also checked: a refused scan is answered where the worker is looking, even
// on a small phone (375 x 667); a code typed while the last one is still being
// checked is not lost; a hand scanner that fires while the "Tomó" field has the
// focus still confirms the line; a quantity error keeps the scanned code; a
// UPC-A scanned in the 13-digit form iOS reports finds its inbound line; a count
// above what was announced is refused with the reason (the database takes no
// more than the seller announced) and nothing is sent; a count that a second
// phone already made is refused by the database with its own words; a parcel
// that came back after a failed delivery is checked in (its condition chosen
// by the worker, nothing pre-selected); and signing out leaves no record of
// the worker on the phone.
//
// Fails on any console error, uncaught exception or 5xx.

const { spawnSync } = require("node:child_process");
const { chromium, request } = require("playwright");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const BASE = process.env.NATIVE_WAREHOUSE_URL || "http://127.0.0.1:3013";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
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
  // A seller announces 12 units for the warehouse, as on the web's journey.
  const [roles] = await rpcAs("vendedor@yuntera.example", [["my_roles", {}]]);
  const tecno = roles.sellers.find((seller) => seller.slug === "tecnocasa");
  const [locations, listings] = await rpcAs("vendedor@yuntera.example", [
    ["seller_locations", { p_seller_id: tecno.id }],
    ["seller_listings", { p_seller_id: tecno.id }],
  ]);
  const curridabat = locations.platform[0].id;
  await rpcAs("vendedor@yuntera.example", [
    [
      "seller_create_inbound",
      {
        p_warehouse_id: curridabat,
        p_seller_id: tecno.id,
        p_lines: [{ sku_id: listings[0].sku_id, quantity: 12 }],
      },
    ],
  ]);

  // A card parcel of route R-1003 fails at the door and Central sends it back
  // to the warehouse, as in the web's money-and-returns journey.
  const [day] = await rpcAs("repartidor@yuntera.example", [["driver_today", {}]]);
  const cardStop = day.routes
    .find((route) => route.code === "R-1003")
    .stops.find((stop) => stop.status === "pending" && stop.cod_amount_minor === 0);
  await rpcAs("repartidor@yuntera.example", [
    ["driver_fail_stop", { p_stop_id: cardStop.stop_id, p_reason: "nobody_home" }],
  ]);
  // The parcel's id, from its shopper's order (the driver's day does not carry it).
  let failedId = null;
  for (const email of ["comprador@", "comprador2@", "comprador3@"]) {
    const [orders] = await rpcAs(`${email}yuntera.example`, [["my_orders", {}]]);
    const details = await rpcAs(
      `${email}yuntera.example`,
      orders.map((order) => ["get_order", { p_order_number: order.order_number }]),
    );
    const shipment = details
      .flatMap((detail) => detail.shipments ?? [])
      .find((s) => s.tracking_code === cardStop.tracking_code);
    if (shipment) {
      failedId = shipment.id;
      break;
    }
  }
  if (!failedId) throw new Error(`no order holds ${cardStop.tracking_code}`);
  const [, returningBefore] = await rpcAs("central@yuntera.example", [
    ["ops_return_shipment", { p_shipment_id: failedId }],
    ["wms_returning_shipments", { p_warehouse_id: curridabat }],
  ]);
  const back = cardStop.tracking_code;

  // A second platform warehouse, so the lead has two to choose from. The API
  // has no function that creates a warehouse (they are set up once, by hand),
  // so this one row goes straight into the lane's database; the assignment
  // then goes through the API as operations staff.
  const database = process.env.DATABASE_URL;
  if (!database) throw new Error("DATABASE_URL is not set (run through tools/dev/stack.sh)");
  const sql = (statement) => {
    const run = spawnSync(
      "psql",
      [database, "-X", "-q", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement],
      { encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
    return run.stdout.trim();
  };
  const liberia = sql(
    "insert into public.warehouses (code, name, kind, address, postal_code, lat, lng) " +
      "values ('LIB1', 'Centro de distribución Liberia', 'platform', " +
      "'Liberia, 200 m norte del parque', '50101', 10.6346, -85.4407) returning id",
  );
  // The announced product carries a UPC-A, as stored by the seller; the dock
  // scans it in the 13-digit form an iPhone reports (0 + the 12 digits). The
  // seed has no barcodes, and the seller's API sets them only on new products.
  const UPC_A = "036000291452";
  sql(`update public.skus set gtin = '${UPC_A}' where id = '${listings[0].sku_id}'`);
  await rpcAs("central@yuntera.example", [
    [
      "ops_set_warehouse_staff",
      { p_warehouse_id: liberia, p_email: "bodega@yuntera.example", p_role: "associate" },
    ],
  ]);

  const browser = await chromium.launch();
  const errors = [];
  let dbRefusal = false;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    // The database's refusal of a count another phone already made (a 400).
    if (dbRefusal && /status of 400/.test(m.text())) return;
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const byId = (id) => page.getByTestId(id).first();
  const textOf = async (id) => squash(await byId(id).innerText());
  const noSideways = async (where) =>
    check(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      `no sideways scrolling at 390 px: ${where}`,
    );
  const focusedId = () =>
    page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  const shot = (name) =>
    page.screenshot({ path: `${SHOTS}/native-warehouse-flow-${name}.png`, fullPage: true });

  // ── Sign in and the board ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await byId("sign-in-email").fill("bodega@yuntera.example");
  await byId("sign-in-password").fill(PASSWORD);
  await byId("sign-in-submit").click();
  await byId("warehouse-board").waitFor();

  // ── Choosing the warehouse ──
  // Assigned to two: the lead chooses, and the choice outlasts a reload.
  const title = (name) => page.getByRole("heading", { name, exact: true }).first();
  check(
    await byId("warehouse-choice").isVisible(),
    "assigned to two warehouses: a choice is offered",
  );
  await byId(`warehouse-choice-${liberia}`).click();
  await title("Centro de distribución Liberia").waitFor();
  await page.getByText("No hay pedidos en el piso ahora.").first().waitFor();
  check(true, "choosing the other warehouse shows its board");
  await shot("01-other-warehouse");
  await page.reload({ waitUntil: "networkidle" });
  await byId("warehouse-board").waitFor();
  check(
    await title("Centro de distribución Liberia").isVisible(),
    "and the choice is kept after a reload",
  );
  await byId(`warehouse-choice-${curridabat}`).click();
  await title("Centro de distribución Curridabat").waitFor();
  // Both choices survive a reload, whichever of the two the app would start on.
  await page.reload({ waitUntil: "networkidle" });
  await byId("warehouse-board").waitFor();
  check(
    await title("Centro de distribución Curridabat").isVisible(),
    "and so does choosing Curridabat again",
  );
  await page
    .getByText(/Mercadería por recibir \(1\)/)
    .first()
    .waitFor();
  const board = await textOf("warehouse-board");
  log("   ", board.slice(0, 200));
  check(
    /Pedidos \(\d+ por hacer\)/.test(board),
    "back in Curridabat, the board counts the parcels to do",
  );
  check(/Mercadería por recibir \(1\)/.test(board), "and lists the stock a seller announced");
  check(/Por alistar/.test(board), "a parcel waits to be picked, its state in words");
  await noSideways("board");
  await shot("02-board");

  // ── Pick list ──
  // A parcel with more than one line, so both ways of entering a code are used.
  const pending = page.getByTestId("shipment-pending");
  let row = pending.first();
  for (let i = 0; i < (await pending.count()); i++) {
    if (/en [2-9] líneas/.test(await pending.nth(i).innerText())) {
      row = pending.nth(i);
      break;
    }
  }
  await row.click();
  await byId("start-picking").waitFor();
  const tracking = await textOf("shipment-title");
  check(/^[A-Z0-9-]+$/.test(tracking), `the parcel opens: ${tracking}`);
  const noCamera = async (prefix) =>
    (await page.getByTestId(`${prefix}-camera`).count()) +
      (await page.getByTestId(`${prefix}-camera-ask`).count()) +
      (await page.getByText(/linterna|Permitir la cámara/).count()) ===
    0;
  await byId("start-picking").click();
  await byId("pick-current").waitFor();
  check(await noCamera("pick"), "the web export shows no camera, nor asks for one");
  const lines = await page.getByTestId("pick-line").count();
  check(
    (await textOf("pick-progress")) ===
      `0 de ${lines} ${lines === 1 ? "línea lista" : "líneas listas"}`,
    `picking started: the count is on screen (0 de ${lines})`,
  );
  check(await byId("pick-input").isVisible(), "the typing path is there without a camera");
  check((await focusedId()) === "pick-input", "the scan field has the focus, ready for a scanner");
  await noSideways("pick list");
  await shot("03-pick-start");

  // A wrong product is refused, and nothing is confirmed.
  await byId("pick-input").fill("YT-NOPE0000");
  await byId("pick-submit").click();
  await page.getByText("Ese código no es el de este producto").first().waitFor();
  log("    wrong code:", await textOf("pick-feedback"));
  check(
    /Código leído: YT-NOPE0000/.test(await textOf("pick-feedback")),
    "a wrong code is refused, and the screen says which code it read",
  );
  check((await textOf("pick-progress")).startsWith("0 de"), "and no line was confirmed");
  const answerAbove = async () => {
    const answer = await byId("pick-feedback").boundingBox();
    const field = await byId("pick-input").boundingBox();
    return answer.y + answer.height <= field.y;
  };
  check(await answerAbove(), "the answer is shown above the scan field, where the eye is");
  await shot("04-pick-wrong");
  // On a small phone the answer is still on screen, not under the button or the count.
  await page.setViewportSize({ width: 375, height: 667 });
  await byId("pick-input").fill("YT-OTRO0000");
  await page.keyboard.press("Enter");
  await page.getByText("Código leído: YT-OTRO0000").first().waitFor();
  const small = await byId("pick-feedback").boundingBox();
  const footer = await byId("pick-progress").boundingBox();
  check(
    small.y >= 0 && small.y + small.height <= footer.y,
    `at 375 x 667 the refusal is in view, above the count (${Math.round(small.y)}–${Math.round(
      small.y + small.height,
    )} px, count at ${Math.round(footer.y)} px)`,
  );
  await page.screenshot({ path: `${SHOTS}/native-warehouse-flow-04b-pick-wrong-small.png` });
  await page.setViewportSize({ width: 390, height: 844 });

  for (let i = 0; i < lines; i++) {
    const location = await textOf("pick-location");
    const sku = /^(\S+)/.exec(await textOf("pick-codes"))[1];
    if (i === 0) {
      // A count above what the line asks is refused, and the code stays for the retry.
      const asked = await byId("pick-quantity").inputValue();
      await byId("pick-quantity").fill("999");
      await byId("pick-input").fill(sku.toLowerCase());
      await byId("pick-submit").click();
      await page.getByText("Escriba cuántas unidades tomó.").first().waitFor();
      check(
        (await byId("pick-input").inputValue()) === sku &&
          (await textOf("pick-progress")).startsWith("0 de"),
        "a wrong count is refused, and the scanned code is kept for the retry",
      );
      // Typed by hand, sent with the button.
      await byId("pick-quantity").fill(asked);
      await byId("pick-submit").click();
    } else if (i === 1) {
      // The worker edits "Tomó" (focus is now there), then the hand scanner fires.
      const asked = await byId("pick-quantity").inputValue();
      await byId("pick-quantity").click();
      await byId("pick-quantity").fill("");
      await page.keyboard.type(asked);
      check((await focusedId()) === "pick-quantity", `line ${i + 1}: "Tomó" has the focus`);
      await page.keyboard.type(sku, { delay: 5 });
      await page.keyboard.press("Enter");
    } else {
      // A hand scanner: characters typed fast into the focused field, then Enter.
      check((await focusedId()) === "pick-input", `line ${i + 1}: the field kept its focus`);
      await page.keyboard.type(sku, { delay: 5 });
      await page.keyboard.press("Enter");
    }
    const done = `${i + 1} de ${lines}`;
    await page.waitForFunction(
      (text) =>
        document.querySelector('[data-testid="pick-progress"]')?.textContent?.startsWith(text),
      done,
    );
    check(
      true,
      `line ${i + 1} (${location}, ${sku}) confirmed ${
        i === 0 ? "typed" : i === 1 ? "by a scanner firing into Tomó" : "as a scanner sends it"
      }: ${done}`,
    );
    if (i === 0) await shot("05-pick-line-done");
  }
  await byId("pack-submit").waitFor();
  check(
    (await textOf("pick-progress")).startsWith(`${lines} de ${lines}`),
    "every line is picked; packing opens",
  );
  await shot("06-pick-all");

  // ── Pack ──
  await byId("pack-submit").click();
  await byId("packed").waitFor();
  const packed = await textOf("packed");
  log("   ", packed);
  check(
    /zona de despacho/.test(packed) && packed.includes(tracking),
    "packed: take it to dispatch",
  );
  await shot("07-packed");

  // ── Receive ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await byId("warehouse-board").waitFor();
  check(
    new RegExp(`${tracking}.*Empacado`).test(await textOf("warehouse-board")),
    "the board shows the parcel as packed",
  );
  await byId("inbound-row").click();
  await byId("receive-scan-input").waitFor();
  const line = await textOf("receive-line-selected");
  log("   ", line.slice(0, 160));
  const inboundSku = /(YT-[A-Z0-9]+) · esperadas 12 · recibidas 0/.exec(line)[1];
  check(Boolean(inboundSku), "the expected line is open: 12 expected, none received");
  await byId("receive-scan-input").click();
  await page.keyboard.type(`0${UPC_A}`, { delay: 5 });
  await page.keyboard.press("Enter");
  await page.getByText("12 unidades por recibir").first().waitFor();
  check(true, "scanning the product's UPC-A as an iPhone reports it finds its line");
  // A slip at the dock: 120 for 12. The database takes no more than the
  // seller announced, so the app says so and sends nothing.
  let receiveCalls = 0;
  const countReceive = (r) => {
    if (r.url().includes("/rpc/wms_receive")) receiveCalls++;
  };
  page.on("request", countReceive);
  await byId("receive-good").fill("120");
  await byId("receive-submit").click();
  await byId("receive-error").waitFor();
  const over = await textOf("receive-error");
  log("   ", over);
  check(
    /108 unidades más de las que faltan por recibir \(faltan 12\)/.test(over) &&
      /No se puede recibir más de lo que el vendedor anunció/.test(over) &&
      /anunciar otro ingreso/.test(over) &&
      receiveCalls === 0,
    "a count above what was announced is refused with the reason and what to do, and nothing is sent",
  );
  check(
    (await page.getByTestId("receive-surplus-confirm").count()) === 0,
    "and there is no way to confirm it anyway",
  );
  await shot("08a-receive-over");
  await byId("receive-good").fill("10");
  await byId("receive-damaged").fill("1");
  await noSideways("receiving");
  await shot("08-receive");
  await byId("receive-submit").click();
  await byId("receive-result").waitFor();
  const received = await textOf("receive-result");
  log("   ", received);
  check(
    /Recepción registrada: 10 buenas y 1 dañada/.test(received),
    "received 10 good and 1 damaged",
  );
  check(receiveCalls === 1, "and only that count was sent");
  page.off("request", countReceive);
  const bin = /guardadas en (\S+)\./.exec(received)[1];
  await page.getByText("esperadas 12 · recibidas 10 · dañadas 1").first().waitFor();
  check(true, "the line now reads 10 received and 1 damaged");
  await shot("09-received");

  // Two phones on one line: the other one counts the last unit first. This
  // screen still shows 1 to receive; the database refuses the count, the app
  // says why in Spanish and reads the line again.
  const [floor, bins] = await rpcAs("bodega@yuntera.example", [
    ["wms_board", { p_warehouse_id: curridabat }],
    ["wms_locations", { p_warehouse_id: curridabat }],
  ]);
  const lastLine = (floor.inbound ?? [])
    .flatMap((inbound) => inbound.lines ?? [])
    .find((l) => l.sku_code === inboundSku && l.expected === 12 && l.received === 10);
  check(Boolean(lastLine), "the line has one unit left to receive");
  await rpcAs("bodega@yuntera.example", [
    [
      "wms_receive",
      {
        p_inbound_line_id: lastLine.line_id,
        p_good_quantity: 1,
        p_damaged_quantity: 0,
        p_location_id: bins.find((b) => b.code === bin).id,
      },
    ],
  ]);
  check(true, "another phone counts that last unit");
  page.on("request", countReceive);
  receiveCalls = 0;
  dbRefusal = true;
  await byId("receive-good").fill("1");
  await byId("receive-damaged").fill("0");
  await byId("receive-submit").click();
  await byId("receive-refused").waitFor();
  const stale = await textOf("receive-refused");
  log("   ", stale);
  check(
    receiveCalls === 1 &&
      /(ya se recibió completa|ya se cerró)/.test(stale) &&
      !/[a-z]+_[a-z_]+/.test(stale),
    "the database refuses a second count of a finished line, in Spanish, with no code shown",
  );
  page.off("request", countReceive);
  dbRefusal = false;
  await shot("09b-received-twice");

  // ── A parcel that came back undelivered ──
  check(
    returningBefore.some((parcel) => parcel.tracking_code === back),
    `a failed parcel (${back}) is on its way back to this warehouse`,
  );
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await byId("warehouse-board").waitFor();
  check(
    /Paquetes devueltos por recibir \(1\)/.test(await textOf("returning-heading")),
    "the board lists one parcel to check in",
  );
  check((await textOf("returned-row")).includes(back), "the parcel that came back");
  await byId("returned-row").click();
  await byId("returned-submit").waitFor();
  check(
    (await page.locator('[data-testid^="returned-condition-"][aria-checked="true"]').count()) === 0,
    "nothing is chosen for the worker",
  );
  await byId("returned-submit").click();
  check(
    /Indique en qué estado llegó el paquete/.test(await textOf("returned-error")),
    "the condition is asked for",
  );
  await byId("returned-condition-resellable").click();
  await byId("returned-note").fill("La caja venía cerrada.");
  await noSideways("returned parcel");
  await shot("09c-returned");
  await byId("returned-submit").click();
  await byId("returned-result").waitFor();
  const checkedIn = await textOf("returned-result");
  log("   ", checkedIn);
  check(
    /Paquete devuelto recibido/.test(checkedIn) && /zona de devoluciones/.test(checkedIn),
    "checked in: back on the shelf, and where to put it",
  );
  const [returningAfter] = await rpcAs("bodega@yuntera.example", [
    ["wms_returning_shipments", { p_warehouse_id: curridabat }],
  ]);
  check(
    !returningAfter.some((parcel) => parcel.tracking_code === back),
    "and it is no longer on its way back",
  );

  // ── Stock lookup ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await byId("open-lookup").click();
  await byId("lookup-input").waitFor();
  check(await noCamera("lookup"), "the lookup shows no camera either");
  check((await focusedId()) === "lookup-input", "the lookup field is ready for a scanner");
  await page.keyboard.type(inboundSku, { delay: 5 });
  await page.keyboard.press("Enter");
  await byId("lookup-result").waitFor();
  const found = await textOf("lookup-result");
  log("   ", found.slice(0, 200));
  check(
    /Total en bodega: \d+ unidades?/.test(found),
    "the lookup says which bins hold it and how many",
  );
  check(found.includes(bin), `including the units just put away in ${bin}`);
  await noSideways("lookup");
  await shot("10-lookup");
  await byId("lookup-input").fill("NOEXISTE");
  await page.keyboard.press("Enter");
  await page
    .getByText("No hay ningún producto con el código “NOEXISTE” en esta bodega.")
    .first()
    .waitFor();
  check(true, "an unknown code is answered plainly");
  check((await focusedId()) === "lookup-input", "and the field is ready for the next scan");
  await byId("lookup-input").fill("4006381333932");
  await page.keyboard.press("Enter");
  await page
    .getByText(/se haya leído o escrito mal/)
    .first()
    .waitFor();
  check(true, "a barcode with a wrong check digit is refused before it is sent");
  await shot("11-lookup-unknown");

  // A junk read is answered without repeating all of it.
  await byId("lookup-input").fill("X".repeat(300));
  await page.keyboard.press("Enter");
  await page
    .getByText(/demasiado largo/)
    .first()
    .waitFor();
  const echo = /Código leído: (\S+)/.exec(await textOf("lookup-feedback"))[1];
  check([...echo].length <= 40, `a too-long read is echoed cut short (${[...echo].length} chars)`);

  // Slow Wi-Fi: a second scan sent while the first is still being checked waits its turn.
  await page.route("**/rest/v1/rpc/wms_find_sku", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  const asked = [];
  const countFind = (r) => {
    if (r.url().includes("/rpc/wms_find_sku")) asked.push(JSON.parse(r.postData() || "{}").p_code);
  };
  page.on("request", countFind);
  await page.keyboard.type("YT-NOEXISTE1", { delay: 5 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  await page.keyboard.type(inboundSku, { delay: 5 });
  await page.keyboard.press("Enter");
  await page
    .getByText(/Este va después/)
    .first()
    .waitFor();
  check(true, "a scan sent during the check is told to wait, not dropped");
  await page.getByText(`Código leído: ${inboundSku}`).first().waitFor();
  await byId("lookup-result").waitFor();
  check(
    asked.includes("YT-NOEXISTE1") && asked.includes(inboundSku),
    "both scans were looked up, one after the other",
  );
  check(/Encontrado/.test(await textOf("lookup-feedback")), "and the second one is answered");
  page.off("request", countFind);
  await page.unroute("**/rest/v1/rpc/wms_find_sku");

  // ── Sign out on a shared phone ──
  const saved = () =>
    page.evaluate(() => {
      try {
        return window.localStorage.getItem("yuntera-bodega:warehouse");
      } catch {
        return "unreadable";
      }
    });
  const before = await saved();
  check(
    Boolean(before) && JSON.parse(before).warehouseId === curridabat,
    "the chosen warehouse is kept on the phone while signed in",
  );
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await byId("sign-out").click();
  await byId("sign-in-email").waitFor();
  await page.waitForFunction(
    () => window.localStorage.getItem("yuntera-bodega:warehouse") === null,
  );
  check(
    (await page.evaluate(() => Object.keys(window.localStorage))).every(
      (key) => !key.startsWith("yuntera-bodega:warehouse"),
    ),
    "signing out leaves no record of the worker's choice on the phone",
  );

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
