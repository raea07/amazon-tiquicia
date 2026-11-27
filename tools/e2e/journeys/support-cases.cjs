// The support desk (migration 20261121084700_support_cases.sql), at phone size:
//
//   1. A shopper files a complaint from an order's page ("Presente un
//      reclamo" → /reclamo?pedido=…) and reads the reference and the dates by
//      which the acknowledgement and the written answer are promised. The
//      footer's link goes to the same form.
//   2. Support (a demo shopper made support staff for this run) finds the case
//      in Casos, oldest first with its clock in words, adds an internal note,
//      is refused a note holding the order's delivery code, answers with a
//      saved answer and closes the case.
//   3. The shopper reads the answer in "Sus consultas" and on the order's
//      page, and never the note.
//   4. Support records a WhatsApp contact from the console's order page, opens
//      the customer view from there and uses "Mostrar contacto" with a reason;
//      the administrator sees "Vio el contacto de un cliente" on Auditoría.
//   5. Finance (another demo shopper made finance staff) sees only its case
//      types: the payment contact, not the delivery complaint, whose page is
//      "not found"; "Hoy" carries the cases line.
//   6. Every new console page and the shop's form fit 390 px.
//
// Fails on any console error, uncaught exception or 5xx (a refused note is an
// ordinary answer, not an error).

const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const SHOPPER = "comprador@yuntera.example";
const SUPPORT = "comprador3@yuntera.example";
const FINANCE = "comprador2@yuntera.example";
const ADMIN = "central@yuntera.example";

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
  const phone = () =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    });
  const signIn = async (page, base, email, next = "") => {
    await page.goto(`${base}/ingresar${next ? `?siguiente=${encodeURIComponent(next)}` : ""}`, {
      waitUntil: "networkidle",
    });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
    await page.waitForLoadState("networkidle");
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const fits = async (page, what) =>
    check((await overflow(page)) <= 0, `${what} fits 390 px without sideways scrolling`);

  // Two demo shoppers work in the console for this run (the runner reseeds after).
  sql(`insert into public.staff_members (user_id, role)
       select id, 'support' from auth.users where email = '${SUPPORT}'
       on conflict (user_id) do update set role = 'support', active = true`);
  sql(`insert into public.staff_members (user_id, role)
       select id, 'finance' from auth.users where email = '${FINANCE}'
       on conflict (user_id) do update set role = 'finance', active = true`);
  // One of the shopper's orders that still has a delivery code.
  const orderNumber = sql(`select o.order_number from public.orders o
    join auth.users u on u.id = o.user_id join private.delivery_codes c on c.order_id = o.id
    where u.email = '${SHOPPER}' order by o.placed_at desc limit 1`);
  const code = sql(`select c.code from private.delivery_codes c
    join public.orders o on o.id = c.order_id where o.order_number = '${orderNumber}'`);
  log("order:", orderNumber);

  // ── 1. The shopper files a complaint from the order's page ────────────────
  const shopper = await (await phone()).newPage();
  watch(shopper);
  await signIn(shopper, WEB, SHOPPER, `/pedidos/${orderNumber}`);
  await shopper.goto(`${WEB}/pedidos/${orderNumber}`, { waitUntil: "networkidle" });
  const footerLink = await shopper
    .locator('footer a:has-text("Presentar un reclamo")')
    .getAttribute("href");
  check(footerLink === "/reclamo", `the footer links the complaint form (${footerLink})`);
  await shopper.locator('main a:has-text("Presente un reclamo")').click();
  await shopper.waitForURL((u) => new URL(u).pathname === "/reclamo");
  await shopper.waitForLoadState("networkidle");
  check(
    (await shopper.inputValue('input[name="orderNumber"]')) === orderNumber,
    "the form carries the order's number",
  );
  const promise = await text(shopper.locator("main p").first());
  check(
    promise.includes("1 día hábil") && promise.includes("5 días hábiles"),
    `the form says the promised times: ${promise}`,
  );
  await shopper.selectOption('select[name="category"]', "delivery");
  await shopper.fill(
    'textarea[name="description"]',
    "El paquete llegó con la caja abierta y faltaba el cargador.",
  );
  await fits(shopper, "the complaint form");
  await shopper.screenshot({ path: SHOTS + "/sc1-complaint-form.png", fullPage: true });
  await shopper.click('main form button[type="submit"]');
  const filed = shopper.locator('[data-testid="complaint-filed"]');
  await filed.waitFor({ timeout: 30_000 });
  const filedText = await text(filed);
  log("filed:", filedText);
  const reference = /reclamo ([0-9A-F]{8})/.exec(filedText)?.[1] ?? "";
  check(reference.length === 8, `the shopper reads the reference (${reference})`);
  check(
    (filedText.match(/a más tardar el/g) ?? []).length === 2,
    "and the dates of the acknowledgement and of the written answer",
  );
  await shopper.screenshot({ path: SHOTS + "/sc2-complaint-filed.png", fullPage: true });
  const caseId =
    sql(`select k.id from private.cases k join public.complaints c on c.id = k.complaint_id
    where upper(left(c.id::text, 8)) = '${reference}'`);

  // ── 2. Support works the case ─────────────────────────────────────────────
  const support = await (await phone()).newPage();
  watch(support);
  await signIn(support, OPS, SUPPORT, "/casos");
  await support.goto(`${OPS}/casos`, { waitUntil: "networkidle" });
  const list = await text(support.locator('[data-testid="case-list"]'));
  check(list.includes(`pedido ${orderNumber}`) && list.includes("María"), "Casos lists the case");
  check(
    /A tiempo|Vence pronto|Atrasado/.test(list) && /Responder: (quedan|atrasado por)/.test(list),
    "with its clock in words and the time left",
  );
  await fits(support, "Casos");
  await support.screenshot({ path: SHOTS + "/sc3-cases-list.png", fullPage: true });

  await support.goto(`${OPS}/casos/${caseId}`, { waitUntil: "networkidle" });
  check(
    (await text(support.locator("main"))).includes("el cliente nunca ve esta nota"),
    "the case page says the customer never sees a note",
  );
  await support.fill('textarea[name="note"]', `El cliente dijo que su código es ${code}.`);
  await support.click('button:has-text("Guardar la nota")');
  await support.waitForSelector("text=código de entrega del cliente");
  check(true, "a note with the order's delivery code is refused");
  await support.fill(
    'textarea[name="note"]',
    `Nota interna de prueba: revisar el empaque del pedido ${orderNumber}, tel. 8888-${code}.`,
  );
  await support.click('button:has-text("Guardar la nota")');
  await support.waitForSelector("text=Nota guardada. El cliente no la ve.");
  check(true, "a note with an order number and a phone number is kept");
  await support.click('button:has-text("Asignarme el caso")');
  await support.waitForSelector("text=Usted atiende este caso.");
  await support
    .getByLabel("Usar una respuesta guardada")
    .selectOption({ label: "Dónde está mi pedido" });
  const prefilled = await support.inputValue('textarea[name="answer"]');
  check(prefilled.startsWith("Gracias por escribirnos."), "a saved answer fills the answer");
  await support.fill(
    'textarea[name="answer"]',
    "Lamentamos lo de la caja. Le enviamos el cargador que faltaba el lunes, sin costo.",
  );
  await support.click('button:has-text("Responder y cerrar")');
  // Closed, the page redraws without the answer form: the timeline says it.
  await support.waitForSelector('[data-testid="case-entry-closed"]');
  check(
    (await text(support.locator('[data-testid="case-entry-answer"]'))).includes(
      "Le enviamos el cargador",
    ),
    "the answer is on the timeline",
  );
  check(true, "support answers and closes the case");
  await fits(support, "the case page");
  await support.screenshot({ path: SHOTS + "/sc4-case-answered.png", fullPage: true });

  // ── 3. The shopper reads the answer ───────────────────────────────────────
  await shopper.goto(`${WEB}/cuenta/casos`, { waitUntil: "networkidle" });
  const mine = await text(shopper.locator("main"));
  check(
    mine.includes(`Reclamo ${reference}`) && mine.includes("Le enviamos el cargador"),
    "the shopper reads the answer in Sus consultas",
  );
  check(!mine.includes("Nota interna de prueba"), "and never the internal note");
  await fits(shopper, "Sus consultas");
  await shopper.screenshot({ path: SHOTS + "/sc5-my-cases.png", fullPage: true });
  await shopper.goto(`${WEB}/pedidos/${orderNumber}`, { waitUntil: "networkidle" });
  const onOrder = await text(shopper.locator('section[aria-labelledby="consultas"]'));
  check(onOrder.includes("Le enviamos el cargador"), "and on the order's page");
  check(
    !(await text(shopper.locator("main"))).includes("Nota interna de prueba"),
    "the order page shows no note",
  );

  // ── 4. A WhatsApp contact, the customer view and "Mostrar contacto" ───────
  await support.goto(`${OPS}/pedidos/${orderNumber}`, { waitUntil: "networkidle" });
  await support.locator('summary:has-text("Registrar un contacto")').click();
  const form = support.locator('details:has(summary:has-text("Registrar un contacto"))');
  await form.locator('select[name="channel"]').selectOption("whatsapp");
  await form.locator('select[name="topic"]').selectOption("payment");
  await form
    .locator('textarea[name="summary"]')
    .fill("Preguntó por WhatsApp si ya salió el reembolso del envío.");
  await form.locator('button:has-text("Registrar el contacto")').click();
  await support.waitForSelector("text=Contacto registrado como caso.");
  const contactCase =
    sql(`select id from private.cases where kind = 'contact' and channel = 'whatsapp'
    order by created_at desc limit 1`);
  check(contactCase.length === 36, "the WhatsApp contact is a case of the order");
  await support.locator('a:has-text("Ver el cliente")').click();
  await support.waitForURL((u) => new URL(u).pathname.startsWith("/clientes/"));
  await support.waitForLoadState("networkidle");
  await support.waitForSelector('section[aria-labelledby="pedidos"]');
  const customerPath = new URL(support.url()).pathname;
  check(
    !/@|%40|\+506/.test(support.url()),
    `the customer view's address holds no contact (${customerPath})`,
  );
  const view = await text(support.locator("main"));
  check(view.includes("María") && view.includes(orderNumber), "the customer view: name and orders");
  check(!view.includes(SHOPPER), "no e-mail until it is asked for");
  await support.getByLabel("Para qué lo necesita").fill("Llamar por el cargador que faltaba.");
  await support.click('button:has-text("Mostrar contacto")');
  await support.waitForSelector(`text=Correo: ${SHOPPER}`);
  check(true, "Mostrar contacto shows the e-mail once a reason is given");
  await fits(support, "the customer view");
  await support.screenshot({ path: SHOTS + "/sc6-customer-view.png", fullPage: true });

  const admin = await (await phone()).newPage();
  watch(admin);
  await signIn(admin, OPS, ADMIN, "/auditoria");
  await admin.goto(`${OPS}/auditoria`, { waitUntil: "networkidle" });
  const trail = await text(admin.locator("main"));
  check(
    trail.includes("Vio el contacto de un cliente") &&
      trail.includes("Motivo: Llamar por el cargador que faltaba."),
    "Auditoría shows who saw a customer's contact, and why",
  );
  check(!trail.includes(SHOPPER), "and not the contact itself");
  await admin.goto(`${OPS}/casos/respuestas`, { waitUntil: "networkidle" });
  await fits(admin, "Respuestas guardadas");
  await admin.screenshot({ path: SHOTS + "/sc7-saved-replies.png", fullPage: true });
  await admin.goto(`${OPS}/casos/informe`, { waitUntil: "networkidle" });
  const report = await text(admin.locator("main"));
  check(
    report.includes("Primera respuesta a tiempo") && report.includes("Casos reabiertos"),
    "the monthly report shows the measures",
  );
  await fits(admin, "the monthly report");
  await admin.screenshot({ path: SHOTS + "/sc8-case-report.png", fullPage: true });

  // ── 5. Finance sees only its case types ───────────────────────────────────
  const finance = await (await phone()).newPage();
  watch(finance);
  await signIn(finance, OPS, FINANCE, "/");
  await finance.goto(`${OPS}/`, { waitUntil: "networkidle" });
  check(
    /Casos: \d+ atrasados? y \d+ vencen? hoy/.test(
      await text(finance.locator('[data-testid="cases-due"]')),
    ),
    "Hoy carries the cases line",
  );
  await finance.goto(`${OPS}/casos`, { waitUntil: "networkidle" });
  const financeList = await finance
    .locator('[data-testid="case-row"] a[href^="/casos/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  check(financeList.includes(`/casos/${contactCase}`), "finance sees the payment contact");
  await finance.goto(`${OPS}/casos?estado=cerrados`, { waitUntil: "networkidle" });
  const financeClosed = await finance
    .locator('[data-testid="case-row"] a[href^="/casos/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  check(!financeClosed.includes(`/casos/${caseId}`), "but not the delivery complaint");
  await finance.screenshot({ path: SHOTS + "/sc9-finance-cases.png", fullPage: true });
  // The browser reports a 404 document as a console error; that one message is expected here.
  const probe = await finance.context().newPage();
  probe.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("status of 404")) {
      errors.push("console: " + m.text().slice(0, 200));
    }
  });
  probe.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  const hidden = await probe.goto(`${OPS}/casos/${caseId}`, { waitUntil: "networkidle" });
  // Inside a streamed page the status may already be sent; what matters is
  // that the case itself is not shown, only the not-found screen.
  await probe.waitForSelector("text=No encontramos esa página");
  const probeText = await text(probe.locator("main"));
  check(
    !probeText.includes("El paquete llegó con la caja abierta"),
    `the complaint's page is not found for finance (status ${hidden?.status()})`,
  );

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
  log("\nThe support cases journey passed.");
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
