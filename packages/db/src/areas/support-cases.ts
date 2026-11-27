/**
 * Support cases (migration 20261121084700_support_cases.sql).
 *
 * Every complaint, return request and content report has a case, and staff
 * record WhatsApp, phone and e-mail contacts as cases of their own. A case
 * has due times from the targets of docs/06-operations/customer-service.md
 * and a timeline of notes (staff only) and answers (the customer reads them).
 * Which role reads which case is decided in the database (support and admin
 * all; ops the cases with an order; finance payments and refunds; catalog
 * reports); these methods only carry the answers.
 *
 * The shopper side: `myCases` (their own cases with the answers, never a
 * note) and `myComplaintReceipt` (what the complaint form shows after
 * `fileComplaint`). No function the store build of 3f251c3 calls changes.
 */

import { z } from "zod";
import { orderStatus } from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const timestamp = z.string().min(10);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);

export const CASE_KINDS = ["complaint", "return", "report", "contact"] as const;
export const caseKind = z.enum(CASE_KINDS);
export type CaseKind = z.infer<typeof caseKind>;

export const CASE_CHANNELS = ["shop", "whatsapp", "phone", "email"] as const;
export const caseChannel = z.enum(CASE_CHANNELS);
export type CaseChannel = z.infer<typeof caseChannel>;

/** What a recorded contact can be about; each has its own target. */
export const CONTACT_TOPICS = [
  "delivery_today",
  "delivery_problem",
  "item_problem",
  "return",
  "payment",
  "seller",
  "listing",
  "complaint",
  "other",
] as const;
export const contactTopic = z.enum(CONTACT_TOPICS);
export type ContactTopic = z.infer<typeof contactTopic>;

/** How a case stands against its next due time. */
export const caseClock = z.enum(["on_time", "due_soon", "overdue", "closed"]);
export type CaseClock = z.infer<typeof caseClock>;

/** A case as a list row. */
export const caseRow = z.object({
  id,
  /** What the customer reads as the case's reference (eight characters). */
  reference: z.string().min(4).max(12),
  kind: caseKind,
  topic: z.string(),
  channel: caseChannel,
  status: z.enum(["open", "closed"]),
  order_number: z.string().nullable(),
  /** The customer's first name only. */
  customer: z.string().nullable(),
  /** The assignee's first name only. */
  assignee: z.string().nullable(),
  assigned_to_me: z.boolean(),
  created_at: timestamp,
  first_response_due_at: timestamp,
  due_at: timestamp,
  first_response_at: timestamp.nullable(),
  resolved_at: timestamp.nullable(),
  /** The first-response time until someone answers, then the resolution time; null once closed. */
  next_due_at: timestamp.nullable(),
  clock: caseClock,
  reopened_count: count,
});
export type CaseRow = z.infer<typeof caseRow>;

export const casesPage = z.object({ cases: z.array(caseRow), total: count });
export type CasesPage = z.infer<typeof casesPage>;

export const caseEntryKind = z.enum([
  "opened",
  "note",
  "answer",
  "assigned",
  "closed",
  "reopened",
  "status",
]);
export type CaseEntryKind = z.infer<typeof caseEntryKind>;

export const caseEntry = z.object({
  id: z.number().int(),
  kind: caseEntryKind,
  /** A note's or an answer's text; for 'status', the source row's new status. */
  body: z.string().nullable(),
  created_at: timestamp,
  /** First name of who wrote it; null for the system. */
  author: z.string().nullable(),
});
export type CaseEntry = z.infer<typeof caseEntry>;

/** One case with what was asked, its order, its customer and its timeline. */
export const caseDetail = caseRow.extend({
  request: z.object({
    /** What the customer (or staff, for a contact) wrote. */
    text: z.string().nullable(),
    category: z.string().optional(),
    return_kind: z.string().optional(),
    reason: z.string().optional(),
    status: z.string().optional(),
    quantity: z.number().int().optional(),
    title: z.string().optional(),
    refund_due_on: day.nullable().optional(),
    target_type: z.string().optional(),
    target_id: id.optional(),
  }),
  order: z
    .object({
      order_number: z.string(),
      status: orderStatus,
      placed_at: timestamp,
      total_minor: z.number().int(),
      item_count: count,
    })
    .nullable(),
  customer: z
    .object({ id, first_name: z.string().nullable(), district: z.string().nullable() })
    .nullable(),
  entries: z.array(caseEntry),
  /** What the caller may do on this case. */
  can: z.object({
    note: z.boolean(),
    answer: z.boolean(),
    /** False while a return or a report still waits for its decision in Atención. */
    close: z.boolean(),
    assign: z.boolean(),
    reopen: z.boolean(),
    customer: z.boolean(),
  }),
});
export type CaseDetail = z.infer<typeof caseDetail>;

export const casesDue = z.object({ open: count, overdue: count, due_today: count });
export type CasesDue = z.infer<typeof casesDue>;

export const orderCases = z.object({ customer_id: id, cases: z.array(caseRow) });
export type OrderCases = z.infer<typeof orderCases>;

const targetUnit = z.enum([
  "minutes",
  "working_hours",
  "working_days",
  "calendar_days",
  "same_day",
]);
export type CaseTargetUnit = z.infer<typeof targetUnit>;

export const caseTarget = z.object({
  kind: caseKind,
  topic: z.string(),
  situation: z.string(),
  first_response_amount: z.number().int(),
  first_response_unit: targetUnit,
  resolution_amount: z.number().int(),
  resolution_unit: targetUnit,
});
export type CaseTarget = z.infer<typeof caseTarget>;

const share = z.object({ on_time: count }).passthrough();

/** The register for a period: the measures customer-service.md names. */
export const caseReport = z.object({
  from: day,
  to: day,
  total: count,
  by_kind: z.record(z.string(), count),
  by_topic: z.array(z.object({ kind: caseKind, topic: z.string(), count })),
  orders: count,
  first_response: z.object({
    answered: count,
    on_time: count,
    late_unanswered: count,
    median_minutes: z.number().int().nullable(),
  }),
  complaints_answered_in_time: share.extend({ closed: count, late_open: count }),
  refunds_in_legal_time: share.extend({ refunded: count }),
  reopened: count,
});
export type CaseReport = z.infer<typeof caseReport>;

export const savedReply = z.object({
  id,
  title: z.string(),
  body: z.string(),
  updated_at: timestamp,
});
export type SavedReply = z.infer<typeof savedReply>;

/** One customer across their orders: no contact details. */
export const customerView = z.object({
  id,
  first_name: z.string().nullable(),
  district: z.string().nullable(),
  account_deleted: z.boolean(),
  order_count: count,
  orders: z.array(
    z.object({
      order_number: z.string(),
      status: orderStatus,
      placed_at: timestamp,
      total_minor: z.number().int(),
    }),
  ),
  returns: z.array(
    z.object({
      id,
      kind: z.string(),
      status: z.string(),
      quantity: z.number().int(),
      title: z.string(),
      order_number: z.string(),
      created_at: timestamp,
    }),
  ),
  complaints: z.array(
    z.object({
      id,
      category: z.string(),
      status: z.string(),
      order_number: z.string().nullable(),
      created_at: timestamp,
    }),
  ),
  cases: z.array(caseRow),
  can_reveal_contact: z.boolean(),
});
export type CustomerView = z.infer<typeof customerView>;

export const customerContact = z.object({
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type CustomerContact = z.infer<typeof customerContact>;

/** A shopper's own case, with the answers staff wrote (never a note). */
export const myCase = z.object({
  id,
  reference: z.string(),
  kind: caseKind,
  topic: z.string(),
  status: z.enum(["open", "closed"]),
  created_at: timestamp,
  /** The last day (Costa Rica) the case is promised to be resolved by (for a complaint, the written answer). */
  answer_due_on: day,
  resolved_at: timestamp.nullable(),
  order_number: z.string().nullable(),
  answers: z.array(
    z.object({ body: z.string(), created_at: timestamp, author: z.string().nullable() }),
  ),
});
export type MyCase = z.infer<typeof myCase>;

/** What the complaint form shows once the complaint is filed. */
export const complaintReceipt = z.object({
  reference: z.string(),
  filed_at: timestamp,
  /** The last day (Costa Rica) of the acknowledgement promise. */
  acknowledge_by: day,
  /** The last day (Costa Rica) of the written answer promise. */
  answer_by: day,
  order_number: z.string().nullable(),
});
export type ComplaintReceipt = z.infer<typeof complaintReceipt>;

export const supportCasesErrors = {
  invalid_target: {
    "es-CR": "Ese plazo de atención no está bien definido. Avise al equipo técnico.",
    en: "That response target is not well defined. Tell the technical team.",
  },
  invalid_case: {
    "es-CR": "No pudimos mostrar esa lista de casos. Recargue la página.",
    en: "We could not show that list of cases. Reload the page.",
  },
  case_not_found: {
    "es-CR": "No encontramos ese caso, o su puesto no lo atiende.",
    en: "We could not find that case, or your role does not handle it.",
  },
  case_closed: {
    "es-CR": "Ese caso ya está cerrado. Vuelva a abrirlo para responder.",
    en: "That case is already closed. Reopen it to answer.",
  },
  case_open: {
    "es-CR": "Ese caso ya está abierto.",
    en: "That case is already open.",
  },
  invalid_note: {
    "es-CR": "La nota debe tener entre 1 y 2000 caracteres.",
    en: "The note must be between 1 and 2,000 characters.",
  },
  note_contains_code: {
    "es-CR":
      "El texto tiene el código de entrega del cliente. Quítelo: ese código solo lo ve el cliente. Quedó registrado en Auditoría.",
    en: "The text contains the customer's delivery code. Remove it: only the customer may see that code. This was recorded in the audit log.",
  },
  too_many_numbers: {
    "es-CR":
      "El texto tiene más de cinco números de cuatro cifras. Deje solo los necesarios; escriba los montos con ₡ y punto (₡4.500).",
    en: "The text has more than five four-digit numbers. Keep only the ones needed; write amounts with ₡ and a point (₡4,500).",
  },
  too_many_numbers_hour: {
    "es-CR":
      "En la última hora escribió muchos números de cuatro cifras en notas y respuestas. Escriba este texto sin ellos o espere una hora; los montos con ₡ y punto (₡4.500) no cuentan.",
    en: "In the last hour you wrote many four-digit numbers in notes and answers. Write this text without them or wait an hour; amounts with ₡ and a point (₡4,500) do not count.",
  },
  case_account_deleted: {
    "es-CR":
      "La cuenta de este cliente se eliminó: su caso ya no recibe notas ni respuestas. Si la persona vuelve a escribir, registre un contacto nuevo cuando tenga otra cuenta o un pedido nuevo.",
    en: "This customer's account was deleted: the case takes no more notes or answers. If the person writes again, record a new contact once they have another account or a new order.",
  },
  too_many_refusals: {
    "es-CR":
      "Por una hora no puede escribir notas ni respuestas: tres textos suyos tenían un código de entrega. Si necesita responder ya, pídaselo a un compañero.",
    en: "For an hour you cannot write notes or answers: three of your texts held a delivery code. If an answer cannot wait, ask a colleague.",
  },
  case_source_open: {
    "es-CR":
      "Esta devolución o este reporte se decide en Atención. Responda sin cerrar: el caso se cierra solo cuando se decida.",
    en: "This return or report is decided in Atención. Answer without closing: the case closes by itself once it is decided.",
  },
  invalid_contact: {
    "es-CR":
      "Revise el contacto: elija el medio y el tema, escriba un resumen de 10 a 1000 caracteres y diga el pedido o la cuenta.",
    en: "Check the contact: choose the channel and the topic, write a summary of 10 to 1,000 characters and give the order or the account.",
  },
  customer_not_found: {
    "es-CR": "No encontramos a ese cliente.",
    en: "We could not find that customer.",
  },
  invalid_period: {
    "es-CR": "Elija un período de hasta un año, con la fecha final después de la inicial.",
    en: "Choose a period of up to a year, with the end after the start.",
  },
  invalid_saved_reply: {
    "es-CR":
      "La respuesta guardada necesita un título de 3 a 80 caracteres y un texto de 10 a 4000.",
    en: "A saved answer needs a title of 3 to 80 characters and a text of 10 to 4,000.",
  },
  reply_not_found: {
    "es-CR": "Esa respuesta guardada ya no existe. Recargue la página.",
    en: "That saved answer no longer exists. Reload the page.",
  },
  reply_title_taken: {
    "es-CR": "Ya hay una respuesta guardada con ese título. Use otro.",
    en: "There is already a saved answer with that title. Use another.",
  },
} as const satisfies Messages;

export const supportCasesApi = ({ call, run }: Caller) => ({
  /** The cases the caller's role reads: open ones oldest first, closed ones newest first. */
  opsCases: (status: "open" | "closed" = "open", limit = 50, offset = 0) =>
    call("ops_cases", { p_status: status, p_limit: limit, p_offset: offset }, casesPage),
  /** The "Hoy" line: open cases, those due before the end of today and those late. */
  opsCasesDue: () => call("ops_cases_due", {}, casesDue),
  opsCase: (caseId: string) => call("ops_case", { p_case_id: id.parse(caseId) }, caseDetail),
  /**
   * An internal note: the customer never sees it. Null when the text held the
   * customer's delivery code: nothing was written, and the refusal is on the
   * audit trail (show `note_contains_code`).
   */
  opsAddCaseNote: (caseId: string, body: string) =>
    call(
      "ops_add_case_note",
      { p_case_id: id.parse(caseId), p_body: body },
      z.number().int().nullable(),
    ),
  /**
   * The answer the customer reads; `close` also closes the case. Support and
   * admin. Null when the text held the delivery code (as `opsAddCaseNote`).
   */
  opsAnswerCase: (caseId: string, body: string, close: boolean) =>
    call(
      "ops_answer_case",
      { p_case_id: id.parse(caseId), p_body: body, p_close: close },
      caseRow.nullable(),
    ),
  opsAssignCase: (caseId: string) =>
    call("ops_assign_case", { p_case_id: id.parse(caseId) }, caseRow),
  opsReopenCase: (caseId: string) =>
    call("ops_reopen_case", { p_case_id: id.parse(caseId) }, caseRow),
  /**
   * "Registrar un contacto" against an order (by number) or a customer's
   * account. Returns the case id, or null when the summary held the delivery
   * code (as `opsAddCaseNote`).
   */
  opsRecordContact: (input: {
    channel: Exclude<CaseChannel, "shop">;
    topic: ContactTopic;
    summary: string;
    orderNumber?: string | null;
    userId?: string | null;
  }) =>
    call(
      "ops_record_contact",
      {
        p_channel: input.channel,
        p_topic: input.topic,
        p_summary: input.summary,
        p_order_number: input.orderNumber ?? undefined,
        p_user_id: input.userId ? id.parse(input.userId) : undefined,
      },
      id.nullable(),
    ),
  opsOrderCases: (orderNumber: string) =>
    call("ops_order_cases", { p_order_number: orderNumber }, orderCases),
  /** The register for [from, to): dates as YYYY-MM-DD, Costa Rica time. */
  opsCaseReport: (from: string, to: string) =>
    call("ops_case_report", { p_from: day.parse(from), p_to: day.parse(to) }, caseReport),
  opsCaseTargets: () => call("ops_case_targets", {}, z.array(caseTarget)),
  opsSavedReplies: () => call("ops_saved_replies", {}, z.array(savedReply)),
  /** Creates a saved answer, or changes the one with `replyId`. Administrators only. */
  opsSaveReply: (title: string, body: string, replyId?: string | null) =>
    call(
      "ops_save_reply",
      { p_title: title, p_body: body, p_id: replyId ? id.parse(replyId) : undefined },
      id,
    ),
  opsDeleteReply: (replyId: string) => run("ops_delete_reply", { p_id: id.parse(replyId) }),
  opsCustomer: (userId: string) =>
    call("ops_customer", { p_user_id: id.parse(userId) }, customerView),
  /** "Mostrar contacto": the reason goes on the audit trail. Support and admin. */
  opsCustomerContact: (userId: string, reason: string) =>
    call(
      "ops_customer_contact",
      { p_user_id: id.parse(userId), p_reason: reason },
      customerContact,
    ),
  /** The shopper's own cases with the answers; only one order's with `orderNumber`. */
  myCases: (orderNumber?: string | null) =>
    call("my_cases", orderNumber ? { p_order_number: orderNumber } : {}, z.array(myCase)),
  myComplaintReceipt: (complaintId: string) =>
    call("my_complaint_receipt", { p_complaint_id: id.parse(complaintId) }, complaintReceipt),
});
