import type { PausedOffer } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import {
  Alert,
  Badge,
  buttonClass,
  EmptyState,
  formatDate,
  formatPrice,
  Skeleton,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OfferForm } from "@/components/forms";
import { ResumeOfferForm, WithdrawOfferForm } from "@/components/seller-listing-forms";
import { FULFILLMENT_LABEL, PRODUCT_STATUS } from "@/lib/labels";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Productos" };

export default function ListingsPage({ searchParams }: PageProps<"/productos">) {
  return (
    <div className="shell py-8">
      <PageHeader
        title="Productos"
        actions={
          <div className="flex flex-wrap gap-3">
            <Link href="/productos/nuevo" className={buttonClass()}>
              Publicar un producto
            </Link>
            <Link href="/productos/ofrecer" className={buttonClass({ variant: "secondary" })}>
              Vender uno que ya existe
            </Link>
          </div>
        }
      >
        Sus publicaciones, su precio y si están a la venta.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Listings searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Listings({ searchParams }: Pick<PageProps<"/productos">, "searchParams">) {
  const { shop } = await requireShop("/productos");
  const api = await sessionApi();
  const [listings, edits, paused] = await Promise.all([
    api.sellerListings(shop.id),
    api.sellerListingEdits(shop.id),
    api.sellerPausedOffers(shop.id),
  ]);
  const editOf = new Map(edits.map((edit) => [edit.product_id, edit]));
  const created = (await searchParams).creado;

  if (listings.length === 0) {
    return (
      <EmptyState
        title="Todavía no tiene productos"
        action={
          <Link href="/productos/nuevo" className={buttonClass()}>
            Publicar el primero
          </Link>
        }
      >
        Publicar toma unos cinco minutos. Antes de enviarlo ve exactamente cuánto recibe por cada
        venta.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {created === "revision" ? (
        <Alert tone="success" title="Producto enviado a revisión">
          Lo revisamos normalmente en un día hábil. Mientras tanto, indique sus existencias en
          Inventario para que pueda venderse apenas se publique.
        </Alert>
      ) : null}
      {created === "borrador" ? (
        <Alert tone="info" title="Borrador guardado">
          Nadie más lo ve todavía.
        </Alert>
      ) : null}

      {paused.length > 0 ? <PausedOffers offers={paused} /> : null}

      <DataTable
        caption="Sus productos"
        head={["Producto", "Estado", "Existencias", "Oferta destacada", "Precio y venta"]}
      >
        {listings.map((listing) => {
          const status = PRODUCT_STATUS[listing.product_status];
          const edit = editOf.get(listing.product_id);
          return (
            <tr key={listing.offer_id}>
              <td className="max-w-xs">
                <p className="font-semibold">{listing.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {listing.sku_code}
                  {listing.variant_name ? ` · ${listing.variant_name}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {FULFILLMENT_LABEL[listing.fulfillment]}
                </p>
                {edit && !edit.editable && listing.product_status !== "archived" ? (
                  <div className="mt-1">
                    <Badge tone="info">De otra tienda</Badge>
                    <p className="mt-1 max-w-64 text-xs text-ink-muted">
                      Usted cambia su precio y sus existencias; el texto, las fotos y el paquete los
                      cambia la tienda que lo publicó.
                    </p>
                  </div>
                ) : null}
                {edit?.editable ? (
                  <p className="mt-1">
                    <Link
                      href={`/productos/${listing.product_id}?v=${listing.sku_id}` as Route}
                      className="inline-flex min-h-11 items-center text-link underline"
                    >
                      Editar<span className="sr-only"> {listing.title}</span>
                    </Link>
                  </p>
                ) : null}
              </td>
              <td>
                <Badge tone={status.tone}>{status.label}</Badge>
                {listing.rejection_reason ? (
                  <p className="mt-1 max-w-56 text-xs text-danger">
                    Motivo: {listing.rejection_reason}
                  </p>
                ) : null}
                {edit?.edit_status === "pending" ? (
                  <p className="mt-1">
                    <Badge tone="warning">Cambios en revisión</Badge>
                  </p>
                ) : null}
                {edit?.edit_status === "rejected" ? (
                  <p className="mt-1 max-w-56 text-xs text-danger">
                    Cambio no aprobado: {edit.edit_reason}
                  </p>
                ) : null}
              </td>
              <td className="tabular-nums">
                {listing.available_quantity}
                {listing.available_quantity === 0 ? (
                  <p className="text-xs text-warning">Sin existencias</p>
                ) : null}
              </td>
              <td>
                {listing.product_status !== "active" || listing.is_featured === null ? (
                  <span className="text-ink-muted">—</span>
                ) : listing.is_featured ? (
                  <Badge tone="success">Destacada</Badge>
                ) : (
                  <Badge tone="neutral">No destacada</Badge>
                )}
                {listing.competing_offers > 0 ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    {listing.competing_offers === 1
                      ? "Otro vendedor ofrece este producto"
                      : `${listing.competing_offers} vendedores más lo ofrecen`}
                  </p>
                ) : null}
              </td>
              <td className="min-w-72">
                <details>
                  <summary className="cursor-pointer py-3 font-semibold tabular-nums">
                    {formatPrice(listing.price_minor)}
                    {listing.offer_status === "paused" ? (
                      <span className="ml-2 font-normal text-ink-muted">· en pausa</span>
                    ) : null}
                    <span className="ml-2 font-normal text-link underline">Cambiar</span>
                  </summary>
                  <div className="mt-3">
                    <OfferForm listing={listing} />
                  </div>
                  {edit && !edit.editable ? (
                    <div className="mt-4 border-t border-border pt-3">
                      <WithdrawOfferForm
                        offerId={listing.offer_id}
                        priceMinor={listing.price_minor}
                        label={`${listing.title}${listing.variant_name ? `, ${listing.variant_name}` : ""}`}
                      />
                    </div>
                  ) : null}
                </details>
              </td>
            </tr>
          );
        })}
      </DataTable>
      <p className="max-w-3xl text-sm text-ink-muted">
        Cuando varias tiendas venden el mismo producto, la oferta destacada es la nueva que tiene
        existencias y el precio más bajo; si cuestan lo mismo, la que se publicó antes. Las demás
        siguen visibles en la página del producto y se pueden comprar.
      </p>
    </div>
  );
}

const PAUSED_REASON: Record<PausedOffer["reason"], (offer: PausedOffer) => string> = {
  fee_change: (offer) =>
    `Las tarifas cambiaron el ${formatDate(offer.paused_at, { day: "numeric", month: "long" })} y, con su precio actual, cada venta le costaría más en comisiones y cobros de lo que recibe. Por eso la pusimos en pausa.`,
  listing_edit: (offer) =>
    `El ${formatDate(offer.paused_at, { day: "numeric", month: "long" })} se aprobó un cambio del paquete o de la categoría de esta publicación y, con su precio actual, cada venta le costaría más en tarifas de lo que recibe. Por eso la pusimos en pausa.`,
};

/**
 * Offers paused because their price no longer covers the fees: why, the
 * lowest price that does, and the way back on sale (a new price and on sale
 * again, in one step).
 */
function PausedOffers({ offers }: { offers: PausedOffer[] }) {
  return (
    <section
      aria-labelledby="en-pausa"
      className="rounded-lg border-2 border-warning bg-surface p-5"
      data-testid="paused-offers"
    >
      <h2 id="en-pausa" className="text-lg font-bold">
        {offers.length === 1
          ? "Una oferta en pausa porque su precio ya no cubre las tarifas"
          : `${offers.length} ofertas en pausa porque su precio ya no cubre las tarifas`}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Para venderla otra vez, ponga un precio que cubra las tarifas y guárdelo: vuelve a la venta
        en el mismo paso.
      </p>
      <ul className="mt-4 flex flex-col gap-4">
        {offers.map((offer) => {
          const label = `${offer.title}${offer.variant_name ? `, ${offer.variant_name}` : ""}`;
          return (
            <li key={offer.offer_id} className="border-t border-border pt-4">
              <p className="font-semibold break-words">{label}</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {offer.sku_code} · precio en pausa {formatPrice(offer.price_minor)}
              </p>
              <p className="mt-2 text-sm">{PAUSED_REASON[offer.reason](offer)}</p>
              {offer.min_price_minor ? (
                <p className="mt-1 text-sm font-semibold">
                  El precio más bajo que cubre las tarifas es {formatPrice(offer.min_price_minor)}.
                </p>
              ) : (
                <p className="mt-1 text-sm font-semibold">
                  Con las tarifas actuales ningún precio cubre el costo de venderlo así. Escríbanos
                  y lo revisamos con usted.
                </p>
              )}
              {offer.min_price_minor ? (
                <div className="mt-3">
                  <ResumeOfferForm
                    offerId={offer.offer_id}
                    label={label}
                    suggestedMinor={offer.min_price_minor}
                    listPriceMinor={offer.list_price_minor}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
