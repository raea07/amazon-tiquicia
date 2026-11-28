import { brand } from "@yuntera/brand";
import {
  awaitingNewAttemptLine,
  cancellationWords,
  deliveryFeeComesBack,
  deliveryFeeKeptLine,
  isRescheduledShipment,
  isStoppedShipment,
  ORDER_STATUS_LABEL,
  orderAwaitingNewAttempt,
  orderComingBack,
  statusWord,
  statusWordMap,
  stoppedParcelHistory,
  stoppedParcelLabel,
  toCostaRicaTime,
  waitsForNewAttempt,
} from "@yuntera/core";
import {
  ApiError,
  type MyCase,
  type MyOrderReturn,
  type MyOrderReview,
  type OrderDetailWithRecall as OrderDetail,
  type OrderPayment,
  type ReviewHideReason,
} from "@yuntera/db";
import { ProductImage } from "@yuntera/next-kit/product-image";
import {
  Alert,
  Badge,
  formatDate,
  formatDateTime,
  formatPrice,
  OrderStatusBadge,
  ShipmentStatusBadge,
  Skeleton,
  touchLinkClass,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CaseAnswers } from "@/components/case-answers";
import {
  CancelOrderForm,
  ReturnForm,
  ReviewForm,
  SimulatePaymentForm,
} from "@/components/order-actions";
import { OrderInvoices } from "@/components/order-invoices";
import { MoneyInReview, PaymentPanel, RefundList } from "@/components/payment-panel";
import { ReturnStatusList } from "@/components/return-status";
import { requireViewer } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

export const metadata: Metadata = { title: "Su pedido", robots: { index: false } };

export default function OrderPage(props: PageProps<"/pedidos/[numero]">) {
  return (
    <div className="shell py-8">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Order {...props} />
      </Suspense>
    </div>
  );
}

/** Why staff hid a shopper's review, as the shopper reads it. */
const HIDDEN_REVIEW_REASON: Record<ReviewHideReason, string> = {
  offensive: "El motivo: tenía insultos o lenguaje ofensivo.",
  personal_data: "El motivo: incluía datos personales, suyos o de otra persona.",
  off_topic: "El motivo: no hablaba del producto ni de su compra.",
  spam: "El motivo: tenía publicidad o enlaces.",
  not_genuine: "El motivo: no describía una experiencia real con el producto.",
  illegal: "El motivo: incluía contenido que la ley no permite publicar.",
  rules: "El motivo: no cumplía las reglas para publicar reseñas.",
};

const PAYMENT_LABEL = {
  card: "Tarjeta",
  sinpe_movil: "SINPE Móvil",
  cash_on_delivery: "Efectivo contra entrega",
  bank_transfer: "Transferencia",
} as const;

async function Order({ params, searchParams }: PageProps<"/pedidos/[numero]">) {
  const [{ numero }, query] = await Promise.all([params, searchParams]);
  await requireViewer(`/pedidos/${numero}`);

  const api = await sessionApi();
  let order: OrderDetail;
  try {
    order = await api.getOrder(numero);
  } catch (error) {
    // Someone else's order and a non-existent one look the same: not found.
    if (error instanceof ApiError && error.code === "order_not_found") notFound();
    throw error;
  }
  // Where each return stands, so the page can say what happens next.
  const returns: MyOrderReturn[] = await api.myOrderReturns(numero);
  // How its payment stands at the gateway, and its refunds on their way.
  const payment: OrderPayment = await api.orderPayment(numero);
  // Which of the shopper's reviews on this order staff hid, and why.
  const reviewStates: MyOrderReview[] = await api.myOrderReviews(numero);
  // The shopper's complaints, returns and contacts about this order, with the answers.
  const cases: MyCase[] = await api.myCases(numero);
  const throughGateway = [
    "start",
    "preparing",
    "pay",
    "transfer",
    "confirming",
    "failed",
    "error",
    "review",
  ].includes(payment.stage);

  await connection();
  const today = toCostaRicaTime(new Date()).date;
  const delivered = order.status === "delivered" || order.status === "completed";
  const withdrawalOpen = delivered && today <= order.withdrawal_deadline;
  const warrantyOpen = delivered && order.warranty_until !== null && today <= order.warranty_until;
  const awaitingPayment = order.status === "pending_payment";
  // Every parcel still to deliver is on its way back to the warehouse
  // (stopped by staff, or sent back after a route): nothing reaches the
  // shopper, so no "En camino", no date and no delivery code.
  const back = orderComingBack(order.status, order.shipments);
  // Or every parcel left waits in the warehouse to go out again: no "En
  // camino" and no old date either.
  const waiting = back ? null : orderAwaitingNewAttempt(order.status, order.shipments);
  // Money held for the shopper, so a cancellation gives some back.
  const paid = ["captured", "partially_refunded"].includes(order.payment?.status ?? "");
  const refundedSoFar = payment.refunds.reduce((sum, refund) => sum + refund.amount_minor, 0);
  const feeBack = deliveryFeeComesBack(order.shipments);
  // What comes back when the warehouse receives them: what is left of the
  // payment, less the delivery fee when someone went to the door.
  const comesBack = Math.max(
    0,
    (order.payment?.amount_minor ?? 0) - refundedSoFar - (feeBack ? 0 : order.shipping_minor),
  );
  // Why the delivery fee stays charged, when the order is (being) cancelled
  // after a real attempt at the door.
  const feeKept =
    back?.cancels || (order.status === "cancelled" && refundedSoFar > 0)
      ? deliveryFeeKeptLine({
          shipments: order.shipments,
          shippingMinor: order.shipping_minor,
          paid: paid || refundedSoFar > 0,
          fee: formatPrice(order.shipping_minor),
        })
      : null;

  // Why it was cancelled, and what to do next (the reason stored on the order).
  const why =
    order.cancelled_at !== null && ["cancelled", "refunded"].includes(order.status) && !back
      ? cancellationWords(
          order.cancel_reason,
          paid || refundedSoFar > 0 || order.payment?.status === "refunded",
          feeKept,
        )
      : null;

  return (
    <>
      {query.pago === "retorno" && payment.stage === "paid" ? (
        <Alert tone="success" className="mb-6" title="¡Pago recibido!">
          Ya estamos preparando su pedido. Le avisamos por correo en cada paso.
        </Alert>
      ) : null}
      {query.pago === "cancelado" && payment.stage !== "paid" ? (
        <Alert tone="info" className="mb-6" title="No se hizo ningún cobro">
          Volvió sin pagar. Puede pagar cuando quiera mientras guardamos sus productos.
        </Alert>
      ) : null}
      {query.nuevo === "1" ? (
        <Alert tone="success" className="mb-6" title="¡Recibimos su pedido!">
          {awaitingPayment
            ? "Complete el pago para que empecemos a prepararlo."
            : "Ya lo estamos preparando. Aquí puede seguirlo en todo momento."}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">Pedido {order.order_number}</h1>
        {/* Not "En camino" when no parcel is on its way to the shopper any more. */}
        {back ? (
          <Badge tone="warning">
            {back.cancels ? "Se está cancelando" : "Un paquete regresa a la bodega"}
          </Badge>
        ) : waiting ? (
          <Badge tone="info">Entrega reprogramada</Badge>
        ) : (
          <OrderStatusBadge status={order.status} />
        )}
      </div>
      <p className="mt-1 text-ink-muted">
        Realizado el{" "}
        {formatDate(order.placed_at, { day: "numeric", month: "long", year: "numeric" })}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {why ? (
            <div data-testid="order-cancel-reason">
              <Alert tone="info" title={why.title}>
                {why.body}
              </Alert>
            </div>
          ) : null}
          {awaitingPayment && throughGateway ? <PaymentPanel payment={payment} /> : null}
          {awaitingPayment && !throughGateway ? (
            <PaymentInstructions order={order} payment={payment} />
          ) : null}
          {/* Money that arrived and waits for finance, or goes back: said whatever the order's status. */}
          {payment.money_in_review && !(awaitingPayment && payment.stage === "review") ? (
            <MoneyInReview payment={payment} />
          ) : null}
          {back ? (
            <Alert
              tone="warning"
              title={
                back.cancels
                  ? "Estamos cancelando su pedido"
                  : "Un paquete regresa a nuestra bodega"
              }
            >
              {back.stopped
                ? "Detuvimos su pedido en nuestra bodega: ya no saldrá hacia usted. "
                : back.cancels
                  ? "Su pedido regresa a nuestra bodega sin entregarse. "
                  : "Un paquete de su pedido regresa a nuestra bodega sin entregarse. "}
              {!paid
                ? back.cancels
                  ? "No se le cobró nada, así que no hay nada que devolver."
                  : ""
                : back.cancels
                  ? `Cuando la bodega confirme que lo recibió, le devolvemos ${formatPrice(comesBack)}${
                      feeBack && order.shipping_minor > 0 ? ", el envío incluido," : ""
                    } por el mismo medio con que pagó.${feeKept ? ` ${feeKept}` : ""}`
                  : "Cuando la bodega lo reciba, le devolvemos lo que pagó por ese paquete."}
            </Alert>
          ) : null}
          <RefundList payment={payment} />
          {/* The cancellation notice carries it when it is shown. */}
          {feeKept && !back && !why ? (
            <p className="-mt-3 text-sm" data-testid="fee-kept">
              {feeKept}
            </p>
          ) : null}
          {payment.refunds.length > 1 ? (
            <p className="-mt-3 text-sm" data-testid="refund-total">
              En total le devolvemos <strong>{formatPrice(refundedSoFar)}</strong>
              {refundedSoFar === order.total_minor && order.shipping_minor > 0
                ? ": todo lo que pagó, el envío incluido."
                : "."}
            </p>
          ) : null}

          {order.delivery_pin && !back ? (
            <section
              className="rounded-lg border-2 border-brand bg-brand-soft p-5"
              data-testid="delivery-code"
            >
              <h2 className="text-lg font-bold">Su código de entrega</h2>
              <p
                data-testid="delivery-pin"
                className="mt-2 font-display text-5xl font-extrabold tracking-[0.2em] text-link tabular-nums"
              >
                {order.delivery_pin}
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                Dígaselo al repartidor solo cuando tenga el paquete en sus manos. Es la prueba de
                que usted lo recibió; nadie de Yuntera se lo va a pedir por teléfono ni por mensaje.
              </p>
            </section>
          ) : null}

          <section aria-labelledby="entrega">
            <h2 id="entrega" className="text-xl font-bold">
              Entrega
            </h2>
            {delivered && order.delivered_at ? (
              <p className="mt-2 font-semibold text-success">
                Entregado el {formatDateTime(order.delivered_at)}
              </p>
            ) : order.status === "cancelled" ||
              order.status === "refunded" ||
              back ? null : waiting ? (
              <p className="mt-2 font-semibold" data-testid="awaiting-new-attempt">
                {awaitingNewAttemptLine(waiting.failedAttempt)}
              </p>
            ) : (
              <p className="mt-2 font-semibold text-success">
                {order.promise_earliest === order.promise_latest
                  ? `Llega el ${formatDate(order.promise_latest)}`
                  : `Llega entre el ${formatDate(order.promise_earliest)} y el ${formatDate(order.promise_latest)}`}
              </p>
            )}
            <p className="mt-2 text-sm text-ink-muted">
              {order.address.recipient_name} · {order.address.senas}. {order.address.district},{" "}
              {order.address.canton}.
            </p>

            <ul className="mt-4 flex flex-col gap-3">
              {order.shipments.map((shipment, index) => (
                <li key={shipment.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      {order.shipments.length > 1
                        ? `Paquete ${index + 1} de ${order.shipments.length}`
                        : "Paquete"}
                      <span className="ml-2 font-normal text-ink-muted">
                        {shipment.tracking_code}
                      </span>
                    </p>
                    {stoppedParcelLabel(shipment.status, stoppedFlags(shipment)) ? (
                      <Badge tone={shipment.status === "returning" ? "warning" : "neutral"}>
                        {stoppedParcelLabel(shipment.status, stoppedFlags(shipment))}
                      </Badge>
                    ) : isRescheduledShipment(shipment.status, shipment.attempt_count) ||
                      waitsForNewAttempt(shipment.status, shipment.attempt_count) ? (
                      <Badge tone="info">
                        {
                          statusWord("shipment_status", "delivery_failed", {
                            viewer: "shopper",
                            attemptCount: 0,
                          }).word
                        }
                      </Badge>
                    ) : (
                      <ShipmentStatusBadge status={shipment.status} viewer="shopper" />
                    )}
                  </div>
                  {shipment.driver_first_name ? (
                    <p className="mt-2 text-sm">
                      {shipment.driver_first_name} va en camino con su paquete. Tenga a mano su
                      código de entrega.
                    </p>
                  ) : null}
                  {isStoppedShipment(shipment.status, shipment.recalled) ? (
                    <p className="mt-2 text-sm">
                      Este paquete no saldrá de nuestra bodega.
                      {paid
                        ? " Le devolvemos lo que pagó por él cuando la bodega confirme que lo recibió."
                        : ""}
                    </p>
                  ) : shipment.status === "returning" ? (
                    <p className="mt-2 text-sm">
                      Este paquete regresa a nuestra bodega sin entregarse.
                      {paid ? " Le devolvemos lo que pagó por él cuando la bodega lo reciba." : ""}
                    </p>
                  ) : isRescheduledShipment(shipment.status, shipment.attempt_count) ||
                    waitsForNewAttempt(shipment.status, shipment.attempt_count) ? (
                    <p className="mt-2 text-sm">
                      Reprogramamos la entrega de este paquete. Le avisaremos cuando vuelva a salir
                      hacia usted; si necesita cambiar algo, escríbanos.
                    </p>
                  ) : shipment.status === "delivery_failed" ? (
                    <p className="mt-2 text-sm text-warning">
                      No pudimos entregarlo. Lo intentaremos de nuevo el próximo día hábil; si
                      necesita cambiar algo, escríbanos.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="productos">
            <h2 id="productos" className="text-xl font-bold">
              Productos
            </h2>
            <ul className="mt-3 flex flex-col gap-3">
              {order.items.map((item) => {
                const returnable = item.quantity - item.returned_quantity;
                const moderation = reviewStates.find((state) => state.order_item_id === item.id);
                const itemReturns = returns.filter((entry) => entry.order_item_id === item.id);
                return (
                  <li key={item.id} className="rounded-lg border border-border bg-surface p-4">
                    <div className="flex gap-4">
                      <div className="size-16 shrink-0 overflow-hidden rounded-md bg-arena-100">
                        {item.image_path ? (
                          <ProductImage
                            path={item.image_path}
                            alt=""
                            sizes="64px"
                            className="size-full object-contain"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        {item.product_slug ? (
                          <Link
                            href={`/p/${item.product_slug}` as Route}
                            className="font-semibold hover:underline"
                          >
                            {item.title}
                          </Link>
                        ) : (
                          <p className="font-semibold">{item.title}</p>
                        )}
                        <p className="text-sm text-ink-muted">
                          {item.variant_name ? `${item.variant_name} · ` : ""}
                          {item.quantity} × {formatPrice(item.unit_price_minor)} · Vendido por{" "}
                          {item.seller_name}
                        </p>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums">
                        {formatPrice(item.line_total_minor)}
                      </p>
                    </div>

                    {moderation?.hidden ? (
                      <Alert tone="warning" className="mt-4" title="Retiramos su reseña">
                        {moderation.hidden_at
                          ? `El ${formatDate(moderation.hidden_at, { day: "numeric", month: "long", year: "numeric" })} la quitamos`
                          : "La quitamos"}{" "}
                        de la página del producto y ya no cuenta en su calificación.{" "}
                        {HIDDEN_REVIEW_REASON[moderation.hidden_reason ?? "rules"]} Si cree que es
                        un error, escríbanos a {brand.support.email} y la revisamos de nuevo.
                      </Alert>
                    ) : null}

                    {delivered ? (
                      <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-2">
                        <details className="group">
                          <summary className="cursor-pointer text-sm font-semibold text-link">
                            {item.review
                              ? `Su reseña: ${item.review.rating} de 5 (editar)`
                              : "Escribir una reseña"}
                          </summary>
                          <div className="mt-3">
                            <ReviewForm orderItemId={item.id} orderNumber={order.order_number} />
                          </div>
                        </details>
                        {returnable > 0 && (withdrawalOpen || warrantyOpen) ? (
                          <details className="group">
                            <summary
                              className="cursor-pointer text-sm font-semibold text-link"
                              data-testid="return-open"
                            >
                              Devolver o reclamar garantía
                            </summary>
                            <div className="mt-3">
                              <ReturnForm
                                orderItemId={item.id}
                                orderNumber={order.order_number}
                                maxQuantity={returnable}
                                withdrawalOpen={withdrawalOpen}
                              />
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                    {itemReturns.length > 0 ? (
                      <div className="mt-4 border-t border-border pt-4">
                        <ReturnStatusList returns={itemReturns} orderNumber={order.order_number} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <Suspense fallback={<Skeleton className="h-24" />}>
            <OrderInvoices
              orderNumber={order.order_number}
              paid={["captured", "partially_refunded", "refunded"].includes(
                order.payment?.status ?? "",
              )}
              payOnDelivery={
                order.payment_method === "cash_on_delivery" &&
                !["cancelled", "refunded"].includes(order.status)
              }
              shippingMinor={order.shipping_minor}
            />
          </Suspense>

          {cases.length > 0 ? (
            <section aria-labelledby="consultas">
              <h2 id="consultas" className="text-xl font-bold">
                Sus consultas sobre este pedido
              </h2>
              <div className="mt-3">
                <CaseAnswers cases={cases} showOrder={false} />
              </div>
            </section>
          ) : null}

          <section aria-labelledby="historial">
            <h2 id="historial" className="text-xl font-bold">
              Historial
            </h2>
            <ol className="mt-3 space-y-2 border-l-2 border-border pl-4 text-sm">
              {order.timeline.map((event) => (
                <li key={`${event.at}-${event.kind}-${event.to_status ?? ""}`}>
                  <span className="font-medium">{describeEvent(event, order)}</span>
                  <span className="ml-2 text-ink-muted">{formatDateTime(event.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside aria-label="Resumen" className="flex h-fit flex-col gap-5">
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="text-lg font-bold">Resumen</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>Productos</dt>
                <dd className="tabular-nums">{formatPrice(order.items_total_minor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Envío</dt>
                <dd className="tabular-nums">
                  {order.shipping_minor === 0 ? "Gratis" : formatPrice(order.shipping_minor)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPrice(order.total_minor)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-ink-muted">
              Incluye {formatPrice(order.tax_included_minor)} de IVA.
            </p>
            <p className="mt-3 text-sm">
              <span className="text-ink-muted">Pago: </span>
              {PAYMENT_LABEL[order.payment_method]}
              {order.payment?.status === "captured" ? " · recibido" : ""}
              {order.payment?.status === "refunded" ? " · reembolsado" : ""}
              {order.payment?.status === "partially_refunded" ? " · reembolsado en parte" : ""}
              {order.payment?.status === "captured" &&
              payment.refunds.some((refund) => refund.status !== "succeeded")
                ? " · reembolso en camino"
                : ""}
            </p>
          </div>

          {delivered ? (
            <div className="rounded-lg border border-border bg-surface p-5 text-sm">
              <h2 className="text-base font-bold">Sus derechos sobre esta compra</h2>
              <ul className="mt-2 space-y-1.5 text-ink-muted">
                <li>
                  Devolución sin dar motivo hasta el{" "}
                  <strong className="text-ink">{formatDate(order.withdrawal_deadline)}</strong>.
                </li>
                {order.warranty_until ? (
                  <li>
                    Garantía legal hasta el{" "}
                    <strong className="text-ink">
                      {formatDate(order.warranty_until, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>
                    .
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {order.can_cancel ? (
            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-base font-bold">¿Cambió de opinión?</h2>
              <p className="mt-1 mb-3 text-sm text-ink-muted">
                Puede cancelar mientras no hayamos empezado a prepararlo.
              </p>
              <CancelOrderForm orderId={order.id} orderNumber={order.order_number} />
            </div>
          ) : null}

          <p className="text-sm text-ink-muted">
            ¿Algo no salió bien?{" "}
            <Link
              href={`/reclamo?pedido=${order.order_number}` as Route}
              className={touchLinkClass()}
            >
              Presente un reclamo
            </Link>
            .
          </p>
        </aside>
      </div>
    </>
  );
}

function PaymentInstructions({ order, payment }: { order: OrderDetail; payment: OrderPayment }) {
  // The simulation only while the site is in sandbox mode, whatever mode the order was placed in.
  const sandbox = payment.stage === "simulated";
  if (order.payment_method === "card" && !sandbox) {
    // A card order no gateway can take any more (placed before the payments set-up changed).
    return (
      <section className="rounded-lg border border-maiz-300 bg-maiz-50 p-5">
        <h2 className="text-lg font-bold">Este pedido ya no se puede pagar en línea</h2>
        <p className="mt-2 text-sm">
          No se le ha cobrado nada. Haga el pedido de nuevo para pagarlo con tarjeta; este se
          cancela solo cuando se acabe el tiempo de reserva.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-maiz-300 bg-maiz-50 p-5" data-testid="payment-due">
      <h2 className="text-lg font-bold">Falta el pago de {formatPrice(order.total_minor)}</h2>
      {order.payment_method === "sinpe_movil" ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>Abra la aplicación de su banco y elija SINPE Móvil.</li>
          <li>
            Envíe exactamente <strong>{formatPrice(order.total_minor)}</strong> al número que le
            indicamos.
          </li>
          <li>
            En el detalle escriba el código{" "}
            <strong className="tabular-nums">{order.payment?.sinpe_reference}</strong>.
          </li>
        </ol>
      ) : (
        <p className="mt-2 text-sm">
          Complete el pago con su tarjeta en la página segura del procesador de pagos.
        </p>
      )}
      <p className="mt-2 text-sm text-ink-muted">
        Guardamos sus productos por 30 minutos. Si no recibimos el pago, el pedido se cancela solo y
        no se le cobra nada.
      </p>
      {sandbox ? (
        <div className="mt-4 border-t border-maiz-300 pt-4">
          <p className="mb-3 text-sm">
            <strong>Modo de prueba:</strong> este sitio todavía no está conectado a un procesador de
            pagos. Use este botón para simular que el pago llegó.
          </p>
          <SimulatePaymentForm orderId={order.id} orderNumber={order.order_number} />
        </div>
      ) : null}
    </section>
  );
}

/** A parcel's words as the shopper reads them (packages/core status-words). */
const PARCEL_WORDS = statusWordMap("shipment_status", "shopper");

function describeEvent(event: OrderDetail["timeline"][number], order: OrderDetail): string {
  if (event.kind === "note") return event.note ?? "Nota";
  if (event.kind === "payment") return event.note ?? "Pago";
  if (event.kind === "order_status" && event.to_status === "cancelled") {
    return cancellationWords(order.cancel_reason, false).history;
  }
  if (event.kind === "order_status" && event.to_status && event.to_status in ORDER_STATUS_LABEL) {
    return ORDER_STATUS_LABEL[event.to_status as keyof typeof ORDER_STATUS_LABEL]["es-CR"];
  }
  const stopped =
    event.kind === "shipment_status"
      ? stoppedParcelHistory(event.to_status, event.stopped_before_leaving)
      : null;
  if (stopped) return stopped;
  if (event.kind === "shipment_status" && event.to_status && event.to_status in PARCEL_WORDS) {
    return `Paquete: ${PARCEL_WORDS[event.to_status as keyof typeof PARCEL_WORDS].toLowerCase()}`;
  }
  return event.to_status ?? "Actualización";
}

/** What parcel-words.ts needs to know of a parcel staff stopped. */
function stoppedFlags(shipment: OrderDetail["shipments"][number]) {
  return { recalled: shipment.recalled, stoppedBeforeLeaving: shipment.stopped_before_leaving };
}
