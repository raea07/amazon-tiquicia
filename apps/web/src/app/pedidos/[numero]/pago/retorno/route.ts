import { ApiError } from "@yuntera/db";
import type { NextRequest } from "next/server";
import { getViewer, signInUrl } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

/**
 * A relative Location, so the browser stays on the host it came from (the
 * server may know itself by another name, and the session cookie is the
 * browser's host's).
 */
const goTo = (path: string) => new Response(null, { status: 303, headers: { location: path } });

/**
 * Where the payment gateway's page sends the shopper back. Only a hint: it
 * asks the worker to check with the gateway now, then shows the order, which
 * says "confirming" until the gateway's signed notification (or that check)
 * says the order is paid. Nothing in this request can make it paid. The order
 * number is in the path because the gateway documents no parameters of its
 * own on the way back.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> },
) {
  const { numero } = await params;
  const base = new URL(request.url);
  if (!/^YT-\d{4,12}$/.test(numero)) return goTo("/pedidos");
  const orderPath = `/pedidos/${numero}`;
  if (!(await getViewer())) return goTo(signInUrl(orderPath));

  const cancelled = base.searchParams.get("cancelado") === "1";
  try {
    const api = await sessionApi();
    const payment = await api.orderPayment(numero);
    if (!cancelled) await api.paymentReturned(payment.order_id);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // Someone else's order, or one that no longer waits: the order page says why.
  }
  return goTo(`${orderPath}?pago=${cancelled ? "cancelado" : "retorno"}`);
}
