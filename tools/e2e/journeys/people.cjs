// People journey: an administrator gives an account a staff role (and takes it away), registers
// a driver, assigns a warehouse worker, and finds all of it in the audit trail by name.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const BASE = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
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
  const signIn = async (page, email, expectPath) => {
    await page.goto(BASE + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === expectPath);
  };

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const page = await context.newPage();
  watch(page);
  await signIn(page, "central@yuntera.example", "/");
  await page.waitForSelector("main h2:visible");
  const nav = await text(page.locator('nav[aria-label="Secciones"]'));
  log("admin nav:", nav);
  for (const label of ["Personal", "Bodegas", "Pagos a vendedores", "Repartidores"]) {
    expect(nav.includes(label), `the administrator's menu has "${label}"`);
  }

  // 1. Staff: the list, a refusal that keeps what was typed, then a real grant
  await page.goto(BASE + "/personal", { waitUntil: "networkidle" });
  const staffRows = page.locator("main:visible tbody tr");
  log("staff rows:", await staffRows.count(), "|", (await text(staffRows.first())).slice(0, 120));
  expect((await staffRows.count()) === 1, "the seed has one staff member");
  expect((await text(staffRows.first())).includes("(usted)"), "your own row is marked");

  const grant = page.locator('main:visible section[aria-labelledby="nuevo"]');
  await grant.locator('input[name="email"]').fill("nadie@yuntera.example");
  await grant.locator('select[name="role"]').selectOption("finance");
  await grant.locator('button[type="submit"]').click();
  await grant.locator('[role="alert"]').waitFor();
  log(
    "grant to an unknown e-mail:",
    await text(grant.locator('[role="alert"]')),
    "| e-mail kept:",
    await grant.locator('input[name="email"]').inputValue(),
  );
  expect(
    (await text(grant.locator('[role="alert"]'))).includes("No hay ninguna cuenta"),
    "an e-mail with no account is refused in words",
  );
  expect(
    (await grant.locator('input[name="email"]').inputValue()) === "nadie@yuntera.example",
    "the form keeps what was typed",
  );

  await grant.locator('input[name="email"]').fill("comprador2@yuntera.example");
  await grant.locator('select[name="role"]').selectOption("support");
  await grant.locator('button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelectorAll("main tbody tr").length === 2);
  log("after granting:", await text(grant.locator('[role="status"]')));
  const andres = page.locator('main:visible tbody tr:has-text("Andrés Mora Chaves")');
  log("new staff row:", (await text(andres)).slice(0, 110));
  await page.screenshot({ path: SHOTS + "/pe1-staff.png", fullPage: true });

  // The last administrator cannot switch themselves off
  const own = page.locator('main:visible tbody tr:has-text("(usted)")');
  await own.locator('select[name="access"]').selectOption("inactive");
  await own.locator('button[type="submit"]').click();
  await own.locator('[role="alert"]').waitFor();
  log("last administrator:", await text(own.locator('[role="alert"]')));
  expect(
    (await text(own.locator('[role="alert"]'))).includes("al menos una persona administradora"),
    "the platform keeps one administrator",
  );

  // 2. The new staff member can enter the console, as far as their role goes
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CR" });
  const p2 = await c2.newPage();
  watch(p2);
  await signIn(p2, "comprador2@yuntera.example", "/");
  await p2.waitForSelector("main h2:visible");
  const supportNav = await text(p2.locator('nav[aria-label="Secciones"]'));
  log(
    "support nav:",
    supportNav,
    "| header:",
    (await text(p2.locator("header").first())).slice(0, 90),
  );
  expect(supportNav.includes("Atención"), "support staff see the care section");
  expect(!supportNav.includes("Personal"), "but not staff management");
  await p2.goto(BASE + "/atencion", { waitUntil: "networkidle" });
  expect(new URL(p2.url()).pathname === "/atencion", "support staff open the care queues");
  await p2.goto(BASE + "/personal", { waitUntil: "networkidle" });
  log("support on /personal ->", new URL(p2.url()).pathname);
  expect(new URL(p2.url()).pathname === "/sin-acceso", "staff management is closed to them");

  // 3. A change of role, then access withdrawn: both apply to the very next request
  await andres.locator('select[name="role"]').selectOption("catalog");
  await andres.locator('button[type="submit"]').click();
  await andres.locator('[role="status"]').waitFor();
  await p2.goto(BASE + "/catalogo", { waitUntil: "networkidle" });
  log("as catalogue staff on /catalogo ->", new URL(p2.url()).pathname);
  expect(new URL(p2.url()).pathname === "/catalogo", "the new role works on the next click");

  await andres.locator('select[name="access"]').selectOption("inactive");
  await andres.locator('button[type="submit"]').click();
  await page.waitForSelector(
    'main:visible tbody tr:has-text("Andrés Mora Chaves") >> text=Sin acceso',
  );
  await p2.goto(BASE + "/catalogo", { waitUntil: "networkidle" });
  log("after access was withdrawn ->", new URL(p2.url()).pathname);
  expect(new URL(p2.url()).pathname === "/sin-acceso", "a deactivated staff member is out at once");
  await c2.close();

  // 4. Drivers: a refusal that says what is wrong, then a new driver, then an edit
  await page.goto(BASE + "/repartidores", { waitUntil: "networkidle" });
  const driversBefore = await page.locator("main:visible tbody tr").count();
  const create = page.locator('main:visible section[aria-labelledby="nuevo"]');
  const fill = async (form, values) => {
    for (const [name, value] of Object.entries(values)) {
      const field = form.locator(`[name="${name}"]`);
      if ((await field.evaluate((el) => el.tagName)) === "SELECT") await field.selectOption(value);
      else await field.fill(value);
    }
  };
  await fill(create, {
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
  await create.locator('button[type="submit"]').click();
  await create.locator('[role="alert"]').waitFor();
  log(
    "driver with a landline:",
    await text(create.locator('[role="alert"]')),
    "| name kept:",
    await create.locator('input[name="fullName"]').inputValue(),
  );
  expect(
    (await text(create.locator('[role="alert"]'))).includes("celular"),
    "the form says the phone must be a mobile",
  );
  expect(
    (await create.locator('input[name="fullName"]').inputValue()) === "Sofía Vargas Rojas",
    "and keeps the rest of what was typed",
  );
  await create.locator('input[name="phone"]').fill("6111-3456");
  await create.locator('button[type="submit"]').click();
  await page.waitForFunction(
    (n) => document.querySelectorAll("main tbody tr").length === n + 1,
    driversBefore,
  );
  const sofia = page.locator('main:visible tbody tr:has-text("Sofía Vargas Rojas")');
  log("new driver:", (await text(sofia)).slice(0, 190));
  expect((await text(sofia)).includes("Por aprobar"), "a new driver starts pending");
  expect((await text(sofia)).includes("MOT123456"), "the plate is tidied");
  await page.screenshot({ path: SHOTS + "/pe2-drivers.png", fullPage: true });

  let roles = await rpcAs("comprador3@yuntera.example", "my_roles");
  log("the driver's own account says:", JSON.stringify(roles.driver));
  expect(roles.driver && roles.driver.status === "pending", "the account now has a driver record");

  // Activate with the existing control, then correct the record
  await sofia.locator('select[name="status"]').selectOption("active");
  await sofia.locator('button:has-text("Guardar")').click();
  await page.waitForSelector('main:visible tbody tr:has-text("Sofía Vargas Rojas") >> text=Activo');
  await sofia.locator('a:has-text("Editar datos")').click();
  const edit = page.locator('main:visible section[aria-labelledby="editar"]');
  await edit.waitFor();
  log(
    "edit form:",
    await text(edit.locator("h2")),
    "| plate:",
    await edit.locator('input[name="plate"]').inputValue(),
  );
  expect(
    (await edit.locator('input[name="phone"]').inputValue()) === "6111-3456",
    "the edit form starts from the saved record",
  );
  await edit.locator('select[name="vehicleType"]').selectOption("car");
  await edit.locator('input[name="plate"]').fill("BRT-555");
  await edit.locator('input[name="capacityKg"]').fill("220");
  await edit.locator('input[name="licenseClass"]').fill("B1");
  await edit.locator('button[type="submit"]').click();
  await edit.locator('[role="status"]').waitFor();
  await page.waitForSelector(
    'main:visible tbody tr:has-text("Sofía Vargas Rojas") >> text=BRT-555',
  );
  log("after the edit:", (await text(sofia)).slice(0, 190));
  expect((await text(sofia)).includes("Activo"), "editing does not change the status");
  await page.screenshot({ path: SHOTS + "/pe3-driver-edit.png", fullPage: true });

  // 5. Warehouse workers: add, promote, remove
  await page.goto(BASE + "/bodegas", { waitUntil: "networkidle" });
  const site = page.locator('main:visible ul > li:has-text("SJO1")').first();
  log("warehouse:", (await text(site)).slice(0, 150));
  const add = site.locator('form:has(button:has-text("Agregar a la bodega"))');
  await add.locator('input[name="email"]').fill("comprador3@yuntera.example");
  await add.locator('select[name="role"]').selectOption("associate");
  await add.locator('button[type="submit"]').click();
  const worker = site.locator('li:has-text("Sofía Vargas Rojas")');
  await worker.waitFor();
  log("new worker:", (await text(worker)).slice(0, 120));
  expect((await text(worker)).includes("Auxiliar de bodega"), "added as an associate");
  roles = await rpcAs("comprador3@yuntera.example", "my_roles");
  log("the worker's own account says:", JSON.stringify(roles.warehouses));
  expect(
    roles.warehouses.length === 1 && roles.warehouses[0].code === "SJO1",
    "the worker can enter SJO1",
  );

  await worker.locator('select[name="role"]').selectOption("lead");
  await worker.locator('button:has-text("Guardar")').click();
  await site.locator('li:has-text("Sofía Vargas Rojas") >> text=Líder de bodega').first().waitFor();
  await page.screenshot({ path: SHOTS + "/pe4-warehouse.png", fullPage: true });

  const kattia = site.locator('li:has-text("Kattia Rodríguez Salas")');
  await kattia.locator('select[name="role"]').selectOption("remove");
  await kattia.locator('button:has-text("Guardar")').click();
  await page.waitForFunction(
    () => !document.querySelector("main")?.innerText.includes("Kattia Rodríguez Salas"),
  );
  roles = await rpcAs("bodega@yuntera.example", "my_roles");
  log("after removing the former lead, her account says:", JSON.stringify(roles.warehouses));
  expect(roles.warehouses.length === 0, "a removed worker loses the warehouse at once");

  // 6. The audit trail has all of it, by name
  await page.goto(BASE + "/auditoria", { waitUntil: "networkidle" });
  const audit = page.locator("main:visible tbody tr");
  const first = await text(audit.first());
  log("audit rows:", await audit.count(), "| newest:", first.slice(0, 170));
  expect(first.includes("Gabriela Soto Marín"), "the newest entry names who did it");
  expect(first.includes("Kattia Rodríguez Salas"), "and who it was done to");
  const whole = await text(page.locator("main:visible table"));
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
    await m.goto(BASE + path, { waitUntil: "networkidle" });
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
