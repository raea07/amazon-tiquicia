import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, formatDateTime, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Ofertas en pausa por tarifas" };

/**
 * Offers a change of the fee schedule paused because a sale would no longer
 * cover its fees. The database paused them and told each shop; they sell
 * again when the seller sets a price at or above the minimum shown here.
 */
export default function FeeFloorPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Ofertas en pausa por tarifas">
        Cuando se activa una tarifa nueva, las ofertas cuyo precio ya no cubre las comisiones y el
        costo de cobro quedan en pausa, para que ninguna venta le deje una deuda al vendedor. A cada
        tienda le avisamos con el precio mínimo; la oferta vuelve a venderse cuando el vendedor lo
        sube. Aquí están las que siguen en pausa.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Breaches />
        </Suspense>
      </div>
    </div>
  );
}

async function Breaches() {
  await requireStaff("/tarifas", ["finance", "catalog"]);
  const breaches = await (await sessionApi()).opsFeeFloorBreaches();
  if (breaches.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Ninguna oferta está en pausa por un cambio de tarifas.
      </p>
    );
  }
  return (
    <section aria-labelledby="en-pausa">
      <h2 id="en-pausa" className="text-xl font-bold">
        En pausa ({breaches.length})
      </h2>
      <ul className="mt-4 grid gap-3 lg:grid-cols-2">
        {breaches.map((breach) => (
          <li
            key={breach.offer_id}
            className="rounded-lg border border-border bg-surface p-4 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold">
                {breach.product_title}
                {breach.variant_name ? ` (${breach.variant_name})` : ""}
              </p>
              <Badge tone="warning">En pausa</Badge>
            </div>
            <p className="mt-1 text-ink-muted">
              {breach.shop_name} · {breach.sku_code}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-ink-muted">Precio actual</dt>
              <dd className="tabular-nums">{formatPrice(breach.price_minor)}</dd>
              <dt className="text-ink-muted">Precio mínimo</dt>
              <dd className="font-semibold tabular-nums">
                {breach.min_price_minor === null
                  ? "Ningún precio cubre las tarifas"
                  : formatPrice(Math.ceil(breach.min_price_minor / 100) * 100)}
              </dd>
              <dt className="text-ink-muted">Tarifa</dt>
              <dd>{breach.schedule_version}</dd>
              <dt className="text-ink-muted">En pausa desde</dt>
              <dd>{formatDateTime(breach.paused_at)}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
