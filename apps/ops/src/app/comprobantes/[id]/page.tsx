import { ApiError, type InvoiceDetail } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { FiscalDocumentView } from "@yuntera/next-kit/fiscal-document";
import { sessionApi } from "@yuntera/next-kit/server";
import { Alert, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { replaceInvoice } from "@/app/invoice-actions";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Comprobante electrónico" };

export default function InvoicePage(props: PageProps<"/comprobantes/[id]">) {
  return (
    <div className="shell max-w-4xl py-8">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Invoice {...props} />
      </Suspense>
    </div>
  );
}

async function Invoice({ params, searchParams }: PageProps<"/comprobantes/[id]">) {
  const { id } = await params;
  const issued = (await searchParams).emitido === "1";
  await requireStaff(`/comprobantes/${id}`, ["finance"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let doc: InvoiceDetail;
  try {
    doc = await (await sessionApi()).invoiceDetail(id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "invoice_not_found") notFound();
    throw error;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-4">
        <Link
          href="/comprobantes"
          className="inline-flex min-h-11 items-center text-sm text-link underline"
        >
          Volver a comprobantes
        </Link>
        {doc.order_number ? (
          <Link
            href={`/pedidos/${doc.order_number}` as Route}
            className="inline-flex min-h-11 items-center text-sm text-link underline"
          >
            Ver el pedido {doc.order_number}
          </Link>
        ) : null}
      </div>
      {issued && doc.replaces ? (
        <Alert tone="success" title="Reemplazo emitido">
          Emitimos el comprobante {doc.consecutivo}, que reemplaza al rechazado{" "}
          {doc.replaces.consecutivo}. Sale hacia Hacienda en unos segundos.
        </Alert>
      ) : null}
      {doc.status === "rejected" && !doc.replaced_by ? (
        <ActionForm
          action={replaceInvoice}
          submit="Emitir reemplazo"
          pendingLabel="Emitiendo…"
          className="flex flex-wrap items-center gap-3"
        >
          <input type="hidden" name="invoiceId" value={doc.id} />
        </ActionForm>
      ) : null}
      {doc.replaces ? (
        <p className="text-sm">
          Reemplaza al comprobante rechazado{" "}
          <Link href={`/comprobantes/${doc.replaces.id}` as Route} className="text-link underline">
            {doc.replaces.consecutivo}
          </Link>
          .
        </p>
      ) : null}
      <FiscalDocumentView doc={doc} filesBase={`/comprobantes/${doc.id}`} />
    </div>
  );
}
