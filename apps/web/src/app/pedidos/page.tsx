import { ProductImage } from "@yuntera/next-kit/product-image";
import {
  buttonClass,
  EmptyState,
  formatDate,
  formatPrice,
  OrderStatusBadge,
  Skeleton,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireViewer } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

export const metadata: Metadata = { title: "Sus pedidos", robots: { index: false } };

export default function OrdersPage() {
  return (
    <div className="shell py-8">
      <h1 className="text-3xl font-bold">Sus pedidos</h1>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-64" />}>
          <Orders />
        </Suspense>
      </div>
    </div>
  );
}

async function Orders() {
  await requireViewer("/pedidos");
  const orders = await (await sessionApi()).myOrders(50);

  if (orders.length === 0) {
    return (
      <EmptyState
        title="Todavía no tiene pedidos"
        action={
          <Link href="/buscar" className={buttonClass()}>
            Ver productos
          </Link>
        }
      >
        Cuando compre, aquí podrá seguir cada entrega.
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {orders.map((order) => (
        <li key={order.order_number}>
          <Link
            href={`/pedidos/${order.order_number}` as Route}
            className="flex gap-4 rounded-lg border border-border bg-surface p-4 hover:border-brand hover:shadow-sm"
          >
            <div className="size-16 shrink-0 overflow-hidden rounded-md bg-arena-100">
              {order.first_image_path ? (
                <ProductImage
                  path={order.first_image_path}
                  alt=""
                  sizes="64px"
                  className="size-full object-contain"
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{order.order_number}</span>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="mt-1 truncate text-sm text-ink-muted">
                {order.first_title}
                {order.item_count > 1 ? ` y ${order.item_count - 1} más` : ""}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {order.delivered_at
                  ? `Entregado el ${formatDate(order.delivered_at, { day: "numeric", month: "long" })}`
                  : order.status === "cancelled" || order.status === "refunded"
                    ? `Pedido el ${formatDate(order.placed_at, { day: "numeric", month: "long" })}`
                    : `Llega el ${formatDate(order.promise_latest)}`}
              </p>
            </div>
            <p className="shrink-0 font-display text-lg font-bold tabular-nums">
              {formatPrice(order.total_minor)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
