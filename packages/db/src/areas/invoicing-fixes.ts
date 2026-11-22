/**
 * What the invoicing screens need to say one true thing (simulated payments,
 * the issuer not set up yet, a factura asked for): the console's state of
 * invoicing and, for one order, what the shopper's page may promise.
 * SQL: supabase/migrations/20261121083510_invoicing_fixes.sql.
 *
 * No new error codes: both functions raise only codes the core already
 * explains (forbidden, not_authenticated, order_not_found).
 */

import { z } from "zod";
import type { Caller, Messages } from "./types";

/** For finance, on the invoices page. */
export const opsInvoicingState = z.object({
  /** sandbox = payments are simulated here; test and live take money through the gateway. */
  payments_mode: z.enum(["sandbox", "test", "live"]),
  /** Whether simulated money gets documents here (local work, a rehearsal); false on a real project. */
  simulated_documented: z.boolean(),
  issuer_ready: z.boolean(),
  /** Invoice jobs with real money (or already documented) that wait to be planned. */
  waiting_real: z.number().int(),
  /** Jobs whose money was never real, that the next planning or sweep ends without a document. */
  waiting_simulated: z.number().int(),
  /** Jobs ended without a document because their money was never real. */
  closed_simulated: z.number().int(),
});
export type OpsInvoicingState = z.infer<typeof opsInvoicingState>;

/** For the shopper, about one of their orders. */
export const orderInvoicing = z.object({
  paid: z.boolean(),
  /** Its money was never real (or, not paid yet, would not be if paid now). */
  simulated: z.boolean(),
  /** Its money gets documents here (real, or simulated where the policy documents it). */
  documented: z.boolean(),
  issuer_ready: z.boolean(),
  /** It has a delivery fee and Yuntera issues the delivery fee's document. */
  delivery_by_platform: z.boolean(),
  /** A factura in the shopper's name was asked for (and still waits to be used, or was issued). */
  factura_requested: z.boolean(),
});
export type OrderInvoicing = z.infer<typeof orderInvoicing>;

export const invoicingFixesErrors = {} as const satisfies Messages;

export const invoicingFixesApi = ({ call }: Caller) => ({
  /** Finance: whether payments are simulated, the issuer set up, and what waits. */
  opsInvoicingState: () => call("ops_invoicing_state", {}, opsInvoicingState),

  /** The shopper: what the order page may say about the documents of one of their orders. */
  myOrderInvoicing: (orderNumber: string) =>
    call("my_order_invoicing", { p_order_number: orderNumber }, orderInvoicing),
});
