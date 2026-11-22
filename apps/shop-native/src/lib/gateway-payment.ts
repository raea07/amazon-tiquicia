/**
 * The decisions of the gateway payment screen that do not need React: what
 * the phone's browser said when it closed, and what to tell the shopper about
 * money that arrived but was not applied (the web says the same in
 * apps/web/src/components/payment-panel.tsx).
 */

import { format, money } from "@yuntera/core";
import type { OrderPayment } from "@yuntera/db";

/** What `WebBrowser.openAuthSessionAsync` resolves with (expo-web-browser). */
export interface BrowserResult {
  type: string;
  url?: string;
}

/**
 * How the shopper left the gateway's page. Only a return through the
 * gateway's own "back to the shop" link (`?pago=retorno`) is a hint that they
 * may have paid; closing the browser, or the gateway's cancel link
 * (`?pago=cancelado`), means they backed out and nothing was charged.
 */
export function browserOutcome(result: BrowserResult): "returned" | "backed_out" {
  if (result.type !== "success" || !result.url) return "backed_out";
  const query = result.url.split("?")[1] ?? "";
  return new URLSearchParams(query).get("pago") === "retorno" ? "returned" : "backed_out";
}

export const BACKED_OUT =
  "Volvió sin pagar. No se hizo ningún cobro; puede pagar cuando quiera mientras guardamos sus productos.";

/** Money the gateway took that finance is deciding about, or sending back. */
export function moneyInReviewText(payment: OrderPayment): { title: string; text: string } {
  const review = payment.money_in_review;
  const amount = format(money(review?.amount_minor ?? payment.amount_minor));
  if (review?.status === "refunding") {
    return {
      title: `Le estamos devolviendo ${amount}`,
      text: "Va de vuelta al mismo medio con el que pagó, o por transferencia si no se puede. Le avisamos cuando se complete; no tiene que hacer nada.",
    };
  }
  if (review?.status === "refunded") {
    return {
      title: `Le devolvimos ${amount}`,
      text: "El reembolso se completó. Su banco puede tardar unos días en mostrarlo.",
    };
  }
  const why =
    review?.kind === "late"
      ? `Recibimos su pago de ${amount} cuando el pedido ya se había cancelado, así que no lo aplicamos.`
      : review?.kind === "paid_twice"
        ? `Recibimos un segundo pago de ${amount} por este pedido, que ya estaba pagado.`
        : review?.kind === "wrong_environment"
          ? `Recibimos su pago de ${amount}, pero llegó justo cuando cambiamos nuestro sistema de pagos, así que no se aplicó solo.`
          : `Recibimos un pago de ${amount} que no coincide con este pedido (por ejemplo, otro monto), así que no lo aplicamos.`;
  return {
    title: "Recibimos un pago que estamos revisando",
    text: `${why} Nuestro equipo de finanzas lo revisa y le escribirá: lo aplicará al pedido o se lo devolverá. No vuelva a pagar.`,
  };
}

/** "Le queda 1 intento." / "Le quedan 3 intentos." */
export const attemptsLeftText = (left: number) =>
  left === 1 ? "Le queda 1 intento." : `Le quedan ${left} intentos.`;
