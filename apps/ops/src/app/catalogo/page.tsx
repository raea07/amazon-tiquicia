import { STAFF_QUEUE_PAGE } from "@yuntera/db";
import { DecisionForm } from "@yuntera/next-kit/client";
import { ListingChanges } from "@yuntera/next-kit/listing-changes";
import { photoPreviews, sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, formatDateTime, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { reviewListingEdit } from "@/app/listing-actions";
import { reviewNewListing } from "@/app/photo-actions";
import { CatalogueNav } from "@/components/catalogue-nav";
import { PhotoChangeReview, PhotoPublishRetry, PhotoStrip } from "@/components/photo-review";
import { SELLER_STATUS } from "@/lib/labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Catálogo" };

export default function CatalogPage() {
  return (
    <div className="shell py-8">
      <CatalogueNav current="/catalogo" />
      <PageHeader title="Productos por revisar">
        Cada producto nuevo, y cada cambio a uno ya publicado, se revisa antes de mostrarse: que sea
        legal venderlo, que la descripción sea veraz y que no copie una marca ajena. Un precio alto
        o bajo no es motivo de rechazo.
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
  const api = await sessionApi();
  const [listings, edits, photoQueue] = await Promise.all([
    api.opsListingsForReview(),
    api.opsListingEditsForReview(),
    api.opsPhotosForReview(),
  ]);
  const photosOf = new Map(photoQueue.map((item) => [item.product_id, item]));
  const photoChanges = photoQueue.filter((item) => item.kind === "change");
  const toPublish = photoQueue.filter((item) => item.kind === "publish");
  // Staff look at the largest copy: it is the one the public sizes are made from.
  const previews = await photoPreviews(
    photoQueue.flatMap((item) => [...item.before, ...item.after]),
    { size: 1600 },
  );

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="nuevos">
        <h2 id="nuevos" className="text-xl font-bold">
          Productos nuevos
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          No se muestran en la tienda hasta que usted los publique.
          {listings.length >= STAFF_QUEUE_PAGE
            ? ` Se muestran los ${STAFF_QUEUE_PAGE} más antiguos; hay más esperando, que aparecen a medida que decida estos.`
            : ""}
        </p>
        <div className="mt-4">
          {listings.length === 0 ? (
            <EmptyState title="No hay productos por revisar">La cola está al día.</EmptyState>
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2">
              {listings.map((listing) => {
                const seller = listing.seller_status ? SELLER_STATUS[listing.seller_status] : null;
                return (
                  <li
                    key={listing.product_id}
                    className="rounded-lg border border-border bg-surface p-5 text-sm"
                  >
                    <h3 className="text-lg font-bold">{listing.title}</h3>
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
                    <div className="mt-4">
                      <PhotoStrip
                        photos={photosOf.get(listing.product_id)?.after ?? []}
                        previews={previews}
                        label="Fotos"
                        rejectable
                      />
                    </div>
                    {listing.seller_status === "pending" ? (
                      <p className="mt-3 text-warning">
                        La tienda aún no está verificada: verifíquela en Vendedores antes de
                        publicar este producto, o rechácelo si no cumple.
                      </p>
                    ) : listing.seller_status && listing.seller_status !== "active" ? (
                      <p className="mt-3 text-warning">
                        La tienda no está activa, así que este producto no se puede publicar por
                        ahora. Puede rechazarlo o dejarlo hasta que la tienda vuelva a estar activa.
                      </p>
                    ) : null}
                    <div className="mt-4 border-t border-border pt-4">
                      <DecisionForm
                        action={reviewNewListing}
                        noteLabel="Motivo"
                        noteHint="Obligatorio si lo rechaza. El vendedor lo lee tal cual: diga qué debe corregir. Publicar aprueba también las fotos que no haya rechazado."
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
          )}
        </div>
      </section>

      <section aria-labelledby="fotos">
        <h2 id="fotos" className="text-xl font-bold">
          Fotos de productos publicados
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Fotos nuevas, quitadas o reordenadas. La tienda sigue mostrando las fotos aprobadas hasta
          que usted decida. Revise que muestren el producto que se vende, sin logotipos ajenos ni
          datos personales, y que el texto alternativo describa la foto.
        </p>
        <div className="mt-4">
          {photoChanges.length === 0 && toPublish.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-5 text-sm text-ink-muted">
              No hay fotos por revisar.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {toPublish.map((item) => (
                <PhotoPublishRetry key={item.product_id} item={item} />
              ))}
              {photoChanges.map((item) => (
                <PhotoChangeReview key={item.product_id} item={item} previews={previews} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="cambios">
        <h2 id="cambios" className="text-xl font-bold">
          Cambios a productos publicados
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          El producto sigue a la venta como está mientras usted decide. Si aprueba, la tienda
          muestra el texto propuesto de inmediato; si rechaza, no cambia nada.
        </p>
        <div className="mt-4">
          {edits.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-5 text-sm text-ink-muted">
              No hay cambios por revisar.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {edits.map((edit) => (
                <article
                  key={edit.request_id}
                  className="rounded-lg border border-border bg-surface p-5 text-sm"
                >
                  <p>
                    <Badge tone="info">Cambio a un producto publicado</Badge>
                  </p>
                  <h3 className="mt-2 text-lg font-bold">{edit.before.title}</h3>
                  <p className="mt-1 text-ink-muted">
                    {edit.seller_name} · {edit.sku_code}
                    {edit.variant_name ? ` · ${edit.variant_name}` : ""} · enviado el{" "}
                    {formatDateTime(edit.submitted_at)}
                  </p>
                  <div className="mt-4">
                    <ListingChanges
                      before={edit.before}
                      after={edit.after}
                      changed={edit.changed}
                    />
                  </div>
                  <div className="mt-4 border-t border-border pt-4">
                    <DecisionForm
                      action={reviewListingEdit}
                      noteLabel="Motivo"
                      noteHint="Obligatorio si lo rechaza. El vendedor lo lee tal cual: diga qué debe corregir."
                      yes="Aprobar cambio"
                      no="Rechazar cambio"
                    >
                      <input type="hidden" name="requestId" value={edit.request_id} />
                    </DecisionForm>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
