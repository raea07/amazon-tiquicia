// Status codes journey: pages that do not exist answer 404, existing ones are still
// served from the shop's cache, and no app shows an error page for a nonsense address.
//
// The first half needs no browser: it asks for pages over plain HTTP and reads the
// status, the headers and the page text. The second half signs in to each app and
// opens its id-taking pages with ids that cannot exist.
//
// Like every journey it runs on a freshly seeded database and fails when a step does
// not arrive where it should, when the browser logs an error, or on any 5xx.

const { chromium } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FIELD = process.env.FIELD_URL || "http://127.0.0.1:3003";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const REFRESH_KEY = process.env.SHOP_REFRESH_KEY || "";
const log = (...a) => console.log(...a);

const errors = [];
const expect = (condition, message) => {
  if (!condition) errors.push(message);
  return condition;
};

/** A page over plain HTTP: status, headers, text, and how long the whole answer took. */
async function get(path) {
  const started = performance.now();
  const response = await fetch(WEB + path, { redirect: "manual" });
  const text = await response.text();
  if (response.status >= 500) errors.push(`HTTP ${response.status} ${path}`);
  return {
    status: response.status,
    headers: response.headers,
    text,
    ms: Math.round(performance.now() - started),
  };
}

/** Calls API functions as a demo user, the way the apps do. */
async function rpcAs(email) {
  const token = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  }).then((r) => r.json());
  return async (fn, args = {}) => {
    const r = await fetch(`${API}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: KEY,
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`${fn}: ${r.status} ${body.slice(0, 200)}`);
    return body ? JSON.parse(body) : null;
  };
}

(async () => {
  // ── 1. Status codes ───────────────────────────────────────────────────────
  // The not-found screen as rendered markup. (Every page also carries its text
  // inside a script, as the template the browser would use; that does not count.)
  const NOT_FOUND_SCREEN = ">No encontramos esa página</h2>";
  const cases = [
    ["/", 200, "home"],
    ["/p/cafe-molido-tarrazu-340g", 200, "existing product"],
    ["/p/no-existe-este-producto", 404, "unknown product"],
    ["/c/hogar", 200, "existing category"],
    ["/c/no-existe", 404, "unknown category"],
    ["/p/lampara-mesa-bambu", 404, "product still awaiting review"],
    ["/p/Mal%20Formado", 404, "address that could never be a product"],
    ["/c/" + "a".repeat(200), 404, "absurdly long category address"],
    ["/buscar?q=cafe", 200, "search"],
    ["/ruta-que-no-existe", 404, "address no page answers"],
  ];
  for (const [path, expected, what] of cases) {
    const page = await get(path);
    log(`${String(page.status).padEnd(4)} ${what.padEnd(40)} ${path.slice(0, 44)}`);
    expect(page.status === expected, `${what}: expected ${expected}, got ${page.status} (${path})`);
    if (expected === 404) {
      expect(page.text.includes(NOT_FOUND_SCREEN), `${what}: the 404 has no not-found screen`);
      expect(page.text.includes("noindex"), `${what}: the 404 does not ask to stay out of indexes`);
    } else {
      expect(
        !page.text.includes(NOT_FOUND_SCREEN),
        `${what}: a 200 page shows the not-found screen`,
      );
    }
  }
  const product = await get("/p/cafe-molido-tarrazu-340g");
  expect(product.text.includes("Café molido"), "the existing product page has no product in it");
  expect(
    (await get("/c/hogar")).text.includes("Hogar y cocina"),
    "the existing category page has no category in it",
  );

  // ── 2. Existing pages are still prepared ahead and served from the cache ──
  // (a) The response starts from the shell built ahead of time.
  const prerender = product.headers.get("x-nextjs-prerender");
  const postponed = product.headers.get("x-nextjs-postponed");
  log("product page headers: x-nextjs-prerender =", prerender, "| x-nextjs-postponed =", postponed);
  expect(prerender === "1", "the product page is no longer served from a prerendered shell");

  // (b) A repeat visit does not read the database again. Proof: change the price in
  // the database without telling the shop; the page must still show the old price.
  const SLUG = "cafe-grano-tarrazu-1kg";
  const priceOn = (html) => /"price":"([0-9.]+)"/.exec(html)?.[1] ?? null;
  const refreshShop = (key) =>
    fetch(`${WEB}/api/catalogo/refrescar`, { method: "POST", headers: { "x-refresh-key": key } });
  await refreshShop(REFRESH_KEY);
  const first = await get(`/p/${SLUG}`);
  const before = priceOn(first.text);

  const seller = await rpcAs("cafetal@yuntera.example");
  const shop = (await seller("my_roles")).sellers[0];
  const listing = (await seller("seller_listings", { p_seller_id: shop.id })).find(
    (row) => row.product_slug === SLUG,
  );
  await seller("seller_update_offer", {
    p_offer_id: listing.offer_id,
    p_price_minor: listing.price_minor + 10000,
    p_status: "active",
  });
  const inDatabase = ((listing.price_minor + 10000) / 100).toFixed(2);

  const repeats = [await get(`/p/${SLUG}`), await get(`/p/${SLUG}`), await get(`/p/${SLUG}`)];
  const repeat = priceOn(repeats[2].text);
  log(
    `price on the page: first visit ${before}; database now says ${inDatabase};`,
    `repeat visits still show ${repeat} (${repeats.map((r) => r.ms + " ms").join(", ")}; first visit ${first.ms} ms)`,
  );
  expect(before !== null && before !== inDatabase, "could not read the price from the page");
  expect(repeat === before, "a repeat visit read the database again: the page is not cached");

  // (c) Telling the shop makes the next visit read the database.
  const told = await refreshShop(REFRESH_KEY);
  const after = priceOn((await get(`/p/${SLUG}`)).text);
  log("after telling the shop (HTTP", told.status + "):", after);
  expect(told.status === 204, `the shop's refresh address answered ${told.status}`);
  expect(after === inDatabase, "the shop did not show the new price after being told");
  // Only the apps that hold the key may make the shop drop its cache.
  const refused = await refreshShop("no-es-la-clave");
  expect(refused.status === 401, `a refresh with the wrong key was answered ${refused.status}`);
  const noKey = await fetch(`${WEB}/api/catalogo/refrescar`, { method: "POST" });
  expect(noKey.status === 401, `a refresh without a key was answered ${noKey.status}`);

  // ── 3. Nonsense ids never show an error page ──────────────────────────────
  const browser = await chromium.launch();
  const NOBODY = "7d9f0c1e-4b6a-4a2f-9c3d-1a2b3c4d5e6f";
  const visits = [
    [
      WEB,
      "comprador@yuntera.example",
      "No encontramos esa página",
      ["/pedidos/tonterias", "/pedidos/YT-999999999"],
    ],
    [
      SELLER,
      "vendedor@yuntera.example",
      "No encontramos esa página",
      ["/productos/tonterias", `/productos/${NOBODY}`],
    ],
    [
      OPS,
      "central@yuntera.example",
      "No encontramos esa página",
      ["/pedidos/tonterias", "/pedidos/YT-999999999"],
    ],
    // A date that looks like one but is not on the calendar shows today's board.
    [OPS, "central@yuntera.example", "Despacho", ["/despacho?fecha=2026-13-45"]],
    [
      FIELD,
      "bodega@yuntera.example",
      "No encontramos esa pantalla",
      [
        "/bodega/paquete/tonterias",
        "/bodega/paquete/------------------------------------",
        `/bodega/paquete/${NOBODY}`,
      ],
    ],
    [
      FIELD,
      "repartidor@yuntera.example",
      "No encontramos esa pantalla",
      ["/ruta/tonterias", `/ruta/${NOBODY}`],
    ],
  ];
  for (const [base, email, expected, paths] of visits) {
    const context = await browser.newContext({ locale: "es-CR" });
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console (${page.url()}): ${m.text().slice(0, 160)}`);
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
    await page.goto(base + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
    for (const path of paths) {
      await page.goto(base + path, { waitUntil: "networkidle" });
      // The drivers' and warehouse app shows its not-found screen without a <main>.
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const shown = text.includes(expected) && !text.includes("Algo salió mal");
      log(
        `${new URL(base).port} ${email.split("@")[0].padEnd(10)} ${path.padEnd(52)}`,
        shown ? `"${expected}"` : `UNEXPECTED: ${text.slice(0, 80)}`,
      );
      expect(shown, `${base}${path} did not show "${expected}"`);
    }
    await context.close();
  }

  // The shop's not-found screen, at phone width, for the record. The browser itself
  // reports a 404 document as a console error; that one message is expected here.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const m = await phone.newPage();
  m.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("status of 404")) {
      errors.push("console: " + msg.text().slice(0, 200));
    }
  });
  m.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  const missing = await m.goto(WEB + "/p/no-existe-este-producto", { waitUntil: "networkidle" });
  log(
    "in a browser: status",
    missing.status(),
    "|",
    (await m.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 60),
    "| overflow px:",
    await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  );
  expect(missing.status() === 404, "the browser did not get a 404 for an unknown product");
  await m.screenshot({ path: SHOTS + "/sc1-not-found-mobile.png" });
  await phone.close();
  await browser.close();

  log("\nERRORS:", errors.length ? errors : "none");
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
