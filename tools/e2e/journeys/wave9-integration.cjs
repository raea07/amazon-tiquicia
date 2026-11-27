// Wave 9 as one whole, at phone size (390 px):
//
//   1. Who sees what (docs/03-data/access-control.md, "Support desk and system
//      health: who sees what"). The administrator and a demo shopper made, in
//      turn, support, ops, finance and catalogue staff: for each, whether the
//      navigation offers Casos and Salud del sistema, and whether /casos,
//      /casos/respuestas, /casos/informe, /clientes/<id> and /salud open or
//      send the person to "Sin acceso". The navigation never offers a page
//      that then refuses the role, and no page opens for a role its
//      functions refuse.
//   2. One answer for "late": with a case made late, Salud del sistema's
//      "Casos atrasados", Hoy's cases line and the "Atrasado" clocks of
//      /casos give the same number; the line links to Casos.
//   3. A customer's own delivery code typed into a complaint reaches staff
//      masked, on the case page and in Atención.
//
// Fails on any console error, uncaught exception or 5xx (a "Sin acceso" page
// is an ordinary answer).

const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set: run through tools/dev/stack.sh e2e");
const ADMIN = "central@yuntera.example";
const STAFF = "comprador3@yuntera.example";
const SHOPPER = "comprador@yuntera.example";

const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

function sql(statement) {
  const run = spawnSync(
    "psql",
    [DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
  return run.stdout.trim();
}

// What each role reaches: [Casos in the menu, Salud in the menu, pages that open].
const TABLE = {
  admin: [true, true, ["/casos", "/casos/respuestas", "/casos/informe", "/clientes", "/salud"]],
  support: [true, true, ["/casos", "/casos/respuestas", "/casos/informe", "/clientes", "/salud"]],
  ops: [true, true, ["/casos", "/clientes", "/salud"]],
  finance: [true, true, ["/casos", "/clientes", "/salud"]],
  catalog: [true, false, ["/casos"]],
};
const PAGES = ["/casos", "/casos/respuestas", "/casos/informe", "/clientes", "/salud"];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
    else log(`  ok: ${message}`);
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
    await page.goto(`${base}/ingresar`, { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
    await page.waitForLoadState("networkidle");
  };
  const fits = async (page, what) =>
    check(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      `${what} fits 390 px without sideways scrolling`,
    );

  // A customer with a case: the shopper's order with a live delivery code,
  // and a complaint in which they typed that code.
  const order = sql(`select o.order_number from public.orders o join auth.users u on u.id = o.user_id
    join private.delivery_codes c on c.order_id = o.id
    where u.email = '${SHOPPER}' and o.status not in ('delivered', 'completed', 'cancelled', 'refunded')
    order by o.placed_at desc limit 1`);
  const code = sql(`select c.code from private.delivery_codes c join public.orders o on o.id = c.order_id
    where o.order_number = '${order}'`);
  const complaint = sql(`insert into public.complaints (user_id, order_id, category, description)
    select o.user_id, o.id, 'delivery', 'El repartidor me pidió el código y le dije ${code} por teléfono.'
    from public.orders o where o.order_number = '${order}' returning id`);
  const caseId = sql(`select id from private.cases where complaint_id = '${complaint}'`);
  const customer = sql(`select user_id from private.cases where id = '${caseId}'`);
  log("order:", order, "case:", caseId);

  // ── 1. Who sees what ──────────────────────────────────────────────────────
  sql(`insert into public.staff_members (user_id, role)
       select id, 'support' from auth.users where email = '${STAFF}'
       on conflict (user_id) do update set role = 'support', active = true`);
  const admin = await phone();
  await signIn(admin, OPS, ADMIN);
  const staff = await phone();
  await signIn(staff, OPS, STAFF);
  for (const role of Object.keys(TABLE)) {
    const page = role === "admin" ? admin : staff;
    if (role !== "admin") {
      sql(`update public.staff_members set role = '${role}' where user_id = (select id from auth.users where email = '${STAFF}')`);
    }
    const [casos, salud, open] = TABLE[role];
    await page.goto(`${OPS}/cuenta`, { waitUntil: "networkidle" });
    const menu = page.locator("details");
    check(
      ((await menu.locator('a[href="/casos"]').count()) > 0) === casos,
      `${role}: the menu ${casos ? "offers" : "does not offer"} Casos`,
    );
    check(
      ((await menu.locator('a[href="/salud"]').count()) > 0) === salud,
      `${role}: the menu ${salud ? "offers" : "does not offer"} Salud del sistema`,
    );
    for (const path of PAGES) {
      const url = path === "/clientes" ? `/clientes/${customer}` : path;
      await page.goto(`${OPS}${url}`, { waitUntil: "networkidle" });
      const refused = new URL(page.url()).pathname === "/sin-acceso";
      check(
        !refused === open.includes(path),
        `${role}: ${path} ${open.includes(path) ? "opens" : "sends to Sin acceso"}`,
      );
    }
    // A page the menu offers is never one that refuses the role.
    check(!casos || open.includes("/casos"), `${role}: Casos in the menu opens`);
    check(!salud || open.includes("/salud"), `${role}: Salud in the menu opens`);
  }
  await staff.goto(`${OPS}/sin-acceso`, { waitUntil: "networkidle" });
  await staff.screenshot({ path: SHOTS + "/w9-catalog-refused.png", fullPage: true });

  // ── 2. One answer for "late" ──────────────────────────────────────────────
  sql(`update private.cases set first_response_due_at = now() - interval '1 hour'
       where id = '${caseId}'`);
  await admin.goto(`${OPS}/salud`, { waitUntil: "networkidle" });
  const line = admin.locator('[data-health="cases_late"]');
  const said = await text(line);
  const onHealth = Number(/(\d+) casos? (está|están) atrasados?/.exec(said)?.[1] ?? "0");
  check(onHealth >= 1, `Salud del sistema: "${said.slice(0, 120)}"`);
  check(
    (await line.locator('a[href="/casos"]').count()) === 1,
    "the cases line links to Casos",
  );
  await fits(admin, "Salud del sistema");
  await admin.screenshot({ path: SHOTS + "/w9-health-cases-late.png", fullPage: true });
  await admin.goto(`${OPS}/`, { waitUntil: "networkidle" });
  const hoy = await text(admin.locator('[data-testid="cases-due"]'));
  const onHoy = Number(/Casos: (\d+) atrasados?/.exec(hoy)?.[1] ?? "-1");
  check(onHoy === onHealth, `Hoy says ${onHoy} late, Salud ${onHealth}`);
  await admin.goto(`${OPS}/casos`, { waitUntil: "networkidle" });
  const rows = admin.locator('[data-testid="case-row"]');
  const total = await rows.count();
  let late = 0;
  for (let i = 0; i < total; i++) {
    if ((await text(rows.nth(i))).includes("Atrasado")) late++;
  }
  const listed = Number(sql("select count(*) from private.cases where status = 'open'"));
  if (listed <= 50) {
    check(late === onHealth, `Casos marks ${late} "Atrasado", Salud ${onHealth}`);
  } else {
    log(`  (Casos lists the first 50 of ${listed} open cases: compared with Hoy only)`);
  }
  await fits(admin, "Casos");

  // ── 3. The customer's own code reaches staff masked ───────────────────────
  await admin.goto(`${OPS}/casos/${caseId}`, { waitUntil: "networkidle" });
  const onCase = await text(admin.locator("main"));
  check(
    onCase.includes("le dije •••• por teléfono") && !onCase.includes(code),
    "the case page masks the customer's own delivery code",
  );
  await fits(admin, "the case page");
  await admin.screenshot({ path: SHOTS + "/w9-case-masked.png", fullPage: true });
  await admin.goto(`${OPS}/atencion`, { waitUntil: "networkidle" });
  const care = await text(admin.locator("main"));
  check(
    care.includes("le dije •••• por teléfono") && !care.includes(`le dije ${code}`),
    "Atención masks it too",
  );
  const shopper = await phone();
  await signIn(shopper, WEB, SHOPPER);
  check(
    sql(`select description from public.complaints where id = '${complaint}'`).includes(code),
    "the customer's complaint keeps their own words",
  );

  await browser.close();
  if (errors.length) {
    console.error("FAILED:\n  " + errors.join("\n  "));
    process.exit(1);
  }
  log("\nwave9-integration journey passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
