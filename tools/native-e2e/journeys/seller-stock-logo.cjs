// Yuntera Vende, the seller app (apps/seller-native): what the seller centre
// has and the app lacked until wave 7. Web export, at phone size, on a
// freshly seeded database. Tienda Sendero's owner works in the app.
//
//   1. Inventario shows "Historial de existencias" (seller_stock_history) in
//      the seller centre's words: after the warehouse corrects a count of
//      the shop's notebook with a reason, the app lists the correction, the
//      units with their sign, the warehouse and the reason, and never who in
//      the warehouse made it.
//   2. Cuenta withdraws a logo waiting for review (seller_withdraw_logo) and
//      removes the shop's current logo (seller_remove_logo, the tick box
//      first), with the seller centre's words; the database and the shop's
//      face follow. The logos are put in place through the API, the way the
//      seller centre uploads and the console publishes them (uploading stays
//      out of the app).
//
// Fails on any console error, uncaught exception or 5xx.

const { chromium, request } = require("playwright");
const { overflow, settledText, shows } = require("../lib/screen.cjs");
const seller = require("../lib/seller.cjs");

const BASE = process.env.NATIVE_SELLER_URL || "http://127.0.0.1:3011";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const OWNER = "sendero@yuntera.example";
const REASON = "Conteo de la prueba de la app";
const log = (...args) => console.log(...args);

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

/** Signs in through the API and calls database functions (and storage) as that person. */
async function as(email) {
  const ctx = await request.newContext();
  const token = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await token.json();
  const headers = { apikey: KEY, authorization: `Bearer ${access_token}` };
  const rpc = async (fn, args = {}) => {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, { headers, data: args });
    const body = r.status() === 204 ? null : await r.json().catch(() => null);
    if (r.status() >= 400)
      throw new Error(`${fn} as ${email}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  rpc.upload = async (bucket, path, bytes) => {
    const r = await ctx.post(`${API}/storage/v1/object/${bucket}/${path}`, {
      headers: { ...headers, "content-type": "image/jpeg" },
      data: bytes,
    });
    if (r.status() >= 400)
      throw new Error(`upload ${bucket} as ${email}: ${r.status()} ${await r.text()}`);
  };
  rpc.dispose = () => ctx.dispose();
  return rpc;
}

/** A logo of the shop's, uploaded and sent for review as the seller centre does; approved and published when asked. */
async function logoFor(owner, staff, shopId, jpeg, { publish }) {
  const reserved = await owner("seller_reserve_logo", { p_seller_id: shopId, p_format: "jpeg" });
  for (const file of reserved.files) await owner.upload(reserved.bucket, file.path, jpeg);
  await owner("seller_finish_logo", {
    p_seller_id: shopId,
    p_logo_id: reserved.logo_id,
    p_width: 600,
    p_height: 600,
  });
  if (!publish) return reserved.logo_id;
  await staff("ops_review_logo", { p_logo_id: reserved.logo_id, p_approve: true });
  for (const logo of await staff("ops_logo_files_to_publish", { p_logo_id: reserved.logo_id })) {
    for (const path of logo.paths) await staff.upload("product-photos", path, jpeg);
  }
  const confirmed = await staff("ops_confirm_logo_published", { p_logo_id: reserved.logo_id });
  if (confirmed.outcome !== "published")
    throw new Error(`logo not published: ${confirmed.outcome}`);
  return reserved.logo_id;
}

(async () => {
  const owner = await as(OWNER);
  const bodega = await as("bodega@yuntera.example");
  const central = await as("central@yuntera.example");
  const shopId = (await owner("my_roles")).sellers[0].id;

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    timezoneId: "America/Costa_Rica",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const visible = (id) => page.getByTestId(id).filter({ visible: true }).first();
  const said = async (id) => (await visible(id).innerText()).replace(/\s+/g, " ").trim();
  const shot = (name) =>
    page.screenshot({ path: `${SHOTS}/native-seller-stock-logo-${name}.png`, fullPage: true });
  const noSideways = async (where) =>
    check((await overflow(page)) <= 0, `${where}: no sideways scrolling at 390 px`);
  const tall = async (id, what) => {
    const box = await visible(id).boundingBox();
    check(box !== null && box.height >= 44, `${what} is at least 44 px high`);
  };

  // A real JPEG, drawn by the browser.
  await page.goto("about:blank");
  const jpeg = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 600;
      const g = canvas.getContext("2d");
      g.fillStyle = "#1f6f5c";
      g.fillRect(0, 0, 600, 600);
      return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
    }),
    "base64",
  );

  // ── 1. The warehouse corrects a count; the app's history shows it ─────────
  const notebook = (await owner("seller_listings", { p_seller_id: shopId })).find(
    (l) => l.product_slug === "libreta-tapa-dura-a5",
  );
  const warehouse = (await bodega("my_roles")).warehouses[0].id;
  const found = await bodega("wms_find_sku", {
    p_warehouse_id: warehouse,
    p_code: notebook.sku_code,
  });
  const bin = found.bins.find(
    (b) => b.seller_id === shopId && b.location_kind === "pick" && b.location_active,
  );
  await bodega("wms_adjust_stock", {
    p_location_id: bin.location_id,
    p_sku_id: found.sku_id,
    p_seller_id: shopId,
    p_delta: 2,
    p_note: REASON,
    p_expected: bin.quantity,
  });

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await visible("sign-in-email").fill(OWNER);
  await visible("sign-in-password").fill(PASSWORD);
  await visible("sign-in-submit").click();
  await seller.tabs.inventory(page).waitFor();
  await page.goto(`${BASE}/inventario`, { waitUntil: "networkidle" });
  await visible("stock-history").waitFor();
  const history = await said("stock-history");
  log("history:", history.slice(0, 400));
  check(
    history.startsWith("Historial de existencias") &&
      history.includes("Cada cambio en las unidades que usted tiene"),
    "the inventory tab shows the stock history, in the seller centre's words",
  );
  const entries = await owner("seller_stock_history", { p_seller_id: shopId, p_limit: 1 });
  const first = await said(`history-${entries[0].id}`);
  log("newest entry:", first);
  check(
    first.includes("Libreta") &&
      first.includes("+2 unidades") &&
      first.includes("Corrección de conteo de la bodega") &&
      first.includes(`Motivo: ${REASON}`),
    "the newest entry is the warehouse's correction, with its sign, kind and reason",
  );
  check(!/Kattia|bodega@/.test(history), "the history never says who in the warehouse did it");
  await noSideways("the stock history");
  await visible("stock-history").scrollIntoViewIfNeeded();
  await shot("01-stock-history");

  // ── 2. A logo waiting for review, withdrawn from the app ──────────────────
  await logoFor(owner, central, shopId, jpeg, { publish: true });
  await logoFor(owner, central, shopId, jpeg, { publish: false });
  await page.goto(`${BASE}/cuenta`, { waitUntil: "networkidle" });
  await visible("logo-withdraw").waitFor();
  check(
    (await said("logo-withdraw")) === "Retirar el logotipo en revisión" &&
      (await said("logo-remove")) === "Quitar el logotipo",
    "the account card offers both logo actions, in the seller centre's words",
  );
  await tall("logo-withdraw", "the withdraw button");
  await tall("logo-remove", "the remove button");
  await noSideways("the shop's logo actions");
  await shot("02-logo-actions");
  await visible("logo-withdraw").click();
  await shows(page, "logo-result", "Retiramos el logotipo que esperaba revisión.");
  await page.getByTestId("logo-withdraw").waitFor({ state: "detached" });
  let front = await owner("seller_shop_front", { p_seller_id: shopId });
  check(
    front.logo_waiting === null && front.logo !== null,
    "the waiting logo is withdrawn; the published one stays",
  );

  // ── 3. The current logo removed: the tick box first ───────────────────────
  await visible("logo-remove").click();
  check(
    (await said("logo-remove-result")) ===
      "Marque la casilla para confirmar que quiere quitar el logotipo.",
    "removing needs the tick box, in the seller centre's words",
  );
  check(
    (await owner("seller_shop_front", { p_seller_id: shopId })).logo !== null,
    "nothing is removed without the tick box",
  );
  await visible("logo-remove-confirm").click();
  await visible("logo-remove").click();
  await shows(page, "logo-result", "Quitamos el logotipo de su tienda.");
  await page.getByTestId("logo-remove").waitFor({ state: "detached" });
  front = await owner("seller_shop_front", { p_seller_id: shopId });
  check(front.logo === null, "the shop no longer shows a logo");
  check(
    Boolean(
      await settledText(visible("shop-face-logo"), /Sin logotipo/, { what: "the shop's card" }),
    ),
    "the card says the shop now shows its initial",
  );
  await shot("03-logo-removed");

  await owner.dispose();
  await bodega.dispose();
  await central.dispose();
  await browser.close();
  if (errors.length > 0) {
    console.error("ERRORS:", errors);
    process.exit(1);
  }
  log("\nThe seller stock-history and logo journey passed.");
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
