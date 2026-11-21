import { ActionForm, DecisionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, formatDate, formatDateTime, formatPrice, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { completeReturn, decideReturn, resolveComplaint, resolveReport } from "@/app/actions";
import { COMPLAINT_CATEGORY, REPORT_REASON, RETURN_KIND, RETURN_STATUS } from "@/lib/labels";
import { canSee, requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Atención" };

export default function CarePage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Atención al cliente">
        Devoluciones, reclamos y reportes de contenido, del más antiguo al más reciente. Lo que
        usted escribe como respuesta lo lee la persona que hizo el reclamo.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Queues />
        </Suspense>
      </div>
    </div>
  );
}

function OrderLink({ number }: { number: string | null }) {
  if (!number) return null;
  return (
    <Link href={`/pedidos/${number}` as Route} className="text-link underline">
      {number}
    </Link>
  );
}

async function Queues() {
  const staff = await requireStaff("/atencion", ["support", "ops", "finance", "catalog"]);
  const { returns, complaints, reports } = await (await sessionApi()).opsCareQueues();
  const canDecide = canSee(staff.staff_role, ["support", "ops"]);
  const canRefund = canSee(staff.staff_role, ["finance", "support"]);
  const canModerate = canSee(staff.staff_role, ["catalog", "support", "ops"]);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="devoluciones">
        <h2 id="devoluciones" className="text-xl font-bold">
          Devoluciones ({returns.length})
        </h2>
        {returns.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No hay devoluciones pendientes.</p>
        ) : (
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {returns.map((item) => {
              const status = RETURN_STATUS[item.status];
              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-border bg-surface p-5 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{RETURN_KIND[item.kind]}</p>
                    <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? item.status}</Badge>
                  </div>
                  <p className="mt-2">
                    {item.quantity} × {item.title}
                  </p>
                  <p className="text-ink-muted">
                    <OrderLink number={item.order_number} /> · {item.customer ?? "Cliente"} ·
                    vendido por {item.seller_name ?? "—"}
                  </p>
                  {item.reason ? (
                    <p className="mt-2 rounded-md bg-surface-muted p-3">“{item.reason}”</p>
                  ) : null}
                  <p className="mt-2">
                    A reembolsar:{" "}
                    <span className="font-semibold tabular-nums">
                      {formatPrice(item.amount_minor)}
                    </span>
                    {item.refund_due_on ? (
                      <span className="text-warning">
                        {" "}
                        · antes del {formatDate(item.refund_due_on)}
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-4 border-t border-border pt-4">
                    {item.status === "requested" ? (
                      canDecide ? (
                        <DecisionForm
                          action={decideReturn}
                          noteLabel="Nota para el cliente"
                          noteHint="Obligatoria si la rechaza: explique por qué."
                          yes="Aprobar"
                          no="Rechazar"
                        >
                          <input type="hidden" name="returnId" value={item.id} />
                        </DecisionForm>
                      ) : (
                        <p className="text-ink-muted">La decide Atención al cliente.</p>
                      )
                    ) : canRefund ? (
                      <ActionForm
                        action={completeReturn}
                        submit={`Registrar reembolso de ${formatPrice(item.amount_minor)}`}
                        pendingLabel="Registrando…"
                        hideOnSuccess
                      >
                        <input type="hidden" name="returnId" value={item.id} />
                        <TextField
                          label="Nota"
                          name="note"
                          optional
                          hint="Por ejemplo, el comprobante de la transferencia de reembolso."
                        />
                      </ActionForm>
                    ) : (
                      <p className="text-ink-muted">El reembolso lo registra Finanzas.</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="reclamos">
        <h2 id="reclamos" className="text-xl font-bold">
          Reclamos ({complaints.length})
        </h2>
        {complaints.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No hay reclamos abiertos.</p>
        ) : (
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {complaints.map((item) => (
              <li key={item.id} className="rounded-lg border border-border bg-surface p-5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{COMPLAINT_CATEGORY[item.category]}</p>
                  <Badge tone={item.status === "in_progress" ? "info" : "warning"}>
                    {item.status === "in_progress" ? "En curso" : "Sin responder"}
                  </Badge>
                </div>
                <p className="text-ink-muted">
                  {item.customer ?? "Cliente"} · {formatDateTime(item.created_at)}
                  {item.order_number ? " · " : ""}
                  <OrderLink number={item.order_number} />
                </p>
                <p className="mt-2 rounded-md bg-surface-muted p-3">“{item.description}”</p>
                {canDecide ? (
                  <div className="mt-4 border-t border-border pt-4">
                    <DecisionForm
                      action={resolveComplaint}
                      noteLabel="Respuesta al cliente"
                      noteOptional={false}
                      yes="Responder y cerrar"
                      no="Responder y dejar abierto"
                    >
                      <input type="hidden" name="complaintId" value={item.id} />
                    </DecisionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="reportes">
        <h2 id="reportes" className="text-xl font-bold">
          Reportes de contenido ({reports.length})
        </h2>
        {reports.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No hay reportes por atender.</p>
        ) : (
          <ul className="mt-3 grid gap-4 lg:grid-cols-2">
            {reports.map((item) => (
              <li key={item.id} className="rounded-lg border border-border bg-surface p-5 text-sm">
                <p className="font-semibold">{REPORT_REASON[item.reason]}</p>
                <p className="text-ink-muted">
                  {item.target_type === "product"
                    ? "Producto"
                    : item.target_type === "review"
                      ? "Reseña"
                      : "Vendedor"}
                  : {item.target_label ?? "ya no existe"} · {formatDateTime(item.created_at)}
                </p>
                {item.details ? (
                  <p className="mt-2 rounded-md bg-surface-muted p-3">“{item.details}”</p>
                ) : null}
                {canModerate ? (
                  <div className="mt-4 border-t border-border pt-4">
                    <DecisionForm
                      action={resolveReport}
                      noteLabel="Motivo de la decisión"
                      noteHint={
                        item.target_type === "seller"
                          ? "Para suspender a un vendedor use la sección Vendedores; aquí solo se cierra el reporte."
                          : "Si retira el contenido, el vendedor ve este motivo."
                      }
                      noteOptional={false}
                      yes={item.target_type === "seller" ? "Atendido" : "Retirar el contenido"}
                      no="Descartar el reporte"
                    >
                      <input type="hidden" name="reportId" value={item.id} />
                    </DecisionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
