import type { WmsStockLocation } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { Badge, buttonClass, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireWarehouse } from "@/lib/access";
import { LOCATION_KIND, locationHref, units } from "@/lib/locations";

export const metadata: Metadata = { title: "Ubicaciones" };

export default function LocationsPage() {
  return (
    <div className="shell max-w-2xl py-6">
      <p className="text-sm">
        <Link href="/bodega" className="text-link underline">
          ← Bodega
        </Link>
      </p>
      <h1 className="mt-3 text-2xl font-bold">Ubicaciones</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Abra una ubicación para ver qué tiene, mover unidades a otro estante o corregir lo que
        contó.
      </p>
      <form action="/bodega/ubicacion" className="mt-4 flex items-end gap-2">
        <div className="flex w-full flex-col gap-1">
          <label htmlFor="codigo" className="text-sm font-semibold">
            Código de la ubicación
          </label>
          <input
            id="codigo"
            name="codigo"
            autoComplete="off"
            autoCapitalize="characters"
            required
            placeholder="Escanee la etiqueta o escriba, p. ej. A-01-02-B"
            className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3"
          />
        </div>
        <button type="submit" className={buttonClass()}>
          Abrir
        </button>
      </form>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <List />
        </Suspense>
      </div>
    </div>
  );
}

async function List() {
  const warehouse = await requireWarehouse("/bodega/ubicaciones");
  const locations = await (await sessionApi()).wmsStockLocations(warehouse.id);
  const shelves = locations.filter((location) => location.shelf);
  const areas = locations.filter((location) => !location.shelf);
  return (
    <div className="flex flex-col gap-6">
      <Group title={`Estantes (${shelves.length})`} locations={shelves} />
      {areas.length > 0 ? (
        <Group title={`Otras áreas (${areas.length})`} locations={areas} />
      ) : null}
    </div>
  );
}

function Group({ title, locations }: { title: string; locations: WmsStockLocation[] }) {
  return (
    <section>
      <h2 className="text-lg font-bold">{title}</h2>
      {locations.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">No hay ninguna.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
          {locations.map((location) => (
            <li key={location.id}>
              <Link
                href={locationHref(location.code)}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-muted"
                data-location={location.code}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-bold">{location.code}</span>
                  <span className="text-sm text-ink-muted">{LOCATION_KIND[location.kind]}</span>
                  {location.active ? null : <Badge tone="warning">Desactivada</Badge>}
                </span>
                <span className="text-sm tabular-nums text-ink-muted">
                  {location.units === 0
                    ? "Vacía"
                    : `${units(location.units)} · ${location.products} ${location.products === 1 ? "producto" : "productos"}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
