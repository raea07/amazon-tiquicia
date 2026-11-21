import type { SearchInput } from "@yuntera/db";
import { buttonClass, EmptyState } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";
import { searchCatalog } from "@/lib/data";
import { ProductGrid } from "./product-card";

export const PAGE_SIZE = 24;

const SORTS = [
  ["relevance", "Más relevantes"],
  ["price_asc", "Precio: menor a mayor"],
  ["price_desc", "Precio: mayor a menor"],
  ["rating", "Mejor calificados"],
  ["newest", "Más nuevos"],
] as const;

export type SortKey = (typeof SORTS)[number][0];

export interface ListingQuery {
  q?: string;
  categorySlug?: string;
  sort: SortKey;
  inStock: boolean;
  page: number;
}

/** Reads listing options from the URL, ignoring anything it does not recognise. */
export function parseListingParams(
  params: Record<string, string | string[] | undefined>,
  categorySlug?: string,
): ListingQuery {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const sort = SORTS.find(([key]) => key === one(params.orden))?.[0] ?? "relevance";
  const page = Number.parseInt(one(params.pagina) ?? "1", 10);
  return {
    q: one(params.q)?.trim().slice(0, 120) || undefined,
    categorySlug,
    sort,
    inStock: one(params.disponibles) === "1",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 500) : 1,
  };
}

function hrefFor(basePath: string, query: ListingQuery, overrides: Partial<ListingQuery>): Route {
  const next = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.sort !== "relevance") params.set("orden", next.sort);
  if (next.inStock) params.set("disponibles", "1");
  if (next.page > 1) params.set("pagina", String(next.page));
  const text = params.toString();
  return (text ? `${basePath}?${text}` : basePath) as Route;
}

/**
 * Results, sort and paging for the search and category pages. Sorting and
 * filtering are plain links that change the URL, so every state can be shared,
 * bookmarked and reached with the back button, and nothing needs JavaScript.
 */
export async function CatalogListing({
  basePath,
  query,
}: {
  basePath: string;
  query: ListingQuery;
}) {
  const input: SearchInput = {
    query: query.q ?? null,
    categorySlug: query.categorySlug ?? null,
    sort: query.sort,
    inStockOnly: query.inStock,
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
  };
  const results = await searchCatalog(input);
  const total = results[0]?.total_count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (results.length === 0) {
    return (
      <EmptyState
        title={
          query.q ? `No encontramos resultados para “${query.q}”` : "Todavía no hay productos aquí"
        }
        action={
          <Link href="/buscar" className={buttonClass({ variant: "secondary" })}>
            Ver todos los productos
          </Link>
        }
      >
        {query.q
          ? "Revise la ortografía o pruebe con una palabra más general. También puede explorar por categoría."
          : "Estamos sumando vendedores. Vuelva pronto."}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {total} {total === 1 ? "producto" : "productos"}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={hrefFor(basePath, query, { inStock: !query.inStock, page: 1 })}
            aria-pressed={query.inStock}
            className={`inline-flex min-h-10 items-center rounded-full border px-3 ${
              query.inStock
                ? "border-brand bg-brand-soft font-semibold text-link"
                : "border-border-strong text-ink-muted hover:bg-surface-muted"
            }`}
          >
            Solo disponibles
          </Link>
          <nav aria-label="Ordenar resultados" className="flex flex-wrap gap-1">
            {SORTS.map(([key, label]) => (
              <Link
                key={key}
                href={hrefFor(basePath, query, { sort: key, page: 1 })}
                aria-current={query.sort === key ? "true" : undefined}
                className={`inline-flex min-h-10 items-center rounded-full px-3 ${
                  query.sort === key
                    ? "bg-anil-900 font-semibold text-white"
                    : "text-ink-muted hover:bg-surface-muted"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <ProductGrid products={results} />

      {pages > 1 ? (
        <nav
          aria-label="Páginas de resultados"
          className="flex items-center justify-center gap-3 pt-4"
        >
          {query.page > 1 ? (
            <Link
              href={hrefFor(basePath, query, { page: query.page - 1 })}
              className={buttonClass({ variant: "secondary" })}
            >
              Anterior
            </Link>
          ) : null}
          <span className="text-sm text-ink-muted">
            Página {query.page} de {pages}
          </span>
          {query.page < pages ? (
            <Link
              href={hrefFor(basePath, query, { page: query.page + 1 })}
              className={buttonClass({ variant: "secondary" })}
            >
              Siguiente
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
