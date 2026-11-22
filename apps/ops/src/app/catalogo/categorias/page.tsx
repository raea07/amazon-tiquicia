import type { OpsCategory } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, SelectField, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
  createCategory,
  deleteCategory,
  moveCategory,
  renameCategory,
  setCategoryVisible,
  shiftCategory,
} from "@/app/catalogue-actions";
import { CatalogueNav } from "@/components/catalogue-nav";
import { percent } from "@/lib/catalogue-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Categorías" };

export default function CategoriesPage() {
  return (
    <div className="shell py-8">
      <CatalogueNav current="/catalogo/categorias" />
      <PageHeader title="Categorías">
        El menú de la tienda: departamentos, categorías y subcategorías, hasta tres niveles. Ocultar
        una categoría la quita del menú y de su página, con todo lo que tiene debajo; sus productos
        siguen a la venta, en la búsqueda y en su propia dirección. La comisión de cada categoría
        cambia solo con una actualización de tarifas.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Categories />
        </Suspense>
      </div>
    </div>
  );
}

/** "Hogar y cocina › Cocina y mesa", for choosing a place in the tree. */
function pathName(category: OpsCategory, byId: Map<string, OpsCategory>): string {
  const names = [category.name_es];
  let parent = category.parent_id ? byId.get(category.parent_id) : undefined;
  while (parent) {
    names.unshift(parent.name_es);
    parent = parent.parent_id ? byId.get(parent.parent_id) : undefined;
  }
  return names.join(" › ");
}

async function Categories() {
  await requireStaff("/catalogo/categorias", ["catalog"]);
  const categories = await (await sessionApi()).opsCatalogCategories();
  const byId = new Map(categories.map((category) => [category.id, category]));
  // Places a new category can go: anything that is not already at the third level.
  const parents = categories.filter((category) => category.depth < 3);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="nueva" className="max-w-xl">
        <h2 id="nueva" className="text-xl font-bold">
          Nueva categoría
        </h2>
        <div className="mt-3 rounded-lg border border-border bg-surface p-5">
          <ActionForm action={createCategory} submit="Crear categoría" pendingLabel="Creando…">
            <TextField label="Nombre" name="name" maxLength={60} autoComplete="off" />
            <TextField
              label="Dirección en la tienda"
              name="slug"
              optional
              maxLength={60}
              autoComplete="off"
              placeholder="cafe-de-especialidad"
              hint="Lo que va después de /c/. Si la deja vacía, la hacemos a partir del nombre."
            />
            <SelectField label="Dentro de" name="parentId" defaultValue="" optional>
              <option value="">Ninguna: es un departamento</option>
              {parents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {pathName(parent, byId)}
                </option>
              ))}
            </SelectField>
          </ActionForm>
        </div>
      </section>

      <section aria-labelledby="arbol">
        <h2 id="arbol" className="text-xl font-bold">
          Todas las categorías ({categories.length})
        </h2>
        {categories.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Todavía no hay categorías">
              Cree el primer departamento con el formulario de arriba.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                byId={byId}
                places={categories.filter(
                  (other) =>
                    other.id !== category.id &&
                    other.depth < 3 &&
                    !pathName(other, byId).startsWith(`${pathName(category, byId)} ›`),
                )}
                siblings={categories.filter((other) => other.parent_id === category.parent_id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CategoryRow({
  category,
  byId,
  places,
  siblings,
}: {
  category: OpsCategory;
  byId: Map<string, OpsCategory>;
  places: OpsCategory[];
  siblings: OpsCategory[];
}) {
  const parent = category.parent_id ? byId.get(category.parent_id) : undefined;
  const first = siblings[0]?.id === category.id;
  const last = siblings.at(-1)?.id === category.id;
  return (
    <li
      className="rounded-lg border border-border bg-surface p-4 text-sm"
      style={{ marginInlineStart: `${(category.depth - 1) * 1}rem` }}
      data-category={category.slug}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold">{category.name_es}</h3>
        {category.visible ? (
          <Badge tone="success">Se ve en la tienda</Badge>
        ) : category.active ? (
          <Badge tone="warning">Oculta: {parent?.name_es ?? "la de arriba"} está oculta</Badge>
        ) : (
          <Badge tone="warning">Oculta</Badge>
        )}
      </div>
      <p className="mt-1 break-words text-ink-muted">
        /c/{category.slug} · {category.active_product_count}{" "}
        {category.active_product_count === 1 ? "producto publicado" : "productos publicados"} ·
        comisión {percent(category.referral_bps)}
        {category.own_referral ? "" : " (heredada)"}
      </p>
      {category.aliases.length > 0 ? (
        <p className="mt-1 break-words text-ink-muted">
          Direcciones anteriores, que llevan aquí:{" "}
          {category.aliases.map((alias) => `/c/${alias}`).join(", ")}
        </p>
      ) : null}

      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
          Cambiar «{category.name_es}»
        </summary>
        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          <ActionForm action={renameCategory} submit="Guardar nombre y dirección" size="sm">
            <input type="hidden" name="categoryId" value={category.id} />
            <TextField
              label="Nombre"
              name="name"
              defaultValue={category.name_es}
              maxLength={60}
              autoComplete="off"
            />
            <TextField
              label="Dirección en la tienda"
              name="slug"
              defaultValue={category.slug}
              maxLength={60}
              autoComplete="off"
              hint="Si la cambia, la anterior sigue funcionando: lleva a la nueva."
            />
          </ActionForm>

          <div className="flex flex-col gap-4">
            <ActionForm action={moveCategory} submit="Mover" size="sm" variant="secondary">
              <input type="hidden" name="categoryId" value={category.id} />
              <SelectField
                label="Mover dentro de"
                name="parentId"
                defaultValue={category.parent_id ?? ""}
                optional
                hint="Va al final de su nuevo lugar. Si cambiaría la comisión de productos a la venta, no se mueve."
              >
                <option value="">Ninguna: que sea un departamento</option>
                {places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {pathName(place, byId)}
                  </option>
                ))}
              </SelectField>
            </ActionForm>

            <div className="flex flex-wrap gap-2">
              {first ? null : (
                <ActionForm
                  action={shiftCategory}
                  submit="Subir un lugar"
                  size="sm"
                  variant="secondary"
                  className="flex flex-col gap-2"
                >
                  <input type="hidden" name="categoryId" value={category.id} />
                  <input type="hidden" name="direction" value="-1" />
                </ActionForm>
              )}
              {last ? null : (
                <ActionForm
                  action={shiftCategory}
                  submit="Bajar un lugar"
                  size="sm"
                  variant="secondary"
                  className="flex flex-col gap-2"
                >
                  <input type="hidden" name="categoryId" value={category.id} />
                  <input type="hidden" name="direction" value="1" />
                </ActionForm>
              )}
            </div>

            {category.active ? (
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
                  Ocultar de la tienda
                </summary>
                <div className="mt-2">
                  <ActionForm
                    action={setCategoryVisible}
                    submit="Ocultar la categoría"
                    variant="danger"
                    size="sm"
                    pendingLabel="Ocultando…"
                  >
                    <input type="hidden" name="categoryId" value={category.id} />
                    <input type="hidden" name="visible" value="no" />
                    <p className="text-ink-muted">
                      Sale del menú y su página deja de existir
                      {category.child_count > 0 ? ", con sus subcategorías" : ""}. Sus{" "}
                      {category.active_product_count} productos publicados siguen a la venta y se
                      encuentran con la búsqueda. Puede volver a mostrarla cuando quiera.
                    </p>
                  </ActionForm>
                </div>
              </details>
            ) : (
              <ActionForm
                action={setCategoryVisible}
                submit="Mostrar en la tienda"
                size="sm"
                pendingLabel="Guardando…"
              >
                <input type="hidden" name="categoryId" value={category.id} />
                <input type="hidden" name="visible" value="yes" />
              </ActionForm>
            )}

            {!category.in_use && category.child_count === 0 ? (
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
                  Eliminar la categoría
                </summary>
                <div className="mt-2">
                  <ActionForm
                    action={deleteCategory}
                    submit="Eliminar para siempre"
                    variant="danger"
                    size="sm"
                    pendingLabel="Eliminando…"
                  >
                    <input type="hidden" name="categoryId" value={category.id} />
                    <p className="text-ink-muted">
                      No tiene productos ni pedidos que la nombren. Se borra con sus direcciones
                      anteriores; no se puede deshacer.
                    </p>
                  </ActionForm>
                </div>
              </details>
            ) : (
              <p className="text-ink-muted">
                {category.child_count > 0
                  ? "Tiene subcategorías, así que no se puede eliminar."
                  : "Tiene productos o pedidos que la nombran, así que no se puede eliminar; puede ocultarla."}
              </p>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}
