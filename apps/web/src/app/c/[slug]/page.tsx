import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ListingSkeleton } from "@/app/buscar/page";
import { CatalogListing, parseListingParams } from "@/components/catalog-listing";
import { getCategories } from "@/lib/data";

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = (await getCategories()).find((c) => c.slug === slug);
  return category
    ? {
        title: category.name_es,
        description: `${category.name_es} de vendedores costarricenses, con entrega propia en el GAM.`,
        alternates: { canonical: `/c/${slug}` },
      }
    : { title: "Categoría no encontrada" };
}

export default function CategoryPage({ params, searchParams }: PageProps<"/c/[slug]">) {
  return (
    <div className="shell py-8">
      <Suspense fallback={<ListingSkeleton />}>
        <Category params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Category({ params, searchParams }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const categories = await getCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const parent = categories.find((c) => c.slug === category.parent_slug);
  const children = categories.filter((c) => c.parent_slug === slug && c.product_count > 0);
  const query = parseListingParams(await searchParams, slug);

  return (
    <>
      <nav aria-label="Ruta" className="mb-3 text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
          </li>
          {parent ? (
            <li className="before:mr-1.5 before:content-['/']">
              <Link href={`/c/${parent.slug}` as Route} className="hover:underline">
                {parent.name_es}
              </Link>
            </li>
          ) : null}
          <li
            aria-current="page"
            className="font-medium text-ink before:mr-1.5 before:content-['/']"
          >
            {category.name_es}
          </li>
        </ol>
      </nav>

      <h1 className="text-3xl font-bold">{category.name_es}</h1>

      {children.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {children.map((child) => (
            <li key={child.slug}>
              <Link
                href={`/c/${child.slug}` as Route}
                className="inline-flex min-h-10 items-center rounded-full border border-border-strong bg-surface px-4 text-sm hover:border-brand hover:bg-brand-soft"
              >
                {child.name_es}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6">
        <CatalogListing basePath={`/c/${slug}`} query={query} />
      </div>
    </>
  );
}
