/**
 * The shopper's complaint form and their cases, in words both shopper apps
 * use (the website's /reclamo and the phone app's "Presentar un reclamo").
 * The rules mirror public.file_complaint (20261121083000_limits.sql): one of
 * six categories, a description of 10 to 4000 characters, and an optional
 * order number of the shopper's own (up to 40 characters). The database is
 * the lock; these checks only give a good message first.
 *
 * The promised times are those of docs/06-operations/customer-service.md
 * ("Formal complaint"), in service-times.ts (COMPLAINT_PROMISE). The exact
 * dates come from the database (my_complaint_receipt), which counts working
 * days on the operations calendar.
 */

import { statusWordOf } from "./status-words";

export const COMPLAINT_CATEGORIES = [
  ["delivery", "La entrega"],
  ["product", "El producto"],
  ["payment", "Un cobro o un reembolso"],
  ["seller", "Un vendedor"],
  ["privacy", "Sus datos personales"],
  ["other", "Otra cosa"],
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number][0];

export const COMPLAINT_DESCRIPTION_MIN = 10;
export const COMPLAINT_DESCRIPTION_MAX = 4000;

export interface ComplaintInput {
  category: ComplaintCategory;
  description: string;
  orderNumber: string | null;
}

const CATEGORY_VALUES = new Set<string>(COMPLAINT_CATEGORIES.map(([value]) => value));

/** The checks the apps make before calling file_complaint, with their words. */
export function checkComplaint(form: {
  category: string | null | undefined;
  description: string;
  orderNumber?: string | null;
}):
  | { error: string; field: "category" | "description" | "orderNumber" }
  | { input: ComplaintInput } {
  if (!form.category || !CATEGORY_VALUES.has(form.category)) {
    return { error: "Elija de qué trata su reclamo.", field: "category" };
  }
  const description = form.description.trim();
  if (description.length < COMPLAINT_DESCRIPTION_MIN) {
    return {
      error: "Cuéntenos qué pasó en al menos 10 caracteres.",
      field: "description",
    };
  }
  if (description.length > COMPLAINT_DESCRIPTION_MAX) {
    return {
      error: "El reclamo puede tener hasta 4000 caracteres.",
      field: "description",
    };
  }
  const orderNumber = (form.orderNumber ?? "").trim().toUpperCase();
  if (orderNumber && !/^YT-\d{4,12}$/.test(orderNumber)) {
    return {
      error: "Revise el número de pedido: tiene la forma YT-100123.",
      field: "orderNumber",
    };
  }
  return {
    input: {
      category: form.category as ComplaintCategory,
      description,
      orderNumber: orderNumber || null,
    },
  };
}

/**
 * What the form says once the complaint is filed, the date formatted. This
 * message, with its reference, is the acknowledgement the promise speaks of
 * (no second one follows), so it gives only the date of the written answer.
 */
export function complaintFiledText(receipt: { reference: string; answerBy: string }): string {
  return `Recibimos su reclamo ${receipt.reference}. Este mensaje es la confirmación; guarde el número de referencia. Le respondemos por escrito a más tardar el ${receipt.answerBy}, y la respuesta queda en su cuenta, en «Sus consultas».`;
}

/** A case as the shopper names it. */
export const MY_CASE_KIND: Record<string, string> = {
  complaint: "Reclamo",
  return: "Devolución",
  report: "Reporte",
  contact: "Consulta",
};

/**
 * What the shopper's case card promises by its due day (answer_due_on, the
 * case's resolution day), the day already formatted. Only a complaint's due
 * day is the day of an answer (the written answer); a return or a contact is
 * resolved by then and a report reviewed, while their first answer comes
 * sooner (a return's in 2 working hours, as the order's page says), so they
 * never say «le respondemos» for that later day.
 */
export function myCaseDueText(kind: string, day: string): string {
  if (kind === "complaint") return `le respondemos a más tardar el ${day}`;
  if (kind === "report") return `lo revisamos a más tardar el ${day}`;
  return `lo resolvemos a más tardar el ${day}`;
}

/**
 * Whether someone at Yuntera has responded to a shopper's case: a written
 * answer, or a decision without one (a return approved in Atención without a
 * note sets responded_at, the case's first_response_at, as the console reads
 * it). Without this the shopper read «Por responder» while the same order
 * page said «Aprobada».
 */
export function myCaseResponded(item: {
  answers: readonly unknown[];
  responded_at?: string | null;
}): boolean {
  return item.answers.length > 0 || (item.responded_at ?? null) !== null;
}

/**
 * Where a shopper's case stands, in words (never colour alone): the «cases»
 * words of status-words.ts (decision 59), «En revisión» once someone has
 * responded (myCaseResponded).
 */
export function myCaseStatusWord(item: {
  status: string;
  answers: readonly unknown[];
  responded_at?: string | null;
}): string {
  return (
    statusWordOf("cases", item.status, { viewer: "shopper", answered: myCaseResponded(item) })
      ?.word ?? item.status
  );
}

/**
 * What a shopper's case card says when it has no written answer, the day of
 * the decision already formatted. A return or a report decided without a note
 * shows the decision in the words of status-words.ts («Aprobada: por recibir
 * (desde el 27 de noviembre).»), so the card agrees with the order's page.
 */
export function myCaseNoAnswerText(
  item: {
    kind: string;
    answers: readonly unknown[];
    responded_at?: string | null;
    decision?: { status: string } | null;
  },
  decisionDay: string | null,
): string {
  const source =
    item.kind === "return" ? "return_requests" : item.kind === "report" ? "content_reports" : null;
  const word =
    source && item.decision
      ? statusWordOf(source, item.decision.status, { viewer: "shopper" })?.word
      : undefined;
  if (word && decisionDay) {
    return `${word} (desde el ${decisionDay}). Todavía no hay una respuesta escrita; le avisamos si la hay.`;
  }
  if (myCaseResponded(item)) {
    return "Ya revisamos su caso. Todavía no hay una respuesta escrita; le avisamos si la hay.";
  }
  return "Todavía no hay respuesta. Le avisamos cuando la haya.";
}
