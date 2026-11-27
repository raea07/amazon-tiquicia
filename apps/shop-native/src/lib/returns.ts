import { format, money, returnRequestedText } from "@yuntera/core";
import type { MyOrderReturn } from "@yuntera/db";

/**
 * Where each of the shopper's returns stands, in the web shop's words
 * (`apps/web/src/components/return-status.tsx`). A return is refunded only
 * after the goods are back at the warehouse, so an approved one says it will
 * be collected first.
 */
export const RETURN_KIND: Record<MyOrderReturn["kind"], string> = {
  withdrawal: "Devolución",
  warranty: "Garantía",
  damaged: "Devolución por producto dañado",
  wrong_item: "Devolución por producto equivocado",
};

/** What happens next, in the shopper's words, for each step of a return. */
export function returnNextStep(item: MyOrderReturn): string {
  switch (item.status) {
    case "requested":
      return returnRequestedText(item.kind);
    case "approved":
      return "Aprobada. Le contactaremos para recoger el producto, sin costo para usted. Téngalo listo y completo; cuando llegue a nuestra bodega le reembolsamos por el mismo medio de pago.";
    case "received":
      return "Ya recibimos el producto. Estamos registrando su reembolso por el mismo medio de pago.";
    case "refunded":
      return item.refund_minor
        ? `Reembolsada: le devolvimos ${format(money(item.refund_minor))} por el mismo medio de pago.`
        : "Reembolsada por el mismo medio de pago.";
    case "rejected":
      if (item.withdrawn_at) return "Retirada: usted retiró esta solicitud.";
      return item.resolution_note ? `Cerrada: ${item.resolution_note}` : "Cerrada.";
  }
}

export const returnTitle = (item: MyOrderReturn) =>
  `${RETURN_KIND[item.kind]} de ${item.quantity} ${item.quantity === 1 ? "unidad" : "unidades"}`;

/** What the shopper is told once a request opened by mistake is withdrawn. */
export const RETURN_WITHDRAWN =
  "Retiramos su solicitud. Si lo necesita, puede pedir la devolución de nuevo.";

/** What the shopper is told when a withdrawal is accepted: refunded once the goods are back. */
export const WITHDRAWAL_APPROVED =
  "Devolución aprobada. Le contactaremos para recoger el producto, sin costo para usted; cuando llegue a nuestra bodega le reembolsamos por el mismo medio de pago.";
