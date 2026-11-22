/**
 * Hacienda's answer, MensajeHacienda (research note 5.4): Mensaje 1 accepted,
 * 3 rejected, and DetalleMensaje with the reasons or warnings. Only these
 * fields are read; the whole XML is kept as Hacienda sent it.
 */

const decode = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function field(xml: string, name: string): string | null {
  const match = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${name}>`,
  ).exec(xml);
  if (!match) return null;
  const inner = match[1] ?? "";
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(inner.trim());
  return cdata ? (cdata[1] ?? "") : decode(inner);
}

export interface HaciendaMessage {
  clave: string | null;
  /** "1" accepted, "3" rejected. */
  message: string | null;
  detail: string | null;
}

export function readMessage(xml: string): HaciendaMessage {
  const detail = field(xml, "DetalleMensaje");
  return {
    clave: field(xml, "Clave")?.trim() ?? null,
    message: field(xml, "Mensaje")?.trim() ?? null,
    // Kept readable for staff: at most 2 000 characters, whitespace tidied.
    detail: detail === null ? null : detail.replace(/\s+/g, " ").trim().slice(0, 2000),
  };
}
