import { brand } from "@yuntera/brand";
import { COMPLAINT_PROMISE } from "@yuntera/core";
import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ComplaintForm } from "@/components/complaint-form";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Presentar un reclamo", robots: { index: false } };

const ORDER_NUMBER = /^YT-\d{4,12}$/;

/**
 * The free complaint form the help page and customer-service.md promise,
 * linked from the footer of every page and from each order's page
 * (?pedido=YT-…). Filing needs an account; a visitor is sent to sign in and
 * brought back here.
 */
export default function ComplaintPage({ searchParams }: PageProps<"/reclamo">) {
  return (
    <div className="shell max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Presentar un reclamo</h1>
      <p className="mt-2 text-ink-muted" data-testid="complaint-promise">
        {COMPLAINT_PROMISE}
      </p>
      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <Suspense fallback={<Skeleton className="h-64" />}>
          <Complaint searchParams={searchParams} />
        </Suspense>
      </div>
      <p className="mt-6 text-sm text-ink-muted">
        También puede escribirnos a {brand.support.email}. Si no queda conforme con nuestra
        respuesta, puede acudir a la Comisión Nacional del Consumidor del Ministerio de Economía,
        Industria y Comercio.
      </p>
    </div>
  );
}

async function Complaint({ searchParams }: Pick<PageProps<"/reclamo">, "searchParams">) {
  const query = await searchParams;
  const raw = Array.isArray(query.pedido) ? query.pedido[0] : query.pedido;
  const orderNumber = raw && ORDER_NUMBER.test(raw) ? raw : null;
  await requireViewer(orderNumber ? `/reclamo?pedido=${orderNumber}` : "/reclamo");
  return <ComplaintForm orderNumber={orderNumber} />;
}
