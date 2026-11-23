import { sessionApi } from "@yuntera/next-kit/server";
import { Alert, Badge, buttonClass, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireWarehouse } from "@/lib/access";
import { locationHref } from "@/lib/locations";

export const metadata: Metadata = { title: "Buscar un producto" };

export default function LookupPage({ searchParams }: PageProps<"/bodega/buscar">) {
  return (
    <div className="shell max-w-2xl py-6">
      <p className="text-sm">
        <Link href="/bodega" className="text-link underline">
          ← Bodega
        </Link>
      </p>
      <h1 className="mt-3 text-2xl font-bold">Buscar un producto</h1>
      <form action="/bodega/buscar" className="mt-4 flex gap-2">
        <label htmlFor="codigo" className="sr-only">
          Código de barras o código YT
        </label>
        <input
          id="codigo"
          name="codigo"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="Escanee o escriba el código"
          className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3"
        />
        <button type="submit" className={buttonClass()}>
          Buscar
        </button>
      </form>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-40" />}>
          <Result searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Result({ searchParams }: Pick<PageProps<"/bodega/buscar">, "searchParams">) {
  const warehouse = await requireWarehouse("/bodega/buscar");
  const asked = (await searchParams).codigo;
  const code = (Array.isArray(asked) ? asked[0] : asked)?.trim().slice(0, 40);
  if (!code) {
    return (
      <p className="text-sm text-ink-muted">
        Le decimos en qué ubicaciones está y cuántas unidades hay.
      </p>
    );
  }

  const sku = await (await sessionApi()).wmsFindSku(warehouse.id, code);
  if (!sku)
    return (
      <Alert tone="warning">No hay ningún producto con el código “{code}” en esta bodega.</Alert>
    );

  const total = sku.bins.reduce((sum, bin) => sum + bin.quantity, 0);
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-lg font-bold">{sku.title}</h2>
      <p className="text-sm text-ink-muted">
        {sku.sku_code}
        {sku.gtin ? ` · ${sku.gtin}` : ""}
        {sku.variant_name ? ` · ${sku.variant_name}` : ""}
      </p>
      {sku.bins.length === 0 ? (
        <p className="mt-3 text-sm">No hay unidades en ninguna ubicación.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border text-sm">
            {sku.bins.map((bin) => (
              <li key={`${bin.location_id}:${bin.seller_id}`}>
                <Link
                  href={locationHref(bin.location_code)}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-surface-muted"
                >
                  <span>
                    <span className="font-display text-lg font-bold text-link underline">
                      {bin.location_code}
                    </span>
                    <span className="ml-2 text-ink-muted">de {bin.seller_name}</span>
                    {bin.location_active ? null : (
                      <span className="ml-2">
                        <Badge tone="warning">Desactivada</Badge>
                      </span>
                    )}
                    {bin.promised > 0 ? (
                      <span className="block text-xs text-ink-muted">
                        {bin.promised} {bin.promised === 1 ? "espera" : "esperan"} a pedidos ·{" "}
                        {bin.free} libres
                      </span>
                    ) : null}
                  </span>
                  <span className="font-display text-lg font-bold tabular-nums">
                    {bin.quantity}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-muted">Total en bodega: {total} unidades.</p>
        </>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        Si lo que ve en el estante no coincide, abra la ubicación y corrija la cantidad con lo que
        contó, con el motivo.
      </p>
    </section>
  );
}
