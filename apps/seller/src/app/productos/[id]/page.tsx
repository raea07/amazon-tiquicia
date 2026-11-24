import { ApiError, type SharedListingDetail as SellerListingDetail } from "@yuntera/db";
import { BackLink } from "@yuntera/next-kit/back-link";
import { ListingChanges } from "@yuntera/next-kit/listing-changes";
import { photoPreviews, sessionApi } from "@yuntera/next-kit/server";
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
import { type ManagedPhoto, PhotoManager } from "@/components/photo-manager";
import { UnpublishListingForm, VariantToggleForm } from "@/components/seller-listing-forms";
import { listingCategoryOptions } from "@/lib/categories";
import { PRODUCT_STATUS } from "@/lib/labels";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Editar producto" };

export default function EditListingPage(props: PageProps<"/productos/[id]">) {
  return (
    <div className="shell py-8">
      <BackLink href="/productos" className="py-3">
        Productos
      </BackLink>
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
    if (error instanceof ApiError && error.code === "listing_not_found") {
      // A product this shop sells but another shop created: say so, and what
      // this shop may change. Any other: not found, as one that does not exist.
      const edits = await (await sessionApi()).sellerListingEdits(shop.id);
      if (edits.some((edit) => edit.product_id === id && !edit.editable)) {
        return <AnotherShopsListing />;
      }
      notFound();
    }
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
  const photos = archived ? null : await (await sessionApi()).sellerPhotos(listing.product_id);
  const previews = photos
    ? await photoPreviews([...photos.photos, ...photos.leaving], { waiting: { route: "/fotos" } })
    : new Map<string, string>();
  const managed = (list: NonNullable<typeof photos>["photos"]): ManagedPhoto[] =>
    list.map((photo) => ({ ...photo, preview: previews.get(photo.photo_id) ?? null }));
  const photosMissing =
    (Array.isArray(query.fotos) ? query.fotos[0] : query.fotos) === "incompletas";
  const justDrafted = Array.isArray(query.estado) ? query.estado[0] : query.estado;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold">{listing.content.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {listing.pending ? <Badge tone="warning">Cambios en revisión</Badge> : null}
        </p>
      </header>

      {listing.status === "draft" &&
      (justDrafted === "borrador" || justDrafted === "borrador-sin-cambio") ? (
        <Alert tone="success" title="Volvió a borrador">
          Ya no aparece en la tienda ni en las búsquedas, y nadie lo puede comprar. Los pedidos que
          ya tenía siguen su curso.
          {justDrafted === "borrador-sin-cambio"
            ? " El cambio que esperaba revisión se retiró: hágalo aquí."
            : ""}{" "}
          Cuando esté listo, envíelo a revisión.
        </Alert>
      ) : null}

      <ListingState listing={listing} />

      {photosMissing ? (
        <Alert tone="warning" title="Guardamos el producto como borrador">
          Algunas fotos no se pudieron subir, así que todavía no lo enviamos a revisión. Agréguelas
          aquí y envíelo cuando esté listo.
        </Alert>
      ) : null}

      {archived ? null : (
        <>
          {photos ? (
            <PhotoManager
              productId={listing.product_id}
              status={listing.status}
              photos={managed(photos.photos)}
              leaving={managed(photos.leaving)}
              rejected={managed(photos.rejected)}
              changeWaiting={photos.change_waiting}
            />
          ) : null}

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

          {listing.variants.length > 1 ? <Variants listing={listing} /> : null}

          <ListingEditForm
            // A new proposal, or a decision on one, starts the form afresh.
            key={`${listing.status}:${listing.pending?.request_id ?? "none"}:${listing.content.sku_id}`}
            productId={listing.product_id}
            content={starting}
            categories={categories}
            published={published}
          />

          {published ? (
            <section
              aria-labelledby="borrador"
              className="rounded-lg border border-border bg-surface p-5"
            >
              <h2 id="borrador" className="text-lg font-bold">
                Volver a borrador
              </h2>
              {listing.shared ? (
                <p className="mt-1 text-sm text-ink-muted">
                  <SharedBy count={listing.other_shops} />, así que no puede salir de la tienda.
                  Cambie lo que necesite con «Enviar cambios a revisión»: mientras tanto sigue a la
                  venta como está.
                </p>
              ) : (
                <>
                  <p className="mt-1 mb-4 text-sm text-ink-muted">
                    Para rehacerlo con calma: deja de aparecer en la tienda y en las búsquedas, y
                    nadie lo puede comprar. Los pedidos que ya tiene siguen su curso. Cuando lo
                    envíe a revisión y lo aprobemos, vuelve a la venta.
                    <PausedElsewhere count={listing.paused_other_shops} />
                  </p>
                  <UnpublishListingForm productId={listing.product_id} />
                </>
              )}
            </section>
          ) : null}

          <section
            aria-labelledby="archivar"
            className="rounded-lg border border-border bg-surface p-5"
          >
            <h2 id="archivar" className="text-lg font-bold">
              Archivar el producto
            </h2>
            {listing.shared ? (
              <p className="mt-1 text-sm text-ink-muted">
                <SharedBy count={listing.other_shops} />, así que no se puede archivar. Si usted ya
                no lo vende, ponga su oferta en pausa desde la lista de productos: la publicación
                sigue para la otra tienda.
              </p>
            ) : (
              <>
                <p className="mt-1 mb-4 text-sm text-ink-muted">
                  El producto desaparece de la tienda y deja de venderse. Sus existencias, sus
                  pedidos anteriores y sus pagos no cambian.
                  <PausedElsewhere count={listing.paused_other_shops} />
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

/**
 * Each variant, on sale or retired, with the button that switches it. A
 * variant another shop also sells stays in the shop for that shop: retiring
 * it pauses only this shop's own offer.
 */
function Variants({ listing }: { listing: SellerListingDetail }) {
  return (
    <section aria-labelledby="variantes" className="rounded-lg border border-border bg-surface p-5">
      <h2 id="variantes" className="text-lg font-bold">
        Variantes a la venta
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Retire una variante que ya no tiene o no quiere vender: nadie la puede pedir hasta que la
        vuelva a ofrecer. Los pedidos que ya tiene y sus existencias no cambian.
      </p>
      <ul className="mt-4 flex flex-col divide-y divide-border">
        {listing.variants.map((variant) => {
          const name = variant.variant_name || variant.sku_code;
          const ownPaused = variant.own_offer_status === "paused";
          return (
            <li
              key={variant.sku_id}
              className="flex flex-wrap items-start justify-between gap-3 py-3"
              data-testid={`variant-${variant.sku_code}`}
            >
              <div>
                <p className="font-semibold">{name}</p>
                <p className="mt-1 flex flex-wrap gap-2">
                  {!variant.active ? (
                    <Badge tone="neutral">Retirada</Badge>
                  ) : ownPaused ? (
                    // Whether or not another shop sells it: this shop does not, now.
                    <Badge tone="warning">Su oferta en pausa</Badge>
                  ) : (
                    <Badge tone="success">A la venta</Badge>
                  )}
                  {variant.shared ? <Badge tone="info">Otra tienda también la vende</Badge> : null}
                </p>
              </div>
              {listing.status === "archived" ? null : (
                <VariantToggleForm
                  productId={listing.product_id}
                  skuId={variant.sku_id}
                  name={name}
                  active={variant.active}
                  ownOfferPaused={ownPaused}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Another shop sells from this listing", with how many. */
function SharedBy({ count }: { count: number }) {
  return (
    <>
      {count <= 1
        ? "Otra tienda tiene una oferta a la venta en esta publicación"
        : `${count} tiendas más tienen una oferta a la venta en esta publicación`}
    </>
  );
}

/** Shops whose offer here is paused: they hold nothing back, and the seller is told. */
function PausedElsewhere({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="mt-1 block">
      {count === 1
        ? "Otra tienda tiene aquí una oferta en pausa; no lo impide, y su oferta sigue en pausa."
        : `${count} tiendas más tienen aquí una oferta en pausa; no lo impiden, y sus ofertas siguen en pausa.`}
    </span>
  );
}

/** A product this shop sells but another shop created and edits. */
function AnotherShopsListing() {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-3xl font-bold">Esta publicación es de otra tienda</h1>
      <Alert tone="info" title="Usted vende aquí con su propia oferta">
        El texto, las fotos, el paquete y las variantes los cambia la tienda que la publicó, con
        nuestra revisión. Usted cambia su precio, si está a la venta o en pausa, y sus existencias,
        desde la lista de productos; ahí también puede dejar de venderlo.
      </Alert>
      <p>
        <Link href="/productos" className="inline-flex min-h-11 items-center text-link underline">
          Ir a la lista de productos
        </Link>
      </p>
    </div>
  );
}
