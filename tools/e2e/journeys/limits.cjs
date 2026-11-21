// Limits journey: a shop invites someone who accepts; a seller asks for a new contact phone
// and a new shop name, staff approve one and reject the other with a reason the seller reads;
// a visitor's report about a listing that does not exist is refused politely and a repeated
// report is counted once; a suspended driver is told the account has no access.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FIELD = process.env.FIELD_URL || "http://127.0.0.1:3003";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
const expect = (condition, message) => {
  if (!condition) throw new Error("expected: " + message);
};

// Asks the API directly, as a given person, what the database now says.
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
  const body = r.status() === 204 ? null : await r.json().catch(() => null);
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
  const signIn = async (page, base, email, landsOn) => {
    await page.goto(base + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === landsOn);
    await page.waitForLoadState("networkidle");
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const phone = () =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    });

  // 1. A shop invites a member, who accepts
  const ownerContext = await phone();
  const owner = await ownerContext.newPage();
  watch(owner);
  await signIn(owner, SELLER, "sendero@yuntera.example", "/");
  await owner.goto(SELLER + "/equipo", { waitUntil: "networkidle" });
  const invite = owner.locator('main:visible section[aria-labelledby="invitar"]');
  await invite.locator('input[name="email"]').fill("persona@correo");
  await invite.locator('button[type="submit"]').click();
  await invite.locator('[role="alert"]').waitFor();
  log("invitation to a malformed address:", await text(invite.locator('[role="alert"]')));
  await invite.locator('input[name="email"]').fill("comprador2@yuntera.example");
  await invite.locator('select[name="role"]').selectOption("staff");
  await invite.locator('button[type="submit"]').click();
  await invite.locator('[role="status"]').waitFor();
  const sent = await text(invite.locator('[role="status"]'));
  log("invitation sent:", sent);
  expect(sent.includes("comprador2@yuntera.example"), "the owner is told the invitation went out");
  await owner.reload({ waitUntil: "networkidle" });
  const waiting = await text(owner.locator('main:visible section[aria-labelledby="pendientes"]'));
  log("waiting:", waiting.slice(0, 160));
  expect(waiting.includes("comprador2@yuntera.example"), "the invitation waits for an answer");
  expect((await overflow(owner)) <= 0, "the team page fits a phone");
  await owner.screenshot({ path: SHOTS + "/l1-team-invited.png", fullPage: true });
  const before = await rpcAs("comprador2@yuntera.example", "my_roles");
  expect(before.sellers.length === 0, "being invited does not make anyone a member");

  const memberContext = await phone();
  const member = await memberContext.newPage();
  watch(member);
  // Someone with no shop lands on registration, which points to the invitation.
  await signIn(member, SELLER, "comprador2@yuntera.example", "/registro");
  const notice = member.locator('main:visible [role="status"]:has-text("Le invitaron")');
  await notice.waitFor();
  log("registration says:", await text(notice));
  await notice.locator('a:has-text("vea la invitación")').click();
  await member.waitForURL((u) => new URL(u).pathname === "/invitaciones");
  await member.waitForSelector('main:visible li:has-text("Tienda Sendero")');
  log("invitation:", (await text(member.locator("main:visible li").first())).slice(0, 200));
  expect((await overflow(member)) <= 0, "the invitation fits a phone");
  await member.screenshot({ path: SHOTS + "/l2-invitation.png", fullPage: true });
  await member.locator('main:visible button:has-text("Aceptar y unirme")').click();
  await member.waitForURL((u) => new URL(u).search.includes("unido=1"));
  const joined = member.locator('main:visible [role="status"]:has-text("Ya es parte del equipo")');
  await joined.waitFor();
  log("after accepting:", await text(joined));
  await joined.locator('a:has-text("Ir al resumen")').click();
  await member.waitForURL((u) => new URL(u).pathname === "/");
  await member.waitForSelector('main h1:visible:has-text("Tienda Sendero")');
  const after = await rpcAs("comprador2@yuntera.example", "my_roles");
  expect(
    after.sellers.some((s) => s.slug === "tienda-sendero" && s.role === "staff"),
    "accepting makes them staff of the shop",
  );
  // Leaving asks for a confirmation, and says afterwards what happened.
  await member.goto(SELLER + "/equipo", { waitUntil: "networkidle" });
  const leave = member.locator('main:visible form:has(button:has-text("Salir del equipo"))');
  await leave.locator('input[name="confirma"]').check();
  await leave.locator('button:has-text("Salir del equipo")').click();
  await member.waitForURL((u) => new URL(u).search.includes("salio=1"));
  const left = member.locator('main:visible [role="status"]:has-text("Salió del equipo")');
  await left.waitFor();
  log("after leaving:", await text(left));
  const gone = await rpcAs("comprador2@yuntera.example", "my_roles");
  expect(gone.sellers.length === 0, "leaving ends the membership");
  await memberContext.close();

  // 2. The seller asks for a new contact phone and a new shop name
  await owner.goto(SELLER + "/cuenta", { waitUntil: "networkidle" });
  const shopCard = owner.locator('main:visible section:has(h2:has-text("Tienda"))').first();
  const nameForm = shopCard.locator('form:has(input[name="tradeName"])');
  await nameForm.locator('input[name="tradeName"]').fill("Yuntera Oficial");
  await nameForm.locator('button[type="submit"]').click();
  await nameForm.locator('[role="alert"]').waitFor();
  const refusedName = await text(nameForm.locator('[role="alert"]'));
  log("a name that imitates the platform:", refusedName);
  expect(
    refusedName.includes("parece de Yuntera"),
    "a name like the platform's is refused, plainly",
  );
  await nameForm.locator('input[name="tradeName"]').fill("Sendero Aventura");
  await nameForm.locator('button[type="submit"]').click();
  await shopCard.locator("text=Cambio de nombre de la tienda en revisión").waitFor();
  const contactForm = shopCard.locator('form:has(input[name="contactPhone"])');
  await contactForm.locator('input[name="contactPhone"]').fill("2289-0999");
  await contactForm.locator('button[type="submit"]').click();
  await shopCard.locator("text=Cambio de correo y teléfono en revisión").waitFor();
  // While the contact change waits, the payout account cannot be changed.
  const payoutCard = owner.locator('main:visible section:has(h2:has-text("Dónde le pagamos"))');
  await owner.reload({ waitUntil: "networkidle" });
  expect(
    (await text(payoutCard)).includes(
      "Hay un cambio del teléfono o el correo de la tienda en revisión",
    ),
    "the payout form waits for the contact change",
  );
  expect(
    (await payoutCard.locator('input[name="iban"]').count()) === 0,
    "and is not offered meanwhile",
  );
  // A fiscal change that only touches the address keeps the postal code on file.
  const fiscalCard = owner.locator('main:visible section:has(h2:has-text("Identidad fiscal"))');
  const fiscalForm = fiscalCard.locator('form:has(textarea[name="fiscalAddress"])');
  const postal = await fiscalForm.locator('input[name="postalCode"]').inputValue();
  log("postal code the fiscal form starts from:", postal);
  expect(postal === "10203", "the fiscal form starts from the postal code on file");
  await fiscalForm
    .locator('textarea[name="fiscalAddress"]')
    .fill("Escazú, San Rafael, Plaza Colonial local 5, segundo piso");
  await fiscalForm.locator('button[type="submit"]').click();
  await fiscalCard.locator("text=Cambio de datos fiscales en revisión").waitFor();
  log("waiting for staff:", (await text(shopCard)).slice(0, 300));
  expect(
    (await text(shopCard.locator("dl"))).includes("Tienda Sendero"),
    "the name does not change before staff decide",
  );
  expect((await overflow(owner)) <= 0, "the account page fits a phone");
  await owner.screenshot({ path: SHOTS + "/l3-account-requests.png", fullPage: true });

  // 3. Staff approve the phone and reject the name, with a reason
  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const staff = await staffContext.newPage();
  watch(staff);
  await signIn(staff, OPS, "central@yuntera.example", "/");
  const nav = await text(staff.locator('nav[aria-label="Secciones"]'));
  expect(nav.includes("Cambios de tienda"), "the console has the queue in its menu");
  await staff.goto(OPS + "/cambios-tienda", { waitUntil: "networkidle" });
  const cards = staff.locator('main:visible section[aria-labelledby="por-resolver"] ul > li');
  log("staff queue:", await cards.count());
  expect((await cards.count()) === 3, "the three requests wait");
  await staff.screenshot({ path: SHOTS + "/l4a-staff-queue-waiting.png", fullPage: true });
  const contactCard = cards.filter({ hasText: "Correo y teléfono" });
  log("contact card:", (await text(contactCard)).slice(0, 260));
  expect((await text(contactCard)).includes("2289-0404"), "the number to call is the one on file");
  await contactCard.locator('button:has-text("Aprobar el cambio")').click();
  await staff.waitForURL((u) => new URL(u).search.includes("resuelta=aprobada"));
  const fiscalCardStaff = staff
    .locator('main:visible section[aria-labelledby="por-resolver"] ul > li')
    .filter({ hasText: "Datos fiscales" });
  const waitingBefore = await cards.count();
  await fiscalCardStaff.locator('button:has-text("Aprobar el cambio")').click();
  await staff
    .waitForFunction(
      (n) =>
        document.querySelectorAll('main section[aria-labelledby="por-resolver"] > ul > li').length <
        n,
      waitingBefore,
      { timeout: 15000 },
    )
    .catch(async () => {
      throw new Error(`the fiscal change was not approved: ${await text(fiscalCardStaff)}`);
    });
  const nameCard = staff
    .locator('main:visible section[aria-labelledby="por-resolver"] ul > li')
    .filter({ hasText: "Nombre de la tienda" });
  await nameCard.locator('button:has-text("Rechazar")').click();
  await nameCard.locator('[role="alert"]').waitFor();
  log("rejection without a reason:", await text(nameCard.locator('[role="alert"]')));
  await nameCard
    .locator('textarea[name="note"]')
    .fill("El nombre debe coincidir con el que tiene inscrito en Hacienda.");
  await nameCard.locator('button:has-text("Rechazar")').click();
  await staff.waitForURL((u) => new URL(u).search.includes("resuelta=rechazada"));
  await staff.waitForSelector("text=No hay cambios por resolver.");
  await staff.screenshot({ path: SHOTS + "/l4b-staff-queue-decided.png", fullPage: true });

  // 4. The seller reads the outcome
  await owner.goto(SELLER + "/cuenta", { waitUntil: "networkidle" });
  const outcome = await text(
    owner.locator('main:visible section:has(h2:has-text("Tienda"))').first(),
  );
  log("seller reads:", outcome.slice(0, 420));
  expect(outcome.includes("No aprobamos el cambio de nombre"), "the rejection is shown");
  expect(outcome.includes("inscrito en Hacienda"), "with the reason staff wrote");
  expect(outcome.includes("2289-0999"), "and the approved phone is the shop's now");
  const onFile = await rpcAs("sendero@yuntera.example", "seller_shop_changes", {
    p_seller_id: (await rpcAs("sendero@yuntera.example", "my_roles")).sellers[0].id,
  });
  log("fiscal details on file now:", JSON.stringify(onFile.current.fiscal));
  expect(
    onFile.current.fiscal.postal_code === "10203" &&
      onFile.current.fiscal.fiscal_address.includes("segundo piso"),
    "the approved address is applied and the postal code survived",
  );
  await owner.screenshot({ path: SHOTS + "/l5-account-outcome.png", fullPage: true });
  await ownerContext.close();

  // 5. A visitor reports: a listing that does not exist, then the same listing twice
  const visitorContext = await phone();
  const visitor = await visitorContext.newPage();
  watch(visitor);
  const queueBefore = await rpcAs("central@yuntera.example", "ops_care_queues");
  await visitor.goto(WEB + "/reportar?producto=00000000-0000-4000-8000-000000000000", {
    waitUntil: "networkidle",
  });
  const fillReport = async (email) => {
    await visitor.selectOption('main select[name="reason"]', "counterfeit");
    await visitor.fill('main textarea[name="details"]', "La marca del empaque no es la original.");
    await visitor.fill('main input[name="email"]', email);
    await visitor.click('main button:has-text("Enviar el reporte")');
  };
  await fillReport("ana@correo.example");
  await visitor.locator('main [role="alert"]').waitFor();
  const missing = await text(visitor.locator('main [role="alert"]'));
  log("report about a listing that does not exist:", missing);
  expect(missing.includes("No encontramos eso en la tienda"), "it is refused, politely");
  expect(!/report_target|not_found/.test(missing), "and no code is shown");
  expect(
    (await visitor.locator('main select[name="reason"]').inputValue()) === "counterfeit",
    "what was typed is kept",
  );
  await visitor.screenshot({ path: SHOTS + "/l6-report-refused.png", fullPage: true });

  for (const attempt of [1, 2]) {
    await visitor.goto(WEB + "/p/licuadora-volcan-600w", { waitUntil: "networkidle" });
    await visitor.click('main a:has-text("Reportar un problema")');
    await visitor.waitForURL((u) => new URL(u).pathname === "/reportar");
    await visitor.waitForSelector('main select[name="reason"]');
    await fillReport("Ana@Correo.example");
    await visitor.locator('main [role="status"]').waitFor();
    log(`report ${attempt}:`, await text(visitor.locator('main [role="status"]')));
  }
  expect((await overflow(visitor)) <= 0, "the report page fits a phone");
  await visitor.screenshot({ path: SHOTS + "/l7-report-sent.png", fullPage: true });
  const queueAfter = await rpcAs("central@yuntera.example", "ops_care_queues");
  log("reports waiting:", queueBefore.totals.reports, "->", queueAfter.totals.reports);
  expect(
    queueAfter.totals.reports === queueBefore.totals.reports + 1,
    "the same report twice is counted once",
  );
  await visitorContext.close();

  // 6. A driver is suspended, and the field app says so
  await staff.goto(OPS + "/repartidores", { waitUntil: "networkidle" });
  const luis = staff.locator('main:visible tbody tr:has-text("Luis Alvarado Cruz")');
  await luis.locator('select[name="status"]').selectOption("suspended");
  await luis.locator('button:has-text("Guardar")').click();
  await staff.waitForSelector(
    'main:visible tbody tr:has-text("Luis Alvarado Cruz") >> text=Suspendido',
  );
  log("driver row:", (await text(luis)).slice(0, 120));
  await staffContext.close();

  const driverContext = await phone();
  const driver = await driverContext.newPage();
  watch(driver);
  await signIn(driver, FIELD, "repartidor2@yuntera.example", "/sin-acceso");
  await driver.locator("text=Su cuenta de repartidor está suspendida").waitFor();
  const said = await text(driver.locator("main:visible"));
  log("the suspended driver sees:", said.slice(0, 260));
  expect(said.includes("Su cuenta de repartidor está suspendida"), "the driver is told plainly");
  expect(!said.includes("Mi ruta"), "and sees no route");
  await driver.goto(FIELD + "/ruta", { waitUntil: "networkidle" });
  expect(new URL(driver.url()).pathname === "/sin-acceso", "the route page is closed to them");
  const day = await rpcAs("repartidor2@yuntera.example", "driver_today");
  expect(Array.isArray(day.routes) && day.routes.length === 0, "and the API gives no stops");
  expect((await overflow(driver)) <= 0, "the explanation fits a phone");
  await driver.screenshot({ path: SHOTS + "/l8-driver-suspended.png", fullPage: true });
  await driverContext.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
