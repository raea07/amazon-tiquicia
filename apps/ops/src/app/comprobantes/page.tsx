import type { InvoiceRow, InvoiceStatus, OpsInvoices } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import {
  INVOICE_KIND,
  INVOICE_STATUS,
  InvoiceStatusBadge,
  invoiceTitle,
} from "@yuntera/next-kit/fiscal-document";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader, Stat } from "@yuntera/next-kit/shell";
import { Alert, EmptyState, formatDate, formatDateTime, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { replaceInvoice, retryInvoice } from "@/app/invoice-actions";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Comprobantes electrónicos" };

const STATUSES = Object.keys(INVOICE_STATUS) as InvoiceStatus[];
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** What went wrong with a send, in words; never the code itself. */
const TRANSPORT: Record<string, string> = {
  network: "Hacienda no respondió (sin conexión o tiempo agotado).",
  unauthorized: "Hacienda no aceptó el usuario o la contraseña del API.",
  http_403: "Hacienda respondió que la dirección no existe: revise la configuración del API.",
  http_429: "Hacienda pidió esperar por exceso de envíos.",
  worker_error: "El sistema de envío tuvo un error inesperado.",
};
const transportOf = (code: string | null) =>
  !code
    ? "Todavía no se ha intentado enviar."
    : (TRANSPORT[code] ??
      (/^http_5\d\d$/.test(code)
        ? "Hacienda no está disponible en este momento."
        : "No se pudo enviar."));

const hoursSince = (iso: string | null) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)) : 0;

export default function InvoicesPage({ searchParams }: PageProps<"/comprobantes">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Comprobantes electrónicos">
        Los tiquetes, facturas y notas de crédito que Yuntera emite a compradores y vendedores, y
        dónde está cada uno ante Hacienda.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Invoices searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

function Row({ row, children }: { row: InvoiceRow; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="min-w-0">
          <Link
            href={`/comprobantes/${row.id}` as Route}
            className="font-semibold break-all text-link underline"
          >
            {invoiceTitle(row)}
          </Link>
          <span className="block text-xs text-ink-muted">
            {INVOICE_KIND[row.kind]} · {row.seller_name ?? row.receiver_name ?? "Consumidor final"}
            {row.order_number ? ` · pedido ${row.order_number}` : ""} ·{" "}
            {formatDateTime(row.issued_at)} · {formatPrice(row.total_minor)}
          </span>
        </span>
        <InvoiceStatusBadge status={row.status} />
      </div>
      {children}
    </li>
  );
}

async function Invoices({ searchParams }: Pick<PageProps<"/comprobantes">, "searchParams">) {
  await requireStaff("/comprobantes", ["finance"]);
  const query = await searchParams;
  const status = STATUSES.find((candidate) => candidate === one(query.estado)) ?? null;
  const data: OpsInvoices = await (await sessionApi()).opsInvoices(status, 50);
  const certificateDays = data.worker?.certificate_not_after
    ? Math.floor((new Date(data.worker.certificate_not_after).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        {!data.issuer_ready ? (
          <Alert tone="warning" title="La facturación electrónica no está configurada">
            Faltan los datos de inscripción de la empresa en Hacienda. Mientras tanto no se emite
            ningún comprobante: los pagos esperan y se emitirán en orden cuando quede configurada.
          </Alert>
        ) : null}
        {data.paused_until ? (
          <Alert tone="danger" title="Envíos a Hacienda en pausa">
            Hacienda rechazó la configuración o las credenciales del API. No se envía nada hasta las{" "}
            {formatDateTime(data.paused_until)}. Revise la configuración del sistema de envío.
          </Alert>
        ) : null}
        {data.worker?.error ? (
          <Alert tone="danger" title="El sistema de envío no puede firmar">
            No pudo abrir la llave criptográfica. Revise la llave y su PIN en la configuración del
            servidor.
          </Alert>
        ) : null}
        {certificateDays !== null && certificateDays < 30 ? (
          <Alert
            tone={certificateDays < 7 ? "danger" : "warning"}
            title="La llave criptográfica vence pronto"
          >
            Vence el {formatDate(data.worker?.certificate_not_after ?? "")}. Genere una nueva en el
            portal de Hacienda y cámbiela antes de esa fecha; sin ella no se puede emitir.
          </Alert>
        ) : null}
        {data.failed_events > 0 ? (
          <Alert tone="warning" title="Pagos sin comprobante">
            {data.failed_events === 1
              ? "Un pago no pudo producir su comprobante"
              : `${data.failed_events} pagos no pudieron producir su comprobante`}
            , casi siempre porque a la tienda le faltan datos fiscales (razón social o
            identificación). Revise los datos de la tienda.
          </Alert>
        ) : null}
      </div>

      <section aria-labelledby="estado" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <h2 id="estado" className="sr-only">
          Comprobantes por estado
        </h2>
        <Stat label="Preparándose" value={data.counts.pending} />
        <Stat
          label="Esperando a Hacienda"
          value={data.counts.sent}
          tone={data.waiting.length > 0 ? "warning" : undefined}
        />
        <Stat label="Aceptados" value={data.counts.accepted} />
        <Stat
          label="Rechazados"
          value={data.counts.rejected}
          tone={data.counts.rejected > 0 ? "danger" : undefined}
        />
        <Stat label="Anulados" value={data.counts.voided} />
      </section>

      <section aria-labelledby="rechazados">
        <h2 id="rechazados" className="text-xl font-bold">
          Rechazados por Hacienda
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Un comprobante rechazado no tiene validez y no se corrige: se emite uno nuevo, con otro
          número, que lo reemplaza. Corrija primero la causa que indica Hacienda (por ejemplo, los
          datos fiscales de la tienda o de la empresa).
        </p>
        {data.rejected.length === 0 ? (
          <p className="mt-3 text-sm">No hay comprobantes rechazados por reemplazar.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.rejected.map((row) => (
              <Row key={row.id} row={row}>
                <p>
                  <span className="font-semibold">
                    {row.rejection_source === "reception"
                      ? "Hacienda no lo recibió:"
                      : "Motivo de Hacienda:"}
                  </span>{" "}
                  {row.hacienda_message ?? "Hacienda no indicó el motivo."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <ActionForm
                    action={replaceInvoice}
                    submit="Emitir reemplazo"
                    pendingLabel="Emitiendo…"
                    hideOnSuccess
                    className="flex flex-wrap items-center gap-3"
                  >
                    <input type="hidden" name="invoiceId" value={row.id} />
                  </ActionForm>
                  {row.kind === "delivery" && row.document_type === "01" ? (
                    <ActionForm
                      action={replaceInvoice}
                      submit="Reemplazar por un tiquete sin receptor"
                      variant="secondary"
                      pendingLabel="Emitiendo…"
                      hideOnSuccess
                      className="flex flex-wrap items-center gap-3"
                    >
                      <input type="hidden" name="invoiceId" value={row.id} />
                      <input type="hidden" name="asTicket" value="1" />
                    </ActionForm>
                  ) : null}
                </div>
              </Row>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="esperando">
        <h2 id="esperando" className="text-xl font-bold">
          Sin respuesta de Hacienda después de {data.answer_window_hours} horas
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Hacienda tiene hasta {data.answer_window_hours} horas para responder. Mientras no acepte
          una factura, quien la recibe no puede usar su IVA como crédito fiscal ni deducir el gasto:
          para una factura de cargos a una tienda, eso afecta a la tienda. Seguimos preguntando cada
          hora; si sigue así, consulte el estado del comprobante en el portal de Hacienda.
        </p>
        {data.waiting.length === 0 ? (
          <p className="mt-3 text-sm">
            Ninguno lleva más de {data.answer_window_hours} horas esperando.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.waiting.map((row) => (
              <Row key={row.id} row={row}>
                <p>Enviado hace {hoursSince(row.submitted_at)} horas.</p>
              </Row>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sin-enviar">
        <h2 id="sin-enviar" className="text-xl font-bold">
          Sin enviar
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Si Hacienda no está disponible, los comprobantes se guardan y se envían solos cuando
          vuelve (contingencia). Un comprobante detenido por las revisiones previas se reenvía
          después de corregir la causa.
        </p>
        {data.unsent.length === 0 ? (
          <p className="mt-3 text-sm">Todo lo emitido ya salió hacia Hacienda.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.unsent.map((row) => (
              <Row key={row.id} row={row}>
                <p>
                  {row.held_reason
                    ? "Detenido: no pasó las revisiones de montos y datos antes de firmarse."
                    : transportOf(row.last_error_code)}
                  {row.attempts > 0 ? ` ${row.attempts} intentos.` : ""}
                </p>
                <ActionForm
                  action={retryInvoice}
                  submit="Enviar ahora"
                  variant="secondary"
                  pendingLabel="Enviando…"
                  hideOnSuccess
                  className="flex flex-wrap items-center gap-3"
                >
                  <input type="hidden" name="invoiceId" value={row.id} />
                </ActionForm>
              </Row>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="por-dia">
        <h2 id="por-dia" className="text-xl font-bold">
          Por día
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Comprobantes emitidos cada día frente a los pedidos pagados ese día (hora de Costa Rica).
          Cada pedido pagado produce una factura por tienda y, si pagó la entrega, un tiquete o una
          factura al comprador.
        </p>
        <div className="mt-3">
          <DataTable
            caption="Comprobantes por día"
            head={[
              "Día",
              "Pedidos pagados",
              "Comprobantes",
              "Tiquetes",
              "Facturas",
              "Notas de crédito",
              "Aceptados",
              "Rechazados",
            ]}
          >
            {data.daily.map((day) => (
              <tr key={day.day}>
                <td>{formatDate(day.day, { weekday: "short", day: "numeric", month: "short" })}</td>
                <td className="tabular-nums">{day.paid_orders}</td>
                <td className="tabular-nums">{day.documents}</td>
                <td className="tabular-nums">{day.tiquetes}</td>
                <td className="tabular-nums">{day.facturas}</td>
                <td className="tabular-nums">{day.credit_notes}</td>
                <td className="tabular-nums">{day.accepted}</td>
                <td className="tabular-nums">{day.rejected}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      <section aria-labelledby="recientes">
        <h2 id="recientes" className="text-xl font-bold">
          Últimos comprobantes
        </h2>
        <nav aria-label="Filtrar por estado" className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link
            href="/comprobantes"
            className={`inline-flex min-h-11 items-center rounded-md border px-3 ${status === null ? "border-brand bg-brand-soft font-semibold" : "border-border"}`}
            aria-current={status === null ? "page" : undefined}
          >
            Todos
          </Link>
          {STATUSES.map((candidate) => (
            <Link
              key={candidate}
              href={`/comprobantes?estado=${candidate}` as Route}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 ${status === candidate ? "border-brand bg-brand-soft font-semibold" : "border-border"}`}
              aria-current={status === candidate ? "page" : undefined}
            >
              {INVOICE_STATUS[candidate].label}
            </Link>
          ))}
        </nav>
        {data.recent.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No hay comprobantes en este estado">
              Elija otro estado o vea todos.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.recent.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
