import { ApiError, COUNT_IN_LIMITS, type WmsLocationStock } from "@yuntera/db";
import { messageOf, sessionApi } from "@yuntera/next-kit/server";
import { Alert, buttonClass, Skeleton } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CountInForm } from "./count-in-form";

/** The kinds of location that take counted units (the database's count_not_shelf rule). */
const TAKES_COUNTS = new Set(["storage", "pick", "returns", "receiving"]);

/**
 * "Count a product that is not in the list": the worker found units of a
 * product on this location that the list does not show. They look it up by
 * its code, barcode or name (a plain GET form: the search is in the
 * address, `buscar`), choose the shop and count. A product no shop keeps in
 * this warehouse cannot be counted: its first units come in with a receipt.
 */
export async function CountIn({ location, query }: { location: WmsLocationStock; query: string }) {
  const here = { id: location.id, code: location.code };
  const closed = !location.active
    ? "Esta ubicación está desactivada: aquí no se cuentan productos nuevos. Llévelos a un estante activo y cuéntelos allí."
    : !TAKES_COUNTS.has(location.kind)
      ? "En esta zona no se suman unidades: lo que se guarda aquí no se vende. Si están en buen estado, llévelas a un estante y cuéntelas allí; si no, avise a operaciones."
      : null;
  return (
    <section
      aria-labelledby="contar-nuevo"
      className="rounded-lg border border-border bg-surface p-4"
      data-testid="count-in"
    >
      <h2 id="contar-nuevo" className="text-lg font-bold">
        Contar un producto que no está en la lista
      </h2>
      {/* One slot each, whatever the location's state: a form refused because
          the location was switched off meanwhile keeps its place (its refusal
          and what was typed) when the page is drawn again. */}
      {closed ? (
        <p className="mt-2 text-sm text-ink-muted" data-testid="count-in-closed">
          {closed}
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-muted">
          ¿Encontró aquí unidades de un producto que la lista no muestra? Búsquelo por su código, su
          código de barras o su nombre, y cuente lo que hay.
        </p>
      )}
      {closed ? null : (
        <form action="/bodega/ubicacion" className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="codigo" value={location.code} />
          <label htmlFor="buscar" className="text-sm font-semibold">
            Código o nombre del producto
          </label>
          <div className="flex gap-2">
            <input
              id="buscar"
              name="buscar"
              autoComplete="off"
              defaultValue={query}
              minLength={COUNT_IN_LIMITS.query[0]}
              maxLength={COUNT_IN_LIMITS.query[1]}
              required
              className="min-h-11 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3"
            />
            <button type="submit" className={buttonClass({ variant: "secondary" })}>
              Buscar
            </button>
          </div>
        </form>
      )}
      {!query ? null : query.length < COUNT_IN_LIMITS.query[0] ? (
        // The lookup answers nothing below 2 characters: say what to type,
        // not that no product has that code or name.
        <div className="mt-3">
          <Alert tone="warning" title="Escriba un poco más">
            Escriba al menos 2 letras o números del código o del nombre del producto.
          </Alert>
        </div>
      ) : (
        // Its own wait: the location's list above is not held back by the lookup.
        <Suspense fallback={<Skeleton className="mt-4 h-24" />}>
          <Results location={location} here={here} query={query} closed={closed !== null} />
        </Suspense>
      )}
    </section>
  );
}

async function Results({
  location,
  here,
  query,
  closed,
}: {
  location: WmsLocationStock;
  here: { id: string; code: string };
  query: string;
  /** The location takes no counts now: only a form refused just now stays, with its refusal. */
  closed: boolean;
}) {
  const api = await sessionApi();
  // A refused or failed lookup is said here; the location's page stays.
  const found = await api.wmsCountCandidates(location.id, query).catch((error: unknown) => {
    if (error instanceof ApiError) return error;
    throw error;
  });
  if (found instanceof ApiError) {
    return (
      <div className="mt-3">
        <Alert tone="danger" title="No se pudo buscar el producto">
          {messageOf(found)}
        </Alert>
      </div>
    );
  }
  if (found.length === 0) {
    return (
      <div className="mt-3">
        <Alert tone="warning" title="No encontramos ese producto">
          Ningún producto que se guarde en {location.warehouse.name} tiene el código o el nombre «
          {query}». Revise el código o pruebe con otra parte del nombre.
        </Alert>
      </div>
    );
  }
  return (
    <ul className="mt-4 flex flex-col gap-4" data-testid="count-in-results">
      {found.map((product) => {
        const kept = product.shops.filter((shop) => shop.stock_record);
        const elsewhere = product.shops.filter((shop) => !shop.stock_record);
        return (
          <li
            key={product.sku_id}
            className="border-t border-border pt-3"
            data-count-sku={product.sku_code}
          >
            <p className="font-semibold">
              {product.title}
              {product.variant_name ? ` · ${product.variant_name}` : ""}
            </p>
            <p className="text-sm text-ink-muted">
              {product.sku_code}
              {product.gtin ? ` · ${product.gtin}` : ""}
            </p>
            {kept.length === 0 ? (
              <div className="mt-2">
                <Alert tone="info" title="No se puede contar aquí">
                  Ninguna tienda tiene existencias registradas de este producto en{" "}
                  {location.warehouse.name}. Las primeras unidades de una tienda entran con una
                  recepción: búsquela en «Mercadería por recibir», en el inicio de Bodega. Si la
                  tienda no anunció el envío, avise a operaciones.
                </Alert>
                <p className="mt-2 text-sm">
                  <Link
                    href={"/bodega#recepciones" as Route}
                    className="inline-flex min-h-11 items-center text-link underline"
                  >
                    Ver la mercadería por recibir
                  </Link>
                </p>
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-3">
                {kept
                  .filter((shop) => shop.listed)
                  .map((shop) => (
                    <p key={shop.seller_id} className="text-sm" data-testid="count-in-listed">
                      Ya está en esta ubicación, de {shop.seller_name}
                      {shop.on_shelf > 0 ? ` (${shop.on_shelf} en el estante)` : ""}: corrija la
                      cantidad en su línea, en la lista de arriba.
                    </p>
                  ))}
                {elsewhere.map((shop) => (
                  <p key={shop.seller_id} className="text-sm text-ink-muted">
                    {shop.seller_name} también vende este producto, pero no tiene existencias
                    registradas en esta bodega: sus primeras unidades entran con una recepción.
                  </p>
                ))}
                <CountInForm location={here} product={product} closed={closed} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
