import type { OpsZone } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, formatDate, formatPrice, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { createZone, deleteZone, setZoneActive, updateZone } from "@/app/operations-actions";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { OperationsNav } from "@/components/operations-nav";
import { colonesField, plural, WEEKDAYS, weekdayList } from "@/lib/operations-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Zonas de entrega" };

export default function ZonesPage() {
  return (
    <div className="shell py-8">
      <CatalogueOutcome>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Zones />
        </Suspense>
      </CatalogueOutcome>
    </div>
  );
}

async function Zones() {
  const staff = await requireStaff("/operacion", ["ops"]);
  const zones = await (await sessionApi()).opsDeliveryZones();

  return (
    <>
      <OperationsNav current="/operacion" admin={staff.staff_role === "admin"} />
      <PageHeader title="Zonas de entrega">
        Cada zona tiene su costo de envío, su hora de corte y sus días de entrega. Los cambios rigen
        para los pedidos nuevos; los pedidos ya hechos conservan su fecha y su envío.
      </PageHeader>

      <section aria-labelledby="zonas" className="mt-6">
        <h2 id="zonas" className="text-xl font-bold">
          Zonas ({zones.length})
        </h2>
        {zones.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Todavía no hay zonas">
              Cree la primera con el formulario de abajo.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {zones.map((zone) => (
              <ZoneRow key={zone.id} zone={zone} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="nueva-zona" className="mt-10 max-w-2xl">
        <h2 id="nueva-zona" className="text-xl font-bold">
          Nueva zona
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Se crea apagada y sin distritos. Asígnele distritos en Distritos y enciéndala cuando esté
          lista.
        </p>
        <div className="mt-3 rounded-lg border border-border bg-surface p-5">
          <CatalogueForm action={createZone} submit="Crear zona" pendingLabel="Creando…">
            <TextField
              label="Identificador"
              name="zoneId"
              maxLength={30}
              autoComplete="off"
              hint="En minúsculas, sin tildes, con guiones: zona-sur. No se cambia después."
            />
            <ZoneFields />
          </CatalogueForm>
        </div>
      </section>
    </>
  );
}

function ZoneRow({ zone }: { zone: OpsZone }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-4 text-sm" data-zone={zone.id}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold">{zone.name}</h3>
        {zone.active ? (
          <Badge tone="success">Encendida: recibe pedidos</Badge>
        ) : (
          <Badge tone="warning">Apagada: no recibe pedidos</Badge>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-ink-muted">Envío</dt>
        <dd>
          {formatPrice(zone.shipping_fee_minor)}
          {zone.free_shipping_threshold_minor
            ? `; gratis desde ${formatPrice(zone.free_shipping_threshold_minor)}`
            : "; nunca gratis"}
        </dd>
        <dt className="text-ink-muted">Corte</dt>
        <dd>
          Pedidos antes de las {zone.cutoff_hour}:00 se preparan el mismo día (
          {weekdayList(zone.processing_weekdays)})
        </dd>
        <dt className="text-ink-muted">Entregas</dt>
        <dd>
          {weekdayList(zone.delivery_weekdays)};{" "}
          {zone.transit_min_days === zone.transit_max_days
            ? `${zone.transit_max_days} ${zone.transit_max_days === 1 ? "día" : "días"} de camino`
            : `de ${zone.transit_min_days} a ${zone.transit_max_days} días de camino`}
        </dd>
        <dt className="text-ink-muted">Contra entrega</dt>
        <dd>{zone.cod_available ? "Sí" : "No"}</dd>
        <dt className="text-ink-muted">Distritos</dt>
        <dd>
          {zone.district_count}
          {zone.not_served_count > 0 ? ` (y ${zone.not_served_count} sin entrega)` : ""}
          {zone.district_count === 0 ? " · nadie puede pedir a esta zona" : ""}
        </dd>
        <dt className="text-ink-muted">Pedidos abiertos</dt>
        <dd>{zone.open_order_count}</dd>
        <dt className="text-ink-muted">Hoy promete</dt>
        <dd>
          {zone.promise
            ? zone.promise.earliest === zone.promise.latest
              ? formatDate(zone.promise.latest)
              : `${formatDate(zone.promise.earliest)} a ${formatDate(zone.promise.latest)}`
            : "—"}
          {zone.upcoming_closures > 0 ? ` · ${plural(zone.upcoming_closures, "cierre", "cierres")} por venir` : ""}
        </dd>
      </dl>

      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
          Cambiar «{zone.name}»
        </summary>
        <div className="mt-3">
          <CatalogueForm action={updateZone} submit="Guardar la zona" size="sm">
            <input type="hidden" name="zoneId" value={zone.id} />
            <input type="hidden" name="revision" value={zone.revision} />
            <ZoneFields zone={zone} />
          </CatalogueForm>
        </div>
      </details>

      {zone.active ? (
        <details className="mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
            Apagar la zona
          </summary>
          <div className="mt-2">
            <CatalogueForm
              action={setZoneActive}
              submit="Apagar la zona"
              variant="danger"
              size="sm"
            >
              <input type="hidden" name="zoneId" value={zone.id} />
              <input type="hidden" name="revision" value={zone.revision} />
              <input type="hidden" name="active" value="no" />
              <p className="text-ink-muted">
                Direcciones guardadas en esta zona: {zone.saved_address_count}. Dejan de poder
                elegirse al pagar, y la tienda dice que por ahora no entrega ahí. Pedidos abiertos
                de la zona: {zone.open_order_count}. No cambian: se entregan como se prometió. Puede
                volver a encenderla aquí mismo.
              </p>
            </CatalogueForm>
          </div>
        </details>
      ) : zone.district_count === 0 ? (
        <p className="mt-2 text-ink-muted">
          Para encenderla, asígnele antes al menos un distrito en Distritos: sin distritos no
          recibiría pedidos.
        </p>
      ) : (
        <div className="mt-2">
          <CatalogueForm action={setZoneActive} submit="Encender la zona" size="sm">
            <input type="hidden" name="zoneId" value={zone.id} />
            <input type="hidden" name="revision" value={zone.revision} />
            <input type="hidden" name="active" value="yes" />
          </CatalogueForm>
        </div>
      )}

      {zone.in_use ? null : (
        <details className="mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
            Borrar la zona
          </summary>
          <div className="mt-2">
            <CatalogueForm action={deleteZone} submit="Borrar la zona" variant="danger" size="sm">
              <input type="hidden" name="zoneId" value={zone.id} />
              <p className="text-ink-muted">
                No tiene distritos, pedidos ni cierres. No se puede deshacer.
              </p>
            </CatalogueForm>
          </div>
        </details>
      )}
    </li>
  );
}

/** The fields of a zone's service, filled with `zone` when editing one. */
function ZoneFields({ zone }: { zone?: OpsZone }) {
  const weekdayBoxes = (name: string, legend: string, chosen: readonly number[]) => (
    <fieldset>
      <legend className="text-sm font-semibold">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-x-4">
        {WEEKDAYS.map((weekday) => (
          <label key={weekday.day} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={weekday.day}
              defaultChecked={chosen.includes(weekday.day)}
              className="size-5 accent-(--color-brand)"
            />
            {weekday.short}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <>
      <TextField
        label="Nombre"
        name="name"
        defaultValue={zone?.name}
        maxLength={60}
        autoComplete="off"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Costo de envío (colones)"
          name="shippingFee"
          inputMode="numeric"
          defaultValue={zone ? colonesField(zone.shipping_fee_minor) : ""}
          hint="0 si el envío es gratis."
        />
        <TextField
          label="Envío gratis desde (colones)"
          name="freeShippingThreshold"
          inputMode="numeric"
          optional
          defaultValue={zone ? colonesField(zone.free_shipping_threshold_minor) : ""}
          hint="Vacío: nunca es gratis."
        />
        <TextField
          label="Hora de corte"
          name="cutoffHour"
          type="number"
          min={6}
          max={22}
          defaultValue={zone?.cutoff_hour ?? 12}
          hint="De 6 a 22. Lo pedido antes de esa hora se prepara el mismo día."
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Días de camino, mínimo"
            name="transitMinDays"
            type="number"
            min={0}
            max={10}
            defaultValue={zone?.transit_min_days ?? 1}
          />
          <TextField
            label="Máximo"
            name="transitMaxDays"
            type="number"
            min={0}
            max={15}
            defaultValue={zone?.transit_max_days ?? 2}
          />
        </div>
      </div>
      {weekdayBoxes(
        "processingWeekdays",
        "Días en que se preparan pedidos",
        zone?.processing_weekdays ?? [1, 2, 3, 4, 5],
      )}
      {weekdayBoxes(
        "deliveryWeekdays",
        "Días en que se entrega",
        zone?.delivery_weekdays ?? [1, 2, 3, 4, 5],
      )}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="codAvailable"
          defaultChecked={zone?.cod_available ?? false}
          className="size-5 accent-(--color-brand)"
        />
        Se puede pagar contra entrega
      </label>
    </>
  );
}
