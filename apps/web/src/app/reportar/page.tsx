import { EmptyState, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReportForm } from "@/components/report-form";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Reportar un problema", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What is being reported, from the link that brought the person here. */
const KINDS = {
  producto: { type: "product", label: "esta publicación" },
  resena: { type: "review", label: "esta reseña" },
  tienda: { type: "seller", label: "esta tienda" },
} as const;

export default function ReportPage({ searchParams }: PageProps<"/reportar">) {
  return (
    <div className="shell max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Reportar un problema</h1>
      <p className="mt-2 text-ink-muted">
        Si algo en la tienda es ilegal, peligroso, falso o engañoso, avísenos. Revisamos cada
        reporte y, si incumple las reglas, lo retiramos.
      </p>
      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <Suspense fallback={<Skeleton className="h-64" />}>
          <Report searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Report({ searchParams }: Pick<PageProps<"/reportar">, "searchParams">) {
  const query = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const entry = (Object.keys(KINDS) as Array<keyof typeof KINDS>).find(
    (key) => first(query[key]) !== undefined,
  );
  const id = entry ? first(query[entry]) : undefined;
  if (!entry || !id || !UUID.test(id)) {
    return (
      <EmptyState title="No sabemos qué quiere reportar">
        Use el enlace «Reportar un problema» de la página del producto. Para otra cosa, escríbanos
        desde la{" "}
        <Link href="/ayuda" className="font-semibold text-link underline">
          página de ayuda
        </Link>
        .
      </EmptyState>
    );
  }
  const viewer = await getViewer();
  return (
    <>
      <h2 className="mb-4 text-lg font-bold">Qué pasa con {KINDS[entry].label}</h2>
      <ReportForm targetType={KINDS[entry].type} targetId={id} signedIn={viewer !== null} />
    </>
  );
}
