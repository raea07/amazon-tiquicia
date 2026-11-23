import { sessionApi } from "@yuntera/next-kit/server";
import { Alert, Badge, buttonClass, formatDate, Skeleton, type Tone } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReturnedParcelCheckIn } from "@/components/returned-parcel-form";
import { ReceiveForm } from "@/components/warehouse-forms";
import { requireWarehouse } from "@/lib/access";

export const metadata: Metadata = { title: "Bodega" };

const STEP: Record<string, { label: string; tone: Tone; order: number }> = {
  picking: { label: "Alistando", tone: "info", order: 0 },
  pending: { label: "Por alistar", tone: "warning", order: 1 },
  packed: { label: "Empacado", tone: "success", order: 2 },
  ready_for_dispatch: { label: "En zona de despacho", tone: "success", order: 3 },
};

export default function WarehousePage(props: PageProps<"/bodega">) {
  return (
    <div className="shell max-w-3xl py-6">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Board {...props} />
      </Suspense>
    </div>
  );
}

async function Board({ searchParams }: PageProps<"/bodega">) {
  const { devuelto } = await searchParams;
  const warehouse = await requireWarehouse("/bodega");
  const api = await sessionApi();
  const [board, locations, returning] = await Promise.all([
    api.wmsBoardPaged(warehouse.id),
    api.wmsLocations(warehouse.id),
    api.wmsReturningShipments(warehouse.id),
  ]);
  const shipments = [...board.shipments].sort(
    (a, b) => (STEP[a.status]?.order ?? 9) - (STEP[b.status]?.order ?? 9),
  );
  const todo = shipments.filter(
    (shipment) => shipment.status === "pending" || shipment.status === "picking",
  );
  const receivingBins = locations.filter(
    (location) => location.kind === "receiving" || location.kind === "storage",
  );

  return (
    <div className="flex flex-col gap-8">
      {devuelto === "venta" || devuelto === "danado" ? (
        <Alert tone="success" title="Paquete devuelto recibido">
          {devuelto === "venta"
            ? "Guarde las unidades en la zona de devoluciones: ya cuentan de nuevo en el inventario."
            : "Quedó registrado como dañado y no vuelve a la venta. Apártelo para revisión."}
        </Alert>
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-muted">{board.warehouse.code}</p>
          <h1 className="text-2xl font-bold">{board.warehouse.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/bodega/ubicaciones" className={buttonClass({ variant: "secondary" })}>
            Ubicaciones
          </Link>
          <Link href="/bodega/buscar" className={buttonClass({ variant: "secondary" })}>
            Buscar un producto
          </Link>
        </div>
      </header>

      <section aria-labelledby="paquetes">
        <h2 id="paquetes" className="text-xl font-bold">
          Pedidos ({todo.length} por hacer)
        </h2>
        {shipments.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No hay pedidos en el piso ahora.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {shipments.map((shipment) => {
              const step = STEP[shipment.status];
              return (
                <li key={shipment.shipment_id}>
                  <Link
                    href={`/bodega/paquete/${shipment.shipment_id}` as Route}
                    className="block rounded-lg border border-border bg-surface p-4 hover:border-brand"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-display text-lg font-bold">{shipment.tracking_code}</p>
                      <span className="flex gap-1">
                        {shipment.short ? <Badge tone="danger">Faltante</Badge> : null}
                        <Badge tone={step?.tone ?? "neutral"}>
                          {step?.label ?? shipment.status}
                        </Badge>
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">
                      {shipment.units} {shipment.units === 1 ? "unidad" : "unidades"} en{" "}
                      {shipment.lines} {shipment.lines === 1 ? "línea" : "líneas"} · pedido{" "}
                      {shipment.order_number} · sale a más tardar el{" "}
                      {formatDate(shipment.promise_latest, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="devueltos">
        <h2 id="devueltos" className="text-xl font-bold">
          Paquetes devueltos por recibir ({returning.length})
        </h2>
        {returning.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Ningún paquete viene de vuelta.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {returning.map((parcel) => (
              <li
                key={parcel.shipment_id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-display text-lg font-bold">{parcel.tracking_code}</p>
                  <Badge tone="warning">De vuelta</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {parcel.units} {parcel.units === 1 ? "unidad" : "unidades"} en {parcel.lines}{" "}
                  {parcel.lines === 1 ? "línea" : "líneas"} · pedido {parcel.order_number} ·{" "}
                  {parcel.attempt_count === 1
                    ? "1 intento de entrega"
                    : `${parcel.attempt_count} intentos de entrega`}
                </p>
                <div className="mt-3">
                  <ReturnedParcelCheckIn shipmentId={parcel.shipment_id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recepciones">
        <h2 id="recepciones" className="text-xl font-bold">
          Mercadería por recibir (
          {board.inbound_total > board.inbound.length
            ? `${board.inbound.length} de ${board.inbound_total.toLocaleString("es-CR")}, los que llegan antes primero`
            : board.inbound_total}
          )
        </h2>
        {board.inbound.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Ningún vendedor ha anunciado envíos.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {board.inbound.map((inbound) => (
              <li
                key={inbound.inbound_id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-lg font-bold">{inbound.reference}</p>
                  <p className="text-sm text-ink-muted">
                    {inbound.seller_name}
                    {inbound.expected_on ? ` · llega el ${formatDate(inbound.expected_on)}` : ""}
                  </p>
                </div>
                <ul className="mt-3 flex flex-col gap-4">
                  {(inbound.lines ?? []).map((line) => {
                    const pending = line.expected - line.received - line.damaged;
                    return (
                      <li key={line.line_id} className="border-t border-border pt-3 text-sm">
                        <p className="font-semibold">{line.title}</p>
                        <p className="text-ink-muted">
                          {line.sku_code} · esperadas {line.expected} · recibidas {line.received}
                          {line.damaged > 0 ? ` · dañadas ${line.damaged}` : ""}
                        </p>
                        {pending > 0 ? (
                          <div className="mt-3">
                            <ReceiveForm
                              lineId={line.line_id}
                              pending={pending}
                              label={line.title}
                              locations={receivingBins.map(({ id, code }) => ({ id, code }))}
                            />
                          </div>
                        ) : (
                          <p className="mt-1 font-medium text-success">Completa</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
