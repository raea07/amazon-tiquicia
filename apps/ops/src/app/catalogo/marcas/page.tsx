import type { OpsBrand } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, formatDate, SelectField, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { createBrand, mergeBrands, renameBrand, setBrandVisible } from "@/app/catalogue-actions";
import { CatalogueNav } from "@/components/catalogue-nav";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Marcas" };

export default function BrandsPage() {
  return (
    <div className="shell py-8">
      <CatalogueNav current="/catalogo/marcas" />
      <PageHeader title="Marcas">
        Las marcas por las que los compradores filtran. Si dos son la misma (una escrita de otra
        forma), únalas: los productos pasan a la que queda y quien busque el nombre anterior los
        sigue encontrando.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Brands />
        </Suspense>
      </div>
    </div>
  );
}

async function Brands() {
  await requireStaff("/catalogo/marcas", ["catalog"]);
  const brands = await (await sessionApi()).opsCatalogBrands();
  const current = brands.filter((brand) => !brand.merged_into);
  const merged = brands.filter((brand) => brand.merged_into);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="nueva-marca" className="max-w-xl">
        <h2 id="nueva-marca" className="text-xl font-bold">
          Nueva marca
        </h2>
        <div className="mt-3 rounded-lg border border-border bg-surface p-5">
          <ActionForm action={createBrand} submit="Crear marca" pendingLabel="Creando…">
            <TextField label="Nombre" name="name" maxLength={60} autoComplete="off" />
            <TextField
              label="Dirección del filtro"
              name="slug"
              optional
              maxLength={60}
              autoComplete="off"
              hint="Lo que va en ?marca= en la tienda. Si la deja vacía, la hacemos a partir del nombre."
            />
          </ActionForm>
        </div>
      </section>

      <section aria-labelledby="marcas">
        <h2 id="marcas" className="text-xl font-bold">
          Marcas ({current.length})
        </h2>
        {current.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Todavía no hay marcas">
              Cree la primera con el formulario de arriba.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {current.map((brand) => (
              <BrandRow
                key={brand.id}
                brand={brand}
                others={current.filter((other) => other.id !== brand.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {merged.length > 0 ? (
        <section aria-labelledby="unidas">
          <h2 id="unidas" className="text-xl font-bold">
            Unidas a otra marca ({merged.length})
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Ya no tienen productos. Su dirección de filtro muestra la marca en la que quedaron.
          </p>
          <ul className="mt-3 grid gap-2 text-sm lg:grid-cols-2">
            {merged.map((brand) => (
              <li key={brand.id} className="rounded-lg border border-border bg-surface p-4">
                <span className="font-semibold">{brand.name}</span> → {brand.merged_into?.name}
                {brand.merged_at ? (
                  <span className="text-ink-muted"> · el {formatDate(brand.merged_at)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function BrandRow({ brand, others }: { brand: OpsBrand; others: OpsBrand[] }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-4 text-sm" data-brand={brand.slug}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold">{brand.name}</h3>
        {brand.active ? (
          <Badge tone="success">En el filtro de la tienda</Badge>
        ) : (
          <Badge tone="warning">Fuera del filtro</Badge>
        )}
      </div>
      <p className="mt-1 break-words text-ink-muted">
        ?marca={brand.slug} · {brand.active_product_count}{" "}
        {brand.active_product_count === 1 ? "producto publicado" : "productos publicados"}
        {brand.product_count > brand.active_product_count
          ? ` (${brand.product_count} en total)`
          : ""}
      </p>
      {brand.aliases.length > 0 ? (
        <p className="mt-1 break-words text-ink-muted">
          La búsqueda también la encuentra como: {brand.aliases.join(", ")}
        </p>
      ) : null}

      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
          Cambiar «{brand.name}»
        </summary>
        <div className="mt-3 flex flex-col gap-5">
          <ActionForm action={renameBrand} submit="Guardar nombre" size="sm">
            <input type="hidden" name="brandId" value={brand.id} />
            <TextField
              label="Nombre"
              name="name"
              defaultValue={brand.name}
              maxLength={60}
              autoComplete="off"
            />
            <TextField
              label="Dirección del filtro"
              name="slug"
              defaultValue={brand.slug}
              maxLength={60}
              autoComplete="off"
            />
          </ActionForm>

          {brand.active ? (
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
                Sacar del filtro de la tienda
              </summary>
              <div className="mt-2">
                <ActionForm
                  action={setBrandVisible}
                  submit="Sacar del filtro"
                  variant="danger"
                  size="sm"
                >
                  <input type="hidden" name="brandId" value={brand.id} />
                  <input type="hidden" name="visible" value="no" />
                  <p className="text-ink-muted">
                    Deja de ofrecerse para filtrar. Sus productos siguen a la venta y siguen
                    mostrando la marca.
                  </p>
                </ActionForm>
              </div>
            </details>
          ) : (
            <ActionForm action={setBrandVisible} submit="Volver a ofrecer en el filtro" size="sm">
              <input type="hidden" name="brandId" value={brand.id} />
              <input type="hidden" name="visible" value="yes" />
            </ActionForm>
          )}

          {others.length > 0 ? (
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
                Es la misma que otra marca: unirlas
              </summary>
              <div className="mt-2">
                <ActionForm
                  action={mergeBrands}
                  submit={`Unir «${brand.name}» a la elegida`}
                  variant="danger"
                  size="sm"
                  pendingLabel="Uniendo…"
                >
                  <input type="hidden" name="brandId" value={brand.id} />
                  <SelectField label="La marca que queda" name="intoId" defaultValue="">
                    <option value="" disabled>
                      Elija…
                    </option>
                    {others.map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                  </SelectField>
                  <p className="text-ink-muted">
                    Los {brand.product_count} productos de «{brand.name}» pasan a la elegida, y «
                    {brand.name}» deja de existir como marca aparte. No se puede deshacer.
                  </p>
                </ActionForm>
              </div>
            </details>
          ) : null}
        </div>
      </details>
    </li>
  );
}
