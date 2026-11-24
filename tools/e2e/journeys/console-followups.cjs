// Console follow-ups journey: what the reviews of the operations tools left
// open, and deleting a brand (20261121084100_catalogue_followups.sql).
//
//   - A holiday on a day with promised orders reads in correct Spanish
//     ("1 pedido", never "1 pedidos").
//   - On Distritos, "Revisar el cambio" with nothing chosen says what to choose.
//   - Settings and holidays: after a refusal, the confirmation box stays as
//     it was ticked.
//   - Central takes a stop off the journey's own route (so the seed's R-1003
//     stays as it is) before the driver starts it: the driver is told to
//     collect only the parcels still on it, and not to collect the removed
//     one. Then the driver starts it and Central takes off another stop while
//     the driver has the parcel: the driver's header and the dispatch card
//     leave both out of the total and say how many were removed; the staff
//     order page reads "Quitado de una ruta", not "Entrega fallida", and its
//     history shows no machine codes.
//   - Catálogo → Marcas: a new brand is deleted from its row; a brand with
//     products offers no deletion and says why; a brand that got a product
//     while the page was open is refused with the number and what to do.
//   - The pages at phone width, with no sideways scroll.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const { ownRoute } = require("../lib/own-route.cjs");
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
    // A function that returns nothing answers with an empty body.
    out.push(await r.json().catch(() => null));
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

  // ── 3. Confirmation boxes kept after a refusal ────────────────────────────
  await go("/operacion/ajustes");
  const cod = staff.locator('li[data-setting="cod_max_order_minor"]');
  await cod.locator("summary").click();
  await cod.locator('input[name="value"]').fill("150,5");
  await cod.locator('input[name="confirm"]').check();
  const centimos = await submit(cod, "Guardar el nuevo valor");
  log("amount with céntimos:", centimos);
  check(centimos.includes("sin céntimos"), `an amount with céntimos was not refused: ${centimos}`);
  check(
    (await cod.locator('input[name="confirm"]').isChecked()) === true,
    "the setting's confirmation box was cleared after a refusal",
  );
  check(
    (await cod.locator('input[name="value"]').inputValue()) === "150,5",
    "the typed amount was not kept",
  );
  await go("/operacion/feriados");
  const holidayForm = staff
    .locator("main form")
    .filter({ has: staff.locator('input[name="name"]') });
  await holidayForm.locator('input[name="day"]').fill(promised);
  await holidayForm.locator('input[name="name"]').fill("X");
  await holidayForm.locator('input[name="confirm"]').check();
  const shortName = await submit(holidayForm, "Agregar el feriado");
  log("short holiday name:", shortName);
  check(shortName.includes("Escriba el nombre"), `a one-letter name was not refused: ${shortName}`);
  check(
    (await holidayForm.locator('input[name="confirm"]').isChecked()) === true,
    "the holiday's confirmation box was cleared after a refusal",
  );

  // ── 4. Stops taken off a route ────────────────────────────────────────────
  const route = await ownRoute(3, { start: false });
  log("own route:", JSON.stringify(route));
  check(route.stops.length === 3, `the journey's route has ${route.stops.length} stops, not 3`);
  // Before the driver starts: the parcel goes straight back to dispatch.
  const [early] = await rpcAs("central@yuntera.example", [
    [
      "ops_remove_route_stop",
      { p_stop_id: route.stops[0].stopId, p_reason: "Este paquete va en otra ruta." },
    ],
  ]);
  log("removed before the start:", JSON.stringify(early));
  check(early.shipment_status === "packed", "the parcel did not go back to dispatch");

  const driver = await (
    await phone({
      geolocation: { latitude: 9.9336, longitude: -84.0513 },
      permissions: ["geolocation"],
    })
  ).newPage();
  watch(driver);
  await signIn(driver, FIELD, "repartidor@yuntera.example");
  await driver.goto(FIELD + "/ruta", { waitUntil: "networkidle" });
  const section = driver.locator(`section[aria-labelledby="ruta-${route.code}"]`);
  let header = await text(section.locator("> div").first());
  log("driver header before the start:", header.slice(0, 220));
  check(
    header.includes("0 de 2 entregadas · 1 omitida") && header.includes("Recoja 2 bultos"),
    `the driver is sent to collect the removed parcel: ${header.slice(0, 220)}`,
  );
  const earlyStop = await text(section.locator("ol > li").first());
  check(
    earlyStop.includes("No recoja este paquete: volvió a Despacho") &&
      !earlyStop.includes("devuélvalo"),
    `the removed stop does not say to leave the parcel: ${earlyStop.slice(0, 200)}`,
  );
  await driver.screenshot({ path: SHOTS + "/cf3a-driver-assigned.png", fullPage: true });

  // Started, then a stop removed while the driver has the parcel.
  await rpcAs("repartidor@yuntera.example", [
    ["driver_start_route", { p_route_id: route.routeId }],
  ]);
  const stop = { stop_id: route.stops[1].stopId };
  const order = route.stops[1].orderNumber;
  const [removed] = await rpcAs("central@yuntera.example", [
    [
      "ops_remove_route_stop",
      { p_stop_id: stop?.stop_id, p_reason: "La moto se dañó en el camino." },
    ],
  ]);
  log("removed:", JSON.stringify(removed));
  check(removed.shipment_status === "delivery_failed", "the parcel did not go back to dispatch");

  await driver.goto(FIELD + "/ruta", { waitUntil: "networkidle" });
  header = await text(section.locator("> div").first());
  log("driver header:", header.slice(0, 160));
  check(
    header.includes("0 de 1 entregadas · 2 omitidas"),
    `the driver's header counts the removed stops: ${header.slice(0, 160)}`,
  );
  // Once the route has started, the stop removed BEFORE the start still says
  // not to collect its parcel (the driver never had it); the one removed
  // after says to bring it back.
  const beforeStart = await text(
    section.locator("ol > li").filter({ hasText: route.stops[0].tracking }).first(),
  );
  const afterStart = await text(
    section.locator("ol > li").filter({ hasText: route.stops[1].tracking }).first(),
  );
  log("removed before the start, once started:", beforeStart.slice(0, 200));
  log("removed after the start:", afterStart.slice(0, 200));
  check(
    beforeStart.includes("No recoja este paquete: volvió a Despacho") &&
      !beforeStart.includes("devuélvalo"),
    `after the start, the stop removed before it tells the driver to bring back a parcel never collected: ${beforeStart.slice(0, 200)}`,
  );
  check(
    afterStart.includes("Si lleva el paquete, devuélvalo a la bodega") &&
      !afterStart.includes("No recoja"),
    `the stop removed after the start does not ask for the parcel back: ${afterStart.slice(0, 200)}`,
  );
  check((await overflow(driver)) <= 0, "the driver's route scrolls sideways on a phone");
  await driver.screenshot({ path: SHOTS + "/cf3-driver-header.png", fullPage: true });
  // The stop's own page says the same as the route list, never "quedó como no
  // entregada" (packages/core route-stops.ts, the rule the list uses).
  for (const [which, says, never] of [
    [route.stops[0], "No recoja este paquete: volvió a Despacho", "devuélvalo"],
    [route.stops[1], "Si lleva el paquete, devuélvalo a la bodega", "No recoja"],
  ]) {
    await driver.goto(`${FIELD}/ruta/${which.stopId}`, { waitUntil: "networkidle" });
    const closed = await text(driver.locator('[data-testid="stop-closed"]'));
    log("removed stop's page:", closed.slice(0, 200));
    check(
      closed.includes("Central quitó esta parada") &&
        closed.includes(says) &&
        !closed.includes(never) &&
        !(await text(driver.locator("body"))).includes("quedó como no entregada"),
      `the removed stop's own page says what the route list says: ${closed.slice(0, 200)}`,
    );
    // Not visited: no directions and no call to the customer, as in the drivers' app.
    check(
      (await driver.getByRole("link", { name: "Cómo llegar" }).count()) === 0 &&
        (await driver.locator('a[href^="tel:"], a[href^="https://wa.me/"]').count()) === 0,
      "the removed stop's page still offers directions or a call to the customer",
    );
  }
  await driver.screenshot({ path: SHOTS + "/cf3b-driver-removed-stop.png", fullPage: true });

  await go("/despacho");
  const card = await text(
    staff.locator("li").filter({ has: staff.locator(`h3:text-is("${route.code}")`) }),
  );
  log("dispatch card:", card.slice(0, 160));
  check(
    card.includes("0 de 1 entregadas · 2 omitidas"),
    `the dispatch card counts the removed stops: ${card.slice(0, 160)}`,
  );

  await go(`/pedidos/${order}`);
  const parcels = await text(staff.locator('section[aria-labelledby="paquetes"]'));
  log("staff order parcels:", parcels.slice(0, 200));
  check(
    parcels.includes("Quitado de una ruta") &&
      parcels.includes("quitado de una ruta, sin intento de entrega") &&
      !parcels.includes("Entrega fallida"),
    `the staff order page calls the removed stop a failed delivery: ${parcels.slice(0, 200)}`,
  );
  const history = await text(staff.locator('section[aria-labelledby="historial"]'));
  log("staff order history:", history.slice(0, 400));
  check(
    !/\b(confirmed|picking|processing|packed|ready_for_dispatch|out_for_delivery|shipped|delivery_failed|shipment_status)\b/.test(
      history,
    ) && history.includes("Quitado de una ruta"),
    `the staff order history shows machine codes: ${history.slice(0, 400)}`,
  );
  await staff.screenshot({ path: SHOTS + "/cf4-staff-order-rescheduled.png", fullPage: true });

  // ── 5. Deleting a brand ───────────────────────────────────────────────────
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

  // ── 6. At phone width ─────────────────────────────────────────────────────
  const mobile = await (await phone({ storageState: await staffContext.storageState() })).newPage();
  watch(mobile);
  for (const [path, shot] of [
    ["/catalogo/marcas", "cf6-mobile-brands"],
    ["/operacion/distritos?canton=115&revisar=1", "cf7-mobile-districts"],
    [`/pedidos/${order}`, "cf8-mobile-order"],
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
