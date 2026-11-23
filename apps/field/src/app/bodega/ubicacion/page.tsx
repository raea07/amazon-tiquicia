import type { WmsLocationItem } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { Alert, Badge, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CountForm, MoveForm } from "@/components/stock-forms";
import { StockOutcome } from "@/components/stock-outcome";
import { requireWarehouse } from "@/lib/access";
import { LOCATION_KIND, locationHref, movedText, units } from "@/lib/locations";

export const metadata: Metadata = { title: "Ubicación" };

export default function LocationPage({ searchParams }: PageProps<"/bodega/ubicacion">) {
  return (
    <div className="shell max-w-2xl py-6">
      <p className="text-sm">
        <Link href="/bodega/ubicaciones" className="text-link underline">
          ← Ubicaciones
        </Link>
      </p>
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Location searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const count = (value: string | string[] | undefined) => {
  const text = one(value) ?? "";
  return /^-?\d{1,6}$/.test(text) ? Number(text) : null;
};

/** What the last move or correction did, as the action reported it in the address (shown once). */
function Outcome({ params }: { params: Record<string, string | string[] | undefined> }) {
  const moved = count(params.movidas);
  const target = one(params.destino) ?? "";
  if (moved !== null && moved > 0 && /^[A-Z0-9-]{1,20}$/.test(target)) {
    return <StockOutcome title="Unidades movidas">{movedText(moved, target)}</StockOutcome>;
  }
  const counted = count(params.contadas);
  const delta = count(params.diferencia);
  if (counted !== null && counted >= 0 && delta) {
    return (
      <StockOutcome title="Cantidad corregida">
        {`Ahora hay ${units(counted)} (${delta > 0 ? "+" : "−"}${Math.abs(delta)}). La tienda ve la corrección y su motivo en su inventario.`}
      </StockOutcome>
    );
  }
  return null;
}

async function Location({ searchParams }: Pick<PageProps<"/bodega/ubicacion">, "searchParams">) {
  const params = await searchParams;
  const code = one(params.codigo)?.trim().slice(0, 40) ?? "";
  const warehouse = await requireWarehouse(code ? locationHref(code) : "/bodega/ubicaciones");
  if (!code) {
    return (
      <Alert tone="info" title="Falta el código">
        Escanee la etiqueta del estante o escriba su código en{" "}
        <Link href="/bodega/ubicaciones" className="underline">
          Ubicaciones
        </Link>
        .
      </Alert>
    );
  }
  const api = await sessionApi();
  const [location, all] = await Promise.all([
    api.wmsLocationStock(warehouse.id, code),
    api.wmsStockLocations(warehouse.id),
  ]);
  if (!location) {
    return (
      <Alert tone="warning" title="No encontramos esa ubicación">
        En {warehouse.name} no hay ninguna ubicación con el código “{code}”. Revise la etiqueta o
        elíjala de la{" "}
        <Link href="/bodega/ubicaciones" className="underline">
          lista de ubicaciones
        </Link>
        .
      </Alert>
    );
  }
  const targets = all
    .filter((other) => other.shelf && other.active && other.id !== location.id)
    .map(({ id, code }) => ({ id, code }));

  return (
    <div className="flex flex-col gap-5">
      <Outcome params={params} />
      <header>
        <p className="text-sm text-ink-muted">
          {location.warehouse.name} · {LOCATION_KIND[location.kind]}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-bold">{location.code}</h1>
          {location.active ? (
            <Badge tone="success">Activa</Badge>
          ) : (
            <Badge tone="warning">Desactivada</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-muted" data-testid="location-summary">
          {location.units === 0
            ? "Está vacía."
            : `${units(location.units)} en el estante · ${location.promised} ${location.promised === 1 ? "espera" : "esperan"} a pedidos · ${location.free} libres.`}
          {location.picked_units > 0
            ? ` Además, ${units(location.picked_units)} sacadas de aquí están en paquetes que se están alistando: vuelven aquí si se cancela el pedido.`
            : ""}
        </p>
      </header>

      {location.active ? null : (
        <Alert tone="warning" title="Ubicación desactivada">
          Ya no se guarda mercadería aquí. Mueva lo que queda a un estante activo.
        </Alert>
      )}

      {location.items.length === 0 ? (
        <p className="text-sm text-ink-muted">No hay productos en esta ubicación.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {location.items.map((item) => (
            <Item
              key={`${item.sku_id}:${item.seller_id}`}
              location={{ id: location.id, code: location.code }}
              item={item}
              targets={targets}
            />
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">
        Mover y corregir se guardan al momento. Si la cantidad cambia mientras usted cuenta, la
        pantalla le pide contar de nuevo.
      </p>
    </div>
  );
}

function Item({
  location,
  item,
  targets,
}: {
  location: { id: string; code: string };
  item: WmsLocationItem;
  targets: Array<{ id: string; code: string }>;
}) {
  return (
    <li
      className="rounded-lg border border-border bg-surface p-4"
      data-sku={item.sku_code}
      data-seller={item.seller_name}
    >
      <p className="font-semibold">
        {item.title}
        {item.variant_name ? ` · ${item.variant_name}` : ""}
      </p>
      <p className="text-sm text-ink-muted">
        {item.sku_code} · de {item.seller_name}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-surface-muted p-2">
          <dt className="text-xs text-ink-muted">En el estante</dt>
          <dd className="font-display text-xl font-bold tabular-nums">{item.on_shelf}</dd>
        </div>
        <div className="rounded-md bg-surface-muted p-2">
          <dt className="text-xs text-ink-muted">Esperan pedidos</dt>
          <dd className="font-display text-xl font-bold tabular-nums">{item.promised}</dd>
        </div>
        <div className="rounded-md bg-surface-muted p-2">
          <dt className="text-xs text-ink-muted">Libres</dt>
          <dd className="font-display text-xl font-bold tabular-nums">{item.free}</dd>
        </div>
      </dl>
      {item.picked_waiting > 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          {units(item.picked_waiting)} ya alistadas en paquetes que aún no se empacan.
        </p>
      ) : null}
      <p className="mt-2 text-sm">
        <Link
          href={`/bodega/buscar?codigo=${encodeURIComponent(item.sku_code)}` as Route}
          className="inline-flex min-h-11 items-center text-link underline"
        >
          Ver en qué ubicaciones está
        </Link>
      </p>

      <details className="mt-1 border-t border-border pt-1">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-link">
          Mover
        </summary>
        <div className="mt-2">
          {item.free === 0 ? (
            <p className="text-sm text-ink-muted">
              No hay unidades libres para mover: todas esperan a pedidos que se están alistando.
            </p>
          ) : (
            <MoveForm location={location} item={item} targets={targets} />
          )}
        </div>
      </details>
      <details className="border-t border-border pt-1">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-link">
          Corregir cantidad
        </summary>
        <div className="mt-2">
          <CountForm location={location} item={item} />
        </div>
      </details>
    </li>
  );
}
