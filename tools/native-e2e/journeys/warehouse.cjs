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
// Fails on any console error, uncaught exception or 5xx.

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
    out.push(await response.json());
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
  await rpcAs("vendedor@yuntera.example", [
    [
      "seller_create_inbound",
      {
        p_warehouse_id: locations.platform[0].id,
        p_seller_id: tecno.id,
        p_lines: [{ sku_id: listings[0].sku_id, quantity: 12 }],
      },
    ],
  ]);

  const browser = await chromium.launch();
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const page = await context.newPage();
  page.on("console", (m) => {
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
    page.screenshot({ path: `${SHOTS}/native-warehouse-${name}.png`, fullPage: true });

  // ── Sign in and the board ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await byId("sign-in-email").fill("bodega@yuntera.example");
  await byId("sign-in-password").fill(PASSWORD);
  await byId("sign-in-submit").click();
  await byId("warehouse-board").waitFor();
  const board = await textOf("warehouse-board");
  log("   ", board.slice(0, 200));
  check(/Pedidos \(\d+ por hacer\)/.test(board), "the board counts the parcels to do");
  check(/Mercadería por recibir \(1\)/.test(board), "and lists the stock a seller announced");
  check(/Por alistar/.test(board), "a parcel waits to be picked, its state in words");
  await noSideways("board");
  await shot("01-board");

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
  check(
    (await page.getByTestId("lookup-camera").count()) +
      (await page.getByText(/linterna/).count()) ===
      0,
    "the web export shows no camera",
  );
  await byId("start-picking").click();
  await byId("pick-current").waitFor();
  const lines = await page.getByTestId("pick-line").count();
  check(
    (await textOf("pick-progress")) ===
      `0 de ${lines} ${lines === 1 ? "línea lista" : "líneas listas"}`,
    `picking started: the count is on screen (0 de ${lines})`,
  );
  check(await byId("pick-input").isVisible(), "the typing path is there without a camera");
  check((await focusedId()) === "pick-input", "the scan field has the focus, ready for a scanner");
  await noSideways("pick list");
  await shot("02-pick-start");

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
  await shot("03-pick-wrong");

  for (let i = 0; i < lines; i++) {
    const location = await textOf("pick-location");
    const sku = /^(\S+)/.exec(await textOf("pick-codes"))[1];
    if (i === 0) {
      // Typed by hand, sent with the button.
      await byId("pick-input").fill(sku.toLowerCase());
      await byId("pick-submit").click();
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
      `line ${i + 1} (${location}, ${sku}) confirmed ${i === 0 ? "typed" : "as a scanner sends it"}: ${done}`,
    );
    if (i === 0) await shot("04-pick-line-done");
  }
  await byId("pack-submit").waitFor();
  check(
    (await textOf("pick-progress")).startsWith(`${lines} de ${lines}`),
    "every line is picked; packing opens",
  );
  await shot("05-pick-all");

  // ── Pack ──
  await byId("pack-submit").click();
  await byId("packed").waitFor();
  const packed = await textOf("packed");
  log("   ", packed);
  check(
    /zona de despacho/.test(packed) && packed.includes(tracking),
    "packed: take it to dispatch",
  );
  await shot("06-packed");

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
  await page.keyboard.type(inboundSku, { delay: 5 });
  await page.keyboard.press("Enter");
  await page.getByText("12 unidades por recibir").first().waitFor();
  check(true, "scanning the product finds its line");
  await byId("receive-good").fill("10");
  await byId("receive-damaged").fill("1");
  await noSideways("receiving");
  await shot("07-receive");
  await byId("receive-submit").click();
  await byId("receive-result").waitFor();
  const received = await textOf("receive-result");
  log("   ", received);
  check(
    /Recepción registrada: 10 buenas y 1 dañada/.test(received),
    "received 10 good and 1 damaged",
  );
  const bin = /guardadas en (\S+)\./.exec(received)[1];
  await page.getByText("esperadas 12 · recibidas 10 · dañadas 1").first().waitFor();
  check(true, "the line now reads 10 received and 1 damaged");
  await shot("08-received");

  // ── Stock lookup ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await byId("open-lookup").click();
  await byId("lookup-input").waitFor();
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
  await shot("09-lookup");
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
  await shot("10-lookup-unknown");

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
