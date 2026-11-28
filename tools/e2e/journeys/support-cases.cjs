// The support desk (migration 20261121084700_support_cases.sql), at phone size:
//
//   1. A shopper files a complaint from an order's page ("Presente un
//      reclamo" → /reclamo?pedido=…) and reads the reference and the dates by
//      which the acknowledgement and the written answer are promised. The
//      footer's link goes to the same form.
//   2. Support (a demo shopper made support staff for this run) finds the case
//      in Casos, oldest first with its stamp in words, adds an internal note,
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
// Screen steps are in lib/web.cjs and lib/ops.cjs; status words come from
// lib/words.cjs. Fails on any console error, uncaught exception or 5xx (a
// refused note is an ordinary answer, not an error).

const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const web = require("../lib/web.cjs");
const ops = require("../lib/ops.cjs");
const { word } = require("../lib/words.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const SHOPPER = "comprador@yuntera.example";
const SUPPORT = "comprador3@yuntera.example";
const FINANCE = "comprador2@yuntera.example";
const ADMIN = "central@yuntera.example";
const STAFF = { viewer: "staff" };

const log = (...a) => console.log(...a);

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
  // Measured against the context's screen (kit.overflowPx), not innerWidth: in
  // a phone context a page that is too wide widens the layout viewport, and
  // innerWidth with it.
  const overflow = (page) => kit.overflowPx(page);
  const fits = async (page, what) =>
    check((await overflow(page)) <= 0, `${what} fits 390 px without sideways scrolling`);

  // Two demo shoppers work in the console for this run (the runner reseeds after).
  sql(`insert into public.staff_members (user_id, role)
       select id, 'support' from auth.users where email = '${SUPPORT}'
       on conflict (user_id) do update set role = 'support', active = true`);
  sql(`insert into public.staff_members (user_id, role)
       select id, 'finance' from auth.users where email = '${FINANCE}'
       on conflict (user_id) do update set role = 'finance', active = true`);
  // Three refused texts in an hour lock a writer out; earlier runs of this
  // journey on the same database must not count (the trail is otherwise
  // immutable, so the rows are moved back past the hour for this test only).
  sql(`alter table private.audit_log disable trigger audit_log_immutable;
       update private.audit_log set at = at - interval '2 hours'
       where action = 'REFUSED_CODE' and actor_id = (select id from auth.users where email = '${SUPPORT}');
       alter table private.audit_log enable trigger audit_log_immutable`);
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
  await web.signIn(shopper, SHOPPER, { next: `/pedidos/${orderNumber}` });
  await web.openOrder(shopper, orderNumber);
  const footerLink = await web.footerComplaintHref(shopper);
  check(footerLink === "/reclamo", `the footer links the complaint form (${footerLink})`);
  await web.startComplaintFromOrder(shopper);
  check(
    (await web.complaintOrderNumber(shopper)) === orderNumber,
    "the form carries the order's number",
  );
  const promise = await web.complaintPromise(shopper);
  check(
    promise.includes("1 día hábil") && promise.includes("5 días hábiles"),
    `the form says the promised times: ${promise}`,
  );
  await web.fillComplaint(shopper, {
    category: "delivery",
    // A long unbroken word: the case page must still fit 390 px.
    description:
      "El paquete llegó con la caja abierta y faltaba el cargador. Supercalifragilisticoespialidosoextraordinariamentelargo.",
  });
  await fits(shopper, "the complaint form");
  await shopper.screenshot({ path: SHOTS + "/sc1-complaint-form.png", fullPage: true });
  const filedText = await web.sendComplaint(shopper);
  log("filed:", filedText);
  const reference = /reclamo ([0-9A-F]{8})/.exec(filedText)?.[1] ?? "";
  check(reference.length === 8, `the shopper reads the reference (${reference})`);
  check(
    filedText.includes("Este mensaje es la confirmación") &&
      (filedText.match(/a más tardar el/g) ?? []).length === 1,
    "the message is the acknowledgement, with the date of the written answer",
  );
  const casesLink = await web.myCasesLinkAfterFiling(shopper).boundingBox();
  check(
    casesLink && casesLink.height >= 44,
    `«Ver sus consultas» is at least 44 px tall (${casesLink?.height})`,
  );
  await shopper.screenshot({ path: SHOTS + "/sc2-complaint-filed.png", fullPage: true });
  const caseId =
    sql(`select k.id from private.cases k join public.complaints c on c.id = k.complaint_id
    where upper(left(c.id::text, 8)) = '${reference}'`);

  // ── 2. Support works the case ─────────────────────────────────────────────
  const support = await (await phone()).newPage();
  watch(support);
  await ops.signIn(support, SUPPORT, { next: "/casos" });
  await ops.openCases(support);
  const list = await ops.casesText(support);
  check(list.includes(`pedido ${orderNumber}`) && list.includes("María"), "Casos lists the case");
  // The case's stamp: its state, or its clock when it is near or past its due time.
  const stamps = [
    word("cases", "open", STAFF),
    word("cases", "open", { ...STAFF, clock: "due_soon" }),
    word("cases", "open", { ...STAFF, clock: "overdue" }),
  ];
  check(
    stamps.some((stamp) => list.includes(stamp)) &&
      /Responder: (quedan|atrasado por|a más tardar)/.test(list),
    "with its stamp in words and the time left",
  );
  await fits(support, "Casos");
  // Atención lists the complaint with its long word while it is open.
  await ops.open(support, "/atencion");
  await fits(support, "Atención with the long complaint");
  await support.screenshot({ path: SHOTS + "/sc3-cases-list.png", fullPage: true });

  await ops.openCase(support, caseId);
  check(
    (await ops.mainText(support)).includes("el cliente nunca ve esta nota"),
    "the case page says the customer never sees a note",
  );
  await ops.writeCaseNote(support, `El cliente dijo que su código es ${code}.`);
  await ops.caseNoteRefused(support);
  check(true, "a note with the order's delivery code is refused");
  check(
    sql(`select count(*) from private.audit_log a join auth.users u on u.id = a.actor_id
         where a.action = 'REFUSED_CODE' and u.email = '${SUPPORT}' and a.row_key = '${caseId}'
           and a.new_row::text not like '%${code}%'`) === "1",
    "the refusal is on the audit trail, without the text or the code",
  );
  // A phone that ends in the live code, on purpose: the guard reads a phone
  // whole (decision 61), so a person reading the note cannot tell that four
  // of its digits are a code, and refusing or masking it would tell them.
  const phoneNote = `Nota interna de prueba: revisar el empaque del pedido ${orderNumber}, tel. 8888-${code}.`;
  await ops.writeCaseNote(support, phoneNote);
  await ops.caseNoteSaved(support);
  await ops.caseNoteShown(support, phoneNote);
  check(
    true,
    "a staff note with a phone is kept and shown as written: nothing marks which digits are a code",
  );
  await ops.assignCaseToMe(support);
  const prefilled = await ops.useSavedReply(support, "Dónde está mi pedido");
  check(prefilled.startsWith("Gracias por escribirnos."), "a saved answer fills the answer");
  await ops.typeCaseAnswer(
    support,
    "Lamentamos lo de la caja. Le enviamos el cargador que faltaba el lunes, sin costo. https://yuntera.example/ayuda/envios/cargadores-que-faltaron/en-una-caja-abierta/sin-espacios",
  );
  // Closed, the page redraws without the answer form: the timeline says it.
  await ops.answerAndCloseCase(support);
  check(
    (await ops.caseAnswerText(support)).includes("Le enviamos el cargador"),
    "the answer is on the timeline",
  );
  check(true, "support answers and closes the case");
  await fits(support, "the case page");
  await support.screenshot({ path: SHOTS + "/sc4-case-answered.png", fullPage: true });

  // ── 3. The shopper reads the answer ───────────────────────────────────────
  await web.openMyCases(shopper);
  const mine = await web.mainText(shopper);
  check(
    mine.includes(`Reclamo ${reference}`) && mine.includes("Le enviamos el cargador"),
    "the shopper reads the answer in Sus consultas",
  );
  check(!mine.includes("Nota interna de prueba"), "and never the internal note");
  await fits(shopper, "Sus consultas");
  await shopper.screenshot({ path: SHOTS + "/sc5-my-cases.png", fullPage: true });
  await web.openOrder(shopper, orderNumber);
  const onOrder = await web.orderCasesText(shopper);
  check(onOrder.includes("Le enviamos el cargador"), "and on the order's page");
  // The answer holds a long URL: the order page must still fit the screen.
  await fits(shopper, "the order page with the long answer");
  check(
    !(await web.mainText(shopper)).includes("Nota interna de prueba"),
    "the order page shows no note",
  );

  // ── 4. A WhatsApp contact, the customer view and "Mostrar contacto" ───────
  await ops.openOrder(support, orderNumber);
  await ops.recordContact(support, {
    channel: "whatsapp",
    topic: "payment",
    summary: "Preguntó por WhatsApp si ya salió el reembolso del envío.",
  });
  const contactCase =
    sql(`select id from private.cases where kind = 'contact' and channel = 'whatsapp'
    order by created_at desc limit 1`);
  check(contactCase.length === 36, "the WhatsApp contact is a case of the order");
  await fits(support, "the console order page with its cases");
  await ops.openCustomerFromOrder(support);
  const customerPath = new URL(support.url()).pathname;
  check(
    !/@|%40|\+506/.test(support.url()),
    `the customer view's address holds no contact (${customerPath})`,
  );
  const view = await ops.mainText(support);
  check(view.includes("María") && view.includes(orderNumber), "the customer view: name and orders");
  check(!view.includes(SHOPPER), "no e-mail until it is asked for");
  await ops.revealContact(support, "Llamar por el cargador que faltaba.", SHOPPER);
  check(true, "Mostrar contacto shows the e-mail once a reason is given");
  await fits(support, "the customer view");
  await support.screenshot({ path: SHOTS + "/sc6-customer-view.png", fullPage: true });

  const admin = await (await phone()).newPage();
  watch(admin);
  await ops.signIn(admin, ADMIN, { next: "/auditoria" });
  await ops.open(admin, "/auditoria");
  const trail = await ops.mainText(admin);
  check(
    trail.includes("Vio el contacto de un cliente") &&
      trail.includes("Motivo: Llamar por el cargador que faltaba."),
    "Auditoría shows who saw a customer's contact, and why",
  );
  check(!trail.includes(SHOPPER), "and not the contact itself");
  await ops.openCases(admin, "/respuestas");
  await fits(admin, "Respuestas guardadas");
  await admin.screenshot({ path: SHOTS + "/sc7-saved-replies.png", fullPage: true });
  await ops.openCases(admin, "/informe");
  const report = await ops.mainText(admin);
  check(
    report.includes("Primera respuesta a tiempo") && report.includes("Casos reabiertos"),
    "the monthly report shows the measures",
  );
  await fits(admin, "the monthly report");
  await admin.screenshot({ path: SHOTS + "/sc8-case-report.png", fullPage: true });

  // ── 5. Finance sees only its case types ───────────────────────────────────
  const finance = await (await phone()).newPage();
  watch(finance);
  await ops.signIn(finance, FINANCE, { next: "/" });
  await ops.open(finance, "/");
  check(
    /Casos: \d+ atrasados? y \d+ vencen? hoy/.test(await ops.casesDueText(finance)),
    "Hoy carries the cases line",
  );
  await ops.openCases(finance);
  const financeList = await ops.caseLinks(finance);
  check(financeList.includes(`/casos/${contactCase}`), "finance sees the payment contact");
  await ops.openCases(finance, "?estado=cerrados");
  const financeClosed = await ops.caseLinks(finance);
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
  const hidden = await ops.openCase(probe, caseId);
  // Inside a streamed page the status may already be sent; what matters is
  // that the case itself is not shown, only the not-found screen.
  await ops.waitForNotFound(probe);
  const probeText = await ops.mainText(probe);
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
