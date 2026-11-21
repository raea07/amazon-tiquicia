import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import { Alert, Badge, EmptyState, formatDate, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { InboundForm, LocationForm, StockForm } from "@/components/forms";
import { getDistricts } from "@/lib/data";
import { INBOUND_STATUS } from "@/lib/labels";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Inventario" };

export default function InventoryPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Inventario">
        Cuántas unidades hay de cada producto y dónde están. Un producto sin existencias deja de
        ofrecerse solo, y vuelve cuando usted repone.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Inventory />
        </Suspense>
      </div>
    </div>
  );
}

async function Inventory() {
  const { shop } = await requireShop("/inventario");
  const api = await sessionApi();
  const [listings, stock, locations, inbounds, districts] = await Promise.all([
    api.sellerListings(shop.id),
    api.sellerStock(shop.id),
    api.sellerLocations(shop.id),
    api.sellerInbounds(shop.id),
    getDistricts(),
  ]);

  if (listings.length === 0) {
    return (
      <EmptyState title="Primero publique un producto">
        El inventario se lleva por producto. Cuando tenga el primero, aquí indica cuántas unidades
        hay.
      </EmptyState>
    );
  }

  const own = listings.filter((listing) => listing.fulfillment === "seller");
  const hosted = listings.filter((listing) => listing.fulfillment === "platform");
  const levelAt = (warehouseId: string, skuId: string) =>
    stock.find((row) => row.warehouse_id === warehouseId && row.sku_id === skuId);
  const hostedStock = stock.filter((row) => row.warehouse_kind === "platform");

  await connection();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-10">
      {own.length > 0 ? (
        <section aria-labelledby="propio">
          <h2 id="propio" className="text-xl font-bold">
            Lo que usted despacha
          </h2>
          {locations.own.length === 0 ? (
            <div className="mt-3 max-w-3xl rounded-lg border border-border bg-surface p-5">
              <Alert tone="warning" title="Falta registrar de dónde recogemos sus paquetes">
                Sin ese lugar no podemos ofrecer estos productos: no sabríamos adónde enviar al
                repartidor.
              </Alert>
              <div className="mt-5">
                <LocationForm districts={districts} />
              </div>
            </div>
          ) : (
            locations.own.map((location) => (
              <div key={location.id} className="mt-3">
                <p className="mb-2 text-sm text-ink-muted">
                  <span className="font-semibold text-ink">{location.name}</span> ·{" "}
                  {location.address}
                </p>
                <DataTable
                  caption={`Existencias en ${location.name}`}
                  head={["Producto", "Apartadas para pedidos", "Disponibles", "Conteo"]}
                >
                  {own.map((listing) => {
                    const level = levelAt(location.id, listing.sku_id);
                    return (
                      <tr key={listing.sku_id}>
                        <td className="max-w-xs">
                          <p className="font-semibold">{listing.title}</p>
                          <p className="text-xs text-ink-muted">{listing.sku_code}</p>
                        </td>
                        <td className="tabular-nums">{level?.reserved ?? 0}</td>
                        <td className="tabular-nums">{level?.available ?? 0}</td>
                        <td>
                          <StockForm
                            warehouseId={location.id}
                            skuId={listing.sku_id}
                            onHand={level?.on_hand ?? 0}
                            label={listing.title}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </DataTable>
              </div>
            ))
          )}
        </section>
      ) : null}

      {hosted.length > 0 ? (
        <section aria-labelledby="bodega">
          <h2 id="bodega" className="text-xl font-bold">
            En la bodega de Yuntera
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Estas existencias las cuenta la bodega al recibir su mercadería; usted no las edita.
          </p>
          <div className="mt-3">
            {hostedStock.length === 0 ? (
              <Alert tone="info">
                Todavía no hay unidades suyas en bodega. Registre un envío abajo y llévelo a la
                bodega.
              </Alert>
            ) : (
              <DataTable
                caption="Existencias en bodega"
                head={["Producto", "Bodega", "En bodega", "Apartadas", "Disponibles"]}
              >
                {hostedStock.map((row) => (
                  <tr key={`${row.warehouse_id}:${row.sku_id}`}>
                    <td className="max-w-xs">
                      <p className="font-semibold">{row.title}</p>
                      <p className="text-xs text-ink-muted">{row.sku_code}</p>
                    </td>
                    <td>{row.warehouse_name}</td>
                    <td className="tabular-nums">{row.on_hand}</td>
                    <td className="tabular-nums">{row.reserved}</td>
                    <td className="tabular-nums">{row.available}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-5">
              <h3 className="text-lg font-bold">Enviar mercadería a la bodega</h3>
              <p className="mt-1 mb-4 text-sm text-ink-muted">
                Avísenos qué trae y cuándo. Rotule cada caja con la referencia del envío.
              </p>
              <InboundForm
                warehouses={locations.platform}
                minDate={today}
                products={hosted.map((listing) => ({
                  skuId: listing.sku_id,
                  title: listing.title,
                  skuCode: listing.sku_code,
                }))}
              />
            </div>
            <div>
              <h3 className="text-lg font-bold">Sus envíos</h3>
              {inbounds.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">Aún no ha registrado envíos.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-3">
                  {inbounds.map((inbound) => {
                    const status = INBOUND_STATUS[inbound.status];
                    return (
                      <li
                        key={inbound.inbound_id}
                        className="rounded-lg border border-border bg-surface p-4 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-display text-base font-bold">{inbound.reference}</p>
                          <Badge tone={status?.tone ?? "neutral"}>
                            {status?.label ?? inbound.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-ink-muted">
                          {inbound.warehouse_name}
                          {inbound.expected_on
                            ? ` · llega el ${formatDate(inbound.expected_on)}`
                            : ""}
                        </p>
                        <ul className="mt-2 space-y-1">
                          {(inbound.lines ?? []).map((line) => (
                            <li key={line.sku_code} className="flex justify-between gap-3">
                              <span>{line.title}</span>
                              <span className="shrink-0 tabular-nums text-ink-muted">
                                {line.received} de {line.expected} recibidas
                                {line.damaged > 0 ? ` · ${line.damaged} dañadas` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
