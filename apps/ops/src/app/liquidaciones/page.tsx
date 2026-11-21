import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import { Badge, formatDate, formatPrice, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { settleRoute } from "@/app/actions";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Liquidaciones" };

export default function SettlementsPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Liquidaciones de efectivo">
        Al terminar su ruta, cada repartidor entrega el efectivo que cobró. Cuente el dinero delante
        de él y registre aquí el monto real.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Settlements />
        </Suspense>
      </div>
    </div>
  );
}

async function Settlements() {
  await requireStaff("/liquidaciones", ["ops", "finance"]);
  const all = await (await sessionApi()).opsSettlements(null);
  const open = all.filter((row) => row.status === "open");
  const closed = all.filter((row) => row.status !== "open").slice(0, 30);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="abiertas">
        <h2 id="abiertas" className="text-xl font-bold">
          Por liquidar ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No hay rutas con efectivo pendiente.</p>
        ) : (
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {open.map((row) => (
              <li key={row.route_id} className="rounded-lg border border-border bg-surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold">{row.route_code}</h3>
                  <p className="text-sm text-ink-muted">{formatDate(row.service_date)}</p>
                </div>
                <p className="text-sm">{row.driver_name}</p>
                <p className="mt-3 text-sm text-ink-muted">Debe entregar</p>
                <p className="font-display text-2xl font-bold tabular-nums">
                  {formatPrice(row.cod_expected_minor)}
                </p>
                <div className="mt-4">
                  <ActionForm
                    action={settleRoute}
                    submit="Registrar liquidación"
                    pendingLabel="Registrando…"
                    hideOnSuccess
                  >
                    <input type="hidden" name="routeId" value={row.route_id} />
                    <TextField
                      label="Efectivo recibido (₡)"
                      name="handed"
                      inputMode="decimal"
                      placeholder="21 900"
                    />
                    <TextField
                      label="Nota"
                      name="note"
                      optional
                      hint="Obligatoria si el monto no coincide: explique la diferencia."
                    />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cerradas">
        <h2 id="cerradas" className="text-xl font-bold">
          Liquidadas recientemente
        </h2>
        <div className="mt-3">
          {closed.length === 0 ? (
            <p className="text-sm text-ink-muted">Todavía no hay liquidaciones registradas.</p>
          ) : (
            <DataTable
              caption="Liquidaciones recientes"
              head={["Ruta", "Repartidor", "Debía entregar", "Entregó", "Resultado"]}
            >
              {closed.map((row) => (
                <tr key={row.route_id}>
                  <td>
                    <p className="font-semibold">{row.route_code}</p>
                    <p className="text-xs text-ink-muted">
                      {formatDate(row.service_date, { day: "numeric", month: "short" })}
                    </p>
                  </td>
                  <td>{row.driver_name}</td>
                  <td className="tabular-nums">{formatPrice(row.cod_expected_minor)}</td>
                  <td className="tabular-nums">
                    {row.cod_handed_minor === null ? "—" : formatPrice(row.cod_handed_minor)}
                  </td>
                  <td>
                    <Badge tone={row.status === "short" ? "danger" : "success"}>
                      {row.status === "short" ? "Con diferencia" : "Completa"}
                    </Badge>
                    {row.note ? (
                      <p className="mt-1 max-w-56 text-xs text-ink-muted">{row.note}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </section>
    </div>
  );
}
