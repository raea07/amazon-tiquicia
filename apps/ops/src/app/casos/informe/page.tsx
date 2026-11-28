import { formatNumber, SERVICE_HOURS_TEXT, toCostaRicaTime } from "@yuntera/core";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader, Stat } from "@yuntera/next-kit/shell";
import { Skeleton, touchLinkClass } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CasesNav } from "@/components/cases-nav";
import { CASE_KIND, caseTopic, span, targetText } from "@/lib/case-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Informe del mes" };

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "2026-11" → the first day of that month and of the next, as YYYY-MM-DD. */
function monthRange(month: string): { from: string; to: string; next: string; previous: string } {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const pad = (value: number) => String(value).padStart(2, "0");
  const nextYear = m === 12 ? year + 1 : year;
  const nextMonth = m === 12 ? 1 : m + 1;
  const prevYear = m === 1 ? year - 1 : year;
  const prevMonth = m === 1 ? 12 : m - 1;
  return {
    from: `${year}-${pad(m)}-01`,
    to: `${nextYear}-${pad(nextMonth)}-01`,
    next: `${nextYear}-${pad(nextMonth)}`,
    previous: `${prevYear}-${pad(prevMonth)}`,
  };
}

const percent = (part: number, whole: number) =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)} %`;

export default function CaseReportPage({ searchParams }: PageProps<"/casos/informe">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Informe del mes">
        Lo que mide Atención al cliente, mes por mes: cuántos casos llegaron y de qué tipo, cuántos
        se respondieron a tiempo, cuánto tardó la primera respuesta y cuántos se volvieron a abrir.
        Para la revisión mensual de reclamos.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Report searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Report({ searchParams }: Pick<PageProps<"/casos/informe">, "searchParams">) {
  await requireStaff("/casos/informe", ["support"]);
  const query = await searchParams;
  await connection();
  const today = toCostaRicaTime(new Date()).date;
  const asked = typeof query.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.mes);
  const month = asked ? (query.mes as string) : today.slice(0, 7);
  const range = monthRange(month);
  const api = await sessionApi();
  const [report, targets] = await Promise.all([
    api.opsCaseReport(range.from, range.to),
    api.opsCaseTargets(),
  ]);
  const [year, m] = month.split("-").map(Number) as [number, number];
  const contacts = report.by_kind.contact ?? 0;

  return (
    <>
      <CasesNav current="/casos/informe" support />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold" data-testid="report-month">
          {MONTHS[m - 1]} de {year}
        </h2>
        <Link href={`/casos/informe?mes=${range.previous}` as Route} className={touchLinkClass()}>
          Mes anterior
        </Link>
        {range.next <= today.slice(0, 7) ? (
          <Link href={`/casos/informe?mes=${range.next}` as Route} className={touchLinkClass()}>
            Mes siguiente
          </Link>
        ) : null}
      </div>

      <section aria-labelledby="medidas">
        <h3 id="medidas" className="text-lg font-bold">
          Medidas
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Casos del mes" value={report.total} />
          <Stat
            label="Contactos por cada 100 pedidos"
            value={
              report.orders === 0
                ? "—"
                : formatNumber((contacts / report.orders) * 100, { maxDecimals: 1 })
            }
            hint={`${contacts} ${contacts === 1 ? "contacto" : "contactos"} y ${report.orders} ${report.orders === 1 ? "pedido" : "pedidos"}`}
          />
          <Stat
            label="Primera respuesta a tiempo"
            value={percent(report.first_response.on_time, report.first_response.answered)}
            hint={`${report.first_response.on_time} de ${report.first_response.answered} respondidos; ${report.first_response.late_unanswered} sin responder y atrasados`}
          />
          <Stat
            label="Mediana de la primera respuesta"
            value={
              report.first_response.median_minutes === null
                ? "—"
                : span(report.first_response.median_minutes * 60_000)
            }
            hint="La mitad de los casos se respondió antes"
          />
          <Stat
            label="Reclamos respondidos en 5 días hábiles"
            value={percent(
              report.complaints_answered_in_time.on_time,
              report.complaints_answered_in_time.closed,
            )}
            hint={`${report.complaints_answered_in_time.on_time} de ${report.complaints_answered_in_time.closed} cerrados; ${report.complaints_answered_in_time.late_open} abiertos y atrasados`}
          />
          <Stat
            label="Reembolsos dentro del plazo legal"
            value={percent(
              report.refunds_in_legal_time.on_time,
              report.refunds_in_legal_time.refunded,
            )}
            hint="Debe ser el 100 %"
          />
          <Stat
            label="Casos reabiertos"
            value={report.reopened}
            hint="Señal de que la primera respuesta no lo resolvió"
          />
        </div>
      </section>

      <section aria-labelledby="por-tipo" className="mt-8">
        <h3 id="por-tipo" className="text-lg font-bold">
          Por tipo y tema
        </h3>
        {report.by_topic.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No llegaron casos este mes.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {report.by_topic.map((row) => (
              <li
                key={`${row.kind}-${row.topic}`}
                className="flex justify-between gap-4 rounded-lg border border-border bg-surface p-3"
              >
                <span>
                  {CASE_KIND[row.kind] ?? row.kind}: {caseTopic(row)}
                </span>
                <span className="font-semibold tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="plazos" className="mt-8">
        <h3 id="plazos" className="text-lg font-bold">
          Plazos que se usan
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          Los de la política de atención al cliente, contados en el horario de atención.{" "}
          {SERVICE_HOURS_TEXT} El sábado cuenta como día hábil; los domingos y los feriados de
          Operación, no.
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm" data-testid="case-targets">
          {targets.map((target) => (
            <li
              key={`${target.kind}-${target.topic}`}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <p className="font-semibold">
                {CASE_KIND[target.kind] ?? target.kind}
                {target.topic === "*" ? "" : `: ${caseTopic(target)}`}
                {target.topic === "*" && target.kind === "contact" ? ": otra consulta" : ""}
              </p>
              <p className="text-ink-muted">
                Primera respuesta:{" "}
                {targetText(target.first_response_amount, target.first_response_unit)} · Resolver:{" "}
                {targetText(target.resolution_amount, target.resolution_unit)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
