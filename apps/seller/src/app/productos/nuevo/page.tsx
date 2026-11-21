import { PageHeader } from "@yuntera/next-kit/shell";
import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListingForm } from "@/components/listing-form";
import { listingCategoryOptions } from "@/lib/categories";
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
  return <ListingForm categories={await listingCategoryOptions()} />;
}
