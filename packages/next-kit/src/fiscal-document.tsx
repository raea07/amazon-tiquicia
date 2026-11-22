import type { InvoiceDetail, InvoiceRow, InvoiceStatus } from "@yuntera/db";
import {
  DOCUMENT_NAME,
  ID_TYPE,
  IVA_RATE,
  PAYMENT_METHOD,
  REFERENCE_CODE,
  REFERENCE_TYPE,
  SALE_CONDITION,
  UNIT,
} from "@yuntera/invoicing/codes";
import { Badge, formatDateTime, type Tone } from "@yuntera/ui";

// The rules for what a shopper types for a factura (the database applies the same).
export { cleanText, HACIENDA_EMAIL } from "@yuntera/invoicing/codes";

import type { Route } from "next";
import Link from "next/link";

/**
 * The readable representation of an electronic invoice (research note 5.7:
 * legible, the document type, clave and consecutive number shown together,
 * descriptions instead of bare codes). The XML itself is the legal document;
 * this page is how people read it, and it links to both files.
 */

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  pending: { label: "Preparándose para Hacienda", tone: "info" },
  sent: { label: "Enviado, esperando a Hacienda", tone: "info" },
  accepted: { label: "Aceptado por Hacienda", tone: "success" },
  rejected: { label: "Rechazado por Hacienda", tone: "danger" },
  voided: { label: "Anulado con nota de crédito", tone: "neutral" },
};

export const INVOICE_KIND: Record<InvoiceRow["kind"], string> = {
  delivery: "Entrega a domicilio",
  fees: "Cargos de Yuntera",
  credit: "Devolución",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = INVOICE_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** "Factura electrónica 00100001010000000027". */
export const invoiceTitle = (row: Pick<InvoiceRow, "document_type" | "consecutivo">) =>
  `${DOCUMENT_NAME[row.document_type] ?? "Comprobante"} ${row.consecutivo}`;

const money = new Intl.NumberFormat("es-CR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 5,
});
/** An amount as the document states it, up to five decimals, in colones. */
export const formatInvoiceAmount = (value: string) => `₡${money.format(Number(value))}`;

/** The clave in groups, so a person can read it out or compare it. */
export const groupedClave = (clave: string) => clave.replace(/(.{10})(?=.)/g, "$1 ");

function Party({
  title,
  party,
}: {
  title: string;
  party: { name: string; id_type: string; id_number: string } | null;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 text-sm">
      <h2 className="font-semibold">{title}</h2>
      {party ? (
        <>
          <p className="mt-1">{party.name}</p>
          <p className="text-ink-muted">
            {ID_TYPE[party.id_type] ?? "Identificación"} {party.id_number}
          </p>
        </>
      ) : (
        <p className="mt-1 text-ink-muted">Consumidor final (sin identificación)</p>
      )}
    </section>
  );
}

export function FiscalDocumentView({
  doc,
  filesBase,
}: {
  doc: InvoiceDetail;
  /** Where the files are served: `${filesBase}/xml` and `${filesBase}/respuesta`. */
  filesBase: string;
}) {
  const statusNote =
    doc.status === "pending" || doc.status === "sent"
      ? "Este comprobante ya es válido para usted. Hacienda lo revisa y responde en un plazo de hasta tres horas; su respuesta aparecerá aquí."
      : doc.status === "rejected"
        ? doc.replaced_by
          ? doc.rejection_source === "local"
            ? "Este comprobante no llegó a enviarse a Hacienda y no tiene validez. Lo reemplaza el que se indica abajo."
            : "Hacienda rechazó este comprobante, así que no tiene validez. Emitimos uno nuevo que lo reemplaza."
          : "Hacienda rechazó este comprobante, así que no tiene validez. Estamos corrigiéndolo: el comprobante nuevo aparecerá en esta misma sección del pedido."
        : doc.status === "voided"
          ? "Este comprobante quedó anulado por una nota de crédito."
          : null;

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-3xl">
            {DOCUMENT_NAME[doc.document_type] ?? "Comprobante electrónico"}
          </h1>
          <InvoiceStatusBadge status={doc.status} />
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-ink-muted">Número consecutivo</dt>
          <dd className="font-semibold tabular-nums">{doc.consecutivo}</dd>
          <dt className="text-ink-muted">Clave</dt>
          <dd className="break-all font-mono text-xs tabular-nums">{groupedClave(doc.clave)}</dd>
          <dt className="text-ink-muted">Fecha de emisión</dt>
          <dd>{formatDateTime(doc.issued_at)}</dd>
          {doc.order_number ? (
            <>
              <dt className="text-ink-muted">Pedido</dt>
              <dd>{doc.order_number}</dd>
            </>
          ) : null}
          <dt className="text-ink-muted">Condición de venta</dt>
          <dd>{SALE_CONDITION[doc.sale_condition] ?? doc.sale_condition}</dd>
        </dl>
        {statusNote ? <p className="max-w-2xl text-sm text-ink-muted">{statusNote}</p> : null}
        {doc.status === "rejected" && doc.hacienda_message ? (
          <p className="max-w-2xl text-sm">
            <span className="font-semibold">Motivo de Hacienda:</span> {doc.hacienda_message}
          </p>
        ) : null}
        {doc.replaced_by ? (
          <p className="text-sm">
            Lo reemplaza el comprobante{" "}
            <Link
              href={`${filesBase.replace(/\/[^/]+$/, "")}/${doc.replaced_by.id}` as Route}
              className="text-link underline"
            >
              {doc.replaced_by.consecutivo}
            </Link>
            .
          </p>
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Party
          title="Emisor"
          party={{
            name: doc.issuer.commercial_name
              ? `${doc.issuer.name} (${doc.issuer.commercial_name})`
              : doc.issuer.name,
            id_type: doc.issuer.id_type,
            id_number: doc.issuer.id_number,
          }}
        />
        <Party title="Receptor" party={doc.receiver} />
      </div>

      <section aria-labelledby="detalle-comprobante">
        <h2 id="detalle-comprobante" className="text-lg font-bold">
          Detalle
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {doc.lines.map((line) => (
            <li
              key={line.number}
              className="rounded-lg border border-border bg-surface p-4 text-sm"
            >
              <p className="font-semibold">{line.description}</p>
              <p className="text-xs text-ink-muted">
                Código CABYS {line.cabys} · {UNIT[line.unit] ?? line.unit} · Cantidad{" "}
                {Number(line.quantity)}
              </p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
                <dt>Precio sin IVA</dt>
                <dd className="text-right">{formatInvoiceAmount(line.subtotal)}</dd>
                <dt>
                  IVA {IVA_RATE[line.tax.tarifa_code]?.name.toLowerCase() ?? `${line.tax.rate} %`}
                </dt>
                <dd className="text-right">{formatInvoiceAmount(line.net_tax)}</dd>
                <dt className="font-semibold">Total de la línea</dt>
                <dd className="text-right font-semibold">{formatInvoiceAmount(line.line_total)}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="resumen-comprobante" className="sm:max-w-md">
        <h2 id="resumen-comprobante" className="text-lg font-bold">
          Resumen
        </h2>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
          <dt>Total de la venta neta</dt>
          <dd className="text-right">{formatInvoiceAmount(doc.summary.total_net)}</dd>
          <dt>Total de impuestos</dt>
          <dd className="text-right">{formatInvoiceAmount(doc.summary.total_tax ?? "0")}</dd>
          <dt className="font-bold">Total del comprobante</dt>
          <dd className="text-right font-bold">{formatInvoiceAmount(doc.summary.total)}</dd>
          {doc.payments.map((payment) => (
            <div key={payment.code} className="contents text-ink-muted">
              <dt>
                Pago: {PAYMENT_METHOD[payment.code] ?? payment.code}
                {payment.other ? ` (${payment.other})` : ""}
              </dt>
              <dd className="text-right">{formatInvoiceAmount(payment.amount)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-ink-muted">Moneda: colones costarricenses (CRC).</p>
      </section>

      {doc.references.length > 0 ? (
        <section aria-labelledby="referencias-comprobante">
          <h2 id="referencias-comprobante" className="text-lg font-bold">
            Documento de referencia
          </h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {doc.references.map((reference) => (
              <li
                key={`${reference.type}-${reference.number}`}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <p className="font-semibold">
                  {REFERENCE_CODE[reference.code] ?? reference.code}:{" "}
                  {REFERENCE_TYPE[reference.type] ?? reference.type}
                </p>
                <p className="break-all font-mono text-xs">{groupedClave(reference.number)}</p>
                <p className="text-ink-muted">
                  Emitido el {formatDateTime(reference.issued_at)}. {reference.reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="archivos-comprobante" className="flex flex-col gap-2">
        <h2 id="archivos-comprobante" className="text-lg font-bold">
          Archivos
        </h2>
        <div className="flex flex-wrap gap-3">
          {doc.has_xml ? (
            <a
              href={`${filesBase}/xml`}
              className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-4 font-semibold text-link hover:bg-surface-muted"
            >
              Descargar el comprobante (XML)
            </a>
          ) : (
            <p className="text-sm text-ink-muted">
              El archivo firmado estará listo en unos segundos.
            </p>
          )}
          {doc.has_response ? (
            <a
              href={`${filesBase}/respuesta`}
              className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-4 font-semibold text-link hover:bg-surface-muted"
            >
              Descargar la respuesta de Hacienda (XML)
            </a>
          ) : null}
        </div>
        <p className="max-w-2xl text-xs text-ink-muted">
          El archivo XML firmado es el comprobante legal; esta página es su representación para
          leerlo. Consérvelo si lo necesita para su contabilidad.
        </p>
      </section>
    </article>
  );
}
