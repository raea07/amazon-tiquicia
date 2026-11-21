import { ORDER_STATUS_LABEL, ORDER_STATUSES, type OrderStatus } from "@yuntera/core";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import {
  Badge,
  buttonClass,
  EmptyState,
  formatDate,
  formatDateTime,
  formatPrice,
  OrderStatusBadge,
  Skeleton,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Pedidos" };

export default function OrdersPage({ searchParams }: PageProps<"/pedidos">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Pedidos">
        Busque por número de pedido, nombre de quien recibe o teléfono.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Orders searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Orders({ searchParams }: Pick<PageProps<"/pedidos">, "searchParams">) {
  await requireStaff("/pedidos", ["ops", "support", "finance"]);
  const query = await searchParams;
  const text = (one(query.q) ?? "").trim().slice(0, 80);
  const status = ORDER_STATUSES.find((candidate) => candidate === one(query.estado)) ?? null;
  const orders = await (await sessionApi()).opsOrders({ status, query: text || null, limit: 100 });

  return (
    <div className="flex flex-col gap-4">
      <form action="/pedidos" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-semibold">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={text}
            placeholder="YT-100012, nombre o teléfono"
            className="min-h-11 w-72 max-w-full rounded-md border border-border-strong bg-surface px-3"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-semibold">
            Estado
          </label>
          <select
            id="estado"
            name="estado"
            defaultValue={status ?? ""}
            className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
          >
            <option value="">Todos</option>
            {ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {ORDER_STATUS_LABEL[value as OrderStatus]["es-CR"]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Filtrar
        </button>
      </form>

      {orders.length === 0 ? (
        <EmptyState title="Ningún pedido coincide">
          Revise el número o quite el filtro de estado.
        </EmptyState>
      ) : (
        <DataTable
          caption="Pedidos"
          head={["Pedido", "Recibe", "Total", "Pago", "Estado", "Prometido"]}
        >
          {orders.map((order) => {
            const payment = order.payment_status ? PAYMENT_STATUS[order.payment_status] : null;
            return (
              <tr key={order.order_number}>
                <td>
                  <Link
                    href={`/pedidos/${order.order_number}` as Route}
                    className="font-semibold text-link underline"
                  >
                    {order.order_number}
                  </Link>
                  <p className="text-xs text-ink-muted">{formatDateTime(order.placed_at)}</p>
                </td>
                <td>
                  {order.recipient_name}
                  <p className="text-xs text-ink-muted">{order.canton ?? ""}</p>
                </td>
                <td className="tabular-nums">{formatPrice(order.total_minor)}</td>
                <td>
                  {PAYMENT_METHOD[order.payment_method]}
                  {payment ? (
                    <p className="mt-1">
                      <Badge tone={payment.tone}>{payment.label}</Badge>
                    </p>
                  ) : null}
                </td>
                <td>
                  <OrderStatusBadge status={order.status} />
                </td>
                <td>
                  {formatDate(order.promise_latest, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                  {order.is_late ? (
                    <p className="mt-1">
                      <Badge tone="danger">Atrasado</Badge>
                    </p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
