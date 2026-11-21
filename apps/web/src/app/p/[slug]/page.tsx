import {
  daysBetween,
  type OfferCandidate,
  selectFeaturedOffer,
  toCostaRicaTime,
} from "@yuntera/core";
import type { ProductOffer, ProductPage } from "@yuntera/db";
import { Alert, Badge, formatDate, formatPrice, Price, Skeleton, Stars } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AddToCart } from "@/components/add-to-cart";
import { ProductGrid } from "@/components/product-card";
import { readLocation } from "@/lib/cart";
import { getProductPage } from "@/lib/data";

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductPage(slug, null);
  if (!product) return { title: "Producto no encontrado" };
  return {
    title: product.title,
    description: (product.description ?? product.bullet_points.join(". ")).slice(0, 160),
    alternates: { canonical: `/p/${slug}` },
    openGraph: { title: product.title, images: product.images[0] ? [product.images[0].path] : [] },
  };
}

export default function ProductRoute(props: PageProps<"/p/[slug]">) {
  return (
    <div className="shell py-6 md:py-8">
      <Suspense fallback={<ProductSkeleton />}>
        <Product {...props} />
      </Suspense>
    </div>
  );
}

/** Turns an offer from the API into the shape the featured-offer rule scores. */
function toCandidate(offer: ProductOffer, today: string): OfferCandidate {
  return {
    offerId: offer.offer_id,
    sellerId: offer.seller.slug,
    priceMinor: offer.price_minor,
    // Shipping is charged per order, not per offer, so it does not separate offers here.
    shippingMinor: 0,
    availableQuantity: offer.available,
    promiseDays: offer.promise
      ? Math.max(0, daysBetween(today, offer.promise.latest))
      : offer.fulfillment === "platform"
        ? 1
        : 1 + offer.handling_days,
    fulfilledByPlatform: offer.fulfillment === "platform",
    sellerScore: offer.seller.score,
    sellerStatus:
      offer.seller.health === "critico"
        ? "suspended"
        : offer.seller.health === "en_riesgo"
          ? "at_risk"
          : "active",
    condition: offer.condition,
    listedAt: offer.listed_at,
  };
}

async function Product({ params, searchParams }: PageProps<"/p/[slug]">) {
  const [{ slug }, query, location] = await Promise.all([params, searchParams, readLocation()]);
  const product = await getProductPage(slug, location.postalCode);
  if (!product) notFound();

  const requested = Array.isArray(query.v) ? query.v[0] : query.v;
  const sku =
    product.skus.find((k) => k.code === requested) ??
    product.skus.find((k) => k.offers.some((o) => o.available > 0)) ??
    product.skus[0];

  // "Today" is a request-time fact: say so explicitly, so it is never baked into a prerender.
  await connection();
  const today = toCostaRicaTime(new Date()).date;
  const offers = sku?.offers ?? [];
  const selection = selectFeaturedOffer(offers.map((offer) => toCandidate(offer, today)));
  const byId = new Map(offers.map((offer) => [offer.offer_id, offer]));
  const featured = selection.featured ? byId.get(selection.featured.offer.offerId) : undefined;
  const others = selection.ranked
    .map((scored) => byId.get(scored.offer.offerId))
    .filter((offer): offer is ProductOffer => offer !== undefined && offer !== featured);

  return (
    <>
      <Breadcrumbs product={product} />

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_22rem]">
        <div className="overflow-hidden rounded-lg border border-border bg-arena-100">
          {product.images[0] ? (
            // biome-ignore lint/performance/noImgElement: SVG placeholders gain nothing from next/image
            <img
              src={product.images[0].path}
              alt={product.images[0].alt || product.title}
              width={800}
              height={800}
              className="aspect-square size-full object-cover"
            />
          ) : (
            <div className="aspect-square" />
          )}
        </div>

        <div className="flex flex-col gap-4">
          {product.brand ? (
            <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              {product.brand}
            </p>
          ) : null}
          <h1 className="text-2xl font-bold md:text-3xl">{product.title}</h1>
          <a href="#resenas" className="w-fit rounded-md">
            <Stars ratingSum={product.rating_sum} ratingCount={product.rating_count} />
          </a>
          {product.made_in_cr ? (
            <Badge tone="success" className="w-fit">
              Hecho en Costa Rica
            </Badge>
          ) : null}

          {product.skus.length > 1 ? (
            <div>
              <p className="text-sm font-semibold">Opciones</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {product.skus.map((option) => {
                  const selected = option.id === sku?.id;
                  const inStock = option.offers.some((o) => o.available > 0);
                  return (
                    <li key={option.id}>
                      <Link
                        href={`/p/${product.slug}?v=${option.code}` as Route}
                        aria-current={selected ? "true" : undefined}
                        replace
                        scroll={false}
                        className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm ${
                          selected
                            ? "border-brand bg-brand-soft font-semibold text-link"
                            : "border-border-strong hover:bg-surface-muted"
                        } ${inStock ? "" : "text-ink-muted line-through"}`}
                      >
                        {option.variant_name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {product.bullet_points.length > 0 ? (
            <ul className="list-disc space-y-1.5 pl-5 text-ink">
              {product.bullet_points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          ) : null}
          {product.description ? <p className="text-ink-muted">{product.description}</p> : null}
          <Link
            href={`/reportar?producto=${product.id}` as Route}
            className="inline-flex min-h-11 w-fit items-center text-sm text-link underline"
          >
            Reportar un problema
          </Link>
        </div>

        <BuyBox product={product} featured={featured} chosenLocation={location.chosen} />
      </div>

      {others.length > 0 ? (
        <section aria-labelledby="otras-ofertas" className="mt-10">
          <h2 id="otras-ofertas" className="text-xl font-bold">
            Otras ofertas de este producto
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Destacamos la oferta con la mejor combinación de precio, rapidez de entrega y desempeño
            del vendedor.{" "}
            <Link href="/ayuda#como-ordenamos" className="text-link underline">
              Cómo la elegimos
            </Link>
            .
          </p>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {others.map((offer) => (
              <li key={offer.offer_id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Price
                      amountMinor={offer.price_minor}
                      listAmountMinor={offer.list_price_minor}
                    />
                    <OfferFacts offer={offer} />
                  </div>
                  {offer.available > 0 ? (
                    <div className="w-full sm:w-56">
                      <AddToCart offerId={offer.offer_id} available={offer.available} />
                    </div>
                  ) : (
                    <Badge tone="warning">Agotado</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Reviews product={product} />

      {product.related.length > 0 ? (
        <section aria-labelledby="relacionados" className="mt-12">
          <h2 id="relacionados" className="text-xl font-bold">
            {product.related.some((r) => r.kind === "bought_together")
              ? "Quienes compraron esto también llevaron"
              : "Productos parecidos"}
          </h2>
          <div className="mt-4">
            <ProductGrid products={product.related.slice(0, 4)} />
          </div>
        </section>
      ) : null}

      <StructuredData product={product} featured={featured} />
    </>
  );
}

function Breadcrumbs({ product }: { product: ProductPage }) {
  return (
    <nav aria-label="Ruta" className="text-sm text-ink-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/" className="hover:underline">
            Inicio
          </Link>
        </li>
        {product.breadcrumbs.map((crumb) => (
          <li key={crumb.slug} className="before:mr-1.5 before:content-['/']">
            <Link href={`/c/${crumb.slug}` as Route} className="hover:underline">
              {crumb.name_es}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Who sells it, who delivers it, and when it arrives: the facts the law wants in plain sight. */
function OfferFacts({ offer }: { offer: ProductOffer }) {
  return (
    <dl className="mt-2 space-y-1 text-sm">
      <div className="flex gap-1.5">
        <dt className="text-ink-muted">Vendido por</dt>
        <dd className="font-semibold">{offer.seller.trade_name}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-ink-muted">Entrega</dt>
        <dd>
          {offer.fulfillment === "platform"
            ? "Sale de la bodega de Yuntera"
            : "El vendedor lo despacha y Yuntera lo entrega"}
        </dd>
      </div>
      {offer.promise ? (
        <div className="flex gap-1.5">
          <dt className="text-ink-muted">Llega</dt>
          <dd className="font-semibold text-success">
            {offer.promise.earliest === offer.promise.latest
              ? `el ${formatDate(offer.promise.latest)}`
              : `entre el ${formatDate(offer.promise.earliest)} y el ${formatDate(offer.promise.latest)}`}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function BuyBox({
  product,
  featured,
  chosenLocation,
}: {
  product: ProductPage;
  featured: ProductOffer | undefined;
  chosenLocation: boolean;
}) {
  const zone = product.zone;
  return (
    <aside
      aria-label="Comprar"
      className="h-fit rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      {featured ? (
        <>
          <Price
            amountMinor={featured.price_minor}
            listAmountMinor={featured.list_price_minor}
            size="lg"
          />
          <p className="mt-1 text-xs text-ink-muted">Precio final, IVA incluido.</p>
          <OfferFacts offer={featured} />

          {zone && !zone.active ? (
            <Alert tone="warning" className="mt-4" title="Todavía no entregamos en su zona">
              Por ahora llegamos al Gran Área Metropolitana.{" "}
              <Link href="/zona" className="underline">
                Cambiar de zona
              </Link>
            </Alert>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              {zone
                ? zone.free_shipping_threshold_minor
                  ? `Envío ${formatPrice(zone.shipping_fee_minor)}; gratis en pedidos desde ${formatPrice(zone.free_shipping_threshold_minor)}.`
                  : `Envío ${formatPrice(zone.shipping_fee_minor)}.`
                : null}{" "}
              {chosenLocation ? null : (
                <Link
                  href={`/zona?siguiente=/p/${product.slug}` as Route}
                  className="text-link underline"
                >
                  Elija su zona para confirmar la fecha
                </Link>
              )}
            </p>
          )}

          <div className="mt-4">
            {featured.available > 0 ? (
              <>
                {featured.available <= 3 ? (
                  <p className="mb-2 text-sm font-semibold text-warning">
                    {featured.available === 1
                      ? "Queda 1 unidad"
                      : `Quedan ${featured.available} unidades`}
                  </p>
                ) : null}
                <AddToCart offerId={featured.offer_id} available={featured.available} />
              </>
            ) : (
              <Alert tone="warning">Agotado por ahora.</Alert>
            )}
          </div>
        </>
      ) : (
        <Alert tone="warning" title="No disponible por ahora">
          Ningún vendedor tiene este producto en este momento.
        </Alert>
      )}

      <ul className="mt-5 space-y-2 border-t border-border pt-4 text-sm text-ink-muted">
        <li>
          <strong className="text-ink">Devolución:</strong> 8 días hábiles desde que lo recibe, sin
          dar explicaciones.
        </li>
        <li>
          <strong className="text-ink">Garantía:</strong>{" "}
          {product.warranty_months > 1
            ? `${product.warranty_months} meses con el vendedor.`
            : "30 días hábiles por ley."}
        </li>
        <li>
          <strong className="text-ink">Pago:</strong> SINPE Móvil, tarjeta o contra entrega.
        </li>
      </ul>
    </aside>
  );
}

function Reviews({ product }: { product: ProductPage }) {
  const total = product.rating_count;
  return (
    <section id="resenas" aria-labelledby="resenas-titulo" className="mt-12 scroll-mt-28">
      <h2 id="resenas-titulo" className="text-xl font-bold">
        Reseñas de quienes lo compraron
      </h2>
      {total === 0 ? (
        <p className="mt-3 text-ink-muted">
          Todavía no tiene reseñas. Solo puede reseñar quien compró y recibió el producto.
        </p>
      ) : (
        <div className="mt-4 grid gap-8 md:grid-cols-[16rem_1fr]">
          <div>
            <Stars ratingSum={product.rating_sum} ratingCount={product.rating_count} />
            <dl className="mt-3 space-y-1.5 text-sm">
              {[5, 4, 3, 2, 1].map((stars) => {
                const count = product.rating_histogram[String(stars)] ?? 0;
                const percent = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={stars} className="flex items-center gap-2">
                    <dt className="w-20 whitespace-nowrap text-ink-muted">
                      {stars} {stars === 1 ? "estrella" : "estrellas"}
                    </dt>
                    <dd className="flex flex-1 items-center gap-2">
                      <span
                        className="h-2 flex-1 overflow-hidden rounded-full bg-arena-200"
                        aria-hidden="true"
                      >
                        <span className="block h-full bg-rating" style={{ width: `${percent}%` }} />
                      </span>
                      <span className="w-6 text-right tabular-nums">{count}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Publicamos todas las reseñas de compras verificadas, buenas y malas.
            </p>
          </div>

          <ul className="space-y-5">
            {product.reviews.map((review) => (
              <li key={review.id} className="border-b border-border pb-5 last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars ratingSum={review.rating} ratingCount={1} showCount={false} />
                  <span className="text-sm font-semibold">{review.author}</span>
                  <span className="text-sm text-ink-muted">
                    {formatDate(review.created_at, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
                {review.title ? <p className="mt-2 font-semibold">{review.title}</p> : null}
                {review.body ? <p className="mt-1 text-ink">{review.body}</p> : null}
                {review.seller_reply ? (
                  <p className="mt-3 rounded-md bg-surface-muted p-3 text-sm">
                    <span className="font-semibold">Respuesta del vendedor: </span>
                    {review.seller_reply}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Product data for search engines (schema.org), so results can show price and rating. */
function StructuredData({
  product,
  featured,
}: {
  product: ProductPage;
  featured: ProductOffer | undefined;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description ?? undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: product.images.map((image) => image.path),
    aggregateRating:
      product.rating_count > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: (product.rating_sum / product.rating_count).toFixed(1),
            reviewCount: product.rating_count,
          }
        : undefined,
    offers: featured
      ? {
          "@type": "Offer",
          price: (featured.price_minor / 100).toFixed(2),
          priceCurrency: "CRC",
          availability:
            featured.available > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          seller: { "@type": "Organization", name: featured.seller.trade_name },
        }
      : undefined,
  };
  return (
    <script
      type="application/ld+json"
      // Escaping "<" keeps seller-written text from closing the script element.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must be emitted as raw script content
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

function ProductSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-8 lg:grid-cols-[1fr_1fr_22rem]">
      <span className="sr-only">Cargando producto…</span>
      <Skeleton className="aspect-square" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}
