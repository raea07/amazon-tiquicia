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

/** Where a shopper's case stands, in words (never colour alone). */
export const MY_CASE_STATUS: Record<string, string> = {
  open: "En curso",
  closed: "Resuelto",
};
