import { ApiError, type SellerListingDetail } from "@yuntera/db";
import { ListingChanges } from "@yuntera/next-kit/listing-changes";
import { sessionApi } from "@yuntera/next-kit/server";
import { Alert, Badge, formatDateTime, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import {
  ArchiveListingForm,
  ListingEditForm,
  WithdrawEditForm,
} from "@/components/listing-edit-form";
import { listingCategoryOptions } from "@/lib/categories";
import { PRODUCT_STATUS } from "@/lib/labels";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Editar producto" };

export default function EditListingPage(props: PageProps<"/productos/[id]">) {
  return (
    <div className="shell py-8">
      <p className="text-sm">
        <Link href="/productos" className="text-link underline">
          ← Productos
        </Link>
      </p>
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <EditListing {...props} />
        </Suspense>
      </div>
    </div>
  );
}

async function EditListing({ params, searchParams }: PageProps<"/productos/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { shop } = await requireShop(`/productos/${id}`);
  // Anything that is not an id cannot be a product: not found, without asking.
  if (!z.uuid().safeParse(id).success) notFound();
  const variant = z.uuid().safeParse(Array.isArray(query.v) ? query.v[0] : query.v);

  let listing: SellerListingDetail;
  try {
    listing = await (await sessionApi()).sellerListing(id, variant.success ? variant.data : null);
  } catch (error) {
    // Someone else's product and one that does not exist look the same: not found.
    if (error instanceof ApiError && error.code === "listing_not_found") notFound();
    throw error;
  }
  // It belongs to another of this person's shops: they are working in this one.
  if (listing.seller_id !== shop.id) notFound();

  const status = PRODUCT_STATUS[listing.status];
  const published = listing.status === "active";
  const archived = listing.status === "archived";
  // The form starts from what the seller last proposed, so they continue from
  // there instead of typing it again; otherwise from the listing itself.
  const starting = listing.pending?.proposed ?? listing.last_rejection?.proposed ?? listing.content;
  const categories = archived ? [] : await listingCategoryOptions(starting.category_slug);
  const variantName = listing.variants.find((v) => v.sku_id === listing.content.sku_id);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold">{listing.content.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {listing.pending ? <Badge tone="warning">Cambios en revisión</Badge> : null}
        </p>
      </header>

      <ListingState listing={listing} />

      {archived ? null : (
        <>
          {listing.variants.length > 1 ? (
            <nav aria-label="Variante" className="text-sm">
              <p className="font-semibold">
                El paquete que edita es el de la variante
                {variantName?.variant_name ? ` “${variantName.variant_name}”` : ""}.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {listing.variants.map((v) => (
                  <li key={v.sku_id}>
                    <Link
                      href={`/productos/${listing.product_id}?v=${v.sku_id}` as Route}
                      aria-current={v.sku_id === listing.content.sku_id ? "true" : undefined}
                      className={`inline-flex min-h-11 items-center rounded-md border px-4 ${
                        v.sku_id === listing.content.sku_id
                          ? "border-brand bg-brand-soft font-semibold text-link"
                          : "border-border-strong hover:bg-surface-muted"
                      }`}
                    >
                      {v.variant_name || v.sku_code}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <ListingEditForm
            // A new proposal, or a decision on one, starts the form afresh.
            key={`${listing.status}:${listing.pending?.request_id ?? "none"}:${listing.content.sku_id}`}
            productId={listing.product_id}
            content={starting}
            categories={categories}
            published={published}
          />

          <section
            aria-labelledby="archivar"
            className="rounded-lg border border-border bg-surface p-5"
          >
            <h2 id="archivar" className="text-lg font-bold">
              Archivar el producto
            </h2>
            {listing.shared ? (
              <p className="mt-1 text-sm text-ink-muted">
                Otro vendedor también vende desde esta publicación, así que no se puede archivar. Si
                usted ya no lo vende, ponga su oferta en pausa desde la lista de productos.
              </p>
            ) : (
              <>
                <p className="mt-1 mb-4 text-sm text-ink-muted">
                  El producto desaparece de la tienda y deja de venderse. Sus existencias, sus
                  pedidos anteriores y sus pagos no cambian.
                </p>
                <ArchiveListingForm productId={listing.product_id} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Says plainly where the listing stands and what happens next. */
function ListingState({ listing }: { listing: SellerListingDetail }) {
  if (listing.status === "archived") {
    return (
      <Alert tone="info" title="Este producto está archivado">
        No aparece en la tienda y no se puede vender ni editar. Sus existencias no cambiaron.
      </Alert>
    );
  }
  if (listing.pending) {
    return (
      <section className="flex flex-col gap-4">
        <Alert tone="warning" title="Publicado; sus cambios están en revisión">
          {/* The date ends in "p. m.", so no full stop follows it. */}
          <span className="block">
            Enviados a revisión el {formatDateTime(listing.pending.submitted_at)}
          </span>
          <span className="mt-1 block">
            Hasta que los aprobemos, los compradores siguen viendo la publicación como está ahora.
            Si envía otro cambio, reemplaza a este.
          </span>
        </Alert>
        <ListingChanges
          before={listing.content}
          after={listing.pending.proposed}
          afterLabel="Su cambio, en revisión"
        />
        <WithdrawEditForm productId={listing.product_id} />
      </section>
    );
  }
  if (listing.last_rejection) {
    return (
      <section className="flex flex-col gap-4">
        <Alert tone="danger" title="No aprobamos su último cambio">
          <span className="block">Motivo: {listing.last_rejection.reason}</span>
          <span className="mt-1 block">
            La publicación sigue a la venta como estaba. Corrija lo que haga falta y envíelo de
            nuevo.
          </span>
        </Alert>
        <ListingChanges
          before={listing.content}
          after={listing.last_rejection.proposed}
          afterLabel="Lo que usted propuso"
        />
      </section>
    );
  }
  switch (listing.status) {
    case "active":
      return (
        <Alert tone="success" title="Publicado y a la venta">
          Lo que cambie aquí lo revisamos antes de mostrarlo; mientras tanto su publicación sigue
          igual. El precio y las existencias se cambian sin revisión desde la lista de productos.
        </Alert>
      );
    case "pending_review":
      return (
        <Alert tone="warning" title="En revisión; todavía no está publicado">
          Puede seguir corrigiéndolo: revisamos la versión más reciente.
        </Alert>
      );
    case "rejected":
      return (
        <Alert tone="danger" title="No lo publicamos">
          {listing.rejection_reason ? (
            <span className="block">Motivo: {listing.rejection_reason}</span>
          ) : null}
          <span className="mt-1 block">Corríjalo y envíelo de nuevo a revisión.</span>
        </Alert>
      );
    default:
      return (
        <Alert tone="info" title="Borrador">
          Nadie más lo ve todavía. Envíelo a revisión cuando esté listo.
        </Alert>
      );
  }
}
