import type { CartLine, DatedCartAlternative } from "@yuntera/db";
import { ProductImage } from "@yuntera/next-kit/product-image";
import { Alert, buttonClass, EmptyState, formatDate, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { updateCartLine } from "@/app/actions";
import { swapCartOffer } from "@/app/cart-actions";
import { readCart, readLocation } from "@/lib/cart";
import { publicApi } from "@/lib/supabase";

export const metadata: Metadata = { title: "Carrito", robots: { index: false } };

export default function CartPage() {
  return (
    <div className="shell py-8">
      <h1 className="text-3xl font-bold">Su carrito</h1>
      <div className="mt-6">
        {/* The cart is read from this visitor's cookie, so it renders per request. */}
        <Suspense fallback={<Skeleton className="h-64" />}>
          <Cart />
        </Suspense>
      </div>
    </div>
  );
}

async function Cart() {
  const [items, location] = await Promise.all([readCart(), readLocation()]);
  if (items.length === 0) {
    return (
      <EmptyState
        title="Su carrito está vacío"
        action={
          <Link href="/buscar" className={buttonClass()}>
            Ver productos
          </Link>
        }
      >
        Cuando agregue productos los verá aquí.
      </EmptyState>
    );
  }

  // Prices and stock are read fresh every time: the cookie only remembers what and how many.
  const api = publicApi();
  const [lines, quote] = await Promise.all([
    api.cartLines(items.map((item) => item.offerId)),
    api.checkoutQuote(items, location.postalCode),
  ]);
  const quantityOf = new Map(items.map((item) => [item.offerId, item.quantity]));
  const unavailable = lines.filter((line) => !line.buyable).map((line) => line.offer_id);
  const hasUnavailable = unavailable.length > 0;
  // Another shop may still sell what the shopper chose: say so, instead of
  // "gone", with when it would arrive in the district the cart is priced for
  // (the date that offer's product page gives for it).
  // If the other shops cannot be checked, the cart still shows (it never
  // says that nobody else sells the line while that is unknown).
  const alternatives = hasUnavailable
    ? await api.cartAlternatives(unavailable, location.postalCode).catch(() => null)
    : [];
  const alternativesUnread = alternatives === null;
  const alternativeOf = new Map((alternatives ?? []).map((alt) => [alt.offer_id, alt]));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <ul className="flex flex-col gap-3">
        {lines.map((line) => {
          const quantity = quantityOf.get(line.offer_id) ?? 1;
          return (
            <li
              key={line.offer_id}
              className="flex gap-4 rounded-lg border border-border bg-surface p-4"
            >
              <div className="size-20 shrink-0 overflow-hidden rounded-md bg-arena-100 sm:size-24">
                {line.image_path ? (
                  <ProductImage
                    path={line.image_path}
                    alt=""
                    sizes="96px"
                    className="size-full object-contain"
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {line.buyable && line.product_slug ? (
                  <>
                    <Link
                      href={`/p/${line.product_slug}` as Route}
                      className="font-semibold hover:underline"
                    >
                      {line.title}
                    </Link>
                    <p className="text-sm text-ink-muted">
                      {line.variant_name ? `${line.variant_name} · ` : ""}Vendido por{" "}
                      {line.seller_name}
                    </p>
                  </>
                ) : (
                  <UnavailableLine
                    line={line}
                    alternative={alternativeOf.get(line.offer_id)}
                    alternativesUnread={alternativesUnread}
                    quantity={quantity}
                  />
                )}

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <form action={updateCartLine} className="flex items-center gap-2">
                    <input type="hidden" name="offerId" value={line.offer_id} />
                    {line.buyable ? (
                      <>
                        <label htmlFor={`q-${line.offer_id}`} className="text-sm text-ink-muted">
                          Cantidad
                        </label>
                        <select
                          id={`q-${line.offer_id}`}
                          name="quantity"
                          defaultValue={Math.min(quantity, Math.max(line.available, 1))}
                          className="min-h-11 rounded-md border border-border-strong bg-surface px-2"
                        >
                          {Array.from({ length: Math.max(line.available, 1) }, (_, i) => i + 1).map(
                            (n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ),
                          )}
                        </select>
                        <button
                          type="submit"
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          Actualizar
                        </button>
                      </>
                    ) : null}
                    <button
                      type="submit"
                      name="quantity"
                      value="0"
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      Quitar
                    </button>
                  </form>
                  {line.buyable && line.price_minor !== null ? (
                    <p className="font-display text-lg font-bold tabular-nums">
                      {formatPrice(line.price_minor * quantity)}
                    </p>
                  ) : null}
                </div>
                {line.buyable && quantity > line.available ? (
                  <p className="text-sm font-medium text-warning">
                    Solo quedan {line.available}. Actualice la cantidad.
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <aside aria-label="Resumen" className="h-fit rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-bold">Resumen</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>Productos</dt>
            <dd className="tabular-nums">{formatPrice(quote.items_total_minor ?? 0)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Envío {location.chosen ? "" : "(estimado)"}</dt>
            <dd className="tabular-nums">
              {quote.shipping_minor === 0
                ? "Gratis"
                : quote.shipping_minor != null
                  ? formatPrice(quote.shipping_minor)
                  : "—"}
            </dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">
              {quote.total_minor != null ? formatPrice(quote.total_minor) : "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-ink-muted">
          Incluye {formatPrice(quote.tax_included_minor ?? 0)} de IVA.
        </p>

        {quote.promise ? (
          <p className="mt-3 text-sm font-semibold text-success">
            Llega el {formatDate(quote.promise.latest)}
          </p>
        ) : null}
        {quote.issue === "zone_not_served" ? (
          <Alert tone="warning" className="mt-3">
            Por ahora no entregamos en la zona elegida.{" "}
            <Link href="/zona?siguiente=/carrito" className="underline">
              Cambiar de zona
            </Link>
          </Alert>
        ) : null}
        {!location.chosen ? (
          <p className="mt-3 text-sm">
            <Link href="/zona?siguiente=/carrito" className="text-link underline">
              Elija su zona
            </Link>{" "}
            para ver el envío y la fecha exactos.
          </p>
        ) : null}

        <div className="mt-5">
          {hasUnavailable ? (
            <Alert tone="warning">
              {alternativeOf.size > 0 || alternativesUnread
                ? "Cambie o quite los productos que ya no están disponibles para continuar. El total cambia cuando lo haga."
                : "Quite los productos no disponibles para continuar. El total cambia cuando lo haga."}
            </Alert>
          ) : (
            <Link href="/pagar" className={buttonClass({ size: "lg", block: true })}>
              Continuar con la compra
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * A line the shopper cannot buy as it is. When another shop sells the same
 * variant, say whose offer ran out, who else sells it, at what price and when
 * it would arrive, and offer the swap; the product page lists every offer.
 * Otherwise, say it is not available and what to do.
 */
function UnavailableLine({
  line,
  alternative,
  alternativesUnread,
  quantity,
}: {
  line: CartLine;
  alternative: DatedCartAlternative | undefined;
  /** The other shops could not be checked. */
  alternativesUnread: boolean;
  quantity: number;
}) {
  if (!alternative) {
    const gone = line.seller_name
      ? `La oferta de ${line.seller_name} ya no está disponible`
      : "Ya no está disponible";
    return (
      <Alert tone="warning" title={line.title ?? "Producto no disponible"}>
        {alternativesUnread
          ? `${gone}. No pudimos revisar si otra tienda lo vende: recargue la página para intentarlo de nuevo, o quítelo para continuar con su compra.`
          : `${gone} y ninguna otra tienda lo vende ahora. Quítelo para continuar con su compra.`}
      </Alert>
    );
  }
  const what = `${alternative.title}${alternative.variant_name ? `, ${alternative.variant_name}` : ""}`;
  const soldOut = line.seller_name && line.available === 0;
  return (
    <Alert tone="warning" title={what}>
      <p>
        {line.seller_name
          ? soldOut
            ? `La oferta de ${line.seller_name} se agotó.`
            : `La oferta de ${line.seller_name} ya no está a la venta.`
          : "La oferta que eligió ya no está a la venta."}{" "}
        {alternative.seller_name} lo vende a {formatPrice(alternative.price_minor)}
        {quantity > alternative.available ? ` (le quedan ${alternative.available})` : ""}.
      </p>
      {alternative.promise ? (
        <p className="mt-1 font-semibold" data-testid="cart-alternative-arrival">
          {alternative.promise.earliest === alternative.promise.latest
            ? `Llega el ${formatDate(alternative.promise.latest)}`
            : `Llega entre el ${formatDate(alternative.promise.earliest)} y el ${formatDate(alternative.promise.latest)}`}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <form action={swapCartOffer}>
          <input type="hidden" name="from" value={line.offer_id} />
          <input type="hidden" name="to" value={alternative.alternative_offer_id} />
          <button type="submit" className={buttonClass({ size: "sm" })}>
            Cambiar a la oferta de {alternative.seller_name}
          </button>
        </form>
        <Link
          href={`/p/${alternative.product_slug}` as Route}
          className="inline-flex min-h-11 items-center text-link underline"
        >
          Ver todas las ofertas
        </Link>
      </div>
    </Alert>
  );
}
