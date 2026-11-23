import {
  deliveryFeeComesBack,
  isOrderBeingStopped,
  isRescheduledOrder,
  isRescheduledShipment,
  isStoppedShipment,
  ORDER_STATUS_LABEL,
  type OrderStatus,
  type ShipmentStatus,
} from "@yuntera/core";
import { ApiError, type OrderDetailWithRecall } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import {
  Alert,
  Badge,
  formatDate,
  formatDateTime,
  formatPrice,
  OrderStatusBadge,
  SHIPMENT_STATUS_LABEL,
  ShipmentStatusBadge,
  Skeleton,
  TextAreaField,
  TextField,
} from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { confirmPayment } from "@/app/actions";
import { staffCancelOrder } from "@/app/integrity-actions";
import { CatalogueOutcome } from "@/components/catalogue-outcome";
import { DeliveryCodePanel, ReturnedParcelForm } from "@/components/integrity-forms";
import { NotificationLine } from "@/components/notification-list";
import { RecallShipmentForm } from "@/components/order-recall-form";
import { PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/labels";
import {
  ATTEMPT_STATUS,
  gatewayFailure,
  REFUND_CHANNEL,
  REFUND_STATUS,
} from "@/lib/payment-labels";
import { canSee, requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Pedido" };

export default function OrderPage({ params }: PageProps<"/pedidos/[numero]">) {
  return (
    <div className="shell py-8">
      <p className="text-sm">
        <Link href="/pedidos" className="text-link underline">
          ← Pedidos
        </Link>
      </p>
      {/* Stopping a parcel removes its own form: the outcome is said at the bottom. */}
      <CatalogueOutcome>
        <div className="mt-3">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Order params={params} />
          </Suspense>
        </div>
      </CatalogueOutcome>
    </div>
  );
}

async function Order({ params }: Pick<PageProps<"/pedidos/[numero]">, "params">) {
  const { numero } = await params;
  const staff = await requireStaff(`/pedidos/${numero}`, ["ops", "support", "finance"]);
  if (!/^YT-\d{4,12}$/.test(numero)) notFound();

  const api = await sessionApi();
  const order = await api.getOrder(numero).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "order_not_found") notFound();
    throw error;
  });
  const payment = order.payment ? PAYMENT_STATUS[order.payment.status] : null;
  const canHandleParcels = canSee(staff.staff_role, ["ops", "support"]);
  const deliveryCode = canHandleParcels ? await api.opsDeliveryCode(order.id) : null;
  // The gateway's view of the payment: its references, and its refunds on their way.
  const gateway = await api.orderPayment(order.order_number);
  // A transfer is confirmed by hand only where the gateway does not confirm it.
  const awaitingTransfer =
    (order.status === "pending_payment" || order.status === "payment_review") &&
    (order.payment_method === "sinpe_movil" || order.payment_method === "bank_transfer") &&
    gateway.manual_confirmation;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-8">
        <header>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">Pedido {order.order_number}</h1>
            {/* What is happening, not the order's status alone: its parcels may
                be off a route or stopped while the order still reads "shipped". */}
            {isOrderBeingStopped(order.status, order.shipments) ? (
              <Badge tone="warning">
                Se está cancelando: espera que la bodega reciba el paquete
              </Badge>
            ) : isRescheduledOrder(order.status, order.shipments) ? (
              <Badge tone="warning">Ningún paquete en camino: espera otra ruta</Badge>
            ) : (
              <OrderStatusBadge status={order.status} />
            )}
          </div>
          <p className="mt-1 text-ink-muted">
            Realizado el {formatDateTime(order.placed_at)} · prometido para el{" "}
            {formatDate(order.promise_latest)}
          </p>
          {order.cancel_reason ? (
            <p className="mt-1 text-sm text-danger">Motivo de cancelación: {order.cancel_reason}</p>
          ) : null}
        </header>

        <section aria-labelledby="productos">
          <h2 id="productos" className="text-xl font-bold">
            Productos
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {order.items.map((item) => (
              <li
                key={item.id}
                className="flex justify-between gap-4 rounded-lg border border-border bg-surface p-4 text-sm"
              >
                <span>
                  <span className="font-semibold">
                    {item.quantity} × {item.title}
                  </span>
                  <span className="block text-ink-muted">
                    Vendido por {item.seller_name ?? "—"} ·{" "}
                    {item.fulfillment === "platform"
                      ? "sale de bodega Yuntera"
                      : "lo despacha el vendedor"}
                    {item.returned_quantity > 0 ? ` · ${item.returned_quantity} en devolución` : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatPrice(item.line_total_minor)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="paquetes">
          <h2 id="paquetes" className="text-xl font-bold">
            Paquetes
          </h2>
          {order.shipments.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Se crean cuando el pago queda confirmado.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {order.shipments.map((shipment) => (
                <li
                  key={shipment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 text-sm"
                >
                  <span>
                    <span className="font-semibold">{shipment.tracking_code}</span>
                    <span className="ml-2 text-ink-muted">
                      {shipment.package_count} {shipment.package_count === 1 ? "bulto" : "bultos"}
                      {isStoppedShipment(shipment.status, shipment.recalled)
                        ? " · detenido antes de salir, sin intento de entrega"
                        : isRescheduledShipment(shipment.status, shipment.attempt_count)
                          ? " · quitado de una ruta, sin intento de entrega"
                          : shipment.attempt_count > 0
                            ? ` · ${shipment.attempt_count} ${shipment.attempt_count === 1 ? "intento" : "intentos"}`
                            : ""}
                      {shipment.driver_first_name ? ` · ${shipment.driver_first_name}` : ""}
                    </span>
                  </span>
                  {isStoppedShipment(shipment.status, shipment.recalled) ? (
                    <Badge tone="warning">Detenido: vuelve a los estantes</Badge>
                  ) : isRescheduledShipment(shipment.status, shipment.attempt_count) ? (
                    <Badge tone="warning">Quitado de una ruta: espera otra</Badge>
                  ) : (
                    <ShipmentStatusBadge status={shipment.status} />
                  )}
                  {shipment.can_recall && canSee(staff.staff_role, ["ops"]) ? (
                    <div className="w-full border-t border-border pt-3">
                      <RecallShipmentForm
                        shipmentId={shipment.id}
                        trackingCode={shipment.tracking_code}
                        orderNumber={order.order_number}
                        onRoute={shipment.status === "ready_for_dispatch"}
                        money={recallMoney(order, shipment.id)}
                      />
                    </div>
                  ) : null}
                  {shipment.status === "returning" && canSee(staff.staff_role, ["ops"]) ? (
                    <div className="w-full border-t border-border pt-3">
                      <ReturnedParcelForm
                        shipmentId={shipment.id}
                        orderNumber={order.order_number}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {canSee(staff.staff_role, ["support"]) ? (
          <section aria-labelledby="mensajes">
            <h2 id="mensajes" className="text-xl font-bold">
              Mensajes
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Lo que le avisamos al cliente y a las tiendas, por qué canal y si llegó. El contenido
              no se muestra aquí.
            </p>
            <Suspense fallback={<Skeleton className="mt-3 h-24" />}>
              <OrderMessages orderNumber={order.order_number} />
            </Suspense>
          </section>
        ) : null}

        <section aria-labelledby="historial">
          <h2 id="historial" className="text-xl font-bold">
            Historial
          </h2>
          <ol className="mt-3 space-y-2 border-l-2 border-border pl-4 text-sm">
            {order.timeline.map((event, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered history
              <li key={index}>
                <span className="font-medium">{timelineWords(event, order.timeline)}</span>
                <span className="ml-2 text-ink-muted">{formatDateTime(event.at)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="flex h-fit flex-col gap-5">
        <section className="rounded-lg border border-border bg-surface p-5 text-sm">
          <h2 className="text-lg font-bold">Cobro</h2>
          <dl className="mt-3 space-y-2">
            <div className="flex justify-between">
              <dt>Productos</dt>
              <dd className="tabular-nums">{formatPrice(order.items_total_minor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Envío</dt>
              <dd className="tabular-nums">{formatPrice(order.shipping_minor)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatPrice(order.total_minor)}</dd>
            </div>
          </dl>
          <p className="mt-3">
            {PAYMENT_METHOD[order.payment_method]}{" "}
            {payment ? <Badge tone={payment.tone}>{payment.label}</Badge> : null}
          </p>
          {order.payment?.sinpe_reference ? (
            <p className="mt-1 text-ink-muted">
              Código que el cliente debe poner en el detalle:{" "}
              <span className="font-semibold text-ink">{order.payment.sinpe_reference}</span>
            </p>
          ) : null}
          {gateway.attempt ? (
            <p className="mt-2 break-all text-ink-muted">
              Procesador: intento{" "}
              {ATTEMPT_STATUS[gateway.attempt.status] ?? "en un estado desconocido"}
              {gateway.attempt.intent_reference ? ` · ${gateway.attempt.intent_reference}` : ""}
              {gateway.attempt.session_reference
                ? ` · sesión ${gateway.attempt.session_reference}`
                : ""}
              {gateway.attempt.failure_code
                ? ` · motivo: ${gatewayFailure(gateway.attempt.failure_code)}`
                : ""}
            </p>
          ) : null}
          {gateway.refunds.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-border pt-3">
              {gateway.refunds.map((refund) => (
                <li key={refund.id}>
                  Reembolso {formatPrice(refund.amount_minor)}{" "}
                  <Badge tone={REFUND_STATUS[refund.status].tone}>
                    {REFUND_STATUS[refund.status].label}
                  </Badge>
                  <span className="block text-ink-muted">{REFUND_CHANNEL[refund.channel]}</span>
                </li>
              ))}
              <li>
                <Link href="/cobros/reembolsos" className="text-link underline">
                  Ver en Cobros
                </Link>
              </li>
            </ul>
          ) : null}
        </section>

        {awaitingTransfer && canSee(staff.staff_role, ["finance"]) ? (
          <section className="rounded-lg border border-warning bg-surface p-5">
            <h2 className="text-lg font-bold">Confirmar la transferencia</h2>
            <p className="mt-1 mb-4 text-sm text-ink-muted">
              Solo después de ver el dinero en la cuenta del banco, por el monto exacto y con el
              código de este pedido.
            </p>
            <ActionForm
              action={confirmPayment}
              submit="Confirmar pago"
              pendingLabel="Confirmando…"
              hideOnSuccess
            >
              <input type="hidden" name="orderId" value={order.id} />
              <TextField
                label="Comprobante del banco"
                name="bankReference"
                hint="El número de referencia que muestra el banco para esa transferencia."
              />
            </ActionForm>
          </section>
        ) : null}

        <section className="rounded-lg border border-border bg-surface p-5 text-sm">
          <h2 className="text-lg font-bold">Entrega</h2>
          <p className="mt-2 font-semibold">{order.address.recipient_name}</p>
          <p className="text-ink-muted">{order.address.phone}</p>
          <p className="mt-2">{order.address.senas}</p>
          <p className="text-ink-muted">
            {[order.address.district, order.address.canton].filter(Boolean).join(", ")}
            {order.address.plus_code ? ` · ${order.address.plus_code}` : ""}
          </p>
          <Alert tone="info" className="mt-4">
            El código de entrega solo lo ve el cliente. Nadie de Yuntera debe pedírselo por teléfono
            ni por mensaje.
          </Alert>
          {deliveryCode ? (
            <DeliveryCodePanel
              state={deliveryCode}
              orderId={order.id}
              orderNumber={order.order_number}
              canRelease={canHandleParcels}
            />
          ) : null}
        </section>

        {order.can_cancel && canSee(staff.staff_role, ["ops", "support"]) ? (
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="text-lg font-bold">Cancelar el pedido</h2>
            <p className="mt-1 mb-4 text-sm text-ink-muted">
              Libera las existencias y, si ya estaba pagado, lo marca para reembolso.
            </p>
            <ActionForm
              action={staffCancelOrder}
              submit="Cancelar pedido"
              variant="danger"
              pendingLabel="Cancelando…"
              hideOnSuccess
            >
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="orderNumber" value={order.order_number} />
              <TextAreaField
                label="Motivo"
                name="note"
                rows={2}
                hint="El cliente lo ve en su pedido."
              />
            </ActionForm>
          </section>
        ) : canSee(staff.staff_role, ["ops", "support"]) &&
          ["confirmed", "processing", "partially_shipped", "shipped"].includes(order.status) ? (
          <section className="rounded-lg border border-border bg-surface p-5 text-sm">
            <h2 className="text-lg font-bold">Cancelar el pedido</h2>
            <p className="mt-1 text-ink-muted">
              {order.shipments.some((shipment) => shipment.can_recall)
                ? "Ya hay un paquete empacado. Para cancelar, deténgalo en «Paquetes»: vuelve a los estantes y, cuando la bodega lo reciba, se reembolsa y el pedido queda cancelado."
                : "Ya no se puede cancelar: hay un paquete en camino. Si el cliente no lo quiere, que lo rechace en la entrega; al volver a bodega se recibe como devuelto y se le reembolsa."}
            </p>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

/**
 * What stopping this parcel does to the shopper's money, for the
 * confirmation: its goods come back when the warehouse receives it, and the
 * delivery fee too when it is the last parcel still to deliver and nobody
 * went to the door (the database's rule, deliveryFeeComesBack).
 */
function recallMoney(order: OrderDetailWithRecall, shipmentId: string): string {
  const paid = ["captured", "partially_refunded"].includes(order.payment?.status ?? "");
  if (!paid) return "No se cobró nada todavía, así que no hay dinero que devolver.";
  const shipment = order.shipments.find((s) => s.id === shipmentId);
  const goods = order.items
    .filter((item) => shipment?.item_ids?.includes(item.id))
    .reduce((sum, item) => sum + item.line_total_minor, 0);
  const last = order.shipments.every(
    (s) =>
      s.id === shipmentId ||
      s.status === "cancelled" ||
      s.status === "returned" ||
      isStoppedShipment(s.status, s.recalled),
  );
  const fee = last && deliveryFeeComesBack(order.shipments) ? order.shipping_minor : 0;
  return `Cuando la bodega lo reciba, se le devuelven al cliente ${formatPrice(goods + fee)}${
    fee > 0 ? ", productos y envío," : " por los productos"
  } por el mismo medio con que pagó${last ? ", y el pedido queda cancelado" : ""}.`;
}

async function OrderMessages({ orderNumber }: { orderNumber: string }) {
  const rows = await (await sessionApi()).opsOrderNotifications(orderNumber);
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-ink-muted">Todavía no se ha enviado ningún mensaje.</p>;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
          <NotificationLine row={row} />
        </li>
      ))}
    </ul>
  );
}

type TimelineEvent = {
  at: string;
  kind: "order_status" | "shipment_status" | "payment" | "note";
  to_status: string | null;
  note: string | null;
};

/** The note staff's removal of a stop writes (ops_remove_route_stop), in the same moment. */
const REMOVAL_NOTE = "Central quitó el paquete ";

/**
 * A history line in words, never a status code. A parcel's step written by
 * staff taking its stop off a route (the same moment as the removal note)
 * reads "Quitado de una ruta", not "Entrega fallida": nobody went to the door.
 */
function timelineWords(event: TimelineEvent, timeline: readonly TimelineEvent[]): string {
  if (event.note) return event.note;
  const status = event.to_status ?? "";
  if (event.kind === "shipment_status") {
    const removal = timeline.some(
      (other) =>
        other.kind === "note" && other.at === event.at && other.note?.startsWith(REMOVAL_NOTE),
    );
    if (removal) return "Quitado de una ruta, sin intento de entrega";
    const words = SHIPMENT_STATUS_LABEL[status as ShipmentStatus];
    return words ? `Paquete: ${words.toLowerCase()}` : "El paquete cambió de estado";
  }
  if (event.kind === "order_status") {
    return ORDER_STATUS_LABEL[status as OrderStatus]?.["es-CR"] ?? "El pedido cambió de estado";
  }
  if (event.kind === "payment") return "Cambio en el pago";
  return "Nota";
}
