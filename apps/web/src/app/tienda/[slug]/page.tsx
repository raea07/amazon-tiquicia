import type { PublicShop } from "@yuntera/db";
import { ShopLogo } from "@yuntera/next-kit/shop-logo";
import { EmptyState, formatDate, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { type CardProduct, ProductGrid } from "@/components/product-card";
import { getShopPage } from "@/lib/data";

/**
 * A shop's public page: its name, logo and description, and what it sells
 * now at its own price. The description is the seller's text as staff
 * approved it, shown as text: markup in it is never rendered. Only an active
 * shop has a page; the proxy answers 404 for any other (lib/shop-paths.ts).
 */

export async function generateMetadata({ params }: PageProps<"/tienda/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getShopPage(slug);
  if (!shop) return { title: "Tienda no encontrada" };
  return {
    title: shop.trade_name,
    description: (shop.description ?? `Productos de ${shop.trade_name} en Yuntera.`).slice(0, 160),
    alternates: { canonical: `/tienda/${slug}` },
  };
}

export default function ShopRoute(props: PageProps<"/tienda/[slug]">) {
  return (
    <div className="shell py-6 md:py-8">
      <Suspense fallback={<ShopSkeleton />}>
        <Shop {...props} />
      </Suspense>
    </div>
  );
}

/** The shop's own price for a card: what it sells with stock, else its lowest. */
function toCard(product: PublicShop["products"][number]): CardProduct {
  return {
    slug: product.slug,
    title: product.title,
    image_path: product.image_path,
    min_price_minor: product.in_stock_price_minor ?? product.price_minor,
    list_price_minor: null,
    in_stock: product.in_stock,
    rating_sum: product.rating_sum,
    rating_count: product.rating_count,
    fulfilled_by_platform: product.fulfilled_by_platform,
    brand_name: product.brand_name,
  };
}

async function Shop({ params }: Pick<PageProps<"/tienda/[slug]">, "params">) {
  const { slug } = await params;
  const shop = await getShopPage(slug);
  if (!shop) notFound();

  return (
    <>
      <nav aria-label="Ruta" className="text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
          </li>
          <li className="before:mr-1.5 before:content-['/']">Tiendas</li>
        </ol>
      </nav>

      <header className="mt-4 flex flex-wrap items-center gap-4">
        <ShopLogo logo={shop.logo} name={shop.trade_name} size={80} />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words md:text-3xl">{shop.trade_name}</h1>
          {shop.selling_since ? (
            <p className="mt-1 text-sm text-ink-muted">
              Vende en Yuntera desde{" "}
              {formatDate(shop.selling_since, { month: "long", year: "numeric" })}.
            </p>
          ) : null}
        </div>
      </header>

      {shop.description ? (
        <section aria-label="Sobre la tienda" className="mt-5 max-w-3xl">
          {/* Plain text with its line breaks; React escapes it, so nothing in it is markup. */}
          <p className="whitespace-pre-line break-words text-ink">{shop.description}</p>
        </section>
      ) : null}

      <section aria-labelledby="productos-tienda" className="mt-8">
        <h2 id="productos-tienda" className="text-xl font-bold">
          Lo que vende ({shop.products.length})
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Con el precio de esta tienda. En cada producto puede ver si otras tiendas también lo
          venden.
        </p>
        <div className="mt-4">
          {shop.products.length === 0 ? (
            <EmptyState
              title="Esta tienda no tiene productos a la venta ahora"
              action={
                <Link href={"/buscar" as Route} className="text-link underline">
                  Buscar en todo Yuntera
                </Link>
              }
            >
              Vuelva pronto o busque el producto en otras tiendas.
            </EmptyState>
          ) : (
            <ProductGrid products={shop.products.map(toCard)} />
          )}
        </div>
      </section>
    </>
  );
}

function ShopSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Cargando tienda…</span>
      <div className="flex items-center gap-4">
        <Skeleton className="size-20" />
        <Skeleton className="h-8 w-64" />
      </div>
      <Skeleton className="h-20 max-w-3xl" />
      <Skeleton className="h-80" />
    </div>
  );
}
