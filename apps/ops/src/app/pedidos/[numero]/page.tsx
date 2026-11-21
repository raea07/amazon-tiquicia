import { ApiError } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import {
  Alert,
  Badge,
  formatDate,
  formatDateTime,
  formatPrice,
  OrderStatusBadge,
  ShipmentStatusBadge,
  Skeleton,
  TextAreaField,
  TextField,
} from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cancelOrder, confirmPayment } from "@/app/actions";
import { NotificationLine } from "@/components/notification-list";
import { PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/labels";
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
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Order params={params} />
        </Suspense>
      </div>
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
  const awaitingTransfer =
    (order.status === "pending_payment" || order.status === "payment_review") &&
    (order.payment_method === "sinpe_movil" || order.payment_method === "bank_transfer");

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-8">
        <header>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">Pedido {order.order_number}</h1>
            <OrderStatusBadge status={order.status} />
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
                      {shipment.attempt_count > 0 ? ` · ${shipment.attempt_count} intento(s)` : ""}
                      {shipment.driver_first_name ? ` · ${shipment.driver_first_name}` : ""}
                    </span>
                  </span>
                  <ShipmentStatusBadge status={shipment.status} />
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
                <span className="font-medium">{event.note ?? event.to_status ?? event.kind}</span>
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
        </section>

        {order.can_cancel && canSee(staff.staff_role, ["ops", "support"]) ? (
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="text-lg font-bold">Cancelar el pedido</h2>
            <p className="mt-1 mb-4 text-sm text-ink-muted">
              Libera las existencias y, si ya estaba pagado, lo marca para reembolso.
            </p>
            <ActionForm
              action={cancelOrder}
              submit="Cancelar pedido"
              variant="danger"
              pendingLabel="Cancelando…"
              hideOnSuccess
            >
              <input type="hidden" name="orderId" value={order.id} />
              <TextAreaField
                label="Motivo"
                name="note"
                rows={2}
                hint="El cliente lo ve en su pedido."
              />
            </ActionForm>
          </section>
        ) : null}
      </aside>
    </div>
  );
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
