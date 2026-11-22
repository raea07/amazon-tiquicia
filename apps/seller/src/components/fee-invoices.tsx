import type { InvoiceRow } from "@yuntera/db";
import { INVOICE_KIND, InvoiceStatusBadge, invoiceTitle } from "@yuntera/next-kit/fiscal-document";
import { sessionApi } from "@yuntera/next-kit/server";
import { EmptyState, formatDate, formatPrice } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";

/**
 * The electronic facturas Yuntera issues to the shop for its fees on each
 * sale, and the credit notes when a fee goes back (a cancelled order, the
 * commission on a return). The shop needs Hacienda's acceptance to use their
 * IVA as a credit.
 */
export async function FeeInvoices({ shopId }: { shopId: string }) {
  const invoices: InvoiceRow[] = await (await sessionApi()).sellerFeeInvoices(shopId, 100);
  return (
    <section aria-labelledby="facturas">
      <h2 id="facturas" className="text-xl font-bold">
        Facturas de Yuntera por sus cargos
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">
        Por cada venta le emitimos una factura electrónica con la comisión, la bodega y el cobro, y
        una nota de crédito cuando le devolvemos un cargo. Con la factura aceptada por Hacienda
        puede usar ese IVA como crédito fiscal.
      </p>
      <div className="mt-3">
        {invoices.length === 0 ? (
          <EmptyState title="Aún no hay facturas">
            La factura de una venta aparece aquí unos minutos después de que el pago del comprador
            queda confirmado.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold break-all">{invoiceTitle(invoice)}</p>
                  <p className="text-xs text-ink-muted">
                    {INVOICE_KIND[invoice.kind]}
                    {invoice.order_number ? ` · pedido ${invoice.order_number}` : ""} ·{" "}
                    {formatDate(invoice.issued_at, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold tabular-nums">
                    {invoice.kind === "credit" ? "− " : ""}
                    {formatPrice(invoice.total_minor)}
                  </span>
                  <InvoiceStatusBadge status={invoice.status} />
                  <Link
                    href={`/comprobantes/${invoice.id}` as Route}
                    className="inline-flex min-h-11 items-center font-semibold text-link underline"
                  >
                    Ver
                  </Link>
                  {invoice.has_xml ? (
                    <a
                      href={`/comprobantes/${invoice.id}/xml`}
                      className="inline-flex min-h-11 items-center text-link underline"
                    >
                      XML
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
