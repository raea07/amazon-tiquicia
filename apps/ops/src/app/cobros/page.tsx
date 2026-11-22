import { toCostaRicaTime } from "@yuntera/core";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader, Stat } from "@yuntera/next-kit/shell";
import {
  Alert,
  Badge,
  buttonClass,
  formatDateTime,
  formatPrice,
  Skeleton,
  TextField,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { recordPaymentFee } from "@/app/payment-actions";
import { PaymentNav } from "@/components/payment-nav";
import { PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/labels";
import { EVENT_OUTCOME, MODE } from "@/lib/payment-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Cobros" };

export default function PaymentsPage({ searchParams }: PageProps<"/cobros">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Cobros">
        Lo que entró por el procesador de pagos en un día, con sus referencias y comisiones, y si
        cuadra.
      </PageHeader>
      <PaymentNav current="/cobros" />
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Day searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

const fee = (value: number | null) => (value === null ? "—" : formatPrice(value));

async function Day({ searchParams }: Pick<PageProps<"/cobros">, "searchParams">) {
  await requireStaff("/cobros", ["finance"]);
  const params = await searchParams;
  const asked = Array.isArray(params.dia) ? params.dia[0] : params.dia;
  await connection();
  const today = toCostaRicaTime(new Date()).date;
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;

  const api = await sessionApi();
  const [recon, payments] = await Promise.all([
    api.opsPaymentReconciliation(day),
    api.opsPayments(day),
  ]);
  const gatewayRows = payments.filter((row) => row.gateway_reference || row.attempts > 0);
  const expected = recon.captured.reduce((sum, row) => sum + row.expected_fee_minor, 0);
  const reported = recon.captured.reduce((sum, row) => sum + row.reported_fee_minor, 0);
  const missing = recon.captured.reduce((sum, row) => sum + row.fees_missing, 0);

  return (
    <div className="flex flex-col gap-10">
      {recon.mode !== "live" ? (
        <Alert tone="info" title={`Modo de pagos: ${MODE[recon.mode].label}`}>
          {MODE[recon.mode].text}
        </Alert>
      ) : null}

      <form className="flex flex-wrap items-end gap-3" method="get">
        <TextField label="Día" name="dia" type="date" defaultValue={day} max={today} />
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Ver ese día
        </button>
      </form>

      <section aria-labelledby="cuadre">
        <h2 id="cuadre" className="text-xl font-bold">
          Cuadre del {day}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Cobrado"
            value={formatPrice(recon.captured.reduce((sum, row) => sum + row.amount_minor, 0))}
            hint={`${recon.captured.reduce((sum, row) => sum + row.count, 0)} pagos`}
          />
          <Stat
            label="Comisión del procesador"
            value={formatPrice(reported)}
            hint={`Esperada ${formatPrice(expected)}${missing > 0 ? ` · ${missing} sin reportar` : ""}`}
            tone={missing > 0 ? "warning" : undefined}
          />
          <Stat
            label="Reembolsos completados"
            value={formatPrice(recon.refunds_completed.amount_minor)}
            hint={`${recon.refunds_completed.count} en el día`}
          />
          <Stat
            label="Por revisar"
            value={recon.reviews_open.count}
            hint={
              <Link href="/cobros/revision" className="text-link underline">
                Resolver
              </Link>
            }
            tone={recon.reviews_open.count > 0 ? "warning" : undefined}
          />
          <Stat
            label="Reembolsos en curso"
            value={recon.refunds_open.count}
            hint={
              <Link href="/cobros/reembolsos" className="text-link underline">
                {recon.refunds_open.failed > 0 ? `${recon.refunds_open.failed} fallaron` : "Ver"}
              </Link>
            }
            tone={recon.refunds_open.failed > 0 ? "danger" : undefined}
          />
          <Stat
            label="Intentos de pago"
            value={recon.attempts.created}
            hint={`${recon.attempts.succeeded} pagados · ${recon.attempts.failed} rechazados · ${recon.attempts.waiting} esperando`}
          />
          <Stat
            label="Verificados por consulta"
            value={recon.attempts.checked_by_worker}
            hint="Intentos sin aviso que el sistema consultó al procesador"
          />
          <Stat
            label="Debe la pasarela (libro)"
            value={formatPrice(recon.ledger.gateway_clearing_minor)}
            hint={`Reembolsos por pagar ${formatPrice(recon.ledger.refunds_payable_minor)}`}
          />
        </div>

        {recon.captured.length > 0 ? (
          <div className="mt-4">
            <DataTable
              caption="Cobrado por medio de pago"
              head={[
                "Medio",
                "Procesador",
                "Pagos",
                "Monto",
                "Comisión esperada",
                "Comisión reportada",
              ]}
            >
              {recon.captured.map((row) => (
                <tr key={`${row.method}-${row.provider}`}>
                  <td>{PAYMENT_METHOD[row.method]}</td>
                  <td>{row.provider}</td>
                  <td className="tabular-nums">{row.count}</td>
                  <td className="tabular-nums">{formatPrice(row.amount_minor)}</td>
                  <td className="tabular-nums">{formatPrice(row.expected_fee_minor)}</td>
                  <td className="tabular-nums">
                    {formatPrice(row.reported_fee_minor)}
                    {row.fees_missing > 0 ? ` (${row.fees_missing} sin reportar)` : ""}
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        ) : null}

        {recon.events.length > 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Avisos del procesador recibidos:{" "}
            {recon.events
              .map((event) => `${EVENT_OUTCOME[event.outcome] ?? event.outcome} ${event.count}`)
              .join(" · ")}
            .
          </p>
        ) : null}
      </section>

      <section aria-labelledby="pagos">
        <h2 id="pagos" className="text-xl font-bold">
          Pagos por el procesador ({gatewayRows.length})
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          La comisión esperada sale del ajuste «comisión esperada» (Modo y comisiones). Si el
          procesador no la reporta, regístrela desde su estado de cuenta.
        </p>
        {gatewayRows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No hubo pagos por el procesador este día.</p>
        ) : (
          <div className="mt-3">
            <DataTable
              caption="Pagos por el procesador"
              head={["Pedido", "Medio", "Estado", "Monto", "Referencia", "Comisión", "Diferencia"]}
            >
              {gatewayRows.map((row) => {
                const status = PAYMENT_STATUS[row.status];
                return (
                  <tr key={row.id}>
                    <td>
                      <Link
                        href={`/pedidos/${row.order_number}` as Route}
                        className="text-link underline"
                      >
                        {row.order_number}
                      </Link>
                      <span className="block text-xs text-ink-muted">
                        {formatDateTime(row.captured_at ?? row.created_at)}
                      </span>
                    </td>
                    <td>
                      {PAYMENT_METHOD[row.method]}
                      <span className="block text-xs text-ink-muted">
                        {row.environment === "test"
                          ? "Pruebas"
                          : row.environment === "live"
                            ? "Real"
                            : ""}
                        {row.attempts > 1 ? ` · ${row.attempts} intentos` : ""}
                      </span>
                    </td>
                    <td>
                      {status ? <Badge tone={status.tone}>{status.label}</Badge> : row.status}
                    </td>
                    <td className="tabular-nums">{formatPrice(row.amount_minor)}</td>
                    <td className="break-all text-xs">
                      {row.gateway_reference ?? row.provider_reference ?? "—"}
                      {row.session_reference ? (
                        <span className="block text-ink-muted">Sesión {row.session_reference}</span>
                      ) : null}
                    </td>
                    <td className="tabular-nums">
                      {fee(row.reported_fee_minor)}
                      <span className="block text-xs text-ink-muted">
                        Esperada {fee(row.expected_fee_minor)}
                        {row.fee_source === "statement" ? " · del estado de cuenta" : ""}
                      </span>
                      {row.can_record_fee ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer py-2 text-link">Registrar</summary>
                          <ActionForm
                            action={recordPaymentFee}
                            submit="Guardar comisión"
                            pendingLabel="Guardando…"
                            size="sm"
                            hideOnSuccess
                          >
                            <input type="hidden" name="paymentId" value={row.id} />
                            <TextField
                              label="Comisión cobrada (₡)"
                              name="fee"
                              inputMode="decimal"
                            />
                          </ActionForm>
                        </details>
                      ) : null}
                    </td>
                    <td className="tabular-nums">
                      {row.fee_difference_minor === null
                        ? "—"
                        : formatPrice(row.fee_difference_minor)}
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
