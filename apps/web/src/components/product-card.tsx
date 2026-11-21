import { Badge, Price, Stars } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";

/** The fields a card needs; both search results and "related products" provide them. */
export interface CardProduct {
  slug: string;
  title: string;
  image_path: string | null;
  min_price_minor: number;
  list_price_minor: number | null;
  in_stock: boolean;
  rating_sum: number;
  rating_count: number;
  fulfilled_by_platform: boolean;
  made_in_cr?: boolean;
  brand_name?: string | null;
}

export function ProductCard({
  product,
  priority = false,
}: {
  product: CardProduct;
  priority?: boolean;
}) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface transition-shadow hover:shadow-md">
      <div className="relative aspect-square bg-arena-100">
        {product.image_path ? (
          // Demo pictures are small local SVGs; seller photos will go through the image optimiser.
          // biome-ignore lint/performance/noImgElement: SVG placeholders gain nothing from next/image
          <img
            src={product.image_path}
            alt=""
            width={400}
            height={400}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="size-full object-cover"
          />
        ) : null}
        {product.made_in_cr ? (
          <Badge tone="success" className="absolute left-2 top-2">
            Hecho en Costa Rica
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {product.brand_name ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {product.brand_name}
          </p>
        ) : null}
        <h3 className="line-clamp-2 font-sans text-sm font-semibold leading-snug tracking-normal text-ink">
          {/* The link covers the whole card, so the entire tile is one large touch target. */}
          <Link
            href={`/p/${product.slug}` as Route}
            className="after:absolute after:inset-0 group-hover:underline"
          >
            {product.title}
          </Link>
        </h3>
        <Stars ratingSum={product.rating_sum} ratingCount={product.rating_count} />
        <div className="mt-auto flex flex-col gap-1 pt-1">
          <Price amountMinor={product.min_price_minor} listAmountMinor={product.list_price_minor} />
          {product.in_stock ? (
            <p className="text-xs text-ink-muted">
              {product.fulfilled_by_platform ? "Entregado por Yuntera" : "Enviado por el vendedor"}
            </p>
          ) : (
            <p className="text-xs font-semibold text-warning">Agotado por ahora</p>
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products }: { products: CardProduct[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.slug}>
          <ProductCard product={product} priority={index < 4} />
        </li>
      ))}
    </ul>
  );
}
