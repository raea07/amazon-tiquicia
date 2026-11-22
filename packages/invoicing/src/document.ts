/**
 * The XML of a v4.4 document (factura 01, nota de crédito 03, tiquete 04)
 * from the figures the database numbered and computed. Element order follows
 * the schemas' xs:sequence (research note 3.4 to 3.13); optional totals that
 * do not apply are left out, as the note's validated samples do.
 *
 * Nothing is trusted blindly: before a document is written, validate() checks
 * the clave against the consecutive number, the date and the issuer; every
 * line against the annex's formulas; and every total against the lines. A
 * figure that does not add up stops the document here (InvalidDocument), so a
 * bug becomes an alert for staff instead of a document Hacienda rejects.
 */

import { formatAmount, lineTotal, parseAmount, parseQuantity, taxOn } from "./amounts.ts";
import { DOCUMENT, type DocumentType, HACIENDA_EMAIL, IVA_RATE } from "./codes.ts";
import { fechaEmision, parseClave } from "./key.ts";
import { cleanText, el, leaf, type XmlElement } from "./xml.ts";

export const DS_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";

export interface Location {
  province: number;
  canton: number;
  district: number;
  other_signs: string;
}

export interface Issuer {
  name: string;
  commercial_name: string | null;
  id_type: string;
  id_number: string;
  activity_code: string;
  location: Location;
  emails: string[];
  phone: { country: number; number: string } | null;
}

export interface Receiver {
  name: string;
  id_type: string;
  id_number: string;
  email: string | null;
  activity_code: string | null;
}

export interface Line {
  number: number;
  cabys: string;
  quantity: string;
  unit: string;
  description: string;
  unit_price: string;
  total: string;
  subtotal: string;
  base: string;
  tax: { code: string; tarifa_code: string; rate: string; amount: string };
  net_tax: string;
  line_total: string;
}

export interface Payment {
  code: string;
  other: string | null;
  amount: string;
}

export interface Reference {
  type: string;
  number: string;
  issued_at: string;
  code: string;
  reason: string;
}

export interface Summary {
  services_taxed: string | null;
  services_exempt: string | null;
  services_not_subject: string | null;
  goods_taxed: string | null;
  goods_exempt: string | null;
  goods_not_subject: string | null;
  total_taxed: string | null;
  total_exempt: string | null;
  total_not_subject: string | null;
  total_sale: string;
  total_net: string;
  breakdown: Array<{ code: string; tarifa_code: string; amount: string }>;
  total_tax: string | null;
  total: string;
}

export interface FiscalDocument {
  document_type: DocumentType;
  clave: string;
  consecutivo: string;
  /** The instant written to FechaEmision and the clave's date (ISO 8601). */
  issued_at: string;
  /** ProveedorSistemas: for software developed in-house, the taxpayer's own identification. */
  provider_id: string;
  issuer: Issuer;
  receiver: Receiver | null;
  sale_condition: string;
  sale_condition_other: string | null;
  lines: Line[];
  payments: Payment[];
  summary: Summary;
  references: Reference[];
}

export class InvalidDocument extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const fail = (code: string): never => {
  throw new InvalidDocument(code);
};

const isService = (cabys: string) => /^[5-9]/.test(cabys);
const NOT_SUBJECT = new Set(["01", "11"]);
const EXEMPT = new Set(["10"]);

/** The totals of ResumenFactura, recomputed from the lines (ANX pp. 50–56). */
export function summarize(lines: Line[]): Summary {
  const sum = (filter: (line: Line) => boolean) =>
    lines.filter(filter).reduce((acc, line) => acc + parseAmount(line.total), 0n);
  const kind = (line: Line) =>
    EXEMPT.has(line.tax.tarifa_code)
      ? "exempt"
      : NOT_SUBJECT.has(line.tax.tarifa_code)
        ? "not_subject"
        : "taxed";
  const part = (service: boolean, k: string) =>
    sum((line) => isService(line.cabys) === service && kind(line) === k);
  const present = (value: bigint, any: boolean) => (any ? formatAmount(value) : null);
  const has = (service: boolean | null, k: string) =>
    lines.some(
      (line) => (service === null || isService(line.cabys) === service) && kind(line) === k,
    );

  const taxed = part(true, "taxed") + part(false, "taxed");
  const exempt = part(true, "exempt") + part(false, "exempt");
  const notSubject = part(true, "not_subject") + part(false, "not_subject");
  const totalSale = taxed + exempt + notSubject;

  const breakdown = new Map<string, bigint>();
  let totalTax = 0n;
  for (const line of lines) {
    const key = `${line.tax.code}/${line.tax.tarifa_code}`;
    const amount = parseAmount(line.tax.amount);
    breakdown.set(key, (breakdown.get(key) ?? 0n) + amount);
    totalTax += parseAmount(line.net_tax);
  }
  const anyTax = lines.some((line) => parseAmount(line.tax.amount) > 0n);
  return {
    services_taxed: present(part(true, "taxed"), has(true, "taxed")),
    services_exempt: present(part(true, "exempt"), has(true, "exempt")),
    services_not_subject: present(part(true, "not_subject"), has(true, "not_subject")),
    goods_taxed: present(part(false, "taxed"), has(false, "taxed")),
    goods_exempt: present(part(false, "exempt"), has(false, "exempt")),
    goods_not_subject: present(part(false, "not_subject"), has(false, "not_subject")),
    total_taxed: present(taxed, has(null, "taxed")),
    total_exempt: present(exempt, has(null, "exempt")),
    total_not_subject: present(notSubject, has(null, "not_subject")),
    total_sale: formatAmount(totalSale),
    total_net: formatAmount(totalSale),
    breakdown: anyTax
      ? [...breakdown.entries()]
          .filter(([, amount]) => amount > 0n)
          .map(([key, amount]) => {
            const [code = "", tarifa = ""] = key.split("/");
            return { code, tarifa_code: tarifa, amount: formatAmount(amount) };
          })
      : [],
    total_tax: anyTax ? formatAmount(totalTax) : null,
    total: formatAmount(totalSale + totalTax),
  };
}

/** Hacienda's documented e-mail structure, the same rule the database applies at input. */
const EMAIL = HACIENDA_EMAIL;

/** JSON with object keys sorted: the database returns its objects in its own key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Checks everything the annex can reject on arithmetic or shape; throws InvalidDocument. */
export function validate(doc: FiscalDocument): void {
  if (!DOCUMENT[doc.document_type]) fail("document_type");
  const key = parseClave(doc.clave) ?? fail("clave_malformed");
  if (doc.clave.slice(21, 41) !== doc.consecutivo) fail("clave_consecutivo_mismatch");
  if (key.documentType !== doc.document_type) fail("clave_type_mismatch");
  const issued = new Date(doc.issued_at);
  if (Number.isNaN(issued.getTime())) fail("issued_at_invalid");
  const fecha = fechaEmision(issued);
  if (
    fecha.slice(0, 10) !==
    `${key.year}-${String(key.month).padStart(2, "0")}-${String(key.day).padStart(2, "0")}`
  ) {
    fail("clave_date_mismatch");
  }
  if (key.identification !== doc.issuer.id_number.padStart(12, "0")) fail("clave_issuer_mismatch");

  if (!/^\d{6}$/.test(doc.issuer.activity_code)) fail("activity_code_invalid");
  if (!/^[A-Za-z0-9]{1,20}$/.test(doc.provider_id)) fail("provider_id_invalid");
  if (!/^0[1-4]$/.test(doc.issuer.id_type)) fail("issuer_id_type_invalid");
  if (!/^[A-Za-z0-9]{9,12}$/.test(doc.issuer.id_number)) fail("issuer_id_invalid");
  if (cleanText(doc.issuer.name, 100).length < 5) fail("issuer_name_invalid");
  if (doc.issuer.emails.length < 1 || doc.issuer.emails.length > 4) fail("issuer_email_missing");
  for (const email of doc.issuer.emails) {
    if (email.length > 160 || !EMAIL.test(email)) fail("issuer_email_invalid");
  }
  const loc = doc.issuer.location;
  if (
    !(loc.province >= 1 && loc.province <= 9) ||
    !(loc.canton >= 1 && loc.canton <= 99) ||
    !(loc.district >= 1 && loc.district <= 99) ||
    cleanText(loc.other_signs, 250).length < 5
  ) {
    fail("issuer_location_invalid");
  }

  if (doc.document_type === "01" && !doc.receiver) fail("receiver_required");
  if (doc.receiver) {
    if (!/^0[1-4]$/.test(doc.receiver.id_type)) fail("receiver_id_type_invalid");
    if (!/^[A-Za-z0-9]{9,12}$/.test(doc.receiver.id_number)) fail("receiver_id_invalid");
    if (cleanText(doc.receiver.name, 100).length < 3) fail("receiver_name_invalid");
    if (
      doc.receiver.email &&
      (doc.receiver.email.length > 160 || !EMAIL.test(doc.receiver.email))
    ) {
      fail("receiver_email_invalid");
    }
    if (doc.receiver.activity_code && !/^\d{6}$/.test(doc.receiver.activity_code)) {
      fail("receiver_activity_code_invalid");
    }
  }
  if (doc.document_type === "03" && doc.references.length === 0) fail("reference_required");
  if (doc.references.length > 10) fail("too_many_references");
  for (const reference of doc.references) {
    if (!/^\d{2}$/.test(reference.type) || !/^\d{2}$/.test(reference.code)) fail("reference_code");
    if (!/^[A-Za-z0-9]{1,50}$/.test(reference.number)) fail("reference_number");
    if (Number.isNaN(new Date(reference.issued_at).getTime())) fail("reference_date");
    if (cleanText(reference.reason, 180).length < 3) fail("reference_reason");
  }
  if (!/^\d{2}$/.test(doc.sale_condition)) fail("sale_condition_invalid");

  if (doc.lines.length < 1 || doc.lines.length > 1000) fail("lines_count");
  doc.lines.forEach((line, index) => {
    if (line.number !== index + 1) fail("line_number");
    if (!/^\d{13}$/.test(line.cabys)) fail("cabys_invalid");
    if (cleanText(line.description, 200).length < 3) fail("description_invalid");
    const quantity = parseQuantity(line.quantity);
    if (quantity <= 0n) fail("quantity_invalid");
    const price = parseAmount(line.unit_price);
    if (price <= 0n) fail("unit_price_invalid");
    const total = parseAmount(line.total);
    if (lineTotal(quantity, price) !== total) fail("line_total_formula");
    if (parseAmount(line.subtotal) !== total) fail("subtotal_formula");
    if (parseAmount(line.base) !== parseAmount(line.subtotal)) fail("base_formula");
    const rate = IVA_RATE[line.tax.tarifa_code] ?? fail("tarifa_code_invalid");
    if (line.tax.code !== "01" || line.tax.rate !== rate.rate) fail("tarifa_mismatch");
    if (taxOn(parseAmount(line.base), rate.bps) !== parseAmount(line.tax.amount)) {
      fail("tax_formula");
    }
    if (parseAmount(line.net_tax) !== parseAmount(line.tax.amount)) fail("net_tax_formula");
    if (parseAmount(line.line_total) !== parseAmount(line.subtotal) + parseAmount(line.net_tax)) {
      fail("line_total_line_formula");
    }
  });

  const expected = summarize(doc.lines);
  for (const field of Object.keys(expected) as Array<keyof Summary>) {
    if (stable(expected[field]) !== stable(doc.summary[field] ?? null)) {
      fail(`summary_${field}`);
    }
  }

  if (doc.payments.length < 1 || doc.payments.length > 4) fail("payments_count");
  for (const payment of doc.payments) {
    if (!/^\d{2}$/.test(payment.code)) fail("payment_code");
    if (payment.code === "99" && cleanText(payment.other ?? "", 100).length < 3) {
      fail("payment_other_required");
    }
  }
  const paid = doc.payments.reduce((acc, payment) => acc + parseAmount(payment.amount), 0n);
  if (paid !== parseAmount(doc.summary.total)) fail("payments_total");
}

const location = (loc: Location) =>
  el(
    "Ubicacion",
    null,
    leaf("Provincia", loc.province),
    leaf("Canton", String(loc.canton).padStart(2, "0")),
    leaf("Distrito", String(loc.district).padStart(2, "0")),
    leaf("OtrasSenas", cleanText(loc.other_signs, 250)),
  );

const identification = (type: string, number: string) =>
  el("Identificacion", null, leaf("Tipo", type), leaf("Numero", number));

function lineElement(line: Line) {
  return el(
    "LineaDetalle",
    null,
    leaf("NumeroLinea", line.number),
    leaf("CodigoCABYS", line.cabys),
    leaf("Cantidad", line.quantity),
    leaf("UnidadMedida", line.unit),
    leaf("Detalle", cleanText(line.description, 200)),
    leaf("PrecioUnitario", line.unit_price),
    leaf("MontoTotal", line.total),
    leaf("SubTotal", line.subtotal),
    leaf("BaseImponible", line.base),
    el(
      "Impuesto",
      null,
      leaf("Codigo", line.tax.code),
      leaf("CodigoTarifaIVA", line.tax.tarifa_code),
      leaf("Tarifa", line.tax.rate),
      leaf("Monto", line.tax.amount),
    ),
    // Mandatory in facturas and tiquetes, optional in credit notes: always written.
    leaf("ImpuestoAsumidoEmisorFabrica", "0.00000"),
    leaf("ImpuestoNeto", line.net_tax),
    leaf("MontoTotalLinea", line.line_total),
  );
}

/** The unsigned document; signature.ts adds ds:Signature as its last child. */
export function buildDocument(doc: FiscalDocument): XmlElement {
  validate(doc);
  const spec = DOCUMENT[doc.document_type];
  const s = doc.summary;
  const issuer = doc.issuer;
  const receiverAllowsActivity = doc.document_type !== "04";

  return el(
    spec.root,
    [
      ["xmlns", spec.namespace],
      ["xmlns:ds", DS_NAMESPACE],
    ],
    leaf("Clave", doc.clave),
    leaf("ProveedorSistemas", doc.provider_id),
    leaf("CodigoActividadEmisor", issuer.activity_code),
    receiverAllowsActivity ? leaf("CodigoActividadReceptor", doc.receiver?.activity_code) : null,
    leaf("NumeroConsecutivo", doc.consecutivo),
    leaf("FechaEmision", fechaEmision(new Date(doc.issued_at))),
    el(
      "Emisor",
      null,
      leaf("Nombre", cleanText(issuer.name, 100)),
      identification(issuer.id_type, issuer.id_number),
      issuer.commercial_name && cleanText(issuer.commercial_name, 80).length >= 3
        ? leaf("NombreComercial", cleanText(issuer.commercial_name, 80))
        : null,
      location(issuer.location),
      issuer.phone
        ? el(
            "Telefono",
            null,
            leaf("CodigoPais", issuer.phone.country),
            leaf("NumTelefono", issuer.phone.number),
          )
        : null,
      issuer.emails.map((email) => leaf("CorreoElectronico", email.trim())),
    ),
    doc.receiver
      ? el(
          "Receptor",
          null,
          leaf("Nombre", cleanText(doc.receiver.name, 100)),
          identification(doc.receiver.id_type, doc.receiver.id_number),
          doc.receiver.email ? leaf("CorreoElectronico", doc.receiver.email.trim()) : null,
        )
      : null,
    leaf("CondicionVenta", doc.sale_condition),
    doc.sale_condition === "99"
      ? leaf("CondicionVentaOtros", cleanText(doc.sale_condition_other ?? "", 100))
      : null,
    el(
      "DetalleServicio",
      null,
      doc.lines.map((line) => lineElement(line)),
    ),
    el(
      "ResumenFactura",
      null,
      el("CodigoTipoMoneda", null, leaf("CodigoMoneda", "CRC"), leaf("TipoCambio", "1.00000")),
      leaf("TotalServGravados", s.services_taxed),
      leaf("TotalServExentos", s.services_exempt),
      leaf("TotalServNoSujeto", s.services_not_subject),
      leaf("TotalMercanciasGravadas", s.goods_taxed),
      leaf("TotalMercanciasExentas", s.goods_exempt),
      leaf("TotalMercNoSujeta", s.goods_not_subject),
      leaf("TotalGravado", s.total_taxed),
      leaf("TotalExento", s.total_exempt),
      leaf("TotalNoSujeto", s.total_not_subject),
      leaf("TotalVenta", s.total_sale),
      leaf("TotalVentaNeta", s.total_net),
      s.breakdown.map((part) =>
        el(
          "TotalDesgloseImpuesto",
          null,
          leaf("Codigo", part.code),
          leaf("CodigoTarifaIVA", part.tarifa_code),
          leaf("TotalMontoImpuesto", part.amount),
        ),
      ),
      leaf("TotalImpuesto", s.total_tax),
      doc.payments.map((payment) =>
        el(
          "MedioPago",
          null,
          leaf("TipoMedioPago", payment.code),
          payment.code === "99"
            ? leaf("MedioPagoOtros", cleanText(payment.other ?? "", 100))
            : null,
          leaf("TotalMedioPago", payment.amount),
        ),
      ),
      leaf("TotalComprobante", s.total),
    ),
    doc.references.map((reference) =>
      el(
        "InformacionReferencia",
        null,
        leaf("TipoDocIR", reference.type),
        leaf("Numero", reference.number),
        leaf("FechaEmisionIR", fechaEmision(new Date(reference.issued_at))),
        leaf("Codigo", reference.code),
        leaf("Razon", cleanText(reference.reason, 180)),
      ),
    ),
  );
}
