import type { InvoiceRow } from "@yuntera/db";
import { INVOICE_KIND, InvoiceStatusBadge, invoiceTitle } from "@yuntera/next-kit/fiscal-document";
import { formatDateTime, formatPrice } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";
import { sessionApi } from "@/lib/supabase";

/**
 * The electronic documents Yuntera issued to the shopper for an order: the
 * delivery fee's tiquete or factura, and credit notes when it was refunded.
 * The products are invoiced by each seller with their own system.
 */
export async function OrderInvoices({
  orderNumber,
  paid,
  payOnDelivery,
  shippingMinor,
}: {
  orderNumber: string;
  /** The payment has been received: documents are issued within minutes of it. */
  paid: boolean;
  /** Cash on delivery not yet paid: nothing is issued until the cash is collected. */
  payOnDelivery: boolean;
  shippingMinor: number;
}) {
  const invoices: InvoiceRow[] = await (await sessionApi()).myOrderInvoices(orderNumber);
  if (invoices.length === 0 && !paid && !(payOnDelivery && shippingMinor > 0)) return null;

  return (
    <section aria-labelledby="comprobantes">
      <h2 id="comprobantes" className="text-xl font-bold">
        Comprobantes electrónicos
      </h2>
      {invoices.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          {shippingMinor === 0
            ? "Este pedido no tuvo costo de entrega, así que Yuntera no le emite comprobante."
            : paid
              ? "Su comprobante por la entrega a domicilio estará aquí en unos minutos."
              : "Le emitiremos el comprobante por la entrega a domicilio cuando pague al recibir el pedido. Aparecerá aquí."}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {invoiceTitle(invoice)}
                  <span className="block font-normal text-ink-muted">
                    {INVOICE_KIND[invoice.kind]}
                    {invoice.receiver_name ? ` · a nombre de ${invoice.receiver_name}` : ""} ·{" "}
                    {formatDateTime(invoice.issued_at)}
                  </span>
                </p>
                <InvoiceStatusBadge status={invoice.status} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-semibold tabular-nums">
                  {formatPrice(invoice.total_minor)}
                </span>
                <Link
                  href={`/comprobantes/${invoice.id}` as Route}
                  className="inline-flex min-h-11 items-center font-semibold text-link underline"
                >
                  Ver comprobante
                </Link>
                {invoice.has_xml ? (
                  <a
                    href={`/comprobantes/${invoice.id}/xml`}
                    className="inline-flex min-h-11 items-center text-link underline"
                  >
                    Descargar XML
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        Yuntera le emite el comprobante por la entrega. Los productos los factura cada vendedor con
        su propio sistema de facturación electrónica.
      </p>
    </section>
  );
}
