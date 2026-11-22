/**
 * The codes of Hacienda's v4.4 annex that Yuntera's own documents use, with
 * the plain-language name a person reads on the document's readable page
 * (the annex asks for descriptions, not bare codes: notas 1 and 7).
 * Source: docs/research/hacienda-factura-electronica-v44.md, sections 3.1 to 3.13,
 * with the corrections at its end.
 */

export type DocumentType = "01" | "03" | "04";

/** Root element and namespace of each document type (XSD targetNamespace). */
export const DOCUMENT: Record<DocumentType, { root: string; namespace: string; name: string }> = {
  "01": {
    root: "FacturaElectronica",
    namespace: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica",
    name: "Factura electrónica",
  },
  "03": {
    root: "NotaCreditoElectronica",
    namespace: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica",
    name: "Nota de crédito electrónica",
  },
  "04": {
    root: "TiqueteElectronico",
    namespace: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico",
    name: "Tiquete electrónico",
  },
};

export const MENSAJE_HACIENDA_NAMESPACE =
  "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda";

export const DOCUMENT_NAME: Record<string, string> = {
  "01": "Factura electrónica",
  "02": "Nota de débito electrónica",
  "03": "Nota de crédito electrónica",
  "04": "Tiquete electrónico",
  "08": "Factura electrónica de compra",
  "09": "Factura electrónica de exportación",
  "10": "Recibo electrónico de pago",
};

/** Identification types (nota 4). 05 and 06 exist only in purchase invoices. */
export const ID_TYPE: Record<string, string> = {
  "01": "Cédula física",
  "02": "Cédula jurídica",
  "03": "DIMEX",
  "04": "NITE",
};

/** Situation digit of the clave (nota 4.1, position 42). */
export const SITUATION: Record<string, string> = {
  "1": "Normal",
  "2": "Contingencia",
  "3": "Sin internet",
};

export const TAX_CODE: Record<string, string> = { "01": "Impuesto al Valor Agregado (IVA)" };

/** IVA rate codes (nota 8.1): the rate each code means, as written in `Tarifa`. */
export const IVA_RATE: Record<string, { rate: string; bps: number; name: string }> = {
  "01": { rate: "0.00", bps: 0, name: "Tarifa 0 % (artículo 32.1 del reglamento)" },
  "02": { rate: "1.00", bps: 100, name: "Tarifa reducida 1 %" },
  "03": { rate: "2.00", bps: 200, name: "Tarifa reducida 2 %" },
  "04": { rate: "4.00", bps: 400, name: "Tarifa reducida 4 %" },
  "08": { rate: "13.00", bps: 1300, name: "Tarifa general 13 %" },
  "09": { rate: "0.50", bps: 50, name: "Tarifa reducida 0,5 %" },
  "10": { rate: "0.00", bps: 0, name: "Exento" },
  "11": { rate: "0.00", bps: 0, name: "Tarifa 0 % sin derecho a crédito" },
};

/** Sale conditions (nota 5) that Yuntera may use. */
export const SALE_CONDITION: Record<string, string> = {
  "01": "Contado",
  "02": "Crédito",
  "07": "Cobro a favor de un tercero",
  "99": "Otros",
};

/** Payment methods (nota 6). In v4.4 they sit inside ResumenFactura, with an amount. */
export const PAYMENT_METHOD: Record<string, string> = {
  "01": "Efectivo",
  "02": "Tarjeta",
  "03": "Cheque",
  "04": "Transferencia o depósito bancario",
  "05": "Recaudado por terceros",
  "06": "SINPE Móvil",
  "07": "Plataforma digital",
  "99": "Otros",
};

/** Units for services (nota 15). */
export const UNIT: Record<string, string> = {
  Os: "Otro tipo de servicio",
  Cm: "Comisiones",
  Sp: "Servicios profesionales",
  Spe: "Servicios personales",
  St: "Servicios técnicos",
  Unid: "Unidad",
};

/** Kinds of referenced document (nota 10, TipoDocIR). */
export const REFERENCE_TYPE: Record<string, string> = {
  "01": "Factura electrónica",
  "02": "Nota de débito electrónica",
  "03": "Nota de crédito electrónica",
  "04": "Tiquete electrónico",
  "08": "Comprobante emitido en contingencia",
  "10": "Comprobante rechazado por Hacienda",
  "99": "Otros",
};

/** What a reference does (nota 9, Codigo), including the codes in force since 1 Nov 2026. */
export const REFERENCE_CODE: Record<string, string> = {
  "01": "Anula el documento de referencia",
  "02": "Corrige monto",
  "04": "Referencia a otro documento",
  "05": "Sustituye comprobante provisional por contingencia",
  "06": "Devolución de mercancía",
  "07": "Sustituye comprobante electrónico",
  "13": "Anula por error material",
  "14": "Corrige monto por error material",
  "15": "Sustituye comprobante electrónico por error material",
  "16": "Sustituye comprobante electrónico rechazado",
  "99": "Otros",
};

/** The reference codes the settings may choose for a credit note (the accountant decides which). */
export const CREDIT_NOTE_CODES = ["01", "02", "06", "13", "14"] as const;

/** MensajeHacienda/Mensaje: 1 accepted, 3 rejected. */
export const HACIENDA_MESSAGE: Record<string, string> = { "1": "Aceptado", "3": "Rechazado" };

/**
 * XAdES signature policy (ANX Anexo 2): the identifier and the SHA-256 of the
 * policy document, as Hacienda's own example publishes it. Hard-coded on
 * purpose (research note 4.1): validators were built against this value.
 */
export const SIGNATURE_POLICY = {
  identifier:
    "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf",
  digestValue: "DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=",
} as const;

// ── What a person types ─────────────────────────────────────────────────────
// The same rules as the database (private.invoice_clean_text,
// private.invoice_email_valid) and the checkout's form, so nothing accepted at
// input is refused when the document is written.

/**
 * Whether XML 1.0 can carry a code point at all: not the control characters
 * other than tab, newline and carriage return, not a lone surrogate, not
 * U+FFFE or U+FFFF.
 */
const xmlCanCarry = (code: number) =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7ff) ||
  (code >= 0xe000 && code <= 0xfffd) ||
  (code >= 0x10000 && code <= 0x10ffff);

const onlyXml = (value: string) =>
  Array.from(value)
    .filter((char) => xmlCanCarry(char.codePointAt(0) ?? 0))
    .join("");

/**
 * What a person typed, made safe for a one-line field of at most `max`
 * characters: characters XML cannot carry are removed, every run of
 * whitespace (newlines included) becomes one space, and the text is trimmed
 * and cut to `max` characters (counted as the schema counts them, by code
 * point). Markup characters are kept; the writer escapes them.
 */
export function cleanText(value: string, max: number): string {
  const one = onlyXml(value.normalize("NFC")).replace(/\s+/g, " ").trim();
  return Array.from(one).slice(0, max).join("").trim();
}

/**
 * CorreoElectronico as the annex documents its structure:
 * \w+([-+.']\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)* (ASCII word characters), at most 160.
 */
export const HACIENDA_EMAIL =
  /^[A-Za-z0-9_]+([-+.'][A-Za-z0-9_]+)*@[A-Za-z0-9_]+([-.][A-Za-z0-9_]+)*\.[A-Za-z0-9_]+([-.][A-Za-z0-9_]+)*$/;
