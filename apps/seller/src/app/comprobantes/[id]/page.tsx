import { ApiError, type InvoiceDetail } from "@yuntera/db";
import { FiscalDocumentView } from "@yuntera/next-kit/fiscal-document";
import { sessionApi } from "@yuntera/next-kit/server";
import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireShop } from "@/lib/shop";

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

async function Invoice({ params }: PageProps<"/comprobantes/[id]">) {
  const { id } = await params;
  await requireShop(`/comprobantes/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let doc: InvoiceDetail;
  try {
    doc = await (await sessionApi()).invoiceDetail(id);
  } catch (error) {
    // Another shop's document and one that does not exist look the same.
    if (error instanceof ApiError && error.code === "invoice_not_found") notFound();
    throw error;
  }
  return (
    <>
      <Link href="/pagos" className="inline-flex min-h-11 items-center text-sm text-link underline">
        Volver a Pagos
      </Link>
      <div className="mt-2">
        <FiscalDocumentView doc={doc} filesBase={`/comprobantes/${doc.id}`} />
      </div>
    </>
  );
}
