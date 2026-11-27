import type { OpsLocation, OpsStockChange, OpsWarehouseLocations } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, formatDateTime, SelectField, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { createLocation, renameLocation, setLocationActive } from "@/app/operations-actions";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { OperationsNav } from "@/components/operations-nav";
import { LOCATION_KIND } from "@/lib/operations-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Ubicaciones de bodega" };

export default function LocationsPage() {
  return (
    <div className="shell py-8">
      <CatalogueOutcome>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Locations />
        </Suspense>
      </CatalogueOutcome>
    </div>
  );
}

async function Locations() {
  const staff = await requireStaff("/operacion/ubicaciones", ["ops"]);
  const api = await sessionApi();
  const [warehouses, changes] = await Promise.all([
    api.opsWarehouseLocations(),
    api.opsStockChanges(100),
  ]);

  return (
    <>
      <OperationsNav current="/operacion/ubicaciones" admin={staff.staff_role === "admin"} />
      <PageHeader title="Ubicaciones de bodega">
        Los estantes donde se guarda y se alista la mercadería en las bodegas de Yuntera. Una
        ubicación nueva se ofrece de inmediato en las pantallas de la bodega; una desactivada deja
        de ofrecerse. No se desactiva una ubicación con mercadería o con tareas de alisto abiertas:
        para vaciarla, la bodega mueve sus unidades a otro estante desde su app (Bodega,
        Ubicaciones, «Mover»).
      </PageHeader>

      {warehouses.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Todavía no hay bodegas de Yuntera" />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          {warehouses.map((warehouse) => (
            <Warehouse key={warehouse.id} warehouse={warehouse} />
          ))}
        </div>
      )}

      <StockChanges changes={changes} />
    </>
  );
}

/** Moves and count corrections, newest first, for someone to review. */
function StockChanges({ changes }: { changes: OpsStockChange[] }) {
  return (
    <section aria-labelledby="movimientos" className="mt-10">
      <h2 id="movimientos" className="text-xl font-bold">
        Movimientos y correcciones de existencias
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">
        Lo que la bodega movió de un estante a otro y las cantidades que corrigió al contar, con
        quién, cuándo y por qué (los últimos 100). Una corrección cambia lo que la tienda puede
        vender; la tienda la ve en su inventario con el motivo.
      </p>
      {changes.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Todavía no hay movimientos ni correcciones.</p>
      ) : (
        <ul className="mt-3 flex max-w-4xl flex-col gap-2">
          {changes.map((change) => (
            <li
              key={change.id}
              className="rounded-lg border border-border bg-surface p-4 text-sm"
              data-change={change.kind}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={change.kind === "move" ? "info" : "warning"}>
                  {change.kind === "move" ? "Movimiento" : "Corrección"}
                </Badge>
                <span className="font-semibold">
                  {change.title}
                  {change.variant_name ? ` · ${change.variant_name}` : ""}
                </span>
                <span className="text-ink-muted">de {change.seller_name}</span>
              </div>
              <p className="mt-1">
                {change.kind === "move"
                  ? `${change.quantity} ${change.quantity === 1 ? "unidad" : "unidades"} de ${change.from_code ?? "?"} a ${change.to_code ?? "?"}`
                  : `${change.change > 0 ? "+" : "−"}${Math.abs(change.change)} ${Math.abs(change.change) === 1 ? "unidad" : "unidades"} en ${change.to_code ?? change.from_code ?? "?"}`}{" "}
                · {change.warehouse_code}
              </p>
              <p className="mt-1 text-ink-muted">
                {change.actor_name ?? "Cuenta eliminada"} · {formatDateTime(change.at)}
              </p>
              {change.note ? <p className="mt-1">Motivo: {change.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Warehouse({ warehouse }: { warehouse: OpsWarehouseLocations }) {
  const shelves = warehouse.locations.filter((location) => location.editable);
  const areas = warehouse.locations.filter((location) => !location.editable);
  const titleId = `bodega-${warehouse.code}`;
  return (
    <section aria-labelledby={titleId} data-warehouse={warehouse.code}>
      <h2 id={titleId} className="text-xl font-bold">
        {warehouse.name} <span className="font-normal text-ink-muted">· {warehouse.code}</span>
      </h2>

      <div className="mt-3 max-w-xl rounded-lg border border-border bg-surface p-5">
        <h3 className="font-semibold">Nueva ubicación</h3>
        <div className="mt-3">
          <CatalogueForm
            action={createLocation}
            submit="Crear la ubicación"
            pendingLabel="Creando…"
          >
            <input type="hidden" name="warehouseId" value={warehouse.id} />
            <TextField
              label="Código"
              name="code"
              maxLength={9}
              autoComplete="off"
              hint="Como en la etiqueta: letra de la zona, pasillo, nivel y posición. Por ejemplo A-01-02-B."
            />
            <SelectField label="Uso" name="kind" defaultValue="">
              <option value="" disabled>
                Elija…
              </option>
              <option value="storage">{LOCATION_KIND.storage}</option>
              <option value="pick">{LOCATION_KIND.pick}</option>
            </SelectField>
          </CatalogueForm>
        </div>
      </div>

      <h3 className="mt-6 font-semibold">Estantes ({shelves.length})</h3>
      {shelves.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">Esta bodega todavía no tiene estantes.</p>
      ) : (
        <ul className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shelves.map((location) => (
            <Shelf key={location.id} location={location} />
          ))}
        </ul>
      )}

      {areas.length > 0 ? (
        <>
          <h3 className="mt-6 font-semibold">Otras áreas ({areas.length})</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Recepción, empaque, despacho, devoluciones y dañados no se cambian desde aquí.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {areas.map((location) => (
              <li
                key={location.id}
                className="rounded-md border border-border bg-surface-muted px-3 py-2"
              >
                {location.code} · {LOCATION_KIND[location.kind]}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Shelf({ location }: { location: OpsLocation }) {
  return (
    <li
      className={`rounded-lg border border-border p-4 text-sm ${location.active ? "bg-surface" : "bg-surface-muted"}`}
      data-location={location.code}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-display text-base font-bold">{location.code}</h4>
        <Badge tone="neutral">{LOCATION_KIND[location.kind]}</Badge>
        {location.active ? (
          <Badge tone="success">Activa</Badge>
        ) : (
          <Badge tone="warning">Desactivada</Badge>
        )}
      </div>
      <p className="mt-1 text-ink-muted">
        {location.units} {location.units === 1 ? "unidad" : "unidades"} · {location.open_tasks}{" "}
        {location.open_tasks === 1 ? "tarea abierta" : "tareas abiertas"}
        {location.picked_units > 0
          ? ` · ${location.picked_units} ${location.picked_units === 1 ? "unidad" : "unidades"} en paquetes que se están alistando`
          : ""}
      </p>

      <details className="mt-1">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
          Cambiar el código
        </summary>
        <div className="mt-2">
          <CatalogueForm action={renameLocation} submit="Guardar el código" size="sm">
            <input type="hidden" name="locationId" value={location.id} />
            <TextField
              label="Código nuevo"
              name="code"
              defaultValue={location.code}
              maxLength={9}
              autoComplete="off"
            />
          </CatalogueForm>
        </div>
      </details>

      {location.active ? (
        <details className="mt-1">
          <summary
            className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link"
            data-testid="location-switch-off"
          >
            Desactivar
          </summary>
          <div className="mt-2">
            <CatalogueForm
              action={setLocationActive}
              submit="Desactivar la ubicación"
              variant="danger"
              size="sm"
            >
              <input type="hidden" name="locationId" value={location.id} />
              <input type="hidden" name="active" value="no" />
              <p className="text-ink-muted">
                {location.units > 0
                  ? `Tiene ${location.units} ${location.units === 1 ? "unidad" : "unidades"}: primero hay que vaciarla. La bodega las mueve a otro estante desde su app (Bodega, Ubicaciones, ${location.code}, «Mover»).`
                  : "La bodega deja de verla al recibir y guardar. Puede volver a activarla aquí."}
              </p>
            </CatalogueForm>
          </div>
        </details>
      ) : (
        <div className="mt-2">
          <CatalogueForm action={setLocationActive} submit="Volver a activar" size="sm">
            <input type="hidden" name="locationId" value={location.id} />
            <input type="hidden" name="active" value="yes" />
          </CatalogueForm>
        </div>
      )}
    </li>
  );
}
