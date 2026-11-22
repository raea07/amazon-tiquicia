// Electronic invoices journey. A shopper asks at checkout for a factura in
// their name (a wrong cédula is refused first, and what was typed is kept),
// pays, and their factura for the delivery fee is signed, sent to the fake of
// Hacienda, accepted, and downloadable from the order page; another shopper
// cannot download it. The seller sees the platform's factura for its fees in
// its statements. The shopper cancels the order: the refund produces credit
// notes; the fake rejects the one to the shopper; finance reads Hacienda's
// reason and issues a replacement, which goes out with a new number and is
// accepted; the shopper's factura is then shown as voided by its credit note.
//
// Needs `tools/dev/stack.sh up <lane>`, which starts the invoice worker
// (served as the Edge Functions are, with a throwaway signing key) and the
// fake of Hacienda. Nothing here reaches Hacienda. Fails on any browser error
// or 5xx, like the other journeys.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FAKE = process.env.HACIENDA_FAKE_URL || "http://127.0.0.1:54325";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHOPPER = "comprador@yuntera.example";
const CEDULA = "109870654";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`);
  log("ok:", message);
}

async function until(what, fn, seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

(async () => {
  const fake = await request.newContext();
  const documents = async () => (await fake.get(`${FAKE}/_fake/documents`)).json();
  const behave = (rules) => fake.post(`${FAKE}/_fake/behaviour`, { data: { rules } });
  // A fresh fake: what it kept from an earlier run belongs to a database that no longer exists.
  await fake.post(`${FAKE}/_fake/reset`);

  const browser = await chromium.launch();
  const errors = [];
  let expectingNotFound = false;
  const watch = (page) => {
    page.on("console", (m) => {
      // A refused download asked for on purpose (below) is the only 404 allowed.
      if (m.type() === "error" && !(expectingNotFound && m.text().includes("status of 404")))
        errors.push("console: " + m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
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
  async function signIn(base, email, path, options = desktop) {
    const page = await (await browser.newContext(options)).newPage();
    watch(page);
    await page.goto(`${base}/ingresar?siguiente=${encodeURIComponent(path)}`, {
      waitUntil: "networkidle",
    });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === path.split("?")[0], { timeout: 30000 });
    return page;
  }

  // The seed's own payments produce documents when the stack starts: wait for
  // the worker to have sent them, so the counts below are about this journey.
  await until(
    "the seed's documents to be answered",
    async () => {
      const docs = await documents();
      return (
        docs.length > 0 && docs.every((d) => d.state === "aceptado" || d.state === "rechazado")
      );
    },
    120,
  );
  const before = (await documents()).length;
  log("documents from the seed, answered:", before);

  // ── 1. Checkout with a factura in the shopper's name ────────────────────
  const shopper = await signIn(WEB, SHOPPER, "/carrito");
  await shopper.goto(`${WEB}/p/libreta-tapa-dura-a5`, { waitUntil: "networkidle" });
  await shopper
    .locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")')
    .click();
  await shopper.waitForSelector("text=Agregado al carrito");
  await shopper.goto(`${WEB}/pagar`, { waitUntil: "networkidle" });
  await shopper.waitForSelector("text=Resumen del pedido");
  check(!(await shopper.locator("#factura").isChecked()), "the factura box starts unticked");
  check(
    (await shopper.locator('input[name="facturaNumero"]').count()) === 0,
    "and asks for nothing",
  );
  await shopper.check("#factura");
  await shopper.selectOption('select[name="facturaTipo"]', "fisica");
  await shopper.fill('input[name="facturaNumero"]', "12345");
  await shopper.fill('input[name="facturaNombre"]', "María Pérez Rojas");
  await shopper.fill('input[name="facturaCorreo"]', "maria@example.com");
  await shopper.check('input[name="paymentMethod"][value="sinpe_movil"]');
  await shopper.screenshot({ path: `${SHOTS}/i01-checkout-factura.png`, fullPage: true });
  await shopper.click('button:has-text("Confirmar pedido")');
  await shopper.waitForSelector('main [role="alert"]');
  const refusal = await text(shopper.locator('main [role="alert"]').first());
  check(/cédula física tiene 9 dígitos/.test(refusal), `a wrong cédula is refused: "${refusal}"`);
  check(shopper.url().includes("/pagar"), "and no order is placed");
  check(
    (await shopper.inputValue('input[name="facturaNombre"]')) === "María Pérez Rojas",
    "the name is kept",
  );
  check(await shopper.locator("#factura").isChecked(), "and the choice");
  check(
    await shopper.locator('input[name="paymentMethod"][value="sinpe_movil"]').isChecked(),
    "and the payment method",
  );
  await shopper.fill('input[name="facturaNumero"]', "1-0987-0654");
  await shopper.click('button:has-text("Confirmar pedido")');
  await shopper.waitForURL((u) => /^\/pedidos\/YT-/.test(new URL(u).pathname), { timeout: 30000 });
  const orderPath = new URL(shopper.url()).pathname;
  const orderNumber = orderPath.split("/").pop();
  log("order:", orderNumber);
  await shopper.click('button:visible:has-text("Simular pago")');
  await shopper.waitForSelector("text=Su código de entrega", { timeout: 15000 });

  // ── 2. Signed, sent, accepted, downloadable ─────────────────────────────
  const factura = await until("the factura to be accepted by the fake", async () =>
    (await documents()).find(
      (d) =>
        d.type === "01" && d.receptor?.numeroIdentificacion === CEDULA && d.state === "aceptado",
    ),
  );
  check(
    /^506\d{6}003101123456/.test(factura.clave),
    `its clave is the platform's: ${factura.clave}`,
  );
  await until("the order page to show it accepted", async () => {
    await shopper.goto(`${WEB}${orderPath}`, { waitUntil: "load" });
    await shopper.waitForSelector('h1:visible:has-text("Pedido")');
    return (await text(shopper.locator("main:visible"))).includes("Aceptado por Hacienda");
  });
  const invoices = await text(shopper.locator("section:has(#comprobantes)"));
  check(invoices.includes("Factura electrónica"), "the order shows a factura electrónica");
  check(invoices.includes("a nombre de María Pérez Rojas"), "in her name");
  check(
    invoices.includes("Los productos los factura cada vendedor"),
    "and says who invoices the goods",
  );
  await shopper.screenshot({ path: `${SHOTS}/i02-order-invoice.png`, fullPage: true });

  await shopper.click('a:has-text("Ver comprobante")');
  await shopper.waitForURL(/\/comprobantes\//);
  await shopper.waitForSelector('h1:visible:has-text("Factura electrónica")');
  const view = await text(shopper.locator("main"));
  check(
    view.includes(factura.clave.replace(/(.{10})(?=.)/g, "$1 ")),
    "the readable page shows the clave",
  );
  check(/Número consecutivo 00100001010\d{9}/.test(view), "and the consecutive number, together");
  check(view.includes("Cédula física 109870654"), "the receiver's identification");
  check(view.includes("Entrega a domicilio, pedido"), "the line");
  check(view.includes("SINPE Móvil"), "the payment method, in words");
  await shopper.screenshot({ path: `${SHOTS}/i03-invoice-page.png`, fullPage: true });
  const invoicePath = new URL(shopper.url()).pathname;
  // Downloads as the signed-in page makes them (the session cookie is Secure
  // and HttpOnly, so only the browser itself sends it).
  const fetchIn = (page, url) =>
    page.evaluate(async (target) => {
      const response = await fetch(target, { redirect: "manual" });
      return {
        status: response.status,
        disposition: response.headers.get("content-disposition") || "",
        type: response.headers.get("content-type") || "",
        cache: response.headers.get("cache-control") || "",
        body: await response.text(),
      };
    }, url);
  const xml = await fetchIn(shopper, `${invoicePath}/xml`);
  check(
    xml.status === 200 && xml.type.startsWith("application/xml"),
    "the shopper downloads the signed XML",
  );
  check(xml.disposition === `attachment; filename="${factura.clave}.xml"`, "named {clave}.xml");
  check(xml.cache.includes("no-store"), "never cached");
  check(
    xml.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>') &&
      xml.body.includes("<FacturaElectronica "),
    "a v4.4 factura",
  );
  check(
    xml.body.includes("<ds:Signature") && xml.body.includes("xades:SignedProperties"),
    "signed with XAdES",
  );
  const answer = await fetchIn(shopper, `${invoicePath}/respuesta`);
  check(
    answer.status === 200 && answer.body.includes("<Mensaje>1</Mensaje>"),
    "and Hacienda's answer",
  );
  const visitor = await (await request.newContext()).get(`${WEB}${invoicePath}/xml`, {
    maxRedirects: 0,
  });
  check(visitor.status() === 307, "a visitor is sent to sign in");

  const other = await signIn(WEB, "comprador2@yuntera.example", "/pedidos");
  expectingNotFound = true;
  const theirs = await fetchIn(other, `${invoicePath}/xml`);
  expectingNotFound = false;
  check(theirs.status === 404, "another shopper cannot download it");
  await other.goto(`${WEB}${invoicePath}`, { waitUntil: "networkidle" });
  check((await text(other.locator("main"))).includes("No encontramos"), "nor open it");

  const shopperPhone = await signIn(WEB, SHOPPER, invoicePath, phone);
  await shopperPhone.waitForSelector('h1:visible:has-text("Factura electrónica")');
  check((await overflow(shopperPhone)) <= 0, "the document page fits 390 px");
  const download = await shopperPhone
    .locator('a:has-text("Descargar el comprobante")')
    .boundingBox();
  check(
    download && download.height >= 44,
    `download links are at least 44 px tall (${download && download.height})`,
  );
  await shopperPhone.screenshot({ path: `${SHOTS}/i04-invoice-phone.png`, fullPage: true });

  // ── 3. The seller sees the platform's factura for its fees ──────────────
  const seller = await signIn(SELLER, "sendero@yuntera.example", "/pagos");
  const feeRow = await until("the fee factura in the statements", async () => {
    await seller.goto(`${SELLER}/pagos`, { waitUntil: "networkidle" });
    const row = seller
      .locator(`section:has(#facturas) li:has-text("pedido ${orderNumber}")`)
      .first();
    return (await row.count()) > 0 && (await text(row)).includes("Aceptado por Hacienda")
      ? row
      : null;
  });
  check(
    (await text(feeRow)).includes("Factura electrónica"),
    "a factura electrónica for the order's fees",
  );
  await seller.screenshot({ path: `${SHOTS}/i05-seller-invoices.png`, fullPage: true });
  await feeRow.locator('a:has-text("Ver")').click();
  await seller.waitForURL(/\/comprobantes\//);
  await seller.waitForSelector('h1:visible:has-text("Factura electrónica")');
  const feeView = await text(seller.locator("main:visible"));
  check(feeView.includes("Comisión por venta"), "with the commission");
  check(feeView.includes("Cédula jurídica"), "made out to the shop's legal identification");
  check(
    feeView.includes("Compensación contra la liquidación de ventas"),
    "paid by netting from the payout",
  );
  const sellerXml = await fetchIn(seller, `${new URL(seller.url()).pathname}/xml`);
  check(
    sellerXml.status === 200 && sellerXml.body.includes("<FacturaElectronica "),
    "the seller downloads it",
  );
  expectingNotFound = true;
  const notTheirs = await fetchIn(seller, `${invoicePath}/xml`);
  expectingNotFound = false;
  check(notTheirs.status === 404, "but not the shopper's factura");
  const sellerPhone = await signIn(SELLER, "sendero@yuntera.example", "/pagos", phone);
  await sellerPhone.waitForSelector("#facturas");
  check((await overflow(sellerPhone)) <= 0, "the statements fit 390 px");
  await sellerPhone.screenshot({ path: `${SHOTS}/i06-seller-phone.png`, fullPage: true });

  // ── 4. A refund: credit notes; one rejected, replaced with a new number ─
  await behave([
    {
      mode: "reject",
      times: 1,
      receiver: CEDULA,
      cause: "La identificación del receptor no coincide con el padrón.",
    },
  ]);
  await shopper.goto(`${WEB}${orderPath}`, { waitUntil: "load" });
  await shopper.waitForSelector('h1:visible:has-text("Pedido")');
  await shopper.click('button:visible:has-text("Cancelar pedido")');
  // The page redraws with the order cancelled: the button (and its form) are gone.
  await shopper
    .locator('button:visible:has-text("Cancelar pedido")')
    .waitFor({ state: "detached", timeout: 20000 });
  const rejectedNote = await until("the shopper's credit note to be rejected", async () =>
    (await documents()).find(
      (d) =>
        d.type === "03" && d.receptor?.numeroIdentificacion === CEDULA && d.state === "rechazado",
    ),
  );
  const feeNote = await until("the seller's credit note to be accepted", async () =>
    (await documents()).find(
      (d) =>
        d.type === "03" && d.receptor?.numeroIdentificacion !== CEDULA && d.state === "aceptado",
    ),
  );
  log("credit notes:", rejectedNote.clave.slice(21, 41), feeNote.clave.slice(21, 41));

  const finance = await signIn(OPS, "central@yuntera.example", "/comprobantes");
  const rejectedRow = await until("finance to see the rejection", async () => {
    await finance.goto(`${OPS}/comprobantes`, { waitUntil: "networkidle" });
    const row = finance.locator("section:has(#rechazados) li").first();
    return (await row.count()) > 0 ? row : null;
  });
  const reason = await text(rejectedRow);
  check(
    reason.includes("La identificación del receptor no coincide con el padrón."),
    `finance reads Hacienda's reason: "${reason.slice(0, 160)}"`,
  );
  check(reason.includes(rejectedNote.clave.slice(21, 41)), "for that credit note");
  await finance.screenshot({ path: `${SHOTS}/i07-ops-rejected.png`, fullPage: true });
  await rejectedRow.locator('button:has-text("Emitir reemplazo")').click();
  // The new document's own page, which says what it replaces.
  await finance.waitForURL(/\/comprobantes\/[0-9a-f-]{36}\?emitido=1$/, { timeout: 20000 });
  await finance.waitForSelector("text=que reemplaza al rechazado");
  const done = await text(finance.locator("text=que reemplaza al rechazado").first());
  const newNumber = /comprobante (\d{20})/.exec(done)?.[1];
  check(newNumber && newNumber !== rejectedNote.clave.slice(21, 41), `a new number: ${newNumber}`);
  const replacement = await until("the replacement to be accepted", async () =>
    (await documents()).find((d) => d.clave.slice(21, 41) === newNumber && d.state === "aceptado"),
  );
  check(replacement.clave !== rejectedNote.clave, "a new clave too");
  await until("the rejection to leave the list", async () => {
    await finance.goto(`${OPS}/comprobantes`, { waitUntil: "networkidle" });
    return (await text(finance.locator("section:has(#rechazados)"))).includes(
      "No hay comprobantes rechazados",
    );
  });
  await finance.goto(`${OPS}/comprobantes?estado=accepted`, { waitUntil: "networkidle" });
  await finance.locator(`a:has-text("${newNumber}")`).first().click();
  await finance.waitForURL(/\/comprobantes\/[0-9a-f-]{36}$/);
  await finance.waitForSelector('h1:visible:has-text("Nota de crédito electrónica")');
  const replacementView = await text(finance.locator("main:visible"));
  check(
    replacementView.includes("Sustituye comprobante electrónico rechazado"),
    "it references the rejected one (código 16)",
  );
  check(
    replacementView.includes("Anula el documento de referencia"),
    "and the factura it annuls (código 01)",
  );
  await finance.screenshot({ path: `${SHOTS}/i08-ops-replacement.png`, fullPage: true });
  const financePhone = await signIn(OPS, "central@yuntera.example", "/comprobantes", phone);
  await financePhone.waitForSelector("#por-dia");
  check((await overflow(financePhone)) <= 0, "the finance page fits 390 px");
  await financePhone.screenshot({ path: `${SHOTS}/i09-ops-phone.png`, fullPage: true });

  // ── 5. The shopper sees the credit note, and the factura voided ─────────
  const final = await until("the order page to show the credit note", async () => {
    await shopper.goto(`${WEB}${orderPath}`, { waitUntil: "load" });
    await shopper.waitForSelector('h1:visible:has-text("Pedido")');
    const section = await text(shopper.locator("section:has(#comprobantes)"));
    return section.includes("Nota de crédito electrónica") &&
      section.includes("Anulado con nota de crédito")
      ? section
      : null;
  });
  check(final.includes(newNumber), "the replacement credit note, not the rejected one");
  check(!final.includes(rejectedNote.clave.slice(21, 41)), "the rejected one is not listed");
  await shopper.screenshot({ path: `${SHOTS}/i10-order-credit-note.png`, fullPage: true });

  // ── 6. Free delivery (over the zone's threshold): nothing of Yuntera's to invoice ──
  await shopper.goto(`${WEB}/p/laptop-14-nimbo-libro`, { waitUntil: "networkidle" });
  await shopper
    .locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")')
    .click();
  await shopper.waitForSelector("text=Agregado al carrito");
  await shopper.goto(`${WEB}/pagar`, { waitUntil: "networkidle" });
  await shopper.waitForSelector("text=Resumen del pedido");
  check(
    (await text(shopper.locator('aside[aria-label="Resumen del pedido"]'))).includes("Gratis"),
    "this order has free delivery",
  );
  check((await shopper.locator("#factura").count()) === 0, "so no factura is offered");
  check(
    (await text(shopper.locator("main:visible"))).includes("Este pedido tiene entrega gratis"),
    "and the checkout says why",
  );
  await shopper.screenshot({ path: `${SHOTS}/i11-checkout-free-delivery.png`, fullPage: true });

  check(
    (await documents()).filter((d) => d.state === "aceptado" || d.state === "rechazado").length >=
      before + 4,
    "every document of the journey got an answer",
  );
  check(errors.length === 0, `no browser errors or 5xx (${errors.join(" | ")})`);
  await browser.close();
  log("invoicing journey: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
