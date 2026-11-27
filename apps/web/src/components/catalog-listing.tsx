import type { CatalogSearchInput, ShopBrand } from "@yuntera/db";
import { buttonClass, EmptyState } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";
import { getBrands, searchCatalog } from "@/lib/data";
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

/** The shape of a brand's address; anything else in `?marca=` is ignored. */
const BRAND_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ListingQuery {
  q?: string;
  categorySlug?: string;
  /** A brand's address (`?marca=`). */
  brand?: string;
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
  const brand = one(params.marca)?.trim().toLowerCase();
  return {
    q: one(params.q)?.trim().slice(0, 120) || undefined,
    categorySlug,
    brand: brand && BRAND_SLUG.test(brand) ? brand : undefined,
    sort,
    inStock: one(params.disponibles) === "1",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 500) : 1,
  };
}

function hrefFor(basePath: string, query: ListingQuery, overrides: Partial<ListingQuery>): Route {
  const next = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.brand) params.set("marca", next.brand);
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
  const input: CatalogSearchInput = {
    query: query.q ?? null,
    categorySlug: query.categorySlug ?? null,
    brandSlug: query.brand ?? null,
    sort: query.sort,
    inStockOnly: query.inStock,
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
  };
  const [results, brands] = await Promise.all([
    searchCatalog(input),
    getBrands(query.categorySlug ?? null),
  ]);
  const total = results[0]?.total_count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const brandFilter = (
    <BrandFilter basePath={basePath} query={query} brands={brands} resultCount={total} />
  );

  if (results.length === 0 && query.brand) {
    return (
      <div className="flex flex-col gap-5">
        {brandFilter}
        <EmptyState
          title="No hay productos de esa marca aquí"
          action={
            <Link
              href={hrefFor(basePath, query, { brand: undefined, page: 1 })}
              className={buttonClass({ variant: "secondary" })}
            >
              Quitar el filtro de marca
            </Link>
          }
        >
          Pruebe con otra marca o quite el filtro para ver todos los productos.
        </EmptyState>
      </div>
    );
  }

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

      {brandFilter}

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

/**
 * Filter by brand: a plain form that changes the URL (it works without
 * JavaScript), with the other choices carried along. Only shown when there is
 * a choice to make, or a filter to take off.
 */
function BrandFilter({
  basePath,
  query,
  brands,
  resultCount,
}: {
  basePath: string;
  query: ListingQuery;
  brands: ShopBrand[];
  resultCount: number;
}) {
  // An old address (a brand renamed, or merged into another) means the brand
  // that has it now: select that one and name it.
  const current = query.brand
    ? (brands.find((brand) => brand.slug === query.brand) ??
      brands.find((brand) => brand.former_slugs.includes(query.brand ?? "")))
    : undefined;
  if (brands.length < 2 && !query.brand) return null;
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <form action={basePath} method="get" className="flex flex-wrap items-end gap-2">
        {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
        {query.sort !== "relevance" ? (
          <input type="hidden" name="orden" value={query.sort} />
        ) : null}
        {query.inStock ? <input type="hidden" name="disponibles" value="1" /> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="marca" className="font-semibold">
            Marca
          </label>
          <select
            id="marca"
            name="marca"
            defaultValue={current?.slug ?? query.brand ?? ""}
            className="min-h-11 max-w-full rounded-md border border-border-strong bg-surface px-3"
          >
            <option value="">Todas las marcas</option>
            {brands.map((brand) => (
              <option key={brand.slug} value={brand.slug}>
                {brand.name} ({brand.product_count})
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>
          Filtrar por marca
        </button>
      </form>
      {query.brand ? (
        <p
          className="flex flex-wrap items-center gap-2"
          aria-live="polite"
          data-testid="brand-filter-summary"
        >
          <span>
            Mostrando {resultCount} {resultCount === 1 ? "producto" : "productos"} de{" "}
            <span className="font-semibold">{current?.name ?? "esa marca"}</span>
          </span>
          <Link
            href={hrefFor(basePath, query, { brand: undefined, page: 1 })}
            className="inline-flex min-h-11 items-center text-link underline"
          >
            Quitar el filtro de marca
          </Link>
        </p>
      ) : null}
    </div>
  );
}
