import { isRescheduledShipment } from "@yuntera/core";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import {
  Alert,
  Badge,
  buttonClass,
  formatDate,
  formatPrice,
  SelectField,
  Skeleton,
} from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { assignRoute, planDay, returnShipment } from "@/app/actions";
import { FAILURE_REASON, ROUTE_STATUS, STOP_STATUS, VEHICLE } from "@/lib/labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Despacho" };

export default function DispatchPage({ searchParams }: PageProps<"/despacho">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Despacho">
        Arme las rutas del día con los paquetes listos y siga cómo van las que ya salieron.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Board searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

/** True for a date that exists, written YYYY-MM-DD (so not "2026-13-45" or "2026-02-30"). */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Today's date in Costa Rica, as YYYY-MM-DD. */
const todayInCostaRica = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Costa_Rica" }).format(new Date());

/**
 * When a stop was closed without signal, how much later the server heard of
 * it (the delivery promise and the seller scores use when it happened).
 */
function lateBy(stop: { completed_at: string | null; completed_received_at: string | null }) {
  if (!stop.completed_at || !stop.completed_received_at) return null;
  const minutes = Math.round(
    (Date.parse(stop.completed_received_at) - Date.parse(stop.completed_at)) / 60_000,
  );
  if (!(minutes >= 10)) return null;
  const span =
    minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 6) / 10} h`.replace(".", ",");
  return `registrada ${span} después, sin señal`;
}

async function Board({ searchParams }: Pick<PageProps<"/despacho">, "searchParams">) {
  await requireStaff("/despacho", ["ops"]);
  const asked = (await searchParams).fecha;
  const requested = Array.isArray(asked) ? asked[0] : asked;
  await connection();
  // Anything that is not a real day of the calendar means "today".
  const date = requested && isCalendarDate(requested) ? requested : todayInCostaRica();

  const api = await sessionApi();
  const [board, released] = await Promise.all([
    api.opsDispatchBoard(date),
    api.opsReleasedRoutes(7),
  ]);
  // Routes a driver who stopped being active left behind, still without a driver.
  const orphaned = released.filter((route) => route.status === "draft");
  const failed = board.ready.filter((shipment) => shipment.status === "delivery_failed");
  const freeDrivers = board.drivers.filter((driver) => driver.active_routes === 0);

  return (
    <div className="flex flex-col gap-10">
      {orphaned.length > 0 ? (
        <Alert tone="warning" title="Rutas que volvieron a despacho">
          <p>
            Estas rutas quedaron sin repartidor porque se suspendió o se dio de baja a quien las
            tenía. Asígnelas abajo a otro repartidor.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {orphaned.map((route) => (
              <li key={route.route_id}>
                <span className="font-semibold">{route.code}</span>: {route.stops}{" "}
                {route.stops === 1 ? "parada" : "paradas"}, antes de {route.from_driver_name}
                {route.from_route_code
                  ? ` (lo que faltaba de la ruta ${route.from_route_code})`
                  : ""}
                .
                {route.parcels_out > 0
                  ? ` ${route.parcels_out} ${
                      route.parcels_out === 1 ? "paquete sigue" : "paquetes siguen"
                    } en manos de esa persona: recupérelos antes de que salga la ruta.`
                  : ""}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <form action="/despacho" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="fecha" className="text-sm font-semibold">
            Día de reparto
          </label>
          <input
            id="fecha"
            name="fecha"
            type="date"
            defaultValue={date}
            className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
          />
        </div>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Ver
        </button>
      </form>

      <section aria-labelledby="listos">
        <h2 id="listos" className="text-xl font-bold">
          Listos para salir ({board.ready.length})
        </h2>
        {board.ready.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No hay paquetes esperando ruta. Aparecen aquí cuando la bodega o el vendedor los empaca.
          </p>
        ) : (
          <ActionForm
            action={planDay}
            submit="Proponer y crear rutas"
            pendingLabel="Calculando rutas…"
            className="mt-3 flex flex-col gap-5"
          >
            <input type="hidden" name="date" value={date} />
            <DataTable
              caption="Paquetes listos para salir"
              head={["Incluir", "Paquete", "Recibe", "Peso", "Prometido", "Notas"]}
            >
              {board.ready.map((shipment) => (
                <tr key={shipment.shipment_id}>
                  <td>
                    <input
                      type="checkbox"
                      name="shipmentId"
                      value={shipment.shipment_id}
                      defaultChecked
                      aria-label={`Incluir el paquete ${shipment.tracking_code}`}
                      className="size-5 accent-(--color-brand)"
                    />
                  </td>
                  <td>
                    <p className="font-semibold">{shipment.tracking_code}</p>
                    <p className="text-xs text-ink-muted">
                      {shipment.order_number} · sale de {shipment.origin_code}
                    </p>
                  </td>
                  <td>
                    {shipment.recipient_name}
                    <p className="text-xs text-ink-muted">{shipment.canton ?? ""}</p>
                  </td>
                  <td className="tabular-nums">
                    {(shipment.weight_grams / 1000).toLocaleString("es-CR", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    kg
                    <p className="text-xs text-ink-muted">
                      {shipment.package_count} {shipment.package_count === 1 ? "bulto" : "bultos"}
                    </p>
                  </td>
                  <td>
                    {formatDate(shipment.promise_latest, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {shipment.cash_on_delivery ? (
                        <Badge tone="warning">Cobra efectivo</Badge>
                      ) : null}
                      {shipment.attempt_count > 0 ? (
                        <Badge tone="danger">Intento {shipment.attempt_count + 1}</Badge>
                      ) : null}
                      {shipment.origin_kind === "seller" ? (
                        <Badge tone="info">Recoger donde el vendedor</Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>

            <div className="grid gap-5 lg:grid-cols-2">
              <fieldset className="rounded-lg border border-border bg-surface p-4">
                <legend className="px-1 text-sm font-semibold">Repartidores</legend>
                {board.drivers.length === 0 ? (
                  <p className="text-sm text-ink-muted">No hay repartidores activos.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {board.drivers.map((driver) => (
                      <li key={driver.id}>
                        <label className="flex items-start gap-3 text-sm">
                          <input
                            type="checkbox"
                            name="driverId"
                            value={driver.id}
                            defaultChecked={driver.active_routes === 0}
                            className="mt-0.5 size-5 accent-(--color-brand)"
                          />
                          <span>
                            <span className="font-semibold">{driver.full_name}</span>
                            <span className="block text-ink-muted">
                              {VEHICLE[driver.vehicle_type]} · hasta {driver.capacity_kg} kg
                              {driver.active_routes > 0
                                ? ` · ya tiene ${driver.active_routes} ruta(s)`
                                : ""}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
              <div className="flex flex-col gap-3">
                <SelectField label="Bodega de salida" name="depotId">
                  {board.depots.map((depot) => (
                    <option key={depot.id} value={depot.id}>
                      {depot.name}
                    </option>
                  ))}
                </SelectField>
                <p className="text-sm text-ink-muted">
                  El sistema agrupa los paquetes por zona, respeta la capacidad de cada vehículo y
                  ordena las paradas para acortar el recorrido. No conoce el tráfico: revise el
                  resultado antes de que salgan.
                </p>
              </div>
            </div>
          </ActionForm>
        )}
      </section>

      {failed.length > 0 ? (
        <section aria-labelledby="fallidas">
          <h2 id="fallidas" className="text-xl font-bold">
            Entregas fallidas
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Siguen en la lista de arriba para un nuevo intento, también los que se quitaron de una
            ruta. Si ya no se va a entregar, devuélvalo a la bodega.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {failed.map((shipment) => (
              <li
                key={shipment.shipment_id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-surface p-4 text-sm"
              >
                <span>
                  <span className="font-semibold">{shipment.tracking_code}</span> ·{" "}
                  {shipment.recipient_name}
                  <span className="block text-ink-muted">
                    {shipment.order_number} ·{" "}
                    {isRescheduledShipment(shipment.status, shipment.attempt_count)
                      ? "quitado de una ruta, sin intento de entrega"
                      : `${shipment.attempt_count} ${shipment.attempt_count === 1 ? "intento" : "intentos"}`}
                  </span>
                </span>
                <ActionForm
                  action={returnShipment}
                  submit="Devolver a bodega"
                  variant="secondary"
                  size="sm"
                  hideOnSuccess
                >
                  <input type="hidden" name="shipmentId" value={shipment.shipment_id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="rutas">
        <h2 id="rutas" className="text-xl font-bold">
          Rutas del {formatDate(date)}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Para quitar una parada o cerrar una ruta que no puede terminar, vaya a{" "}
          <Link href="/operacion/rutas" className="text-link underline">
            Rutas detenidas
          </Link>
          .
        </p>
        {board.routes.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Todavía no hay rutas para este día.</p>
        ) : (
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {board.routes.map((route) => {
              const status = ROUTE_STATUS[route.status];
              const done = route.stops.filter((stop) => stop.status === "delivered").length;
              const cash = route.stops.reduce((sum, stop) => sum + stop.cod_amount_minor, 0);
              return (
                <li key={route.route_id} className="rounded-lg border border-border bg-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-bold">{route.code}</h3>
                    <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? route.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {route.driver_name ?? "Sin repartidor"} · {done} de {route.stops.length}{" "}
                    entregadas
                    {route.planned_km ? ` · ${route.planned_km} km` : ""}
                    {route.planned_minutes
                      ? ` · ${Math.round(route.planned_minutes / 6) / 10} h`
                      : ""}
                    {cash > 0 ? ` · cobra ${formatPrice(cash)}` : ""}
                  </p>
                  <ol className="mt-3 space-y-1.5 text-sm">
                    {route.stops.map((stop) => {
                      const stopStatus = STOP_STATUS[stop.status];
                      return (
                        <li
                          key={stop.stop_id}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <span>
                            <span className="tabular-nums text-ink-muted">{stop.sequence}.</span>{" "}
                            {stop.recipient_name}
                            <span className="text-ink-muted"> · {stop.tracking_code}</span>
                            {stop.failure_reason ? (
                              <span className="text-danger">
                                {" "}
                                · {FAILURE_REASON[stop.failure_reason] ?? stop.failure_reason}
                              </span>
                            ) : null}
                            {stop.pod_outside_area ? (
                              <span className="text-danger">
                                {" "}
                                · el teléfono dio una ubicación fuera del país: revise esta parada
                              </span>
                            ) : null}
                            {lateBy(stop) ? (
                              <span className="text-ink-muted"> · {lateBy(stop)}</span>
                            ) : null}
                          </span>
                          <Badge tone={stopStatus?.tone ?? "neutral"}>
                            {stopStatus?.label ?? stop.status}
                          </Badge>
                        </li>
                      );
                    })}
                  </ol>
                  {route.status === "draft" ? (
                    <div className="mt-4 border-t border-border pt-4">
                      {freeDrivers.length === 0 ? (
                        <Alert tone="warning">
                          No hay repartidores libres para asignar esta ruta.
                        </Alert>
                      ) : (
                        <ActionForm
                          action={assignRoute}
                          submit="Asignar"
                          size="sm"
                          variant="secondary"
                        >
                          <input type="hidden" name="routeId" value={route.route_id} />
                          <SelectField label="Repartidor" name="driverId">
                            {freeDrivers.map((driver) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.full_name} ({VEHICLE[driver.vehicle_type]})
                              </option>
                            ))}
                          </SelectField>
                        </ActionForm>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
