/**
 * Formatting for message text. Kept here rather than imported from
 * packages/core so the Edge Function bundle is this package alone; a parity
 * test (format.test.ts) keeps it equal to core's `format`.
 */

const TIME_ZONE = "America/Costa_Rica";

/** Colones from céntimos, as packages/core writes them: ₡12 500 (narrow no-break space). */
export function colones(amountMinor: number): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(Math.trunc(amountMinor));
  const whole = Math.floor(abs / 100);
  const minor = abs % 100;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = `₡${wholeText}${minor !== 0 ? `,${minor.toString().padStart(2, "0")}` : ""}`;
  return negative ? `−${body}` : body;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Year, month, day, weekday, hour and minute of an instant on the Costa Rican clock. */
export function costaRicaParts(at: Date) {
  // Costa Rica keeps UTC−6 all year (no daylight saving time).
  const local = new Date(at.getTime() - 6 * 3600 * 1000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

/** "lunes 23 de noviembre" from "2026-11-23" (a calendar date) or a timestamp. */
export function longDate(value: unknown): string {
  if (typeof value !== "string" || value.length < 10) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return `${WEEKDAYS[date.getUTCDay()]} ${d} de ${MONTHS[m - 1]}`;
  }
  const parts = costaRicaParts(new Date(value));
  return `${WEEKDAYS[parts.weekday]} ${parts.day} de ${MONTHS[parts.month]}`;
}

/** "23 de noviembre de 2026". */
export function fullDate(value: unknown): string {
  if (typeof value !== "string" || value.length < 10) return "";
  const parts = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? (() => {
        const [y, m, d] = value.split("-").map(Number) as [number, number, number];
        return { year: y, month: m - 1, day: d };
      })()
    : costaRicaParts(new Date(value));
  return `${parts.day} de ${MONTHS[parts.month]} de ${parts.year}`;
}

/** "3:05 p. m." on the Costa Rican clock. */
export function timeOfDay(value: string | Date): string {
  const parts = costaRicaParts(typeof value === "string" ? new Date(value) : value);
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${hour12}:${parts.minute.toString().padStart(2, "0")} ${parts.hour < 12 ? "a. m." : "p. m."}`;
}

export const timeZone = TIME_ZONE;

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Text that came from a person (a shop name, a product title, a note) made
 * safe for a one-line slot: control characters and line breaks removed,
 * length capped. Escaping for HTML happens separately, at the last moment.
 */
// Control characters and line/paragraph separators.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

export function clean(value: unknown, max = 120): string {
  const text = String(value ?? "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * WhatsApp template parameters may not contain new lines, tabs or more than
 * four consecutive spaces (Meta's rule), and must not be empty.
 */
export function whatsappParam(value: unknown, max = 60): string {
  const text = clean(value, max).replace(/ {4,}/g, "   ");
  return text.length > 0 ? text : "-";
}
