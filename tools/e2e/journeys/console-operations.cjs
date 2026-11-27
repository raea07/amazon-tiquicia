// Console operations journey: operations staff switch a delivery zone off (checkout
// refuses the shopper's address there) and on again; move a district to another zone
// and back; add a holiday on the day a product page promises, watch the date move,
// and remove it; open a zone closure and end it early; an administrator changes an
// operational setting and sees a protected one read-only; a warehouse location is
// created and offered in the warehouse's receiving form; and a stuck route (the
// journey's own, built through the API) has its stops removed and is closed, the driver seeing them skipped and the shopper reading
// that the delivery was rescheduled. Along the way: an amount typed the Costa Rican way
// ("1.500,00") is read as ₡1 500 and one with céntimos is refused with the ticked boxes
// kept; a second member of staff's edit refuses the first one's stale form and the page
// then shows the current values; a closure cancelled before it started is closed again
// from the list. Every page of the section is checked at phone width.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const { ownRoute } = require("../lib/own-route.cjs");
const web = require("../lib/web.cjs");
const ops = require("../lib/ops.cjs");
const field = require("../lib/field.cjs");
const { word } = require("../lib/words.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);

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

/** Today in Costa Rica (UTC−6 all year), plus `days`, as YYYY-MM-DD. */
const crDay = (days = 0) =>
  new Date(Date.now() - 6 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);

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
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const staff = await staffContext.newPage();
  watch(staff);
  await ops.signIn(staff, "central@yuntera.example");

  const go = async (path) => {
    await ops.open(staff, path);
  };

  // The shopper, signed in, with a product in the cart.
  const shopperContext = await browser.newContext({ locale: "es-CR" });
  const shopper = await shopperContext.newPage();
  watch(shopper);
  await web.signIn(shopper, "comprador@yuntera.example");
  await web.open(shopper, "/p/libreta-tapa-dura-a5");
  await web.addToCart(shopper);

  // ── 1. The section ──────────────────────────────────────────────────────────
  await go("/operacion");
  const nav = await ops.operationsNav(staff);
  log("operations pages:", nav);
  check(
    nav.includes("Zonas de entrega") && nav.includes("Rutas detenidas") && nav.length === 7,
    "the operations section does not list its pages (with the settings for an administrator)",
  );
  check((await ops.headerOperationsLinks(staff)) > 0, "the console's navigation has no Operación");

  // ── 2. A zone switched off: checkout refuses the address; then on again ────
  log("gam-core:", (await ops.zoneText(staff, "gam-core")).slice(0, 220));
  const warning = await ops.openZoneSwitchOff(staff, "gam-core");
  log("before switching off:", warning);
  check(/pedidos abiertos/i.test(warning), "switching a zone off does not say its open orders");
  const off = await ops.switchZoneOff(staff, "gam-core");
  log("switched off:", off);
  check(off.includes("apagada"), `zone not switched off: ${off}`);
  await staff.screenshot({ path: SHOTS + "/co1-zone-off.png", fullPage: true });

  await web.open(shopper, "/pagar");
  const pay = await web.mainText(shopper);
  log("checkout with the zone off:", pay.slice(0, 260));
  check(
    pay.includes("Por ahora no entregamos en sus direcciones guardadas"),
    "checkout does not refuse the address in a zone switched off",
  );
  await shopper.screenshot({ path: SHOTS + "/co2-checkout-zone-off.png", fullPage: true });

  const on = await ops.switchZoneOn(staff, "gam-core");
  log("switched on:", on);
  check(on.includes("encendida"), `zone not switched on: ${on}`);
  await web.open(shopper, "/pagar");
  const radio = await web.firstCheckoutAddress(shopper);
  check(
    radio.count === 1 && !radio.disabled,
    "checkout does not offer the address again once the zone is on",
  );

  // Amounts in colones as people type them: "1.500,00" is ₡1 500, céntimos are
  // refused, and after a refusal the weekday boxes stay as they were ticked.
  await go("/operacion");
  const cents = await ops.createZone(staff, {
    id: "zona-prueba-co",
    name: "Zona de prueba",
    unticked: [1],
    fee: "1500,50",
  });
  log("fee with céntimos:", cents);
  check(cents.includes("sin céntimos"), `a fee with céntimos was not refused: ${cents}`);
  check(
    !(await ops.weekdayTicked(staff, 1)) && (await ops.weekdayTicked(staff, 2)),
    "the weekday boxes did not stay as ticked after a refusal",
  );
  const createdZone = await ops.createZone(staff, { fee: "1.500,00" });
  log("zone created:", createdZone);
  check(createdZone.includes("Envío ₡1 500"), `"1.500,00" was not read as ₡1 500: ${createdZone}`);
  await ops.waitForZone(staff, "zona-prueba-co");
  check(
    (await ops.zoneSwitchOnOffered(staff, "zona-prueba-co")) === 0 &&
      (await ops.zoneText(staff, "zona-prueba-co")).includes("asígnele antes al menos un distrito"),
    "a zone with no districts is offered to be switched on",
  );
  check(
    (await ops.deleteZone(staff, "zona-prueba-co")).includes("Zona borrada"),
    "the test zone was not deleted",
  );

  // Two members of staff editing the same zone: the second save from a stale form
  // is refused, the page then shows the current values, and saving again works.
  await go("/operacion");
  await ops.openZoneChange(staff, "gam-extended");
  const other = await staffContext.newPage();
  watch(other);
  await ops.open(other, "/operacion");
  await ops.openZoneChange(other, "gam-extended");
  await ops.typeZoneName(other, "gam-extended", "GAM extendida B");
  await ops.saveZoneNow(other, "gam-extended", "GAM extendida B");
  await other.close();
  const revisionBefore = await ops.zoneRevision(staff, "gam-extended");
  await ops.typeZoneName(staff, "gam-extended", "GAM extendida");
  const stale = await ops.saveZone(staff, "gam-extended");
  log("stale edit:", stale);
  check(stale.includes("Otra persona cambió"), `a stale edit was not refused: ${stale}`);
  await ops.waitForZoneRevision(staff, "gam-extended", revisionBefore);
  const shownName = await ops.zoneNameShown(staff, "gam-extended");
  check(
    shownName.heading === "GAM extendida B",
    "after a stale edit the page does not show the current name",
  );
  check(shownName.typed === "GAM extendida", "after a stale edit what was typed was lost");
  const retried = await ops.saveZone(staff, "gam-extended");
  log("saved again:", retried);
  check(retried.includes("guardada"), `saving again after a stale edit failed: ${retried}`);

  // ── 3. A district moved to another zone, and back ──────────────────────────
  await go("/operacion/distritos?canton=115");
  log("district before:", await ops.districtText(staff, "11503"));
  await ops.previewDistrictMove(staff, "11503", "gam-extended");
  const preview = await ops.districtPreview(staff);
  log("preview:", preview);
  check(
    preview.includes("1 distrito pasa") && preview.includes("Direcciones guardadas: 0"),
    "the move is not previewed with what it touches",
  );
  await staff.screenshot({ path: SHOTS + "/co3-district-preview.png", fullPage: true });
  const moved = await ops.confirmDistrictMove(staff);
  log("moved:", moved);
  check(moved.includes("GAM extendida"), `district not moved: ${moved}`);
  await go("/operacion/distritos?canton=115");
  const after = await ops.districtText(staff, "11503");
  log("district after:", after);
  check(after.includes("GAM extendida"), "the district does not show its new zone");
  const [districts] = await rpcAs(null, [["list_districts", {}]]);
  check(
    districts.find((d) => d.postal_code === "11503")?.zone_id === "gam-extended",
    "the shop's district list does not follow",
  );
  // And back, the same way.
  await go("/operacion/distritos?canton=115&distrito=11503&destino=gam-core");
  const back = await ops.confirmDistrictMove(staff);
  log("moved back:", back);
  check(back.includes("GAM central"), `district not moved back: ${back}`);

  // ── 4. A holiday on the day the product page promises: the date moves ──────
  const promiseOf = async () => {
    const [product] = await rpcAs(null, [
      ["get_product", { p_slug: "libreta-tapa-dura-a5", p_postal_code: "10101" }],
    ]);
    return product.skus[0].offers[0].promise?.latest ?? null;
  };
  const shopPromise = async () => {
    const context = await browser.newContext({ locale: "es-CR" });
    const page = await context.newPage();
    watch(page);
    const line = await web.productArrival(page, "libreta-tapa-dura-a5");
    await context.close();
    return line;
  };
  const promised = await promiseOf();
  const shownBefore = await shopPromise();
  log("product promised for:", promised, "| shown:", shownBefore);
  await go("/operacion/feriados");
  const blocked = await ops.tryHoliday(staff, { day: promised, name: "Feriado de prueba" });
  log("first try:", blocked);
  if (!blocked.includes("Feriado agregado")) {
    // Orders are promised that day: the page says how many; confirmed, it is added.
    check(blocked.includes("con entrega prometida"), `holiday refused: ${blocked}`);
    const confirmed = await ops.addHoliday(staff, { day: promised, name: "Feriado de prueba" });
    log("confirmed:", confirmed);
    check(confirmed.includes("Feriado agregado"), `holiday not added: ${confirmed}`);
  }
  await staff.screenshot({ path: SHOTS + "/co4-holiday.png", fullPage: true });
  const moved_promise = await promiseOf();
  const shownAfter = await shopPromise();
  log("product promised for, with the holiday:", moved_promise, "| shown:", shownAfter);
  check(moved_promise > promised, "the promise does not move past the holiday");
  check(shownAfter !== shownBefore, "the product page still shows the old date");
  // The undo: removed again, the date is back.
  await go("/operacion/feriados");
  const removed = await ops.removeHoliday(staff, promised);
  log("removed:", removed);
  check(removed.includes("ya no es feriado"), `holiday not removed: ${removed}`);
  check((await promiseOf()) === promised, "the promise is not back once the holiday is removed");

  // ── 5. A closure opened, and ended early ───────────────────────────────────
  await go("/operacion/cierres");
  const opened = await ops.saveClosure(staff, {
    zone: "gam-extended",
    startsOn: crDay(0),
    endsOn: crDay(2),
    reason: "road_closed",
  });
  log("closure:", opened);
  check(opened.includes("Cierre guardado"), `closure not opened: ${opened}`);
  const closure = ops.firstClosure(staff);
  await closure.waitFor();
  const closureText = await ops.text(closure);
  log("closure listed:", closureText.slice(0, 200));
  check(
    closureText.includes("GAM extendida") && closureText.includes("En curso"),
    "the closure is not listed as under way",
  );
  // Overlapping: refused, not merged.
  const overlap = await ops.saveClosure(staff, {
    zone: "gam-extended",
    startsOn: crDay(1),
    endsOn: crDay(3),
    reason: "weather",
  });
  log("overlapping closure:", overlap);
  check(
    overlap.includes("ya tiene un cierre"),
    `an overlapping closure was not refused: ${overlap}`,
  );
  await staff.screenshot({ path: SHOTS + "/co5-closure.png", fullPage: true });
  const ended = await ops.endFirstClosure(staff);
  log("ended:", ended);
  check(ended.includes("Cierre"), `closure not ended: ${ended}`);
  await go("/operacion/cierres");
  check(
    (await ops.openClosureCount(staff)) === 0,
    "the closure ended early is still listed as open",
  );
  // It had not started, so it was cancelled; the way back is on the same screen.
  check(
    (await ops.cancelledClosureCount(staff)) === 1,
    "the cancelled closure is not offered to close again",
  );
  const reclosed = await ops.closeAgain(staff);
  log("closed again:", reclosed);
  check(
    reclosed.includes("Cierre guardado"),
    `the cancelled closure was not closed again: ${reclosed}`,
  );
  await go("/operacion/cierres");
  const endedAgain = await ops.endFirstClosure(staff);
  log("ended again:", endedAgain);
  check(endedAgain.includes("Cierre cancelado"), `the closure was not ended again: ${endedAgain}`);

  // ── 6. Settings: an operational one changed, a protected one read-only ─────
  await go("/operacion/ajustes");
  const complaints = "max_open_complaints_per_account";
  log("setting before:", (await ops.settingText(staff, complaints)).slice(0, 160));
  const unconfirmed = await ops.changeSettingUnconfirmed(staff, complaints, "6");
  log("without the confirmation:", unconfirmed);
  check(unconfirmed.includes("Marque la casilla"), "a setting changed without confirming");
  const saved = await ops.confirmSetting(staff, complaints, "6");
  log("setting saved:", saved);
  check(saved.includes("Ajuste guardado"), `setting not saved: ${saved}`);
  await go("/operacion/ajustes");
  check(
    (await ops.settingText(staff, complaints)).includes("Valor: 6"),
    "the new value is not shown",
  );
  const modeText = await ops.settingText(staff, "payments_mode");
  log("payments mode:", modeText);
  check(
    modeText.includes("Protegido") &&
      modeText.includes("procedimiento de despliegue") &&
      (await ops.settingControls(staff, "payments_mode")) === 0,
    "the payments mode is not read-only",
  );
  await staff.screenshot({ path: SHOTS + "/co6-settings.png", fullPage: true });
  // Put back.
  check(
    (await ops.changeSetting(staff, complaints, "5")).includes("Ajuste guardado"),
    "the setting was not put back",
  );

  // ── 7. A warehouse location, offered in the warehouse's receiving form ─────
  await go("/operacion/ubicaciones");
  const created = await ops.createLocation(staff, "SJO1", { code: "c-09-01-a", kind: "storage" });
  log("location:", created);
  check(created.includes("C-09-01-A"), `location not created: ${created}`);
  await staff.screenshot({ path: SHOTS + "/co7-locations.png", fullPage: true });
  // A seller announces a shipment to the warehouse, as field.cjs does.
  const [roles] = await rpcAs("vendedor@yuntera.example", [["my_roles", {}]]);
  const tecno = roles.sellers.find((s) => s.slug === "tecnocasa");
  const [locs, listings] = await rpcAs("vendedor@yuntera.example", [
    ["seller_locations", { p_seller_id: tecno.id }],
    ["seller_listings", { p_seller_id: tecno.id }],
  ]);
  await rpcAs("vendedor@yuntera.example", [
    [
      "seller_create_inbound",
      {
        p_warehouse_id: locs.platform[0].id,
        p_seller_id: tecno.id,
        p_lines: [{ sku_id: listings[0].sku_id, quantity: 3 }],
      },
    ],
  ]);
  const phone = (extra = {}) =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
      ...extra,
    });
  const warehouse = await (await phone()).newPage();
  watch(warehouse);
  await field.signIn(warehouse, "bodega@yuntera.example");
  await field.open(warehouse, "/bodega");
  const bins = await field.receivingLocations(warehouse);
  log(
    "receiving form offers:",
    bins.length,
    "locations, new one there:",
    bins.includes("C-09-01-A"),
  );
  check(bins.includes("C-09-01-A"), "the warehouse does not offer the new location");
  await warehouse.screenshot({ path: SHOTS + "/co8-warehouse-offers.png", fullPage: true });
  // Switched off: no longer offered.
  await go("/operacion/ubicaciones");
  const switched = await ops.switchLocationOff(staff, "C-09-01-A");
  log("location off:", switched);
  check(switched.includes("desactivada"), `location not switched off: ${switched}`);
  await field.open(warehouse, "/bodega");
  check(
    !(await field.receivingLocations(warehouse)).includes("C-09-01-A"),
    "the warehouse still offers a location that is off",
  );

  // ── 8. A route that cannot finish: its stops removed, then closed ──────────
  // The journey's own started route, so the seed's R-1003 stays as the
  // database suites expect it (tools/e2e/lib/own-route.cjs).
  const own = await ownRoute(2);
  log("own route:", JSON.stringify(own));
  check(own.stops.length === 2, `the journey's route has ${own.stops.length} stops, not 2`);
  await go("/operacion/rutas");
  log("route:", (await ops.routeText(staff, own.code)).slice(0, 220));
  check(
    (await ops.routeCloseOffered(staff, own.code)) === 0,
    "a route with stops out offers to be closed",
  );
  for (const tracking of own.stops.map((s) => s.tracking)) {
    const result = await ops.removeStop(
      staff,
      own.code,
      tracking,
      "El camión se varó y no puede seguir.",
    );
    log(`removed ${tracking}:`, result);
    check(result.includes(`Parada ${tracking} quitada`), `stop ${tracking} not removed: ${result}`);
    await go("/operacion/rutas");
  }
  await staff.screenshot({ path: SHOTS + "/co9-route-stops-removed.png", fullPage: true });
  const closed = await ops.closeRoute(
    staff,
    own.code,
    "Camión varado; paradas devueltas a despacho.",
  );
  log("route closed:", closed);
  check(closed.includes(`Ruta ${own.code} cerrada`), `route not closed: ${closed}`);
  await go("/despacho");
  const ready = await ops.dispatchReady(staff);
  check(
    ready.includes(own.stops[0].tracking),
    "the parcel taken off the route is not waiting for a route",
  );
  // The driver sees the stops skipped, and why.
  const driver = await (
    await phone({
      geolocation: { latitude: 9.9336, longitude: -84.0513 },
      permissions: ["geolocation"],
    })
  ).newPage();
  watch(driver);
  await field.signIn(driver, "repartidor@yuntera.example");
  await field.open(driver, "/ruta");
  const day = await field.mainText(driver);
  log("driver:", day.slice(0, 300));
  check(
    day.includes("Omitida") && day.includes("Central quitó esta parada"),
    "the driver does not see the stops skipped",
  );
  await driver.screenshot({ path: SHOTS + "/co10-driver-skipped.png", fullPage: true });
  // The shopper whose parcel was taken off the route while the driver had it reads
  // that the delivery was rescheduled, not that nobody was home.
  const theirs = own.stops.find((s) => s.shopper);
  check(Boolean(theirs), "no parcel of the journey's route belongs to a demo shopper");
  let owner = shopper;
  if (theirs && theirs.shopper !== "comprador@yuntera.example") {
    owner = await (await browser.newContext({ locale: "es-CR" })).newPage();
    watch(owner);
    await web.signIn(owner, theirs.shopper);
  }
  await web.openOrder(owner, theirs?.orderNumber);
  const parcel = await web.mainText(owner);
  log("shopper's order:", parcel.slice(0, 300));
  check(
    parcel.includes(word("shipment_status", "delivery_failed", { attemptCount: 0 })) &&
      parcel.includes("Reprogramamos la entrega") &&
      !parcel.includes("No pudimos entregarlo") &&
      !parcel.includes(word("shipment_status", "delivery_failed")),
    "the shopper is told the delivery failed after staff removed the stop",
  );
  // The order's heading agrees: its only parcel is not on its way any more.
  const heading = await web.orderHeadingBlock(owner);
  log("shopper's order heading:", heading);
  check(
    heading.includes(word("derived", "rescheduled")) &&
      !heading.includes(word("order_status", "shipped")),
    `the order's heading still says it is on its way: ${heading}`,
  );
  await owner.screenshot({ path: SHOTS + "/co10b-shopper-rescheduled.png", fullPage: true });

  // ── 9. Every page of the section at phone width ─────────────────────────────
  const mobile = await (await phone({ storageState: await staffContext.storageState() })).newPage();
  watch(mobile);
  for (const [path, shot] of [
    ["/operacion", "co11-mobile-zones"],
    ["/operacion/distritos?canton=115&distrito=11503&destino=none", "co12-mobile-districts"],
    ["/operacion/feriados", "co13-mobile-holidays"],
    ["/operacion/cierres", "co14-mobile-closures"],
    ["/operacion/ubicaciones", "co15-mobile-locations"],
    ["/operacion/rutas", "co16-mobile-routes"],
    ["/operacion/ajustes", "co17-mobile-settings"],
  ]) {
    await ops.open(mobile, path);
    await mobile.evaluate(() => {
      for (const details of document.querySelectorAll("main details")) details.open = true;
    });
    const px = await overflow(mobile);
    log(`mobile ${path} overflow px:`, px);
    check(px <= 0, `ops ${path} scrolls sideways on a phone`);
    const layout = await mobile.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      const headings = [...document.querySelectorAll("main h1, main h2")]
        .filter(visible)
        .map((h) => `${h.tagName}:${h.innerText.trim()}`);
      const small = [];
      for (const el of document.querySelectorAll(
        "main button, main select, main input, main textarea, nav[aria-label='Operación'] a",
      )) {
        if (!visible(el) || el.type === "hidden") continue;
        let box = el.getBoundingClientRect();
        if (el.type === "checkbox" || el.type === "radio") {
          const label = el.closest("label") ?? document.querySelector(`label[for="${el.id}"]`);
          if (label) box = label.getBoundingClientRect();
        }
        if (box.height < 44)
          small.push(
            `${el.tagName}:${(el.innerText || el.name || "").trim().slice(0, 30)}:${Math.round(box.height)}`,
          );
      }
      return {
        h1: headings.filter((h) => h.startsWith("H1")).length,
        repeated: headings.filter((h, i) => headings.indexOf(h) !== i),
        small,
      };
    });
    log(`mobile ${path} headings and targets:`, JSON.stringify(layout));
    check(layout.h1 === 1, `ops ${path} has ${layout.h1} page titles`);
    check(layout.repeated.length === 0, `ops ${path} repeats a heading: ${layout.repeated}`);
    check(layout.small.length === 0, `ops ${path} has controls under 44 px: ${layout.small}`);
    await mobile.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }

  // ── 10. Operations staff do not see the settings; a shopper sees nothing ───
  const [central] = await rpcAs("central@yuntera.example", [["ops_settings", {}]]);
  check(Array.isArray(central), "an administrator cannot read the settings");
  const [refused] = await rpcAs("comprador@yuntera.example", [["ops_delivery_zones", {}]]);
  check(JSON.stringify(refused).includes("forbidden"), "a shopper reached the zones");

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
