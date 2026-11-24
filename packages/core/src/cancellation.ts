/**
 * Why an order was cancelled, in the shopper's words.
 *
 * The database stores the reason on the order (orders.cancel_reason) as a
 * fixed sentence for the cancellations it makes itself, and as staff's own
 * words when staff cancel. The shopper's order page (web shop and shopper app)
 * says why, and what to do next, from the fixed sentences; staff's words are
 * an internal note and are never shown to the shopper. The fixed sentences
 * exist in SQL too (cancellation.test.ts keeps them equal).
 */

/** The reasons the database writes itself, exactly as stored. */
export const CANCEL_REASON = {
  /** The unpaid-order sweep (private.expire_unpaid_orders). */
  unpaid: "Pago no recibido a tiempo",
  /** Every parcel came back without being delivered (wms_receive_returned_shipment). */
  returned: "Los paquetes regresaron sin entregarse",
  /** The shopper cancelled it (cancel_order, from the web shop or the shopper app). */
  shopper: "Cancelado por el cliente",
} as const;

export type CancelReasonKind = keyof typeof CANCEL_REASON | "other";

export function cancelReasonKind(reason: string | null | undefined): CancelReasonKind {
  const stored = (reason ?? "").trim();
  for (const [kind, sentence] of Object.entries(CANCEL_REASON)) {
    if (stored === sentence) return kind as CancelReasonKind;
  }
  return "other";
}

export interface CancellationWords {
  /** The notice's title: what happened. */
  title: string;
  /** What it means for the shopper's money, and what to do next. */
  body: string;
  /** The line of the order's history ("Historial") for the cancellation. */
  history: string;
}

/**
 * The words for a cancelled order. `paid` says whether any money was taken
 * for it (a captured payment, or refunds made): then the money goes back the
 * way it came; otherwise nothing was charged. `feeKept` is the sentence that
 * says why the delivery fee stays charged (deliveryFeeKeptLine), when it
 * does: then only the products' money goes back, the notice says so and
 * carries that sentence, and the page shows it nowhere else.
 */
export function cancellationWords(
  reason: string | null | undefined,
  paid: boolean,
  feeKept: string | null = null,
): CancellationWords {
  const money = !paid
    ? "No se le cobró nada."
    : feeKept
      ? `Le devolvemos lo que pagó por los productos por el mismo medio con que pagó. ${feeKept}`
      : "Le devolvemos lo que pagó por el mismo medio con que pagó.";
  switch (cancelReasonKind(reason)) {
    case "unpaid":
      return {
        title: "Cancelamos su pedido porque no recibimos el pago a tiempo",
        body: `Guardamos sus productos solo por un tiempo y el pago no llegó. ${
          paid
            ? `Si su pago llegó después, se lo devolvemos por el mismo medio.${feeKept ? ` ${feeKept}` : ""}`
            : money
        } Si todavía los quiere, haga el pedido de nuevo.`,
        history: "Cancelado: no recibimos el pago a tiempo",
      };
    case "returned":
      return {
        title: "Cancelamos su pedido porque los paquetes regresaron sin entregarse",
        body: `Los paquetes volvieron a nuestra bodega sin llegar a usted. ${money} Si todavía quiere los productos, haga el pedido de nuevo.`,
        history: "Cancelado: los paquetes regresaron sin entregarse",
      };
    case "shopper":
      return {
        title: "Usted canceló este pedido",
        body: `${money} Si cambia de opinión, haga el pedido de nuevo.`,
        history: "Cancelado por usted",
      };
    default:
      return {
        title: "Cancelamos este pedido",
        body: `${money} Si quiere saber por qué, escríbanos desde Ayuda y se lo explicamos. Si todavía quiere los productos, haga el pedido de nuevo.`,
        history: "Cancelado",
      };
  }
}
