import { Alert, buttonClass, formatDate, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AddressForm } from "@/components/address-form";
import { CheckoutForm } from "@/components/checkout-form";
import { readCart, readLocation } from "@/lib/cart";
import { getDistricts } from "@/lib/data";
import { requireViewer } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

export const metadata: Metadata = { title: "Finalizar compra", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <div className="shell py-8">
      <h1 className="text-3xl font-bold">Finalizar compra</h1>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Checkout />
        </Suspense>
      </div>
    </div>
  );
}

async function Checkout() {
  const viewer = await requireViewer("/pagar");
  const items = await readCart();
  if (items.length === 0) redirect("/carrito");

  const api = await sessionApi();
  const [addresses, districts, location] = await Promise.all([
    api.myAddresses(),
    getDistricts(),
    readLocation(),
  ]);

  // First purchase: there is no address yet, so that comes first.
  if (addresses.length === 0) {
    return (
      <section className="max-w-3xl">
        <h2 className="text-xl font-bold">Primero, ¿dónde se lo entregamos?</h2>
        <p className="mt-1 text-ink-muted">La guardamos para sus próximas compras.</p>
        <div className="mt-5">
          <AddressForm
            districts={districts}
            defaultName={viewer.name}
            defaultPostalCode={location.chosen ? location.postalCode : undefined}
            returnTo="/pagar"
          />
        </div>
      </section>
    );
  }

  const target =
    addresses.find((a) => a.is_default && a.zone_active) ?? addresses.find((a) => a.zone_active);
  const quote = await api.checkoutQuote(
    items,
    target?.postal_code ?? addresses[0]?.postal_code ?? "",
  );
  const lines = await api.cartLines(items.map((item) => item.offerId));
  const quantityOf = new Map(items.map((item) => [item.offerId, item.quantity]));

  if (quote.issue && quote.issue !== "zone_not_served") {
    return (
      <Alert tone="warning" title="Revise su carrito antes de continuar">
        Algún producto cambió o ya no está disponible.{" "}
        <Link href="/carrito" className="underline">
          Volver al carrito
        </Link>
      </Alert>
    );
  }
  if (!target || quote.total_minor == null) {
    return (
      <div className="max-w-3xl">
        <Alert tone="warning" title="Por ahora no entregamos en sus direcciones guardadas">
          Para comprar ahora, agregue una dirección en una zona donde sí entregamos. Sus direcciones
          quedan guardadas: cuando volvamos a entregar ahí, podrá elegirlas de nuevo.
        </Alert>
        <div className="mt-6">
          <AddressForm districts={districts} defaultName={viewer.name} returnTo="/pagar" />
        </div>
      </div>
    );
  }

  // A fresh key per rendering of this page: resubmitting the same form cannot create a second order.
  await connection();
  const idempotencyKey = crypto.randomUUID();

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
      <div>
        {quote.payments_mode === "sandbox" ? (
          <Alert tone="info" className="mb-6" title="Sitio en modo de prueba">
            Los pagos son simulados: no se cobra dinero real ni se entrega ningún producto.
          </Alert>
        ) : null}
        {quote.payments_mode === "test" ? (
          <Alert tone="info" className="mb-6" title="Pagos de prueba">
            El cobro pasa por el entorno de pruebas del procesador de pagos: no se cobra dinero
            real.
          </Alert>
        ) : null}
        <CheckoutForm
          addresses={addresses}
          totalMinor={quote.total_minor}
          codAvailable={quote.cod_available ?? false}
          throughGateway={quote.payments_mode !== "sandbox"}
          idempotencyKey={idempotencyKey}
          shippingMinor={quote.shipping_minor ?? 0}
        />
        <p className="mt-6 text-sm">
          <Link href="/cuenta#direcciones" className="text-link underline">
            Agregar o cambiar direcciones
          </Link>
        </p>
      </div>

      {/* The full breakdown, visible before confirming: every charge and the tax inside it. */}
      <aside
        aria-label="Resumen del pedido"
        className="h-fit rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-lg font-bold">4. Resumen del pedido</h2>
        <ul className="mt-4 space-y-3 text-sm">
          {lines.map((line) => (
            <li key={line.offer_id} className="flex justify-between gap-3">
              <span>
                {quantityOf.get(line.offer_id)} × {line.title}
                <span className="block text-xs text-ink-muted">Vendido por {line.seller_name}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {formatPrice((line.price_minor ?? 0) * (quantityOf.get(line.offer_id) ?? 1))}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between">
            <dt>Productos</dt>
            <dd className="tabular-nums">{formatPrice(quote.items_total_minor ?? 0)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Envío</dt>
            <dd className="tabular-nums">
              {quote.shipping_minor === 0 ? "Gratis" : formatPrice(quote.shipping_minor ?? 0)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
            <dt>Total a pagar</dt>
            <dd className="tabular-nums">{formatPrice(quote.total_minor)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-ink-muted">
          Precio final en colones. Incluye {formatPrice(quote.tax_included_minor ?? 0)} de IVA.
        </p>
        {quote.promise ? (
          <p className="mt-4 rounded-md bg-selva-50 p-3 text-sm font-semibold text-selva-900">
            Llega el {formatDate(quote.promise.latest)} a {target.district}.
          </p>
        ) : null}
        <Link
          href="/carrito"
          className={buttonClass({ variant: "ghost", size: "sm", className: "mt-3" })}
        >
          Editar carrito
        </Link>
      </aside>
    </div>
  );
}
