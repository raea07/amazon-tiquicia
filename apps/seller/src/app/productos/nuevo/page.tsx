import { PageHeader } from "@yuntera/next-kit/shell";
import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { type CategoryOption, ListingForm } from "@/components/listing-form";
import { getCategories } from "@/lib/data";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Publicar un producto" };

export default function NewListingPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Publicar un producto">
        Complete los datos una vez; el resumen de la derecha le muestra cuánto recibe por cada
        venta.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <NewListing />
        </Suspense>
      </div>
    </div>
  );
}

async function NewListing() {
  await requireShop("/productos/nuevo");
  const categories = await getCategories();
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const parents = new Set(categories.map((category) => category.parent_slug).filter(Boolean));

  const topOf = (slug: string): { slug: string; name: string } => {
    let current = bySlug.get(slug);
    while (current?.parent_slug) current = bySlug.get(current.parent_slug);
    return { slug: current?.slug ?? slug, name: current?.name_es ?? "" };
  };

  // A product goes in the most specific category: only ones without children are offered.
  const options: CategoryOption[] = categories
    .filter((category) => !parents.has(category.slug))
    .map((category) => {
      const top = topOf(category.slug);
      return { slug: category.slug, name: category.name_es, group: top.name, top: top.slug };
    });

  return <ListingForm categories={options} />;
}
