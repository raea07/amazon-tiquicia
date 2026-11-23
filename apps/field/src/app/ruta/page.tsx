import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { Alert, Badge, EmptyState, formatPrice, Skeleton, type Tone } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { startRoute } from "@/app/actions";
import { PositionReporter } from "@/components/position";
import { requireDriver } from "@/lib/access";

export const metadata: Metadata = { title: "Mi ruta" };

const STOP: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "neutral" },
  arrived: { label: "En la puerta", tone: "info" },
  delivered: { label: "Entregado", tone: "success" },
  failed: { label: "No entregado", tone: "danger" },
  skipped: { label: "Omitida", tone: "neutral" },
};

export default function RoutePage({ searchParams }: PageProps<"/ruta">) {
  return (
    <div className="shell max-w-2xl py-6">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Day searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Day({ searchParams }: Pick<PageProps<"/ruta">, "searchParams">) {
  const driver = await requireDriver("/ruta");
  const { routes } = await (await sessionApi()).driverToday();
  const flash = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Hola, {driver.full_name.split(" ")[0]}</h1>

      {flash.entregado ? (
        <Alert tone="success">Entrega registrada. Siga con la próxima parada.</Alert>
      ) : null}
      {flash.fallida ? (
        <Alert tone="warning">
          Quedó registrado que no se entregó. Lleve el paquete de vuelta a la bodega.
        </Alert>
      ) : null}
      {flash.fin ? (
        <Alert tone="success" title="Terminó la ruta">
          Regrese a la bodega para liquidar.
        </Alert>
      ) : null}

      {routes.length === 0 ? (
        <EmptyState title="No tiene rutas asignadas hoy">
          Cuando Central le asigne una, aparece aquí. Deslice hacia abajo para actualizar.
        </EmptyState>
      ) : null}

      {routes.map((route) => {
        const open = route.stops.filter(
          (stop) => stop.status === "pending" || stop.status === "arrived",
        );
        const next = open[0];
        const delivered = route.stops.filter((stop) => stop.status === "delivered").length;
        // Stops staff took off the route are not part of the total.
        const skipped = route.stops.filter((stop) => stop.status === "skipped").length;
        // The parcels of removed stops went back to dispatch: not collected.
        const packages = route.stops
          .filter((stop) => stop.status !== "skipped")
          .reduce((sum, stop) => sum + stop.package_count, 0);
        return (
          <section
            key={route.route_id}
            aria-labelledby={`ruta-${route.code}`}
            className="flex flex-col gap-4"
          >
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`ruta-${route.code}`} className="text-xl font-bold">
                  Ruta {route.code}
                </h2>
                <p className="text-sm text-ink-muted">
                  {delivered} de {route.stops.length - skipped} entregadas
                  {skipped > 0 ? ` · ${skipped} ${skipped === 1 ? "omitida" : "omitidas"}` : ""}
                </p>
              </div>

              {route.status === "assigned" ? (
                <>
                  <p className="mt-2 text-sm">
                    Recoja{" "}
                    <span className="font-semibold">
                      {packages} {packages === 1 ? "bulto" : "bultos"}
                    </span>{" "}
                    en {route.depot.name}. Revise que cada código de paquete esté en su lista antes
                    de salir.
                  </p>
                  <p className="text-sm text-ink-muted">{route.depot.address}</p>
                  <div className="mt-4">
                    <ActionForm
                      action={startRoute}
                      submit="Ya tengo los paquetes: iniciar ruta"
                      size="lg"
                    >
                      <input type="hidden" name="routeId" value={route.route_id} />
                    </ActionForm>
                  </div>
                </>
              ) : null}

              {route.status === "in_progress" ? (
                <div className="mt-2">
                  <PositionReporter />
                </div>
              ) : null}

              {route.status === "completed" ||
              (route.status === "in_progress" && open.length === 0) ? (
                <p className="mt-2 text-sm">
                  Ruta terminada. Regrese a {route.depot.name}
                  {route.cash_to_hand_in_minor > 0 ? " y entregue el efectivo." : "."}
                </p>
              ) : null}

              {route.cash_to_hand_in_minor > 0 ? (
                <p className="mt-3 rounded-md bg-maiz-50 p-3 text-sm">
                  Efectivo que lleva cobrado:{" "}
                  <span className="font-display text-lg font-bold tabular-nums">
                    {formatPrice(route.cash_to_hand_in_minor)}
                  </span>
                </p>
              ) : null}
            </div>

            <ol className="flex flex-col gap-3">
              {route.stops.map((stop) => {
                const status = STOP[stop.status];
                const actionable =
                  route.status === "in_progress" &&
                  (stop.status === "pending" || stop.status === "arrived");
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold">
                        <span className="tabular-nums text-ink-muted">{stop.sequence}.</span>{" "}
                        {stop.recipient_name}
                      </p>
                      <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? stop.status}</Badge>
                    </div>
                    {stop.district ? (
                      <p className="mt-1 text-sm font-medium">
                        {stop.district}
                        {stop.canton ? `, ${stop.canton}` : ""}
                      </p>
                    ) : null}
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{stop.senas}</p>
                    {stop.status === "skipped" ? (
                      <p className="mt-1 text-sm font-medium">
                        {route.status === "assigned"
                          ? "Central quitó esta parada de la ruta. No recoja este paquete: volvió a Despacho."
                          : "Central quitó esta parada de la ruta. Si lleva el paquete, devuélvalo a la bodega."}
                      </p>
                    ) : null}
                    <p className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-surface-muted px-2 py-0.5">
                        {stop.package_count} {stop.package_count === 1 ? "bulto" : "bultos"} ·{" "}
                        {stop.tracking_code}
                      </span>
                      {stop.cod_amount_minor > 0 ? (
                        <span className="rounded-full bg-maiz-100 px-2 py-0.5 font-semibold text-maiz-900">
                          Cobrar {formatPrice(stop.cod_amount_minor)}
                        </span>
                      ) : null}
                    </p>
                  </>
                );
                return (
                  <li key={stop.stop_id}>
                    {actionable ? (
                      <Link
                        href={`/ruta/${stop.stop_id}` as Route}
                        className={`block rounded-lg border bg-surface p-4 ${
                          stop.stop_id === next?.stop_id ? "border-2 border-brand" : "border-border"
                        }`}
                      >
                        {stop.stop_id === next?.stop_id ? (
                          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-brand">
                            Próxima parada
                          </p>
                        ) : null}
                        {body}
                      </Link>
                    ) : (
                      <div className="rounded-lg border border-border bg-surface-muted p-4">
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
