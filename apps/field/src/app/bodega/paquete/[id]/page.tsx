import { ApiError } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { Alert, Badge, formatDate, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { startPicking } from "@/app/actions";
import { PackForm, PickForm } from "@/components/warehouse-forms";
import { requireWarehouse } from "@/lib/access";

export const metadata: Metadata = { title: "Paquete" };

export default function ShipmentPage({ params }: PageProps<"/bodega/paquete/[id]">) {
  return (
    <div className="shell max-w-2xl py-6">
      <p className="text-sm">
        <Link href="/bodega" className="text-link underline">
          ← Bodega
        </Link>
      </p>
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Shipment params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function Shipment({ params }: Pick<PageProps<"/bodega/paquete/[id]">, "params">) {
  const { id } = await params;
  await requireWarehouse(`/bodega/paquete/${id}`);
  // Anything that is not an id cannot be a parcel: not found, without asking.
  if (!z.uuid().safeParse(id).success) notFound();

  const shipment = await (await sessionApi()).wmsShipment(id).catch((error: unknown) => {
    if (
      error instanceof ApiError &&
      (error.code === "shipment_not_found" || error.code === "forbidden")
    ) {
      notFound();
    }
    throw error;
  });
  const done = shipment.tasks.filter((task) => task.status === "done").length;
  const short = shipment.tasks.some((task) => task.status === "short");
  const allPicked = shipment.tasks.length > 0 && done === shipment.tasks.length;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-sm text-ink-muted">
          Pedido {shipment.order_number} · sale a más tardar el{" "}
          {formatDate(shipment.promise_latest)}
        </p>
        <h1 className="font-display text-3xl font-bold">{shipment.tracking_code}</h1>
      </header>

      {shipment.status === "pending" ? (
        <ActionForm action={startPicking} submit="Empezar a alistar" size="lg">
          <input type="hidden" name="shipmentId" value={shipment.shipment_id} />
        </ActionForm>
      ) : null}

      {shipment.status === "packed" || shipment.status === "ready_for_dispatch" ? (
        <Alert tone="success" title="Empacado">
          {shipment.package_count} {shipment.package_count === 1 ? "bulto" : "bultos"}
          {shipment.weight_grams ? ` · ${shipment.weight_grams} g` : ""}. Debe estar en la zona de
          despacho con el código {shipment.tracking_code} visible.
        </Alert>
      ) : null}

      <section aria-labelledby="lineas">
        <h2 id="lineas" className="text-lg font-bold">
          Líneas ({done} de {shipment.tasks.length})
        </h2>
        <p className="text-sm text-ink-muted">En el orden del recorrido por la bodega.</p>
        <ol className="mt-3 flex flex-col gap-3">
          {shipment.tasks.map((task) => (
            <li
              key={task.task_id}
              className={`rounded-lg border bg-surface p-4 ${
                task.status === "done" ? "border-border opacity-80" : "border-border-strong"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-2xl font-bold">
                  {task.location_code ?? "Sin ubicación"}
                </p>
                {task.status === "done" ? (
                  <Badge tone="success">Listo</Badge>
                ) : task.status === "short" ? (
                  <Badge tone="danger">Faltante</Badge>
                ) : (
                  <Badge tone="neutral">Pendiente</Badge>
                )}
              </div>
              <p className="mt-1">
                <span className="font-display text-xl font-bold tabular-nums">
                  {task.quantity} ×
                </span>{" "}
                {task.title}
                {task.variant_name ? ` (${task.variant_name})` : ""}
              </p>
              <p className="text-sm text-ink-muted">
                {task.sku_code}
                {task.gtin ? ` · ${task.gtin}` : ""}
                {task.picked_quantity > 0 && task.status !== "done"
                  ? ` · tomadas ${task.picked_quantity}`
                  : ""}
              </p>
              {shipment.status === "picking" && task.status !== "done" ? (
                <div className="mt-3 border-t border-border pt-3">
                  <PickForm shipmentId={shipment.shipment_id} task={task} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {shipment.status === "picking" ? (
        <section className="rounded-lg border-2 border-brand bg-surface p-5">
          <h2 className="text-lg font-bold">Empacar</h2>
          {allPicked ? (
            <div className="mt-3">
              <PackForm shipment={shipment} />
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">
              {short
                ? "Hay una línea con faltante. Avise a Central antes de empacar."
                : "Confirme todas las líneas para poder empacar."}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
