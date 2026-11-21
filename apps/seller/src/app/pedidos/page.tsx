import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import {
  EmptyState,
  formatDate,
  formatDateTime,
  formatPrice,
  OrderStatusBadge,
  ShipmentStatusBadge,
  Skeleton,
} from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PackForm } from "@/components/forms";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Pedidos" };

export default function OrdersPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Pedidos">
        Lo que debe empacar hoy y sus ventas recientes. Por privacidad solo ve el nombre de pila del
        comprador y la zona de entrega; la dirección la maneja el repartidor.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Orders />
        </Suspense>
      </div>
    </div>
  );
}

async function Orders() {
  const { shop } = await requireShop("/pedidos");
  const api = await sessionApi();
  const [all, lines] = await Promise.all([
    api.sellerToPack(shop.id),
    api.sellerOrderLines(shop.id, 50),
  ]);
  const parcels = all.filter((parcel) => parcel.status !== "packed");
  const waiting = all.filter((parcel) => parcel.status === "packed");

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="empacar">
        <h2 id="empacar" className="text-xl font-bold">
          Por empacar
        </h2>
        {parcels.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No tiene paquetes por empacar.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {parcels.map((parcel) => (
              <li
                key={parcel.shipment_id}
                className="rounded-lg border border-border bg-surface p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-lg font-bold">Paquete {parcel.tracking_code}</p>
                  <p className="text-sm font-semibold text-warning">
                    Prometido para el {formatDate(parcel.promise_latest)}
                  </p>
                </div>
                <p className="text-sm text-ink-muted">
                  Pedido {parcel.order_number} · recogemos en {parcel.origin}
                </p>
                <ul className="mt-3 space-y-1 text-sm">
                  {parcel.items.map((item) => (
                    <li key={item.sku_code}>
                      <span className="font-semibold tabular-nums">{item.quantity} ×</span>{" "}
                      {item.title}
                      <span className="text-ink-muted"> · {item.sku_code}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-ink-muted">
                  Escriba <span className="font-semibold text-ink">{parcel.tracking_code}</span> en
                  el paquete, bien visible. No incluya facturas con precios de otros pedidos.
                </p>
                <div className="mt-4">
                  <PackForm parcel={parcel} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {waiting.length > 0 ? (
        <section aria-labelledby="recoger">
          <h2 id="recoger" className="text-xl font-bold">
            Empacados, esperando al repartidor
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {waiting.map((parcel) => (
              <li
                key={parcel.shipment_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-4 text-sm"
              >
                <span>
                  <span className="font-semibold">Paquete {parcel.tracking_code}</span> · pedido{" "}
                  {parcel.order_number}
                </span>
                <span className="text-ink-muted">Recogemos en {parcel.origin}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-muted">
            Entregue cada paquete solo a un repartidor que le muestre la ruta de Yuntera en su
            teléfono.
          </p>
        </section>
      ) : null}

      <section aria-labelledby="ventas">
        <h2 id="ventas" className="text-xl font-bold">
          Ventas recientes
        </h2>
        <div className="mt-3">
          {lines.length === 0 ? (
            <EmptyState title="Aún no tiene ventas">
              Cuando alguien compre uno de sus productos aparece aquí al instante.
            </EmptyState>
          ) : (
            <DataTable
              caption="Ventas recientes"
              head={["Pedido", "Producto", "Total", "Estado", "Entrega", "Comprador"]}
            >
              {lines.map((line) => (
                <tr key={line.order_item_id}>
                  <td>
                    <p className="font-semibold">{line.order_number}</p>
                    <p className="text-xs text-ink-muted">{formatDateTime(line.placed_at)}</p>
                  </td>
                  <td className="max-w-xs">
                    <span className="tabular-nums">{line.quantity} ×</span> {line.title}
                  </td>
                  <td className="tabular-nums">{formatPrice(line.line_total_minor)}</td>
                  <td>
                    <OrderStatusBadge status={line.order_status} />
                  </td>
                  <td>
                    {line.shipment_status ? (
                      <ShipmentStatusBadge status={line.shipment_status} />
                    ) : (
                      "—"
                    )}
                    <p className="mt-1 text-xs text-ink-muted">
                      {line.fulfillment === "platform"
                        ? "Sale de bodega Yuntera"
                        : "Lo despacha usted"}
                    </p>
                  </td>
                  <td>
                    {line.buyer_first_name}
                    <p className="text-xs text-ink-muted">
                      {[line.district, line.canton].filter(Boolean).join(", ")}
                    </p>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </section>
    </div>
  );
}
