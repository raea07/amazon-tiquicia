import type { CaseClock, CaseRow, CaseTargetUnit } from "@yuntera/db";
import { formatDate, formatDateTime, type Tone } from "@yuntera/ui";
import { COMPLAINT_CATEGORY, REPORT_REASON, RETURN_KIND, RETURN_STATUS } from "@/lib/labels";

/** The roles that work in Casos (each reads its own kinds of case; admin all). */
export const CASE_ROLES = ["support", "ops", "finance", "catalog"] as const;

/** The kinds of case, as the console names them. */
export const CASE_KIND: Record<string, string> = {
  complaint: "Reclamo",
  return: "Devolución",
  report: "Reporte de contenido",
  contact: "Contacto",
};

export const CASE_CHANNEL: Record<string, string> = {
  shop: "Tienda",
  whatsapp: "WhatsApp",
  phone: "Teléfono",
  email: "Correo",
};

/** The channel inside a sentence: "llegó por la tienda", "llegó por teléfono". */
export const CASE_CHANNEL_IN_SENTENCE: Record<string, string> = {
  shop: "la tienda",
  whatsapp: "WhatsApp",
  phone: "teléfono",
  email: "correo",
};

/** What a recorded contact can be about, with the target it takes. */
export const CONTACT_TOPIC: Record<string, string> = {
  delivery_today: "Pedido en camino hoy",
  delivery_problem: "Entrega fallida o atrasada",
  item_problem: "Producto equivocado, dañado o incompleto",
  return: "Devolución o retracto",
  payment: "Pago",
  seller: "Pregunta sobre un vendedor",
  listing: "Una publicación",
  complaint: "Reclamo formal",
  other: "Otra consulta",
};

/** A case's topic in words, by its kind. */
export function caseTopic(row: Pick<CaseRow, "kind" | "topic">): string {
  const table =
    row.kind === "complaint"
      ? COMPLAINT_CATEGORY
      : row.kind === "return"
        ? RETURN_KIND
        : row.kind === "report"
          ? REPORT_REASON
          : CONTACT_TOPIC;
  return table[row.topic] ?? row.topic;
}

/** The clock in words: status is never colour alone. */
export const CASE_CLOCK: Record<CaseClock, { label: string; tone: Tone }> = {
  on_time: { label: "A tiempo", tone: "neutral" },
  due_soon: { label: "Vence pronto", tone: "warning" },
  overdue: { label: "Atrasado", tone: "danger" },
  closed: { label: "Cerrado", tone: "success" },
};

/** "3 h 20 min", "2 días", "15 min": a span, rounded down. */
export function span(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 día" : `${days} días`;
}

/** Whether an instant is midnight in Costa Rica (the end of the day before). */
function isMidnightInCostaRica(value: string): boolean {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Costa_Rica",
  }).format(new Date(value));
  return time === "00:00";
}

/**
 * A due time in words. Due times in working or calendar days fall at
 * midnight, which reads as the next day; they are said as the end of the day
 * they close: "el final del lunes, 30 de nov." rather than "1 dic, 12:00 a. m.".
 */
export function deadline(value: string): string {
  if (!isMidnightInCostaRica(value)) return formatDateTime(value);
  const dayBefore = new Date(new Date(value).getTime() - 1000).toISOString();
  return `el final del ${formatDate(dayBefore, { weekday: "long", day: "numeric", month: "short" })}`;
}

/**
 * What the case is waiting for, how long is left from `now` and the due time:
 * "Responder: quedan 3 h (plazo: 27 nov, 3:00 p. m.)", "Resolver: atrasado
 * por 2 h (plazo: …)", or, a day or more ahead, "Responder: a más tardar el
 * final del lunes, 30 de nov." (a count of days would include weekends and
 * holidays, which the targets do not count).
 */
export function timeLeft(
  row: Pick<CaseRow, "next_due_at" | "first_response_at">,
  now: number,
): string | null {
  if (!row.next_due_at) return null;
  const what = row.first_response_at ? "Resolver" : "Responder";
  const due = deadline(row.next_due_at);
  const left = new Date(row.next_due_at).getTime() - now;
  if (left < 0) return `${what}: atrasado por ${span(-left)} (plazo: ${due})`;
  if (left < 86_400_000) return `${what}: quedan ${span(left)} (plazo: ${due})`;
  return `${what}: a más tardar ${due}`;
}

/** What each timeline entry says. */
export function entryLabel(kind: string, body: string | null, caseKind: string): string {
  switch (kind) {
    case "opened":
      return "Se abrió el caso";
    case "note":
      return "Nota interna";
    case "answer":
      return "Respuesta al cliente";
    case "assigned":
      return "Tomó el caso";
    case "closed":
      return "Cerró el caso";
    case "reopened":
      return "Volvió a abrir el caso";
    case "status":
      if (caseKind === "return") return `Devolución: ${RETURN_STATUS[body ?? ""]?.label ?? body}`;
      if (caseKind === "report") {
        return body === "actioned"
          ? "Reporte: se retiró el contenido"
          : body === "dismissed"
            ? "Reporte: descartado"
            : "Reporte: en revisión";
      }
      return `Estado: ${body ?? ""}`;
    default:
      return kind;
  }
}

const UNIT: Record<CaseTargetUnit, [string, string]> = {
  minutes: ["minuto", "minutos"],
  working_hours: ["hora hábil", "horas hábiles"],
  working_days: ["día hábil", "días hábiles"],
  calendar_days: ["día natural", "días naturales"],
  same_day: ["el mismo día", "el mismo día"],
};

/** "2 horas hábiles", "el mismo día". */
export function targetText(amount: number, unit: CaseTargetUnit): string {
  const [one, many] = UNIT[unit];
  if (unit === "same_day") return one;
  return `${amount} ${amount === 1 ? one : many}`;
}
