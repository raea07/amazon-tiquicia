/**
 * Integrity: the refusals and staff steps added when money, returns, stock and
 * the delivery code were hardened after the security review of 21 November 2026.
 *
 *   Returns       staff record that the goods came back before the refund.
 *   Parcels back  the warehouse (or the seller) checks in a parcel that came
 *                 back undelivered; its units are restocked and refunded.
 *   Delivery code staff see whether an order's code is locked after too many
 *                 wrong attempts, and release it with a new code. Never the code.
 *
 * SQL: supabase/migrations/20261121082900_integrity.sql. The rules are written
 * down in docs/04-algorithms/returns-and-refunds.md.
 */

import { z } from "zod";
import { orderStatus } from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const timestamp = z.string().min(10);

/** How an order's delivery code stands. The code itself is never in it. */
export const deliveryCodeState = z.object({
  order_id: id,
  wrong_attempts: z.number().int().nonnegative(),
  attempts_left: z.number().int().nonnegative(),
  max_attempts: z.number().int().positive(),
  locked: z.boolean(),
  locked_at: timestamp.nullable(),
  released_at: timestamp.nullable(),
});
export type DeliveryCodeState = z.infer<typeof deliveryCodeState>;

/** What checking in a returned parcel did. */
export const returnedShipmentResult = z.object({
  shipment_id: id,
  /** What went back to the shopper for the parcel's units (0 if nothing was paid). */
  refund_minor: z.number().int().nonnegative(),
  order_status: orderStatus,
});
export type ReturnedShipmentResult = z.infer<typeof returnedShipmentResult>;

export const integrityErrors = {
  // ── Returns and refunds ──
  order_not_returnable: {
    "es-CR":
      "Este pedido no tiene nada que devolver: no se ha pagado, o ya se canceló o se reembolsó.",
    en: "There is nothing to return on this order: it has not been paid, or it was already cancelled or refunded.",
  },
  withdraw_before_delivery: {
    "es-CR":
      "Todavía no ha recibido este producto. Si ya no lo quiere, cancele el pedido mientras se pueda; si no, podrá devolverlo sin dar motivo cuando lo reciba.",
    en: "You have not received this product yet. If you no longer want it, cancel the order while you still can; otherwise you can return it without giving a reason once it arrives.",
  },
  return_not_received: {
    "es-CR":
      "El producto todavía no ha vuelto a bodega. Registre primero que llegó y después el reembolso.",
    en: "The product has not come back to the warehouse yet. Record that it arrived first, then the refund.",
  },
  order_not_refundable: {
    "es-CR": "Este pedido no tiene un pago cobrado que se pueda reembolsar, o ya se reembolsó entero.",
    en: "This order has no collected payment left to refund, or it was already refunded in full.",
  },
  refund_exceeds_purchase: {
    "es-CR": "Esas unidades ya se reembolsaron. No se puede devolver el dinero dos veces.",
    en: "Those units were already refunded. Money cannot be given back twice.",
  },
  refund_exceeds_payment: {
    "es-CR": "Ese reembolso supera lo que se cobró por el pedido, así que no se registró.",
    en: "That refund is more than was collected for the order, so it was not recorded.",
  },
  refund_not_registered: {
    "es-CR":
      "Un reembolso solo se registra por las funciones de devoluciones y cancelaciones. No se guardó nada.",
    en: "A refund can only be recorded through returns and cancellations. Nothing was saved.",
  },

  // ── Checkout limits ──
  too_many_unpaid_orders: {
    "es-CR":
      "Ya tiene varios pedidos esperando el pago. Pague o cancele alguno de ellos antes de hacer uno nuevo.",
    en: "You already have several orders waiting for payment. Pay or cancel one of them before placing a new one.",
  },
  too_many_held_units: {
    "es-CR":
      "Ya tiene muchas unidades apartadas en pedidos sin pagar. Pague o cancele alguno de esos pedidos, o pida menos unidades.",
    en: "You already hold many units in unpaid orders. Pay or cancel one of those orders, or order fewer units.",
  },
  cod_limit_reached: {
    "es-CR":
      "Ya tiene pedidos con pago contra entrega en camino. Cuando reciba uno podrá hacer otro así, o pague este con tarjeta o SINPE Móvil.",
    en: "You already have cash-on-delivery orders on their way. Once one arrives you can place another; or pay for this one by card or SINPE Móvil.",
  },

  // ── Delivery ──
  cash_already_on_route: {
    "es-CR": "El cobro en efectivo de este pedido ya está en otra parada. Esta parada no cobra.",
    en: "This order's cash collection is already on another stop. This stop does not collect.",
  },
  delivery_code_not_locked: {
    "es-CR": "El código de entrega de este pedido no está bloqueado.",
    en: "This order's delivery code is not locked.",
  },
  shipment_not_returning: {
    "es-CR": "Ese paquete no está en camino de vuelta, así que no se puede recibir como devuelto.",
    en: "That parcel is not on its way back, so it cannot be checked in as returned.",
  },

  // ── Warehouse ──
  over_receipt: {
    "es-CR":
      "Esa cantidad supera lo que el vendedor anunció en este ingreso. Cuente de nuevo; si llegaron unidades de más, el vendedor debe anunciar otro ingreso.",
    en: "That quantity is more than the seller announced on this inbound. Count again; if extra units arrived, the seller must announce another inbound.",
  },
  inbound_line_complete: {
    "es-CR": "Esta línea ya se recibió completa. Si la escaneó dos veces, no hace falta hacer nada.",
    en: "This line was already received in full. If you scanned it twice, there is nothing to do.",
  },

  // ── Money for sellers ──
  payout_exceeds_balance: {
    "es-CR":
      "Desde que se programó este pago hubo reembolsos y el vendedor ya no tiene ese saldo. Márquelo como fallido; la próxima corrida pagará lo que corresponda.",
    en: "There have been refunds since this payout was scheduled and the seller no longer has that balance. Mark it failed; the next run will pay what is owed.",
  },
  price_below_fees: {
    "es-CR":
      "Con ese precio las comisiones y el costo de cobro serían mayores que la venta. Suba el precio.",
    en: "At that price the fees and the cost of collecting payment would be more than the sale. Raise the price.",
  },
} as const satisfies Messages;

export const integrityApi = ({ call, run }: Caller) => ({
  /**
   * Staff record that an approved return is back with Yuntera. `resellable`
   * puts warehouse units back on sale; damaged ones stay out of stock.
   */
  opsReceiveReturn: (returnId: string, resellable = true, note: string | null = null) =>
    run("ops_receive_return", { p_return_id: returnId, p_resellable: resellable, p_note: note }),
  /** Whether an order's delivery code is locked, and how many attempts are left. */
  opsDeliveryCode: (orderId: string) =>
    call("ops_delivery_code", { p_order_id: orderId }, deliveryCodeState),
  /** Releases a locked code; the order gets a new one the shopper reads on their order. */
  opsReleaseDeliveryCode: (orderId: string, note: string) =>
    run("ops_release_delivery_code", { p_order_id: orderId, p_note: note }),
  /** Checks in a parcel that came back undelivered: restock (or record damage) and refund. */
  wmsReceiveReturnedShipment: (shipmentId: string, resellable = true, note: string | null = null) =>
    call(
      "wms_receive_returned_shipment",
      { p_shipment_id: shipmentId, p_resellable: resellable, p_note: note },
      returnedShipmentResult,
    ),
});
