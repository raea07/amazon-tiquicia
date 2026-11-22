import type { OpsOpenRoute, OpsRouteStop } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import {
  Badge,
  EmptyState,
  formatDate,
  SHIPMENT_STATUS_LABEL,
  Skeleton,
  TextAreaField,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { closeRoute, removeRouteStop } from "@/app/operations-actions";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { OperationsNav } from "@/components/operations-nav";
import { ROUTE_STATUS, STOP_STATUS } from "@/lib/labels";
import { NOT_REMOVABLE, STUCK_REASON } from "@/lib/operations-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Rutas detenidas" };

export default function RoutesPage() {
  return (
    <div className="shell py-8">
      <CatalogueOutcome>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Routes />
        </Suspense>
      </CatalogueOutcome>
    </div>
  );
}

async function Routes() {
  const staff = await requireStaff("/operacion/rutas", ["ops"]);
  const routes = await (await sessionApi()).opsOpenRoutes();
  const stuck = routes.filter((route) => route.stuck);
  const others = routes.filter((route) => !route.stuck);

  return (
    <>
      <OperationsNav current="/operacion/rutas" admin={staff.staff_role === "admin"} />
      <PageHeader title="Rutas detenidas">
        Una ruta que ya no puede terminar (su día pasó, lleva un paquete cancelado, o el camión no
        puede seguir) se arregla aquí: quite las paradas que no se harán y ciérrela. El paquete de
        una parada quitada vuelve a Despacho para otra ruta; el dinero no se toca.
      </PageHeader>

      <section aria-labelledby="detenidas" className="mt-6">
        <h2 id="detenidas" className="text-xl font-bold">
          Rutas que no pueden terminar ({stuck.length})
        </h2>
        {stuck.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Ninguna ruta está detenida">
              Cuando una ruta no pueda terminar, aparece aquí.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {stuck.map((route) => (
              <RouteCard key={route.route_id} route={route} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="abiertas" className="mt-10">
        <h2 id="abiertas" className="text-xl font-bold">
          Otras rutas abiertas ({others.length})
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          También se pueden arreglar aquí, por ejemplo si el camión se varó a mitad de camino.
        </p>
        {others.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No hay otras rutas abiertas" />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {others.map((route) => (
              <RouteCard key={route.route_id} route={route} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RouteCard({ route }: { route: OpsOpenRoute }) {
  const status = ROUTE_STATUS[route.status];
  return (
    <li className="rounded-lg border border-border bg-surface p-4 text-sm" data-route={route.code}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold">Ruta {route.code}</h3>
        <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? route.status}</Badge>
        {route.stuck_reasons.map((reason) => (
          <Badge key={reason} tone="warning">
            {STUCK_REASON[reason]}
          </Badge>
        ))}
      </div>
      <p className="mt-1 text-ink-muted">
        {formatDate(route.service_date)} · {route.driver_name ?? "Sin repartidor"} ·{" "}
        {route.open_stops} {route.open_stops === 1 ? "parada pendiente" : "paradas pendientes"}
      </p>

      <ol className="mt-3 flex flex-col gap-2">
        {route.stops.map((stop) => (
          <StopRow key={stop.stop_id} stop={stop} />
        ))}
      </ol>

      {route.open_stops === 0 ? (
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
            Cerrar la ruta {route.code}
          </summary>
          <div className="mt-2 max-w-xl">
            <CatalogueForm action={closeRoute} submit="Cerrar la ruta" variant="danger" size="sm">
              <input type="hidden" name="routeId" value={route.route_id} />
              <TextAreaField label="Por qué se cierra" name="reason" maxLength={300} />
              <p className="text-ink-muted">
                {route.status === "in_progress"
                  ? "Queda terminada y su liquidación se abre en Liquidaciones con lo que el repartidor cobró."
                  : "Nunca salió: queda cancelada y el repartidor deja de verla."}{" "}
                No se puede deshacer.
              </p>
            </CatalogueForm>
          </div>
        </details>
      ) : (
        <p className="mt-3 text-ink-muted">
          Para cerrarla, quite las paradas pendientes o espere a que el repartidor las cierre.
        </p>
      )}
    </li>
  );
}

function StopRow({ stop }: { stop: OpsRouteStop }) {
  const status = STOP_STATUS[stop.status];
  return (
    <li className="rounded-md border border-border p-3" data-stop={stop.tracking_code}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold tabular-nums">{stop.sequence}.</span>
        <span className="font-semibold">{stop.tracking_code}</span>
        <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? stop.status}</Badge>
        <span className="text-ink-muted">
          Paquete:{" "}
          {SHIPMENT_STATUS_LABEL[stop.shipment_status as keyof typeof SHIPMENT_STATUS_LABEL] ??
            stop.shipment_status}
        </span>
      </div>
      <p className="mt-1 text-ink-muted">
        <Link
          href={`/pedidos/${stop.order_number}` as Route}
          className="inline-flex min-h-11 items-center text-link underline"
        >
          Pedido {stop.order_number}
        </Link>
        {stop.district ? ` · ${stop.district}` : ""}
        {stop.cash_planned ? " · cobra en efectivo" : ""}
      </p>
      {stop.removal_reason ? (
        <p className="mt-1 break-words text-ink-muted">Quitada: {stop.removal_reason}</p>
      ) : null}
      {stop.not_removable === null ? (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
            Quitar de la ruta
          </summary>
          <div className="mt-2 max-w-xl">
            <CatalogueForm
              action={removeRouteStop}
              submit="Quitar la parada"
              variant="danger"
              size="sm"
            >
              <input type="hidden" name="stopId" value={stop.stop_id} />
              <TextAreaField label="Por qué se quita" name="reason" maxLength={300} />
              <p className="text-ink-muted">
                El repartidor la ve como omitida. Si ya lleva el paquete, debe devolverlo a la
                bodega; el paquete vuelve a Despacho para otra ruta. La fecha prometida al comprador
                no cambia y no se le avisa de una entrega fallida.
              </p>
            </CatalogueForm>
          </div>
        </details>
      ) : stop.status === "arrived" ? (
        <p className="mt-1 text-ink-muted">{NOT_REMOVABLE[stop.not_removable]}</p>
      ) : null}
    </li>
  );
}
