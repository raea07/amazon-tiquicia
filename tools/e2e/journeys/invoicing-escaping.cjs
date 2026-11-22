// Escaping, end to end. Hostile text — markup, both quotes, a CDATA end
// marker, an entity and a DOCTYPE declaration, an entity reference, values
// longer than their fields — in the platform's name, commercial name and
// address (the issuer's settings), in a shop's registered legal name, and in
// the name and e-mail a shopper types for a factura at checkout. The real
// worker numbers, writes, signs and sends the documents to the fake of
// Hacienda. Each document the fake received is then checked here, outside
// the code that wrote it: well-formed, valid against Hacienda's official
// schemas (libxml2's xmllint), every one of those texts read back as the
// text that was typed (cleaned and cut as the writer does, nothing expanded),
// and its digests and signature verified with the certificate it carries.
// The pages show the same text as text. A product's name never reaches the
// platform's documents (their lines are fixed words and the order number);
// the writer's own tests cover it (packages/invoicing/src/escaping.test.ts).
//
// Needs `tools/dev/stack.sh up <lane>` (the invoice worker and the fake of
// Hacienda), psql and xmllint. Fails on any browser error or 5xx.

const { spawnSync } = require("node:child_process");
const { createHash, verify, X509Certificate } = require("node:crypto");
const path = require("node:path");
const { chromium, request } = require("playwright");

const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FAKE = process.env.HACIENDA_FAKE_URL || "http://127.0.0.1:54325";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const SCHEMAS = path.resolve(__dirname, "../../../packages/invoicing/schemas/v4.4");
const SCHEMA = {
  "01": `${SCHEMAS}/factura/FacturaElectronica_V4.4.xsd`,
  "03": `${SCHEMAS}/nota-credito/NotaCreditoElectronica_V4.4.xsd`,
  "04": `${SCHEMAS}/tiquete/TiqueteElectronico_V4.4.xsd`,
};
const ROOT = {
  "01": "FacturaElectronica",
  "03": "NotaCreditoElectronica",
  "04": "TiqueteElectronico",
};
const DS = "http://www.w3.org/2000/09/xmldsig#";
const XADES = "http://uri.etsi.org/01903/v1.3.2#";
const SHOPPER = "comprador@yuntera.example";
const CEDULA = "109870654";

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
const literal = (value) => `'${value.replace(/'/g, "''")}'`;
function xmllint(args, input) {
  const run = spawnSync("xmllint", ["--nonet", ...args, "-"], { input, encoding: "utf8" });
  if (run.error) throw new Error(`xmllint is needed (libxml2-utils): ${run.error.message}`);
  return run;
}
const textAt = (xml, ...names) => {
  const xpath = `/${names.map((n) => `/*[local-name()='${n}']`).join("")}`;
  const run = xmllint(["--xpath", `string(${xpath}[1])`], xml);
  if (run.status !== 0) throw new Error(`xmllint --xpath: ${run.stderr}`);
  return run.stdout.replace(/\n$/, "");
};
const c14n = (xml) => {
  const run = xmllint(["--exc-c14n"], xml);
  if (run.status !== 0) throw new Error(`xmllint --exc-c14n: ${run.stderr}`);
  return run.stdout;
};
// As packages/invoicing cleanText does for these inputs (no control characters in them).
const clean = (value, max) =>
  Array.from(value.normalize("NFC").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
const between = (t, start, end) => {
  const from = t.indexOf(start);
  const to = t.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`not found: ${start}`);
  return t.slice(from, to + end.length);
};
const value = (t, tag) => new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(t)?.[1];
const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("base64");
const standalone = (fragment, declarations) =>
  fragment.replace(/^<([^\s>]+)/, `<$1 ${declarations}`);
/** The receiver's check of a signed document (as packages/invoicing/src/testing/verify.ts). */
function signatureHolds(xml) {
  const unsigned = xml.replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "");
  const documentRef = between(xml, '<ds:Reference Id="r-id-1"', "</ds:Reference>");
  const propsRef = between(
    xml,
    '<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties"',
    "</ds:Reference>",
  );
  const props = standalone(
    between(xml, "<xades:SignedProperties", "</xades:SignedProperties>"),
    `xmlns:xades="${XADES}" xmlns:ds="${DS}"`,
  );
  const signedInfo = c14n(
    standalone(between(xml, "<ds:SignedInfo>", "</ds:SignedInfo>"), `xmlns:ds="${DS}"`),
  );
  const cert = new X509Certificate(Buffer.from(value(xml, "ds:X509Certificate") || "", "base64"));
  return (
    value(documentRef, "ds:DigestValue") === sha256(c14n(unsigned)) &&
    value(propsRef, "ds:DigestValue") === sha256(c14n(props)) &&
    verify(
      "RSA-SHA256",
      Buffer.from(signedInfo, "utf8"),
      cert.publicKey,
      Buffer.from(value(xml, "ds:SignatureValue") || "", "base64"),
    )
  );
}

const HOSTILE = "</Nombre><Nombre>Otra</Nombre> & \"Cía\" 'Ltda' ]]> <![CDATA[x]]> &amp; &#60;";
const DOCTYPE = '<!DOCTYPE x [<!ENTITY robo SYSTEM "file:///etc/passwd">]> &robo;';
const ISSUER_NAME = `EJEMPLO PLATAFORMA ${HOSTILE}`;
const COMMERCIAL = `Yuntera <S.A.> & "Cía"`;
const ADDRESS = `Del parque 200 m ${DOCTYPE} ${"y 50 m al <norte> & ".repeat(15)}`;
// A shop's legal name may have up to 160 characters; the XML takes 100.
const LEGAL = Array.from(`Sendero ${HOSTILE} ${DOCTYPE} ${"Outdoor S.R.L. ".repeat(8)}`)
  .slice(0, 158)
  .join("");
const RECEIVER = `María <b>"Ñ"</b> & 'Cía' ]]> &amp;`;
const EMAIL = "o'brien+factura@example.com";

(async () => {
  const fake = await request.newContext();
  const documents = async () => (await fake.get(`${FAKE}/_fake/documents`)).json();
  await fake.post(`${FAKE}/_fake/reset`);

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
  async function signIn(base, email, target) {
    const page = await (
      await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CR" })
    ).newPage();
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

  // The seed's documents go first (as in invoicing.cjs), so what follows is about this journey.
  await until(
    "the seed's documents to be answered",
    async () => {
      const docs = await documents();
      return docs.length > 0 && docs.every((d) => ["aceptado", "rechazado"].includes(d.state));
    },
    120,
  );
  const before = new Set((await documents()).map((d) => d.clave));

  // ── 1. Hostile text where settings and a shop's registration put it ──────
  sql(`update public.app_settings set value = value
         || jsonb_build_object('name', ${literal(ISSUER_NAME)}, 'commercial_name', ${literal(COMMERCIAL)},
                               'other_signs', ${literal(ADDRESS)})
       where key = 'invoicing_issuer'`);
  const sellerId =
    sql(`select o.seller_id from public.offers o join public.skus k on k.id = o.sku_id
                        join public.products p on p.id = k.product_id
                        where p.slug = 'libreta-tapa-dura-a5' order by o.price_minor desc limit 1`);
  sql(
    `update public.seller_private set legal_name = ${literal(LEGAL)} where seller_id = '${sellerId}'`,
  );

  // ── 2. The shopper asks for a factura in a hostile name, and pays ────────
  const shopper = await signIn(WEB, SHOPPER, "/carrito");
  await shopper.goto(`${WEB}/p/libreta-tapa-dura-a5`, { waitUntil: "networkidle" });
  await shopper
    .locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")')
    .click();
  await shopper.waitForSelector("text=Agregado al carrito");
  await shopper.goto(`${WEB}/pagar`, { waitUntil: "networkidle" });
  await shopper.waitForSelector("text=Resumen del pedido");
  await shopper.check("#factura");
  await shopper.selectOption('select[name="facturaTipo"]', "fisica");
  await shopper.fill('input[name="facturaNumero"]', CEDULA);
  await shopper.fill('input[name="facturaNombre"]', RECEIVER);
  await shopper.fill('input[name="facturaCorreo"]', EMAIL);
  await shopper.check('input[name="paymentMethod"][value="sinpe_movil"]');
  await shopper.click('button:has-text("Confirmar pedido")');
  await shopper.waitForURL((u) => /^\/pedidos\/YT-/.test(new URL(u).pathname), { timeout: 30000 });
  const orderPath = new URL(shopper.url()).pathname;
  await shopper.click('button:visible:has-text("Simular pago")');
  await shopper.waitForSelector("text=Su código de entrega", { timeout: 15000 });

  // ── 3. What the fake of Hacienda received ───────────────────────────────
  const received = await until(
    "the factura to the shopper and the fee factura to be answered",
    async () => {
      const docs = (await documents()).filter((d) => !before.has(d.clave));
      const toShopper = docs.find((d) => d.receptor?.numeroIdentificacion === CEDULA);
      const toShop = docs.find((d) => d.receptor && d.receptor.numeroIdentificacion !== CEDULA);
      return toShopper?.state === "aceptado" && toShop?.state === "aceptado"
        ? [toShopper, toShop]
        : null;
    },
  );
  for (const doc of received) {
    const xml = await (await fake.get(`${FAKE}/_fake/xml?clave=${doc.clave}`)).text();
    const root = ROOT[doc.type];
    const label = doc.receptor.numeroIdentificacion === CEDULA ? "to the shopper" : "to the shop";
    check(xmllint(["--noout"], xml).status === 0, `${label}: well-formed`);
    const valid = xmllint(["--noout", "--schema", SCHEMA[doc.type]], xml);
    check(
      valid.status === 0,
      `${label}: valid against the official schema ${valid.stderr.slice(0, 300)}`,
    );
    check(
      !/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/.test(xml),
      `${label}: no declaration or CDATA of anyone's`,
    );
    check(
      textAt(xml, root, "Emisor", "Nombre") === clean(ISSUER_NAME, 100),
      `${label}: the issuer's name, as text`,
    );
    check(
      textAt(xml, root, "Emisor", "NombreComercial") === clean(COMMERCIAL, 80),
      `${label}: the commercial name, as text`,
    );
    check(
      textAt(xml, root, "Emisor", "Ubicacion", "OtrasSenas") === clean(ADDRESS, 250),
      `${label}: the address, as text and cut to 250`,
    );
    if (label === "to the shopper") {
      check(
        textAt(xml, root, "Receptor", "Nombre") === clean(RECEIVER, 100),
        `${label}: the receiver's name`,
      );
      check(
        textAt(xml, root, "Receptor", "CorreoElectronico") === EMAIL,
        `${label}: the receiver's e-mail`,
      );
    } else {
      check(
        textAt(xml, root, "Receptor", "Nombre") === clean(LEGAL, 100),
        `${label}: the shop's legal name, as text and cut to 100`,
      );
    }
    check(signatureHolds(xml), `${label}: the digests and the signature hold`);
    check(
      !signatureHolds(
        xml.replace("&lt;/Nombre&gt;&lt;Nombre&gt;Otra", "&lt;/Nombre&gt;&lt;Nombre&gt;Otro"),
      ),
      `${label}: and break when one escaped character changes`,
    );
  }

  // ── 4. The pages show it as text ────────────────────────────────────────
  await until("the order page to show the factura", async () => {
    await shopper.goto(`${WEB}${orderPath}`, { waitUntil: "load" });
    await shopper.waitForSelector('h1:visible:has-text("Pedido")');
    return (await text(shopper.locator("section:has(#comprobantes)"))).includes(
      "Aceptado por Hacienda",
    );
  });
  check(
    (await text(shopper.locator("section:has(#comprobantes)"))).includes(
      `a nombre de ${clean(RECEIVER, 100)}`,
    ),
    "the order page names the receiver as typed",
  );
  await shopper.click('a:has-text("Ver comprobante")');
  await shopper.waitForSelector('h1:visible:has-text("Factura electrónica")');
  const view = await text(shopper.locator("main"));
  check(view.includes(clean(RECEIVER, 100)), "the document page shows the name as text");
  check(view.includes(clean(ISSUER_NAME, 100)), "and the issuer's name");
  await shopper.screenshot({ path: `${SHOTS}/ie01-invoice-hostile-text.png`, fullPage: true });

  const finance = await signIn(OPS, "central@yuntera.example", "/comprobantes");
  await finance.waitForSelector("#por-dia");
  check(
    (await text(finance.locator("main"))).includes(clean(RECEIVER, 100)),
    "the console lists it under the name as typed",
  );
  await finance.screenshot({ path: `${SHOTS}/ie02-ops-hostile-text.png`, fullPage: true });

  check(errors.length === 0, `no browser errors or 5xx (${errors.join(" | ")})`);
  await browser.close();
  log("invoicing escaping journey: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
