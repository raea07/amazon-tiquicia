import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { EmptyState, formatDate, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { addHoliday, removeHoliday } from "@/app/operations-actions";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { OperationsNav } from "@/components/operations-nav";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Feriados" };

export default function HolidaysPage() {
  return (
    <div className="shell py-8">
      <CatalogueOutcome>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Holidays />
        </Suspense>
      </CatalogueOutcome>
    </div>
  );
}

/** The day after `day` (YYYY-MM-DD), for the date field's minimum. */
const nextDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

async function Holidays() {
  const staff = await requireStaff("/operacion/feriados", ["ops"]);
  const calendar = await (await sessionApi()).opsHolidays();
  const upcoming = calendar.holidays.filter((holiday) => holiday.day >= calendar.today);
  const past = calendar.holidays.filter((holiday) => holiday.day < calendar.today);

  return (
    <>
      <OperationsNav current="/operacion/feriados" admin={staff.staff_role === "admin"} />
      <PageHeader title="Feriados">
        Días sin preparación ni entregas en todo el país (fechas de Costa Rica). La fecha de entrega
        que ve la tienda los salta en cuanto se guardan. Se agregan y se quitan días a partir de
        mañana; hoy ya hay entregas en camino.
      </PageHeader>

      <section aria-labelledby="nuevo-feriado" className="mt-6 max-w-xl">
        <h2 id="nuevo-feriado" className="text-xl font-bold">
          Agregar un feriado
        </h2>
        <div className="mt-3 rounded-lg border border-border bg-surface p-5">
          <CatalogueForm action={addHoliday} submit="Agregar el feriado" pendingLabel="Agregando…">
            <TextField
              label="Día"
              name="day"
              type="date"
              min={nextDay(calendar.today)}
              max={calendar.latest_allowed}
            />
            <TextField label="Nombre" name="name" maxLength={60} autoComplete="off" />
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="confirm"
                className="mt-0.5 size-5 accent-(--color-brand)"
              />
              <span>
                Agregar aunque haya pedidos prometidos ese día. Esos pedidos mantienen su fecha; un
                día con rutas planeadas no se puede marcar.
              </span>
            </label>
          </CatalogueForm>
        </div>
      </section>

      <section aria-labelledby="proximos" className="mt-10">
        <h2 id="proximos" className="text-xl font-bold">
          Próximos feriados ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No hay feriados por venir">
              Agregue los del año con el formulario de arriba.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {upcoming.map((holiday) => (
              <li
                key={holiday.day}
                className="rounded-lg border border-border bg-surface p-4 text-sm"
                data-holiday={holiday.day}
              >
                <h3 className="text-base font-bold">
                  {formatDate(holiday.day, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </h3>
                <p>{holiday.name}</p>
                {holiday.promised_orders > 0 || holiday.routes_planned > 0 ? (
                  <p className="mt-1 text-ink-muted">
                    {holiday.promised_orders} pedidos con entrega prometida ese día ·{" "}
                    {holiday.routes_planned} rutas planeadas
                  </p>
                ) : null}
                {holiday.changeable ? (
                  <details className="mt-1">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
                      Quitar este feriado
                    </summary>
                    <div className="mt-2">
                      <CatalogueForm
                        action={removeHoliday}
                        submit="Quitar el feriado"
                        variant="danger"
                        size="sm"
                      >
                        <input type="hidden" name="day" value={holiday.day} />
                        <p className="text-ink-muted">
                          Ese día vuelve a haber preparación y entregas, y la tienda lo vuelve a
                          prometer. Para deshacerlo, agréguelo de nuevo.
                        </p>
                      </CatalogueForm>
                    </div>
                  </details>
                ) : (
                  <p className="mt-1 text-ink-muted">Es hoy: ya no se cambia.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section aria-labelledby="pasados" className="mt-10">
          <h2 id="pasados" className="text-xl font-bold">
            Feriados de los últimos dos meses ({past.length})
          </h2>
          <ul className="mt-3 grid gap-2 text-sm lg:grid-cols-2">
            {past.map((holiday) => (
              <li key={holiday.day} className="rounded-lg border border-border bg-surface p-3">
                {formatDate(holiday.day)} · {holiday.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
