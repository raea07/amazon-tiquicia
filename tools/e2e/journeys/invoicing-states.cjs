// What the invoicing screens say, in each state, and that each says one true
// thing: the console's invoices page (finance) and the shopper's order page.
//
//   simulation, not documented (the preview): a simulated SINPE Móvil order
//     with a factura asked for, a free-delivery order, a cash order not paid
//     yet; the console says simulated payments get no document, and that
//     nothing with real money waits;
//   issuer not set up, real money: cash taken in live mode, with and without
//     a factura asked for; the order page says the factura or the tiquete will
//     come once invoicing is set up, the console that the payments with real
//     money wait for it;
//   issuer set up, real and simulated payments: the tiquete is issued and
//     shown; the console no longer warns about the set-up and still says the
//     simulated ones got no document;
//   simulated money documented (local work and a rehearsal): the console says so.
//
// The states are set the way the owner would (the settings) and the cash is
// collected the way the driver's door step books it, through psql. Needs
// `tools/dev/stack.sh up <lane>` (the invoice worker and the fake of Hacienda).
// Fails on any browser error or 5xx.

const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const SHOPPER = "comprador@yuntera.example";

const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`);
  log("ok:", message);
}
async function until(what, fn, seconds = 90) {
  for (let i = 0; i < seconds * 2; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}
function sql(statement) {
  const run = spawnSync(
    "psql",
    [DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
  return run.stdout.trim();
}
const setting = (key, path, json) =>
  sql(
    `update public.app_settings set value = jsonb_set(value, '{${path}}', '${json}') where key = '${key}'`,
  );
const mode = (value) =>
  sql(`update public.app_settings set value = '"${value}"' where key = 'payments_mode'`);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  const desktop = { viewport: { width: 1280, height: 900 }, locale: "es-CR" };
  const phone = {
    viewport: { width: 390, height: 844 },
    locale: "es-CR",
    isMobile: true,
    hasTouch: true,
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  async function signIn(base, email, target, options = desktop) {
    const page = await (await browser.newContext(options)).newPage();
    watch(page);
    await page.goto(`${base}/ingresar?siguiente=${encodeURIComponent(target)}`, {
      waitUntil: "networkidle",
    });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === target.split("?")[0], { timeout: 30000 });
    return page;
  }

  // Until the worker has nothing left to plan or send (the seed's documents
  // when the stack starts, and on a database that keeps data, earlier ones).
  await until(
    "the worker to have planned and sent everything waiting",
    async () =>
      sql(`select not exists (select 1 from private.outbox_jobs where consumer = 'invoice' and status = 'pending')
              and not exists (select 1 from public.electronic_invoices
                              where status in ('pending', 'sent') and held_reason is null)`) ===
      "t",
    120,
  );

  const shopper = await signIn(WEB, SHOPPER, "/carrito");
  const finance = await signIn(OPS, "central@yuntera.example", "/comprobantes");
  const states = async () => {
    await finance.goto(`${OPS}/comprobantes`, { waitUntil: "networkidle" });
    return text(finance.locator("main"));
  };
  const invoicesOf = async (orderPath) => {
    await shopper.goto(`${WEB}${orderPath}`, { waitUntil: "load" });
    await shopper.waitForSelector('h1:visible:has-text("Pedido")');
    const section = shopper.locator("section:has(#comprobantes)");
    return (await section.count()) > 0 ? text(section) : "";
  };
  async function order(slug, method, factura) {
    await shopper.goto(`${WEB}/p/${slug}`, { waitUntil: "load" });
    await shopper.waitForSelector(
      'aside[aria-label="Comprar"] button:has-text("Agregar al carrito")',
    );
    await shopper
      .locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")')
      .click();
    await shopper.waitForSelector("text=Agregado al carrito");
    await shopper.goto(`${WEB}/pagar`, { waitUntil: "networkidle" });
    await shopper.waitForSelector("text=Resumen del pedido");
    if (factura) {
      await shopper.check("#factura");
      await shopper.selectOption('select[name="facturaTipo"]', "fisica");
      await shopper.fill('input[name="facturaNumero"]', "109870654");
      await shopper.fill('input[name="facturaNombre"]', "María Pérez Rojas");
    }
    await shopper.check(`input[name="paymentMethod"][value="${method}"]`);
    await shopper.click('button:has-text("Confirmar pedido")');
    await shopper.waitForURL((u) => /^\/pedidos\/YT-/.test(new URL(u).pathname), {
      timeout: 30000,
    });
    return new URL(shopper.url()).pathname;
  }
  const SIMULATED_PAID =
    "Este pedido se pagó en modo de prueba, sin dinero real, así que no se emite ningún comprobante electrónico.";
  const FREE =
    "Este pedido no tuvo costo de entrega, así que Yuntera no le emite ningún comprobante.";
  const ISSUES = "Yuntera le emite el comprobante por la entrega.";
  const GOODS =
    "Los productos los factura cada vendedor con su propio sistema de facturación electrónica.";

  // ── 1. Simulation, not documented: what the preview is ──────────────────
  setting("invoicing_policy", "simulated_payments", "false");
  setting("invoicing_issuer", "ready", "false");

  let page = await states();
  check(
    page.includes("La facturación electrónica no está configurada"),
    "console: the issuer is not set up",
  );
  check(
    page.includes("Ningún pago con dinero real espera comprobante."),
    "console: nothing real waits",
  );
  check(
    !page.includes("se emitirán en orden"),
    "console: no promise of documents for simulated payments",
  );
  check(
    page.includes("Los pagos simulados no reciben comprobante"),
    "console: simulated payments get none",
  );
  check(page.includes("Este ambiente simula los pagos"), "console: payments here are simulated");

  const simulated = await order("libreta-tapa-dura-a5", "sinpe_movil", true);
  await shopper.click('button:visible:has-text("Simular pago")');
  await shopper.waitForSelector("text=Su código de entrega", { timeout: 15000 });
  let section = await invoicesOf(simulated);
  check(section.includes(SIMULATED_PAID), "order page: a simulated payment gets no document");
  check(!section.includes(ISSUES), "and does not say Yuntera issues one");
  check(!section.includes("estará aquí en unos minutos"), "nor that one is on its way");
  check(section.includes(GOODS), "and says who invoices the goods");
  await shopper.screenshot({ path: `${SHOTS}/is01-order-simulated.png`, fullPage: true });
  page = await until("the console to count the simulated payment closed", async () => {
    const p = await states();
    return p.includes("1 pago simulado se cerró sin comprobante.") ? p : null;
  });
  check(
    page.includes("1 pago simulado se cerró sin comprobante."),
    "console: the simulated payment's job ended without a document",
  );
  await finance.screenshot({ path: `${SHOTS}/is02-ops-simulation.png`, fullPage: true });

  const free = await order("laptop-14-nimbo-libro", "sinpe_movil", false);
  await shopper.click('button:visible:has-text("Simular pago")');
  await shopper.waitForSelector("text=Su código de entrega", { timeout: 15000 });
  section = await invoicesOf(free);
  check(section.includes(FREE), "order page, free delivery: Yuntera issues no document");
  check(!section.includes(ISSUES), "and does not also say it issues one for the delivery");
  check(section.includes(GOODS), "and says who invoices the goods");
  await shopper.screenshot({ path: `${SHOTS}/is03-order-free-delivery.png`, fullPage: true });

  const unpaidCash = await order("libreta-tapa-dura-a5", "cash_on_delivery", false);
  section = await invoicesOf(unpaidCash);
  check(
    section.includes(
      "Este pedido es de prueba: se paga sin dinero real, así que no se emite ningún comprobante electrónico.",
    ),
    "order page, sandbox cash not paid yet: no document will come",
  );
  check(!section.includes("Le emitiremos"), "and nothing is promised");

  // ── 2. Issuer not set up, real money ────────────────────────────────────
  mode("live");
  const realCash = await order("libreta-tapa-dura-a5", "cash_on_delivery", true);
  const realNumber = realCash.split("/").pop();
  section = await invoicesOf(realCash);
  check(
    section.includes(
      "Yuntera todavía no emite comprobantes electrónicos. Cuando pague al recibir el pedido, le emitiremos la factura electrónica a su nombre",
    ),
    "order page, real cash not paid yet, factura asked for: it comes once invoicing is set up",
  );
  // The driver collects the cash at the door: booked as the door step books it.
  sql(`select private.capture_payment(id, 'journey-cash-' || order_number, true)
       from public.orders where order_number = '${realNumber}'`);
  section = await invoicesOf(realCash);
  check(
    section.includes(
      "Yuntera todavía no emite comprobantes electrónicos. Le emitiremos la factura electrónica a su nombre por la entrega a domicilio en cuanto quede habilitado",
    ),
    "order page, real cash paid: the factura comes once invoicing is set up",
  );
  check(!section.includes(ISSUES), "and nothing says it was issued");
  await shopper.screenshot({ path: `${SHOTS}/is04-order-real-waiting.png`, fullPage: true });
  page = await states();
  check(
    page.includes("1 pago con dinero real espera y se emitirá en orden cuando quede configurada."),
    "console: one real payment waits for the set-up",
  );

  // Real cash without a factura asked for: a tiquete, once set up.
  const tiqueteCash = await order("libreta-tapa-dura-a5", "cash_on_delivery", false);
  const tiqueteNumber = tiqueteCash.split("/").pop();
  section = await invoicesOf(tiqueteCash);
  check(
    section.includes(
      "Yuntera todavía no emite comprobantes electrónicos. Cuando pague al recibir el pedido, le emitiremos el tiquete electrónico por la entrega a domicilio",
    ),
    "order page, real cash not paid yet, no factura asked for: a tiquete once set up",
  );
  check(!section.includes("factura electrónica a su nombre"), "and no factura is promised");
  sql(`select private.capture_payment(id, 'journey-cash-' || order_number, true)
       from public.orders where order_number = '${tiqueteNumber}'`);
  section = await invoicesOf(tiqueteCash);
  check(
    section.includes(
      "Yuntera todavía no emite comprobantes electrónicos. Le emitiremos el tiquete electrónico por la entrega a domicilio en cuanto quede habilitado",
    ),
    "order page, real cash paid, no factura: the tiquete comes once invoicing is set up",
  );
  page = await states();
  check(
    page.includes(
      "2 pagos con dinero real esperan y se emitirán en orden cuando quede configurada.",
    ),
    "console: two real payments wait for the set-up",
  );
  check(
    page.includes("Los pagos simulados (sin dinero real) nunca reciben comprobante"),
    "console, live mode: simulated payments never get one",
  );
  await finance.screenshot({ path: `${SHOTS}/is05-ops-issuer-not-ready.png`, fullPage: true });

  // ── 3. Issuer set up: the real payment is documented, the simulated not ─
  setting("invoicing_issuer", "ready", "true");
  section = await until("the factura for the real cash to be accepted", async () => {
    const s = await invoicesOf(realCash);
    return s.includes("Aceptado por Hacienda") ? s : null;
  });
  check(
    section.includes("Factura electrónica") && section.includes("a nombre de María Pérez Rojas"),
    "order page: the factura, in her name",
  );
  check(section.includes(ISSUES), "and now says Yuntera issued it");
  section = await until("the tiquete for the other real cash to be accepted", async () => {
    const s = await invoicesOf(tiqueteCash);
    return s.includes("Aceptado por Hacienda") ? s : null;
  });
  check(
    section.includes("Tiquete electrónico") && !section.includes("Factura electrónica"),
    "order page: a tiquete, not a factura, where none was asked for",
  );
  page = await until("the console to count both simulated payments closed", async () => {
    const p = await states();
    return p.includes("2 pagos simulados se cerraron sin comprobante.") ? p : null;
  });
  check(!page.includes("no está configurada"), "console: no set-up warning once it is set up");
  check(
    page.includes("2 pagos simulados se cerraron sin comprobante."),
    "console: both simulated payments (with and without a delivery fee) got none",
  );
  section = await invoicesOf(simulated);
  check(
    section.includes(SIMULATED_PAID),
    "order page: the simulated payment still says it gets none",
  );
  const shopperPhone = await signIn(WEB, SHOPPER, simulated, phone);
  await shopperPhone.waitForSelector("#comprobantes");
  check((await overflow(shopperPhone)) <= 0, "the order page fits 390 px");
  await shopperPhone.screenshot({
    path: `${SHOTS}/is06-order-simulated-phone.png`,
    fullPage: true,
  });
  const financePhone = await signIn(OPS, "central@yuntera.example", "/comprobantes", phone);
  await financePhone.waitForSelector("#por-dia");
  check((await overflow(financePhone)) <= 0, "the console's page fits 390 px");
  await financePhone.screenshot({ path: `${SHOTS}/is07-ops-phone.png`, fullPage: true });

  // ── 4. Simulated money documented (local work, a rehearsal) ─────────────
  mode("sandbox");
  setting("invoicing_policy", "simulated_payments", "true");
  page = await states();
  check(
    page.includes("Ensayo: los pagos simulados también reciben comprobante"),
    "console: says simulated money is documented here",
  );
  check(!page.includes("Los pagos simulados no reciben comprobante"), "and not the opposite");
  await finance.screenshot({ path: `${SHOTS}/is08-ops-rehearsal.png`, fullPage: true });

  check(errors.length === 0, `no browser errors or 5xx (${errors.join(" | ")})`);
  await browser.close();
  log("invoicing states journey: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
