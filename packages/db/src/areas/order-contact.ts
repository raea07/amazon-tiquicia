/**
 * The delivery phone only on request (owner decision D55, 27 November 2026).
 *
 * SQL: supabase/migrations/20261121085000_wave8_followups.sql, point 6.
 * get_order gives staff the recipient's phone as '' ; staff who need it ask
 * with ops_order_contact and a reason, and the look is written on the audit
 * trail (Auditoría: "Vio el teléfono de entrega de un pedido").
 *
 * Its error codes (forbidden, reason_required, order_not_found) are those of
 * earlier areas and the core, with their messages there; it adds none.
 */

import { z } from "zod";
import type { Caller, Messages } from "./types";

/** What one look answers: the order and its recipient's phone (null when none is left). */
export const orderContact = z.object({
  order_number: z.string(),
  phone: z.string().nullable(),
});
export type OrderContact = z.infer<typeof orderContact>;

/** The reason a look needs, as the database checks it (10 to 300 characters, trimmed). */
export const ORDER_CONTACT_REASON = { min: 10, max: 300 } as const;

export const orderContactErrors = {} as const satisfies Messages;

export const orderContactApi = ({ call }: Caller) => ({
  /** "Mostrar contacto" on the console's order page. Support, operations and admin. */
  opsOrderContact: (orderNumber: string, reason: string) =>
    call("ops_order_contact", { p_order_number: orderNumber, p_reason: reason }, orderContact),
});
