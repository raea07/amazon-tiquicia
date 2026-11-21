import { ProductImage } from "@yuntera/next-kit/product-image";
import { Alert, buttonClass, EmptyState, formatDate, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { updateCartLine } from "@/app/actions";
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
  const hasUnavailable = lines.some((line) => !line.buyable);

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
                  <Alert tone="warning" title={line.title ?? "Producto no disponible"}>
                    Ya no está disponible. Quítelo para continuar con su compra.
                  </Alert>
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
            Todavía no entregamos en la zona elegida.{" "}
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
            <Alert tone="warning">Quite los productos no disponibles para continuar.</Alert>
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
