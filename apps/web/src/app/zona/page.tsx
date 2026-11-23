import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ZoneForm } from "@/components/zone-form";
import { readLocation } from "@/lib/cart";
import { getDistricts } from "@/lib/data";
import { safeReturnPath } from "@/lib/session";

export const metadata: Metadata = { title: "Su zona de entrega", robots: { index: false } };

export default function ZonePage({ searchParams }: PageProps<"/zona">) {
  return (
    <div className="shell max-w-3xl py-8">
      <h1 className="text-3xl font-bold">¿Dónde le entregamos?</h1>
      <p className="mt-2 text-ink-muted">
        Con su distrito le mostramos la fecha de entrega y el costo de envío reales, o le decimos si
        por ahora no entregamos ahí.
      </p>
      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <Suspense fallback={<Skeleton className="h-32" />}>
          <Zone searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Zone({ searchParams }: Pick<PageProps<"/zona">, "searchParams">) {
  const [query, location, districts] = await Promise.all([
    searchParams,
    readLocation(),
    getDistricts(),
  ]);
  const next = Array.isArray(query.siguiente) ? query.siguiente[0] : query.siguiente;
  return (
    <ZoneForm
      districts={districts}
      current={location.chosen ? location.postalCode : undefined}
      returnTo={safeReturnPath(next)}
    />
  );
}
