import { CLOSURE_REASONS, type OpsClosure } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import {
  Badge,
  EmptyState,
  formatDate,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { changeClosureEnd, endClosure, openClosure } from "@/app/operations-actions";
import { removeClosureDay } from "@/app/order-followups-actions";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { OperationsNav } from "@/components/operations-nav";
import { CLOSURE_REASON, CLOSURE_STATE } from "@/lib/operations-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Cierres de zona" };

export default function ClosuresPage() {
  return (
    <div className="shell py-8">
      <CatalogueOutcome>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Closures />
        </Suspense>
      </CatalogueOutcome>
    </div>
  );
}

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function Closures() {
  const staff = await requireStaff("/operacion/cierres", ["ops"]);
  const api = await sessionApi();
  const [list, zones] = await Promise.all([api.opsZoneClosures(), api.opsDeliveryZones()]);
  const open = list.closures.filter(
    (closure) => closure.state === "upcoming" || closure.state === "current",
  );
  const over = list.closures.filter((closure) => closure.state === "over");
  const cancelled = list.closures.filter((closure) => closure.state === "cancelled");

  return (
    <>
      <OperationsNav current="/operacion/cierres" admin={staff.staff_role === "admin"} />
      <PageHeader title="Cierres de zona">
        Cuando una zona no puede recibir entregas unos días (lluvias, un camino cerrado, falta de
        repartidores), ciérrela: la tienda deja de prometer esos días en esa zona. Nada se cancela
        solo; los pedidos ya prometidos en esas fechas aparecen en el cierre para que usted los
        atienda.
      </PageHeader>

      <section aria-labelledby="nuevo-cierre" className="mt-6 max-w-xl">
        <h2 id="nuevo-cierre" className="text-xl font-bold">
          Cerrar una zona
        </h2>
        <div className="mt-3 rounded-lg border border-border bg-surface p-5">
          <CatalogueForm action={openClosure} submit="Guardar el cierre" pendingLabel="Guardando…">
            <SelectField label="Zona" name="zoneId" defaultValue="">
              <option value="" disabled>
                Elija…
              </option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </SelectField>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Primer día cerrado"
                name="startsOn"
                type="date"
                min={list.today}
                max={addDays(list.today, 365)}
              />
              <TextField
                label="Último día cerrado"
                name="endsOn"
                type="date"
                min={list.today}
                hint="31 días como máximo."
              />
            </div>
            <SelectField label="Motivo" name="reason" defaultValue="">
              <option value="" disabled>
                Elija…
              </option>
              {CLOSURE_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {CLOSURE_REASON[reason]}
                </option>
              ))}
            </SelectField>
            <TextAreaField
              label="Qué pasa"
              name="note"
              optional
              maxLength={200}
              hint="Obligatorio con el motivo «Otro». Solo lo lee el personal."
            />
          </CatalogueForm>
        </div>
      </section>

      <section aria-labelledby="cierres" className="mt-10">
        <h2 id="cierres" className="text-xl font-bold">
          Cierres en curso y por venir ({open.length})
        </h2>
        {open.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Ninguna zona está cerrada">
              Todas las zonas encendidas reciben entregas en sus días de reparto.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {open.map((closure) => (
              <ClosureRow key={closure.id} closure={closure} today={list.today} />
            ))}
          </ul>
        )}
      </section>

      {over.length > 0 ? (
        <section aria-labelledby="terminados" className="mt-10">
          <h2 id="terminados" className="text-xl font-bold">
            Terminados en los últimos 30 días ({over.length})
          </h2>
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {over.map((closure) => (
              <ClosureRow key={closure.id} closure={closure} today={list.today} />
            ))}
          </ul>
        </section>
      ) : null}

      {cancelled.length > 0 ? (
        <section aria-labelledby="cancelados" className="mt-10">
          <h2 id="cancelados" className="text-xl font-bold">
            Cierres cancelados ({cancelled.length})
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Se terminaron en los últimos 7 días sin que pasara ninguno de sus días. Si fue un error,
            vuelva a cerrar la zona con las mismas fechas.
          </p>
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {cancelled.map((closure) => (
              <CancelledRow key={closure.id} closure={closure} today={list.today} />
            ))}
          </ul>
        </section>
      ) : null}

      {list.single_days.length > 0 ? (
        <section aria-labelledby="dias-sueltos" className="mt-10">
          <h2 id="dias-sueltos" className="text-xl font-bold">
            Días cerrados uno por uno ({list.single_days.length})
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Se cerraron antes de que existieran los cierres por periodo. Si la zona sí puede
            entregar ese día, ábralo de nuevo: la fecha de entrega que ve la tienda lo cuenta de
            inmediato.
          </p>
          <ul className="mt-3 grid gap-2 text-sm lg:grid-cols-2">
            {list.single_days.map((day) => (
              <li
                key={`${day.zone_id}-${day.day}`}
                className="rounded-lg border border-border bg-surface p-3"
              >
                <p>
                  {day.zone_name} · {formatDate(day.day)}
                </p>
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
                    Abrir el {formatDate(day.day)} en {day.zone_name}
                  </summary>
                  <CatalogueForm action={removeClosureDay} submit="Abrir ese día" size="sm">
                    <input type="hidden" name="zoneId" value={day.zone_id} />
                    <input type="hidden" name="day" value={day.day} />
                    <p className="text-ink-muted">
                      La zona vuelve a entregar ese día. Los pedidos ya prometidos no cambian.
                    </p>
                  </CatalogueForm>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** A closure ended before it started: the way back is to close the zone again. */
function CancelledRow({ closure, today }: { closure: OpsClosure; today: string }) {
  const startsOn = closure.starts_on > today ? closure.starts_on : today;
  return (
    <li
      className="rounded-lg border border-border bg-surface p-4 text-sm"
      data-closure={closure.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold">{closure.zone_name}</h3>
        <Badge tone="neutral">{CLOSURE_STATE.cancelled?.label ?? "Cancelado"}</Badge>
      </div>
      <p className="mt-1">
        {startsOn === closure.ends_on
          ? `El ${formatDate(startsOn)}`
          : `Del ${formatDate(startsOn)} al ${formatDate(closure.ends_on)}`}{" "}
        · {CLOSURE_REASON[closure.reason]}
      </p>
      {closure.note ? <p className="mt-1 break-words text-ink-muted">{closure.note}</p> : null}
      <div className="mt-2">
        <CatalogueForm action={openClosure} submit="Volver a cerrar" size="sm">
          <input type="hidden" name="zoneId" value={closure.zone_id} />
          <input type="hidden" name="startsOn" value={startsOn} />
          <input type="hidden" name="endsOn" value={closure.ends_on} />
          <input type="hidden" name="reason" value={closure.reason} />
          <input type="hidden" name="note" value={closure.note ?? ""} />
        </CatalogueForm>
      </div>
    </li>
  );
}

function ClosureRow({ closure, today }: { closure: OpsClosure; today: string }) {
  const state = CLOSURE_STATE[closure.state];
  // Ending a closure gives back the days from today on: one that starts
  // today (or later) is cancelled whole (ops_end_zone_closure), so it says so.
  const cancels = closure.state === "upcoming" || closure.starts_on >= today;
  return (
    <li
      className="rounded-lg border border-border bg-surface p-4 text-sm"
      data-closure={closure.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold">{closure.zone_name}</h3>
        <Badge tone={state?.tone ?? "neutral"}>{state?.label ?? closure.state}</Badge>
        {closure.ended_early ? <Badge tone="neutral">Terminado antes</Badge> : null}
        {closure.state === "current" && closure.starts_on === today ? (
          <Badge tone="neutral">Empezó hoy</Badge>
        ) : null}
      </div>
      <p className="mt-1">
        {closure.starts_on === closure.ends_on
          ? `El ${formatDate(closure.starts_on)}`
          : `Del ${formatDate(closure.starts_on)} al ${formatDate(closure.ends_on)}`}{" "}
        · {CLOSURE_REASON[closure.reason]}
      </p>
      {closure.note ? <p className="mt-1 break-words text-ink-muted">{closure.note}</p> : null}
      <p className="mt-2 font-semibold">
        {closure.affected_order_count === 0
          ? "Ningún pedido abierto tiene la entrega prometida en estas fechas."
          : `${closure.affected_order_count} ${
              closure.affected_order_count === 1
                ? "pedido abierto tiene"
                : "pedidos abiertos tienen"
            } la entrega prometida en estas fechas:`}
      </p>
      {closure.affected_orders.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-2">
          {closure.affected_orders.map((order) => (
            <li key={order.order_number}>
              <Link
                href={`/pedidos/${order.order_number}` as Route}
                className="inline-flex min-h-11 items-center text-link underline"
              >
                {order.order_number} (
                {formatDate(order.promise_latest, { day: "numeric", month: "short" })})
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {closure.state === "over" && !closure.ended_early ? null : (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
            {closure.state === "over" ? "Volver a cerrar la zona" : "Cambiar el último día"}
          </summary>
          <div className="mt-2">
            <CatalogueForm action={changeClosureEnd} submit="Guardar el último día" size="sm">
              <input type="hidden" name="closureId" value={closure.id} />
              <input type="hidden" name="revision" value={closure.revision} />
              <TextField
                label="Último día cerrado"
                name="endsOn"
                type="date"
                min={today > closure.starts_on ? today : closure.starts_on}
                max={addDays(closure.starts_on, 30)}
                defaultValue={closure.state === "over" ? today : closure.ends_on}
              />
            </CatalogueForm>
          </div>
        </details>
      )}

      {closure.state === "over" ? null : (
        <details className="mt-1">
          <summary
            className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link"
            data-testid="closure-end-now"
          >
            Terminar el cierre ahora
          </summary>
          <div className="mt-2">
            <CatalogueForm
              action={endClosure}
              submit="Terminar el cierre"
              variant="danger"
              size="sm"
            >
              <input type="hidden" name="closureId" value={closure.id} />
              <input type="hidden" name="revision" value={closure.revision} />
              <p className="text-ink-muted">
                {closure.state === "upcoming"
                  ? "Todavía no empezó: se cancela y la zona recibe entregas esos días."
                  : cancels
                    ? "Empezó hoy y ningún día quedó atrás: se cancela y la zona recibe entregas desde hoy, en todas esas fechas."
                    : "La zona recibe entregas desde hoy. Los días ya pasados quedan como estaban."}
              </p>
            </CatalogueForm>
          </div>
        </details>
      )}
    </li>
  );
}
