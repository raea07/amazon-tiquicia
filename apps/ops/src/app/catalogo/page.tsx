import { DecisionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, formatDateTime, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { reviewProduct } from "@/app/actions";
import { SELLER_STATUS } from "@/lib/labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Catálogo" };

export default function CatalogPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Productos por revisar">
        Cada producto nuevo se revisa antes de publicarse: que sea legal venderlo, que la
        descripción sea veraz y que no copie una marca ajena. Un precio alto o bajo no es motivo de
        rechazo.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Review />
        </Suspense>
      </div>
    </div>
  );
}

async function Review() {
  await requireStaff("/catalogo", ["catalog"]);
  const listings = await (await sessionApi()).opsListingsForReview();

  if (listings.length === 0) {
    return <EmptyState title="No hay productos por revisar">La cola está al día.</EmptyState>;
  }

  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {listings.map((listing) => {
        const seller = listing.seller_status ? SELLER_STATUS[listing.seller_status] : null;
        return (
          <li
            key={listing.product_id}
            className="rounded-lg border border-border bg-surface p-5 text-sm"
          >
            <h2 className="text-lg font-bold">{listing.title}</h2>
            <p className="mt-1 text-ink-muted">
              {listing.seller_name ?? "Vendedor"}{" "}
              {seller ? <Badge tone={seller.tone}>{seller.label}</Badge> : null} ·{" "}
              {listing.category_slug} · {formatDateTime(listing.created_at)}
            </p>
            {listing.price_minor ? (
              <p className="mt-2 font-display text-xl font-bold tabular-nums">
                {formatPrice(listing.price_minor)}
              </p>
            ) : null}
            {listing.bullet_points.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {listing.bullet_points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : null}
            {listing.description ? (
              <p className="mt-2 text-ink-muted">{listing.description}</p>
            ) : null}
            {listing.seller_status === "pending" ? (
              <p className="mt-3 text-warning">
                El vendedor aún no está verificado: aunque apruebe el producto, no se muestra hasta
                que lo esté.
              </p>
            ) : null}
            <div className="mt-4 border-t border-border pt-4">
              <DecisionForm
                action={reviewProduct}
                noteLabel="Motivo"
                noteHint="Obligatorio si lo rechaza. El vendedor lo lee tal cual: diga qué debe corregir."
                yes="Publicar"
                no="Rechazar"
              >
                <input type="hidden" name="productId" value={listing.product_id} />
              </DecisionForm>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
