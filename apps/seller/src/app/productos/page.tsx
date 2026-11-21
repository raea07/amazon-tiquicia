import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import { Alert, Badge, buttonClass, EmptyState, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OfferForm } from "@/components/forms";
import { FULFILLMENT_LABEL, PRODUCT_STATUS } from "@/lib/labels";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Productos" };

export default function ListingsPage({ searchParams }: PageProps<"/productos">) {
  return (
    <div className="shell py-8">
      <PageHeader
        title="Productos"
        actions={
          <Link href="/productos/nuevo" className={buttonClass()}>
            Publicar un producto
          </Link>
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
  const listings = await (await sessionApi()).sellerListings(shop.id);
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

      <DataTable
        caption="Sus productos"
        head={["Producto", "Estado", "Existencias", "Oferta destacada", "Precio y venta"]}
      >
        {listings.map((listing) => {
          const status = PRODUCT_STATUS[listing.product_status];
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
              </td>
              <td>
                <Badge tone={status.tone}>{status.label}</Badge>
                {listing.rejection_reason ? (
                  <p className="mt-1 max-w-56 text-xs text-danger">
                    Motivo: {listing.rejection_reason}
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
                  <summary className="cursor-pointer font-semibold tabular-nums">
                    {formatPrice(listing.price_minor)}
                    {listing.offer_status === "paused" ? (
                      <span className="ml-2 font-normal text-ink-muted">· en pausa</span>
                    ) : null}
                    <span className="ml-2 font-normal text-link underline">Cambiar</span>
                  </summary>
                  <div className="mt-3">
                    <OfferForm listing={listing} />
                  </div>
                </details>
              </td>
            </tr>
          );
        })}
      </DataTable>
      <p className="max-w-3xl text-sm text-ink-muted">
        Cuando varios vendedores ofrecen el mismo producto, destacamos la oferta con la mejor
        combinación de precio, rapidez de entrega y desempeño del vendedor. Las demás siguen
        visibles en la página del producto.
      </p>
    </div>
  );
}
