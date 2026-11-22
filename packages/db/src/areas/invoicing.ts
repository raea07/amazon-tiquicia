/**
 * Electronic invoices (Hacienda v4.4): the platform's documents to shoppers
 * (the delivery fee) and to sellers (its fees), their credit notes, and what
 * finance sees of them. The shopper asks for a factura in their name at
 * checkout; everyone downloads only their own documents.
 * SQL: supabase/migrations/20261121083500_invoicing.sql.
 *
 * The worker's own functions (`worker_invoice_*`) are deliberately not here:
 * they are callable only with the server-side secret key, and the worker in
 * packages/invoicing calls them itself.
 */

import { z } from "zod";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const timestamp = z.string().min(10);
const amount = z.string().regex(/^\d{1,13}\.\d{5}$/);

export const invoiceKind = z.enum(["delivery", "fees", "credit"]);
export const invoiceDocumentType = z.enum(["01", "03", "04"]);
export const invoiceStatus = z.enum(["pending", "sent", "accepted", "rejected", "voided"]);
export const haciendaState = z.enum(["recibido", "procesando", "aceptado", "rechazado", "error"]);
export type InvoiceStatus = z.infer<typeof invoiceStatus>;

/** One document in a list. */
export const invoiceRow = z.object({
  id,
  kind: invoiceKind,
  document_type: invoiceDocumentType,
  clave: z.string().regex(/^[A-Za-z0-9]{50}$/),
  consecutivo: z.string().regex(/^\d{20}$/),
  issued_at: timestamp,
  status: invoiceStatus,
  hacienda_state: haciendaState.nullable(),
  total_minor: z.number().int(),
  order_number: z.string().nullable(),
  /** Null on a tiquete to an anonymous final consumer. */
  receiver_name: z.string().nullable(),
  seller_name: z.string().nullable(),
  /** The clave and code of the first reference (credit notes and replacements). */
  references_clave: z.string().nullable(),
  reference_code: z.string().nullable(),
  replaces_id: id.nullable(),
  replaced_by_id: id.nullable(),
  has_xml: z.boolean(),
  has_response: z.boolean(),
  accepted_at: timestamp.nullable(),
  rejected_at: timestamp.nullable(),
});
export type InvoiceRow = z.infer<typeof invoiceRow>;

const line = z.object({
  number: z.number().int().positive(),
  cabys: z.string(),
  quantity: z.string(),
  unit: z.string(),
  description: z.string(),
  unit_price: amount,
  total: amount,
  subtotal: amount,
  base: amount,
  tax: z.object({ code: z.string(), tarifa_code: z.string(), rate: z.string(), amount }),
  net_tax: amount,
  line_total: amount,
});

const party = {
  name: z.string(),
  id_type: z.string(),
  id_number: z.string(),
};

/** A whole document, for its readable page. */
export const invoiceDetail = invoiceRow.extend({
  situation: z.string(),
  issuer: z.object({
    ...party,
    commercial_name: z.string().nullable(),
    activity_code: z.string(),
    location: z.object({
      province: z.number().int(),
      canton: z.number().int(),
      district: z.number().int(),
      other_signs: z.string(),
    }),
    emails: z.array(z.string()),
  }),
  provider_id: z.string(),
  receiver: z
    .object({ ...party, email: z.string().nullable(), activity_code: z.string().nullable() })
    .nullable(),
  sale_condition: z.string(),
  payments: z.array(z.object({ code: z.string(), other: z.string().nullable(), amount })),
  lines: z.array(line),
  summary: z.object({
    total_sale: amount,
    total_net: amount,
    total_tax: amount.nullable(),
    total: amount,
    breakdown: z.array(z.object({ code: z.string(), tarifa_code: z.string(), amount })),
  }),
  references: z.array(
    z.object({
      type: z.string(),
      number: z.string(),
      issued_at: timestamp,
      code: z.string(),
      reason: z.string(),
    }),
  ),
  hacienda_message: z.string().nullable(),
  rejection_source: z.enum(["reception", "validation"]).nullable(),
  submitted_at: timestamp.nullable(),
  made_available_at: timestamp.nullable(),
  replaces: z.object({ id, consecutivo: z.string(), clave: z.string() }).nullable(),
  replaced_by: z.object({ id, consecutivo: z.string(), clave: z.string() }).nullable(),
});
export type InvoiceDetail = z.infer<typeof invoiceDetail>;

export const invoiceFile = z.object({
  file_name: z.string().regex(/^[A-Za-z0-9]{50}(_respuesta)?\.xml$/),
  content: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type InvoiceFile = z.infer<typeof invoiceFile>;

/** The finance screen. */
export const opsInvoices = z.object({
  counts: z.object({
    pending: z.number().int(),
    sent: z.number().int(),
    accepted: z.number().int(),
    rejected: z.number().int(),
    voided: z.number().int(),
  }),
  answer_window_hours: z.number().int(),
  waiting: z.array(invoiceRow.extend({ submitted_at: timestamp.nullable() })),
  rejected: z.array(
    invoiceRow.extend({
      hacienda_message: z.string().nullable(),
      rejection_source: z.enum(["reception", "validation"]).nullable(),
    }),
  ),
  unsent: z.array(
    invoiceRow.extend({
      attempts: z.number().int(),
      last_error_code: z.string().nullable(),
      held_reason: z.string().nullable(),
      next_attempt_at: timestamp.nullable(),
    }),
  ),
  failed_events: z.number().int(),
  waiting_events: z.number().int(),
  issuer_ready: z.boolean(),
  worker: z
    .object({
      reported_at: timestamp,
      environment: z.string().nullable(),
      certificate_not_after: timestamp.nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
  paused_until: timestamp.nullable(),
  recent: z.array(invoiceRow),
  daily: z.array(
    z.object({
      day: z.string(),
      paid_orders: z.number().int(),
      documents: z.number().int(),
      tiquetes: z.number().int(),
      facturas: z.number().int(),
      credit_notes: z.number().int(),
      accepted: z.number().int(),
      rejected: z.number().int(),
    }),
  ),
});
export type OpsInvoices = z.infer<typeof opsInvoices>;

export type IdentificationKind = "fisica" | "juridica" | "dimex" | "nite";

export interface InvoiceReceiverInput {
  idType: IdentificationKind;
  /** As typed: dashes and spaces are removed by the database. */
  idNumber: string;
  name: string;
  email?: string | null;
}

export const invoicingErrors = {
  invoice_not_found: {
    "es-CR": "No encontramos ese comprobante. Puede que no sea de su cuenta.",
    en: "We could not find that document. It may not belong to your account.",
  },
  invoice_file_not_ready: {
    "es-CR":
      "Ese archivo todavía no está listo. El comprobante se firma unos segundos después del pago y la respuesta de Hacienda llega después; vuelva a intentarlo en un momento.",
    en: "That file is not ready yet. The document is signed a few seconds after payment and Hacienda's answer comes later; try again in a moment.",
  },
  invoice_receiver_invalid: {
    "es-CR":
      "No pudimos guardar los datos para su factura. Recargue la página e inténtelo de nuevo.",
    en: "We could not save the details for your invoice. Reload the page and try again.",
  },
  invoice_receiver_locked: {
    "es-CR":
      "Este pedido ya está pagado y su comprobante ya se emitió, así que los datos de la factura ya no se pueden cambiar.",
    en: "This order is already paid and its document was issued, so the invoice details can no longer change.",
  },
  invoice_receiver_id_invalid: {
    "es-CR":
      "Revise el número de identificación: la cédula física tiene 9 dígitos, la jurídica 10 (empieza por 2, 3, 4 o 5), el DIMEX 11 o 12 y el NITE 10.",
    en: "Check the identification number: a cédula física has 9 digits, a cédula jurídica 10 (starting with 2, 3, 4 or 5), a DIMEX 11 or 12 and a NITE 10.",
  },
  invoice_receiver_name_invalid: {
    "es-CR":
      "Escriba el nombre o la razón social tal como está inscrito en Hacienda (de 3 a 100 caracteres).",
    en: "Enter the name or legal name as registered with Hacienda (3 to 100 characters).",
  },
  invoice_receiver_email_invalid: {
    "es-CR": "Revise el correo para la factura; debe ser como nombre@dominio.com.",
    en: "Check the invoice e-mail address; it should look like name@domain.com.",
  },
  invoice_not_rejected: {
    "es-CR":
      "Ese comprobante no fue rechazado, así que no se reemplaza. Si hay que anularlo o corregirlo, se hace con una nota de crédito.",
    en: "That document was not rejected, so it is not replaced. Cancelling or correcting it takes a credit note.",
  },
  invoice_already_replaced: {
    "es-CR": "Ese comprobante ya tiene un reemplazo. Recargue la página para verlo.",
    en: "That document already has a replacement. Reload the page to see it.",
  },
  invoice_not_replaceable_as_ticket: {
    "es-CR": "Solo una factura al comprador por la entrega se puede reemplazar por un tiquete.",
    en: "Only a factura to the shopper for delivery can be replaced with a tiquete.",
  },
  invoice_not_retryable: {
    "es-CR":
      "Ese comprobante no está detenido: no hace falta reenviarlo. Si Hacienda lo rechazó, emita un reemplazo.",
    en: "That document is not stuck: there is no need to send it again. If Hacienda rejected it, issue a replacement.",
  },
  // Raised inside the database for the worker or the planner; people never see them.
  invoice_issuer_not_ready: {
    "es-CR": "La facturación electrónica todavía no está configurada.",
    en: "Electronic invoicing is not set up yet.",
  },
  invoice_waiting: {
    "es-CR": "Este comprobante espera el reemplazo de otro que Hacienda rechazó.",
    en: "This document waits for the replacement of one that Hacienda rejected.",
  },
  invoice_receiver_incomplete: {
    "es-CR": "Los datos fiscales de la tienda no alcanzan para emitirle una factura.",
    en: "The shop's fiscal details are not enough to issue it an invoice.",
  },
  invoice_clave_invalid: {
    "es-CR": "No se pudo formar la clave del comprobante.",
    en: "The document's clave could not be built.",
  },
  invoice_file_invalid: {
    "es-CR": "El archivo del comprobante no corresponde al documento.",
    en: "The document's file does not match the document.",
  },
  invoice_outcome_invalid: {
    "es-CR": "El resultado informado para el comprobante no es válido.",
    en: "The outcome reported for the document is not valid.",
  },
} as const satisfies Messages;

export const invoicingApi = ({ call }: Caller) => ({
  /** The documents of the shopper's order made out to them. */
  myOrderInvoices: (orderNumber: string) =>
    call("my_order_invoices", { p_order_number: orderNumber }, z.array(invoiceRow)),

  /** A document the caller may read, whole. */
  invoiceDetail: (invoiceId: string) => call("invoice_detail", { p_id: invoiceId }, invoiceDetail),

  /** The signed XML ("xml") or Hacienda's answer ("response") of a document the caller may read. */
  invoiceFile: (invoiceId: string, kind: "xml" | "response") =>
    call("invoice_file", { p_id: invoiceId, p_kind: kind }, invoiceFile),

  /** The platform's documents to a shop for its fees. */
  sellerFeeInvoices: (sellerId: string, limit = 50) =>
    call("seller_fee_invoices", { p_seller_id: sellerId, p_limit: limit }, z.array(invoiceRow)),

  /**
   * At checkout, before placing the order: the shopper wants the delivery
   * fee's document as a factura in this name (null withdraws it).
   */
  setCheckoutInvoiceReceiver: (idempotencyKey: string, receiver: InvoiceReceiverInput | null) =>
    call(
      "set_checkout_invoice_receiver",
      {
        p_idempotency_key: idempotencyKey,
        p_id_type: receiver?.idType ?? null,
        p_id_number: receiver?.idNumber ?? null,
        p_name: receiver?.name ?? null,
        p_email: receiver?.email ?? null,
      },
      z.object({ requested: z.boolean() }),
    ),

  opsInvoices: (status: InvoiceStatus | null = null, limit = 50) =>
    call("ops_invoices", { p_status: status, p_limit: limit }, opsInvoices),

  /** A new document, with a new number, for one Hacienda rejected. */
  opsReplaceInvoice: (invoiceId: string, asTicket = false) =>
    call("ops_invoice_replace", { p_id: invoiceId, p_as_ticket: asTicket }, invoiceRow),

  /** Sends a document held back or backing off again now, with the same signed bytes. */
  opsRetryInvoice: (invoiceId: string) =>
    call("ops_invoice_retry", { p_id: invoiceId }, invoiceRow),
});
