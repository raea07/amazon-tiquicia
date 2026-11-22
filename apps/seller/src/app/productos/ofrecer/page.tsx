import { isPhotoTemplate } from "@yuntera/core";
import { ApiError, type CatalogMatch } from "@yuntera/db";
import { ProductImage } from "@yuntera/next-kit/product-image";
import { messageOf, sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, Badge, buttonClass, EmptyState, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AddOfferForm } from "@/components/seller-listing-forms";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Vender un producto que ya existe" };

/**
 * Selling a product another shop already published: find it by name, brand
 * or barcode and add the shop's own offer to a variant. No review: the
 * product's text and photos were already approved, and they stay the other
 * shop's. Only the price and how it ships are this shop's.
 */
export default function OfferOnExistingPage({ searchParams }: PageProps<"/productos/ofrecer">) {
  return (
    <div className="shell py-8">
      <p className="text-sm">
        <Link href="/productos" className="inline-flex min-h-11 items-center text-link underline">
          ← Productos
        </Link>
      </p>
      <PageHeader title="Vender un producto que ya existe">
        Si el producto ya está publicado en Yuntera, no lo publique otra vez: agregue su oferta y
        aparecerá en la misma página, junto a las de otras tiendas.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Search searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Search({ searchParams }: Pick<PageProps<"/productos/ofrecer">, "searchParams">) {
  const { shop } = await requireShop("/productos/ofrecer");
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 200) ?? "";

  let results: CatalogMatch[] = [];
  let refusal: string | null = null;
  if (query.length >= 2) {
    try {
      results = await (await sessionApi()).sellerCatalogSearch(shop.id, query);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      refusal =
        error.code === "shop_not_approved"
          ? "Su tienda podrá vender productos de otras tiendas cuando la verifiquemos."
          : error.code === "shop_not_active"
            ? "Su tienda no está activa, así que por ahora no puede agregar ofertas."
            : messageOf(error);
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <form action="/productos/ofrecer" className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="q" className="mb-1.5 block text-sm font-semibold">
            Nombre, marca o código de barras
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={200}
            className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3"
          />
        </div>
        <button type="submit" className={buttonClass()}>
          Buscar
        </button>
      </form>

      {refusal ? <Alert tone="warning">{refusal}</Alert> : null}

      {query.length >= 2 && !refusal && results.length === 0 ? (
        <EmptyState
          title="No encontramos ese producto publicado"
          action={
            <Link href="/productos/nuevo" className={buttonClass()}>
              Publicarlo como producto nuevo
            </Link>
          }
        >
          Pruebe con otro nombre, la marca o el código de barras del empaque. Si nadie lo vende
          todavía, publíquelo usted.
        </EmptyState>
      ) : null}

      <ul className="flex flex-col gap-4">
        {results.map((match) => (
          <li key={match.product_id} className="rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap gap-4">
              <div className="size-20 shrink-0 overflow-hidden rounded-md bg-arena-100">
                {match.image_path && isPhotoTemplate(match.image_path) ? (
                  <ProductImage
                    path={match.image_path}
                    alt=""
                    sizes="80px"
                    className="size-full object-contain"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                {match.brand ? (
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {match.brand}
                  </p>
                ) : null}
                <h2 className="text-lg font-bold break-words">{match.title}</h2>
                <p className="text-sm text-ink-muted">
                  {match.category_name}
                  {match.shop_name ? ` · Publicado por ${match.shop_name}` : ""}
                </p>
              </div>
            </div>

            {match.own_listing ? (
              <p className="mt-3 text-sm">
                <Badge tone="info">Es de su tienda</Badge>{" "}
                <Link href={"/productos" as Route} className="text-link underline">
                  Cambie su precio desde la lista de productos
                </Link>
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-4">
                {match.variants.map((variant) => {
                  const name = variant.variant_name || "Única";
                  const label = `${match.title}${variant.variant_name ? `, ${variant.variant_name}` : ""}`;
                  return (
                    <li key={variant.sku_id} className="border-t border-border pt-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-semibold">
                          {match.variants.length > 1 ? `Variante: ${name}` : "Su oferta"}
                        </p>
                        <p className="text-sm text-ink-muted">
                          {variant.offer_count === 1
                            ? "1 tienda lo vende"
                            : `${variant.offer_count} tiendas lo venden`}
                          {variant.lowest_price_minor
                            ? ` · desde ${formatPrice(variant.lowest_price_minor)}`
                            : ""}
                          {variant.gtin ? ` · código ${variant.gtin}` : ""}
                        </p>
                      </div>
                      {variant.my_offer_id && variant.my_offer_status !== "archived" ? (
                        <p className="mt-2 text-sm">
                          <Badge tone="success">Ya lo ofrece</Badge>{" "}
                          <Link href={"/productos" as Route} className="text-link underline">
                            Cambie su precio o sus existencias
                          </Link>
                        </p>
                      ) : (
                        <div className="mt-3">
                          {variant.my_offer_status === "archived" ? (
                            <p className="mb-2 text-sm text-ink-muted">
                              Usted lo ofreció antes; su oferta vuelve a la venta con estos datos.
                            </p>
                          ) : null}
                          <AddOfferForm
                            skuId={variant.sku_id}
                            label={label}
                            fitsWarehouse={variant.fits_warehouse}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <p className="text-sm text-ink-muted">
        La tienda que publicó el producto es la que cambia el título, las fotos y la descripción.
        Usted maneja su precio, sus existencias y si su oferta está a la venta. Puede agregar hasta
        30 ofertas así por día.
      </p>
    </div>
  );
}
