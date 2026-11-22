import type { GatewayRefund } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import { Badge, formatDateTime, formatPrice, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { recordRefundTransfer, retryGatewayRefund } from "@/app/payment-actions";
import { PaymentNav } from "@/components/payment-nav";
import { PAYMENT_METHOD } from "@/lib/labels";
import { REFUND_CHANNEL, REFUND_REASON, REFUND_STATUS } from "@/lib/payment-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Reembolsos" };

export default function RefundsPage({ searchParams }: PageProps<"/cobros/reembolsos">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Reembolsos">
        Cada reembolso que se pidió, hasta que el dinero llega al cliente. Solo cuenta como
        completado cuando el procesador lo confirma, o cuando usted registra la transferencia.
      </PageHeader>
      <PaymentNav current="/cobros/reembolsos" />
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Refunds searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Refunds({ searchParams }: Pick<PageProps<"/cobros/reembolsos">, "searchParams">) {
  await requireStaff("/cobros/reembolsos", ["finance"]);
  const params = await searchParams;
  const all = params.todos === "1";
  const api = await sessionApi();
  const refunds = await api.opsGatewayRefunds(!all);
  const toDo = refunds.filter((refund) => refund.can_record_transfer || refund.can_retry);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="hacer">
        <h2 id="hacer" className="text-xl font-bold">
          Necesitan a finanzas ({toDo.length})
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Los de contra entrega y los de transferencias confirmadas a mano se pagan por
          transferencia: contacte al cliente para pedirle la cuenta, haga la transferencia y
          registre el comprobante. Uno que el procesador rechazó se puede enviar otra vez o pagar
          por transferencia.
        </p>
        {toDo.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nada pendiente para usted.</p>
        ) : (
          <ul className="mt-4 grid gap-4 lg:grid-cols-2">
            {toDo.map((refund) => (
              <RefundCard key={refund.id} refund={refund} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="todos">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="todos" className="text-xl font-bold">
            {all ? "Todos los reembolsos" : "En curso"}
          </h2>
          <Link
            href={(all ? "/cobros/reembolsos" : "/cobros/reembolsos?todos=1") as Route}
            className="text-link underline"
          >
            {all ? "Ver solo los que están en curso" : "Ver también los completados"}
          </Link>
        </div>
        {refunds.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No hay reembolsos en curso.</p>
        ) : (
          <div className="mt-3">
            <DataTable
              caption="Reembolsos"
              head={["Pedido", "Motivo", "Monto", "Cómo", "Estado", "Referencia", "Fechas"]}
            >
              {refunds.map((refund) => {
                const status = REFUND_STATUS[refund.status];
                return (
                  <tr key={refund.id} data-testid="refund-row">
                    <td>
                      {refund.order_number ? (
                        <Link
                          href={`/pedidos/${refund.order_number}` as Route}
                          className="text-link underline"
                        >
                          {refund.order_number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {REFUND_REASON[refund.reason]}
                      {refund.payment_method ? (
                        <span className="block text-xs text-ink-muted">
                          {PAYMENT_METHOD[refund.payment_method]}
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular-nums">{formatPrice(refund.amount_minor)}</td>
                    <td>{REFUND_CHANNEL[refund.channel]}</td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {refund.failure_code ? (
                        <span className="block text-xs text-ink-muted">
                          Motivo: {refund.failure_code}
                        </span>
                      ) : null}
                    </td>
                    <td className="break-all text-xs">
                      {refund.provider_refund_reference ?? refund.bank_reference ?? "—"}
                    </td>
                    <td className="text-xs">
                      Pedido {formatDateTime(refund.requested_at)}
                      {refund.sent_at ? (
                        <span className="block">Enviado {formatDateTime(refund.sent_at)}</span>
                      ) : null}
                      {refund.completed_at ? (
                        <span className="block">
                          Completado {formatDateTime(refund.completed_at)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}

function RefundCard({ refund }: { refund: GatewayRefund }) {
  const status = REFUND_STATUS[refund.status];
  return (
    <li
      className="rounded-lg border border-warning bg-surface p-5 text-sm"
      data-testid="refund-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">
          {refund.order_number ?? "Sin pedido"} · {REFUND_REASON[refund.reason]}
        </h3>
        <span className="font-semibold tabular-nums">{formatPrice(refund.amount_minor)}</span>
      </div>
      <p className="mt-1">
        <Badge tone={status.tone}>{status.label}</Badge> {REFUND_CHANNEL[refund.channel]}
        {refund.failure_code ? ` · motivo del procesador: ${refund.failure_code}` : ""}
      </p>
      {refund.can_retry ? (
        <div className="mt-3">
          <ActionForm
            action={retryGatewayRefund}
            submit="Enviar otra vez al procesador"
            variant="secondary"
            pendingLabel="Enviando…"
            hideOnSuccess
          >
            <input type="hidden" name="refundId" value={refund.id} />
          </ActionForm>
        </div>
      ) : null}
      {refund.can_record_transfer ? (
        <details className="mt-3" open={refund.channel === "transfer"}>
          <summary className="cursor-pointer py-2 font-semibold text-link">Ya lo transferí</summary>
          <ActionForm
            action={recordRefundTransfer}
            submit="Registrar la transferencia"
            pendingLabel="Registrando…"
            hideOnSuccess
          >
            <input type="hidden" name="refundId" value={refund.id} />
            <TextField
              label="Comprobante del banco"
              name="bankReference"
              hint="El número de referencia que muestra el banco para esa transferencia."
            />
            <TextField
              label="Nota"
              name="note"
              optional
              hint="Por ejemplo, a qué cuenta se envió."
            />
          </ActionForm>
        </details>
      ) : null}
    </li>
  );
}
