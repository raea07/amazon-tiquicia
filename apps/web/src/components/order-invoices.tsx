import type { InvoiceRow, OrderInvoicing } from "@yuntera/db";
import { INVOICE_KIND, InvoiceStatusBadge, invoiceTitle } from "@yuntera/next-kit/fiscal-document";
import { formatDateTime, formatPrice } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";
import { sessionApi } from "@/lib/supabase";

/**
 * Why an order shows no document of Yuntera's yet, in one true sentence:
 * nothing of Yuntera's to document, money that was never real, the issuer not
 * set up yet, or the document on its way (a factura when the shopper asked for
 * one, a tiquete otherwise).
 */
function whyNoDocument(facts: OrderInvoicing, shippingMinor: number): string {
  if (shippingMinor === 0) {
    return "Este pedido no tuvo costo de entrega, así que Yuntera no le emite ningún comprobante.";
  }
  if (!facts.delivery_by_platform) {
    return "El comprobante por la entrega a domicilio lo emite el vendedor, no Yuntera.";
  }
  if (!facts.documented) {
    return facts.paid
      ? "Este pedido se pagó en modo de prueba, sin dinero real, así que no se emite ningún comprobante electrónico."
      : "Este pedido es de prueba: se paga sin dinero real, así que no se emite ningún comprobante electrónico.";
  }
  const document = facts.factura_requested
    ? "la factura electrónica a su nombre"
    : "el tiquete electrónico";
  if (!facts.issuer_ready) {
    return facts.paid
      ? `Yuntera todavía no emite comprobantes electrónicos. Le emitiremos ${document} por la entrega a domicilio en cuanto quede habilitado, y aparecerá aquí.`
      : `Yuntera todavía no emite comprobantes electrónicos. Cuando pague al recibir el pedido, le emitiremos ${document} por la entrega a domicilio en cuanto quede habilitado, y aparecerá aquí.`;
  }
  return facts.paid
    ? `${document.charAt(0).toUpperCase()}${document.slice(1)} por la entrega a domicilio estará aquí en unos minutos.`
    : `Le emitiremos ${document} por la entrega a domicilio cuando pague al recibir el pedido. Aparecerá aquí.`;
}

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
  const api = await sessionApi();
  const [invoices, facts]: [InvoiceRow[], OrderInvoicing] = await Promise.all([
    api.myOrderInvoices(orderNumber),
    api.myOrderInvoicing(orderNumber),
  ]);
  if (invoices.length === 0 && !paid && !(payOnDelivery && shippingMinor > 0)) return null;

  return (
    <section aria-labelledby="comprobantes">
      <h2 id="comprobantes" className="text-xl font-bold">
        Comprobantes electrónicos
      </h2>
      {invoices.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{whyNoDocument(facts, shippingMinor)}</p>
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
        {invoices.length > 0 ? "Yuntera le emite el comprobante por la entrega. " : ""}
        Los productos los factura cada vendedor con su propio sistema de facturación electrónica.
      </p>
    </section>
  );
}
