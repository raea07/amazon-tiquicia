// People journey: an administrator gives an account a staff role (and takes it away), registers
// a driver, assigns a warehouse worker, and finds all of it in the audit trail by name.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const ops = require("../lib/ops.cjs");
const { word } = require("../lib/words.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const expect = (condition, message) => {
  if (!condition) throw new Error("expected: " + message);
};

// Asks the API directly, as a given person, what the database now says about them.
async function rpcAs(email, fn, args = {}) {
  const ctx = await request.newContext();
  const t = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await t.json();
  const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
    headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
    data: args,
  });
  const body = await r.json();
  await ctx.dispose();
  return body;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  const signIn = (page, email, expectPath) => ops.signInLandingOn(page, email, expectPath);

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const page = await context.newPage();
  watch(page);
  await signIn(page, "central@yuntera.example", "/");
  await ops.waitForSummary(page);
  const nav = await ops.sectionsNav(page);
  log("admin nav:", nav);
  for (const label of ["Personal", "Bodegas", "Pagos a vendedores", "Repartidores"]) {
    expect(nav.includes(label), `the administrator's menu has "${label}"`);
  }

  // 1. Staff: the list, a refusal that keeps what was typed, then a real grant
  await ops.open(page, "/personal");
  const staffCount = await ops.tableRows(page);
  const firstStaff = await ops.tableRow(page);
  log("staff rows:", staffCount, "|", firstStaff.slice(0, 120));
  expect(staffCount === 1, "the seed has one staff member");
  expect(firstStaff.includes("(usted)"), "your own row is marked");
  const unknown = await ops.grantAccess(page, "nadie@yuntera.example", "finance", {
    refused: true,
  });
  const kept = await ops.grantFormState(page);
  log("grant to an unknown e-mail:", unknown, "| e-mail kept:", kept.email);
  expect(
    unknown.includes("No hay ninguna cuenta"),
    "an e-mail with no account is refused in words",
  );
  expect(kept.email === "nadie@yuntera.example", "the form keeps what was typed");
  await ops.grantAccess(page, "comprador2@yuntera.example", "support");
  await ops.waitForRowCount(page, 2);
  log("after granting:", await ops.grantMessage(page));
  log("new staff row:", (await ops.rowText(page, "Andrés Mora Chaves")).slice(0, 110));
  await page.screenshot({ path: SHOTS + "/pe1-staff.png", fullPage: true });

  // The last administrator cannot switch themselves off
  const lastAdmin = await ops.setStaff(page, "(usted)", { access: "inactive" }, "alert");
  log("last administrator:", lastAdmin);
  expect(
    lastAdmin.includes("al menos una persona administradora"),
    "the platform keeps one administrator",
  );

  // 2. The new staff member can enter the console, as far as their role goes
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CR" });
  const p2 = await c2.newPage();
  watch(p2);
  await signIn(p2, "comprador2@yuntera.example", "/");
  await ops.waitForSummary(p2);
  const supportNav = await ops.sectionsNav(p2);
  log("support nav:", supportNav, "| header:", (await ops.headerText(p2)).slice(0, 90));
  expect(supportNav.includes("Atención"), "support staff see the care section");
  expect(!supportNav.includes("Personal"), "but not staff management");
  await ops.open(p2, "/atencion");
  expect(new URL(p2.url()).pathname === "/atencion", "support staff open the care queues");
  await ops.open(p2, "/personal");
  log("support on /personal ->", new URL(p2.url()).pathname);
  expect(new URL(p2.url()).pathname === "/sin-acceso", "staff management is closed to them");

  // 3. A change of role, then access withdrawn: both apply to the very next request
  await ops.setStaff(page, "Andrés Mora Chaves", { role: "catalog" });
  await ops.open(p2, "/catalogo");
  log("as catalogue staff on /catalogo ->", new URL(p2.url()).pathname);
  expect(new URL(p2.url()).pathname === "/catalogo", "the new role works on the next click");
  await ops.setStaff(page, "Andrés Mora Chaves", { access: "inactive" }, null);
  await ops.waitForRowSaying(page, "Andrés Mora Chaves", "Sin acceso");
  await ops.open(p2, "/catalogo");
  log("after access was withdrawn ->", new URL(p2.url()).pathname);
  expect(new URL(p2.url()).pathname === "/sin-acceso", "a deactivated staff member is out at once");
  await c2.close();

  // 4. Drivers: a refusal that says what is wrong, then a new driver, then an edit
  await ops.open(page, "/repartidores");
  const driversBefore = await ops.tableRows(page);
  await ops.registerDriver(page, {
    email: "comprador3@yuntera.example",
    fullName: "Sofía Vargas Rojas",
    phone: "2222-3333",
    idType: "fisica",
    idNumber: "1-0987-0123",
    vehicleType: "motorcycle",
    capacityKg: "35",
    plate: "mot 123456",
    licenseClass: "a2",
    licenseExpiresOn: "2029-05-31",
    inspectionExpiresOn: "2027-08-15",
    insuranceExpiresOn: "2027-03-01",
  });
  const landline = await ops.driverFormRefusal(page);
  log("driver with a landline:", landline.message, "| name kept:", landline.name);
  expect(landline.message.includes("celular"), "the form says the phone must be a mobile");
  expect(landline.name === "Sofía Vargas Rojas", "and keeps the rest of what was typed");
  await ops.registerDriver(page, { phone: "6111-3456" });
  await ops.waitForRowCount(page, driversBefore + 1);
  const sofia = () => ops.rowText(page, "Sofía Vargas Rojas");
  log("new driver:", (await sofia()).slice(0, 190));
  expect(
    (await sofia()).includes(word("driver_status", "pending", { viewer: "staff" })),
    "a new driver starts pending",
  );
  expect((await sofia()).includes("MOT123456"), "the plate is tidied");
  await page.screenshot({ path: SHOTS + "/pe2-drivers.png", fullPage: true });
  let roles = await rpcAs("comprador3@yuntera.example", "my_roles");
  log("the driver's own account says:", JSON.stringify(roles.driver));
  expect(roles.driver && roles.driver.status === "pending", "the account now has a driver record");

  // Activate with the existing control, then correct the record
  await ops.setDriverRowStatus(page, "Sofía Vargas Rojas", "active");
  const editing = await ops.openDriverEdit(page, "Sofía Vargas Rojas");
  log("edit form:", editing.heading, "| plate:", editing.plate);
  expect(editing.phone === "6111-3456", "the edit form starts from the saved record");
  await ops.editDriver(page, {
    vehicleType: "car",
    plate: "BRT-555",
    capacityKg: "220",
    licenseClass: "B1",
  });
  await ops.waitForRowSaying(page, "Sofía Vargas Rojas", "BRT-555");
  log("after the edit:", (await sofia()).slice(0, 190));
  expect(
    (await sofia()).includes(word("driver_status", "active", { viewer: "staff" })),
    "editing does not change the status",
  );
  await page.screenshot({ path: SHOTS + "/pe3-driver-edit.png", fullPage: true });

  // 5. Warehouse workers: add, promote, remove
  await ops.open(page, "/bodegas");
  log("warehouse:", (await ops.warehouseText(page, "SJO1")).slice(0, 150));
  const worker = await ops.addWarehouseWorker(
    page,
    "SJO1",
    "comprador3@yuntera.example",
    "associate",
    "Sofía Vargas Rojas",
  );
  log("new worker:", worker.slice(0, 120));
  expect(worker.includes("Auxiliar de bodega"), "added as an associate");
  roles = await rpcAs("comprador3@yuntera.example", "my_roles");
  log("the worker's own account says:", JSON.stringify(roles.warehouses));
  expect(
    roles.warehouses.length === 1 && roles.warehouses[0].code === "SJO1",
    "the worker can enter SJO1",
  );
  await ops.setWarehouseRole(page, "SJO1", "Sofía Vargas Rojas", "lead");
  await ops.waitForWorkerRole(page, "SJO1", "Sofía Vargas Rojas", "Líder de bodega");
  await page.screenshot({ path: SHOTS + "/pe4-warehouse.png", fullPage: true });
  await ops.setWarehouseRole(page, "SJO1", "Kattia Rodríguez Salas", "remove");
  await ops.waitForNameGone(page, "Kattia Rodríguez Salas");
  roles = await rpcAs("bodega@yuntera.example", "my_roles");
  log("after removing the former lead, her account says:", JSON.stringify(roles.warehouses));
  expect(roles.warehouses.length === 0, "a removed worker loses the warehouse at once");

  // 6. The audit trail has all of it, by name
  await ops.open(page, "/auditoria");
  const first = await ops.tableRow(page);
  log("audit rows:", await ops.tableRows(page), "| newest:", first.slice(0, 170));
  expect(first.includes("Gabriela Soto Marín"), "the newest entry names who did it");
  expect(first.includes("Kattia Rodríguez Salas"), "and who it was done to");
  const whole = await ops.tableText(page);
  for (const name of [
    "Andrés Mora Chaves",
    "Sofía Vargas Rojas",
    "Personal de bodega",
    "Repartidores",
  ]) {
    expect(whole.includes(name), `the audit trail mentions ${name}`);
  }
  await page.screenshot({ path: SHOTS + "/pe5-audit.png" });
  await context.close();

  // 7. Phone width
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const m = await phone.newPage();
  watch(m);
  await signIn(m, "central@yuntera.example", "/");
  for (const path of ["/personal", "/repartidores", "/bodegas"]) {
    await ops.open(m, path);
    const overflow = await m.evaluate(
      // Against the phone's width itself: with isMobile the layout viewport
      // grows to fit wide content, so innerWidth would hide the overflow.
      () => document.documentElement.scrollWidth - 390,
    );
    log(`mobile ${path} overflow px:`, overflow);
    expect(overflow <= 0, `${path} fits a 390 px screen`);
    await m.screenshot({
      path: `${SHOTS}/pe6-mobile${path.replace("/", "-")}.png`,
      fullPage: true,
    });
  }

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
