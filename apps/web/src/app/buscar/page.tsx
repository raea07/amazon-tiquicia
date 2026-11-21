import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogListing, parseListingParams } from "@/components/catalog-listing";

export const metadata: Metadata = {
  title: "Buscar",
  // Search result pages are endless variations of the same catalogue; keep them out of indexes.
  robots: { index: false, follow: true },
};

export default function SearchPage({ searchParams }: PageProps<"/buscar">) {
  return (
    <div className="shell py-8">
      {/* The query is only known at request time, so the results stream in. */}
      <Suspense fallback={<ListingSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/buscar">, "searchParams">) {
  const query = parseListingParams(await searchParams);
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {query.q ? <>Resultados para “{query.q}”</> : "Todos los productos"}
      </h1>
      <CatalogListing basePath="/buscar" query={query} />
    </>
  );
}

export function ListingSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Cargando productos…</span>
      <Skeleton className="mb-6 h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered
          <Skeleton key={index} className="aspect-[3/4]" />
        ))}
      </div>
    </div>
  );
}
