// Console follow-ups journey: what the reviews of the operations tools left
// open, and deleting a brand (20261121084100_catalogue_followups.sql).
//
//   - A holiday on a day with promised orders reads in correct Spanish
//     ("1 pedido", never "1 pedidos").
//   - On Distritos, "Revisar el cambio" with nothing chosen says what to choose.
//   - Central takes a stop off route R-1003 while the driver has the parcel:
//     the driver's header leaves it out of the total and says one was removed;
//     the staff order page reads "Quitado de una ruta", not "Entrega fallida".
//   - Catálogo → Marcas: a new brand is deleted from its row; a brand with
//     products offers no deletion and says why; a brand that got a product
//     while the page was open is refused with the number and what to do.
//   - The pages at phone width, with no sideways scroll.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FIELD = process.env.FIELD_URL || "http://127.0.0.1:3003";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

/** Calls database functions as a demo user (or a visitor, with no email), as an app does. */
async function rpcAs(email, calls) {
  const ctx = await request.newContext();
  const headers = { apikey: KEY };
  if (email) {
    const t = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
      headers: { apikey: KEY },
      data: { email, password: PASSWORD },
    });
    headers.authorization = `Bearer ${(await t.json()).access_token}`;
  }
  const out = [];
  for (const [fn, args] of calls) {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, { headers, data: args });
    out.push(await r.json());
  }
  await ctx.dispose();
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
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
  const signIn = async (page, base, email) => {
    await page.goto(base + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
    await page.waitForLoadState("networkidle");
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const phone = (extra = {}) =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
      ...extra,
    });

  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const staff = await staffContext.newPage();
  watch(staff);
  await signIn(staff, OPS, "central@yuntera.example");
  const go = (path) => staff.goto(OPS + path, { waitUntil: "networkidle" });

  // Submits a form and waits for its new outcome (its own message, or the page's notice
  // once the form that sent it is gone).
  const submit = async (scope, button) => {
    const outcomes = () =>
      staff.locator(
        '[data-catalogue-outcome] [role="status"], main [role="status"], main [role="alert"]',
      );
    const before = (await outcomes().allInnerTexts()).join("|");
    await scope.locator(`button:has-text("${button}")`).last().click();
    const deadline = Date.now() + 15000;
    let now = "";
    while (Date.now() < deadline) {
      await staff.waitForTimeout(250);
      now = (await outcomes().allInnerTexts()).join("|");
      if (now && now !== before) break;
    }
    const all = await outcomes().allInnerTexts();
    return (all.find((t) => !before.includes(t)) ?? all.at(-1) ?? "").replace(/\s+/g, " ").trim();
  };

  // ── 1. A holiday's counts in correct Spanish ──────────────────────────────
  const [product] = await rpcAs(null, [
    ["get_product", { p_slug: "libreta-tapa-dura-a5", p_postal_code: "10101" }],
  ]);
  const promised = product.skus[0].offers[0].promise?.latest;
  check(Boolean(promised), "the notebook has no delivery promise to put a holiday on");
  const [added] = await rpcAs("central@yuntera.example", [
    ["ops_add_holiday", { p_day: promised, p_name: "Feriado de conteo", p_confirm: true }],
  ]);
  log("holiday added:", JSON.stringify(added));
  await go("/operacion/feriados");
  const holiday = await text(staff.locator(`li[data-holiday="${promised}"]`));
  log("holiday row:", holiday);
  check(holiday.includes("Feriado de conteo"), "the holiday is not listed");
  check(
    !/\b1 (pedidos|rutas)\b/.test(holiday) && !/\b([02-9]|\d{2,}) (pedido|ruta) /.test(holiday),
    `the holiday's counts are not in correct Spanish: ${holiday}`,
  );
  if (added.promised_orders > 0) {
    check(
      holiday.includes(
        added.promised_orders === 1
          ? "1 pedido con entrega prometida"
          : `${added.promised_orders} pedidos con entrega prometida`,
      ),
      `the holiday does not say how many orders are promised: ${holiday}`,
    );
  }
  await staff.screenshot({ path: SHOTS + "/cf1-holiday-counts.png", fullPage: true });
  await rpcAs("central@yuntera.example", [["ops_remove_holiday", { p_day: promised }]]);

  // ── 2. Districts: the preview asked for with nothing chosen ───────────────
  await go("/operacion/distritos?canton=115");
  await staff.locator('button:has-text("Revisar el cambio")').click();
  await staff.waitForLoadState("networkidle");
  let alert = await text(
    staff.locator('main [role="status"], main [role="alert"]').filter({ hasText: "Elija" }).first(),
  );
  log("nothing chosen:", alert);
  check(
    alert.includes("Elija al menos un distrito y a qué zona pasan"),
    `nothing chosen gives no message: ${alert}`,
  );
  await staff.locator('li[data-district="11503"] input[type="checkbox"]').check();
  await staff.locator('button:has-text("Revisar el cambio")').click();
  await staff.waitForLoadState("networkidle");
  alert = await text(
    staff.locator('main [role="status"], main [role="alert"]').filter({ hasText: "Elija" }).first(),
  );
  log("no destination:", alert);
  check(alert.includes("Elija a qué zona pasan"), `no destination gives no message: ${alert}`);
  check(
    (await staff.locator('li[data-district="11503"] input[type="checkbox"]').isChecked()) === true,
    "the chosen district is not kept",
  );
  await staff.screenshot({ path: SHOTS + "/cf2-districts-nothing-chosen.png", fullPage: true });

  // ── 3. A stop taken off a route ───────────────────────────────────────────
  const [routes] = await rpcAs("central@yuntera.example", [["ops_open_routes", {}]]);
  const stop = routes
    .find((r) => r.code === "R-1003")
    ?.stops.find((s) => s.tracking_code === "YT500011");
  check(Boolean(stop), "route R-1003 has no stop for YT500011");
  const [removed] = await rpcAs("central@yuntera.example", [
    [
      "ops_remove_route_stop",
      { p_stop_id: stop?.stop_id, p_reason: "La moto se dañó en el camino." },
    ],
  ]);
  log("removed:", JSON.stringify(removed));
  check(removed.shipment_status === "delivery_failed", "the parcel did not go back to dispatch");

  const driver = await (
    await phone({
      geolocation: { latitude: 9.9336, longitude: -84.0513 },
      permissions: ["geolocation"],
    })
  ).newPage();
  watch(driver);
  await signIn(driver, FIELD, "repartidor@yuntera.example");
  await driver.goto(FIELD + "/ruta", { waitUntil: "networkidle" });
  const header = await text(driver.locator('section[aria-labelledby="ruta-R-1003"] > div').first());
  log("driver header:", header.slice(0, 160));
  check(
    header.includes("0 de 1 entregadas · 1 omitida"),
    `the driver's header counts the removed stop: ${header.slice(0, 160)}`,
  );
  check((await overflow(driver)) <= 0, "the driver's route scrolls sideways on a phone");
  await driver.screenshot({ path: SHOTS + "/cf3-driver-header.png", fullPage: true });

  await go("/pedidos/YT-100011");
  const parcels = await text(staff.locator('section[aria-labelledby="paquetes"]'));
  log("staff order parcels:", parcels.slice(0, 200));
  check(
    parcels.includes("Quitado de una ruta") &&
      parcels.includes("quitado de una ruta, sin intento de entrega") &&
      !parcels.includes("Entrega fallida"),
    `the staff order page calls the removed stop a failed delivery: ${parcels.slice(0, 200)}`,
  );
  await staff.screenshot({ path: SHOTS + "/cf4-staff-order-rescheduled.png", fullPage: true });

  // ── 4. Deleting a brand ───────────────────────────────────────────────────
  await go("/catalogo/marcas");
  const form = staff.locator('section[aria-labelledby="nueva-marca"]');
  await form.locator('input[name="name"]').fill("Marca de Paso");
  const created = await submit(form, "Crear marca");
  log("created:", created);
  check(created.includes("Marca «Marca de Paso» creada"), `brand not created: ${created}`);
  await go("/catalogo/marcas");
  const row = staff.locator('li[data-brand="marca-de-paso"]');
  await row.locator("summary", { hasText: "Cambiar «Marca de Paso»" }).click();
  await row.locator("summary", { hasText: "Eliminar la marca" }).click();
  const warning = await text(row.locator("details[open] details[open] p"));
  check(warning.includes("No se puede deshacer"), `the deletion does not warn: ${warning}`);
  const deleted = await submit(row, "Eliminar «Marca de Paso»");
  log("deleted:", deleted);
  check(deleted.includes("Marca «Marca de Paso» eliminada"), `brand not deleted: ${deleted}`);
  await go("/catalogo/marcas");
  check(
    (await staff.locator('li[data-brand="marca-de-paso"]').count()) === 0,
    "the brand is still listed",
  );

  // A brand with products offers no deletion, and says why.
  const nimbo = staff.locator('li[data-brand="nimbo"]');
  await nimbo.locator("summary", { hasText: "Cambiar «Nimbo»" }).click();
  check(
    (await nimbo.locator("summary", { hasText: "Eliminar la marca" }).count()) === 0,
    "a brand with products offers to be deleted",
  );
  const why = await text(nimbo);
  check(why.includes("No se puede eliminar"), `the brand with products does not say why: ${why}`);

  // A brand that gets a product while the page is open: refused with the number.
  const [busy] = await rpcAs("central@yuntera.example", [
    ["ops_create_brand", { p_name: "Marca Ocupada" }],
  ]);
  await go("/catalogo/marcas");
  const busyRow = staff.locator('li[data-brand="marca-ocupada"]');
  await busyRow.locator("summary", { hasText: "Cambiar «Marca Ocupada»" }).click();
  await busyRow.locator("summary", { hasText: "Eliminar la marca" }).click();
  const [hamaca] = await rpcAs(null, [["get_product", { p_slug: "hamaca-algodon-doble" }]]);
  const [before] = await rpcAs("central@yuntera.example", [
    ["ops_catalog_product", { p_ref: hamaca.id }],
  ]);
  const [corrected] = await rpcAs("central@yuntera.example", [
    [
      "ops_correct_product",
      {
        p_product_id: hamaca.id,
        p_brand_id: busy.id,
        p_note: "La hamaca es de esta marca.",
      },
    ],
  ]);
  check(corrected?.brand?.name === "Marca Ocupada", "the hamaca did not get the brand");
  const refused = await submit(busyRow, "Eliminar «Marca Ocupada»");
  log("refused:", refused);
  check(
    refused.includes("Hay 1 producto con esta marca") && refused.includes("únala a esa"),
    `the refusal does not give the number and what to do: ${refused}`,
  );
  await staff.screenshot({ path: SHOTS + "/cf5-brand-in-use.png", fullPage: true });
  // The hamaca's brand back as it was.
  await rpcAs("central@yuntera.example", [
    [
      "ops_correct_product",
      before.brand
        ? { p_product_id: hamaca.id, p_brand_id: before.brand.id, p_note: "Vuelve a su marca." }
        : { p_product_id: hamaca.id, p_clear_brand: true, p_note: "Vuelve a no tener marca." },
    ],
  ]);

  // ── 5. At phone width ─────────────────────────────────────────────────────
  const mobile = await (await phone({ storageState: await staffContext.storageState() })).newPage();
  watch(mobile);
  for (const [path, shot] of [
    ["/catalogo/marcas", "cf6-mobile-brands"],
    ["/operacion/distritos?canton=115&revisar=1", "cf7-mobile-districts"],
    ["/pedidos/YT-100011", "cf8-mobile-order"],
  ]) {
    await mobile.goto(OPS + path, { waitUntil: "networkidle" });
    await mobile.evaluate(() => {
      for (const details of document.querySelectorAll("main details")) details.open = true;
    });
    const px = await overflow(mobile);
    log(`mobile ${path} overflow px:`, px);
    check(px <= 0, `ops ${path} scrolls sideways on a phone`);
    await mobile.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
