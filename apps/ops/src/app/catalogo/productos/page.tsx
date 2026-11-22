import { ApiError, type OpsCatalogProduct } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { messageOf, sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import {
  Alert,
  Badge,
  buttonClass,
  formatDateTime,
  SelectField,
  Skeleton,
  TextAreaField,
} from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { correctProduct, restoreProduct, takeDownProduct } from "@/app/catalogue-actions";
import { CatalogueNav } from "@/components/catalogue-nav";
import { percent } from "@/lib/catalogue-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Corregir un producto" };

export default function CorrectProductPage({ searchParams }: PageProps<"/catalogo/productos">) {
  return (
    <div className="shell py-8">
      <CatalogueNav current="/catalogo/productos" />
      <PageHeader title="Corregir un producto">
        Para un producto ya publicado que está en la categoría o la marca equivocada, o que debe
        salir de la tienda. Usted lo corrige sin esperar al vendedor; el vendedor recibe un aviso
        con lo que cambió y el motivo que usted escriba.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Correction searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The product from what staff paste: its address in the shop, its short name, or its id. */
function refOf(text: string): string {
  const trimmed = text.trim();
  const fromAddress = /\/p\/([a-z0-9-]+)/i.exec(trimmed)?.[1];
  return (fromAddress ?? trimmed).toLowerCase().slice(0, 200);
}

const STATUS: Record<
  OpsCatalogProduct["status"],
  { label: string; tone: "success" | "warning" | "info" | "danger" | "neutral" }
> = {
  active: { label: "Publicado", tone: "success" },
  pending_review: { label: "En revisión", tone: "info" },
  rejected: { label: "No publicado", tone: "warning" },
  draft: { label: "Borrador", tone: "neutral" },
  archived: { label: "Archivado", tone: "neutral" },
};

async function Correction({
  searchParams,
}: Pick<PageProps<"/catalogo/productos">, "searchParams">) {
  await requireStaff("/catalogo/productos", ["catalog"]);
  const text = (one((await searchParams).producto) ?? "").trim().slice(0, 300);
  const api = await sessionApi();
  let product: OpsCatalogProduct | null = null;
  let problem: string | null = null;
  if (text) {
    try {
      product = await api.opsCatalogProduct(refOf(text));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      problem = messageOf(error);
    }
  }
  const [categories, brands] = product
    ? await Promise.all([api.opsCatalogCategories(), api.opsCatalogBrands()])
    : [[], []];
  const byId = new Map(categories.map((category) => [category.id, category]));
  const pathName = (id: string) => {
    const names: string[] = [];
    let current = byId.get(id);
    while (current) {
      names.unshift(current.name_es);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return names.join(" › ");
  };
  const shop = process.env.NEXT_PUBLIC_SHOP_URL ?? "";

  return (
    <div className="flex flex-col gap-6">
      <form action="/catalogo/productos" className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="producto" className="text-sm font-semibold">
            Dirección del producto en la tienda
          </label>
          <input
            id="producto"
            name="producto"
            type="search"
            defaultValue={text}
            placeholder="https://…/p/licuadora-de-vaso-de-vidrio"
            className="min-h-11 w-96 max-w-full rounded-md border border-border-strong bg-surface px-3"
          />
        </div>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Buscar el producto
        </button>
      </form>

      {problem ? <Alert tone="danger">{problem}</Alert> : null}

      {product ? (
        <section aria-labelledby="producto-titulo" className="flex flex-col gap-6">
          <div className="rounded-lg border border-border bg-surface p-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="producto-titulo" className="text-xl font-bold">
                {product.title}
              </h2>
              <Badge tone={STATUS[product.status].tone}>{STATUS[product.status].label}</Badge>
              {product.taken_down ? <Badge tone="danger">Retirado por el equipo</Badge> : null}
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
              <dt className="text-ink-muted">Vendedor</dt>
              <dd>{product.seller_name ?? "Yuntera"}</dd>
              <dt className="text-ink-muted">Categoría</dt>
              <dd data-current-category={product.category.slug}>
                {pathName(product.category.id) || product.category.name_es}
                {product.category.visible ? "" : " (oculta en la tienda)"}
              </dd>
              <dt className="text-ink-muted">Marca</dt>
              <dd>{product.brand?.name ?? "Sin marca"}</dd>
              <dt className="text-ink-muted">Comisión por venta</dt>
              <dd>{percent(product.referral_bps)}</dd>
              <dt className="text-ink-muted">IVA</dt>
              <dd>{percent(product.tax_rate_bps)}</dd>
              <dt className="text-ink-muted">Ofertas a la venta</dt>
              <dd>{product.offer_count}</dd>
            </dl>
            {product.status === "active" ? (
              <p className="mt-3">
                <a
                  href={`${shop}/p/${product.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center text-link underline"
                >
                  Ver en la tienda
                </a>
              </p>
            ) : null}
            {product.rejection_reason ? (
              <p className="mt-2 text-warning">
                {product.taken_down && product.taken_down_at
                  ? `Retirado el ${formatDateTime(product.taken_down_at)}: `
                  : "Motivo: "}
                {product.rejection_reason}
              </p>
            ) : null}
          </div>

          {product.status === "archived" || product.status === "draft" ? (
            <Alert tone="info">
              Este producto es un {product.status === "draft" ? "borrador" : "producto archivado"}{" "}
              del vendedor; no se corrige desde aquí.
            </Alert>
          ) : product.edit_pending ? (
            <Alert tone="warning" title="El vendedor tiene un cambio en revisión">
              Decídalo primero en{" "}
              <Link href="/catalogo" className="text-link underline">
                Productos por revisar
              </Link>
              ; después puede corregir aquí.
            </Alert>
          ) : (
            <section aria-labelledby="corregir" className="max-w-xl">
              <h2 id="corregir" className="text-lg font-bold">
                Corregir categoría y marca
              </h2>
              <div className="mt-3 rounded-lg border border-border bg-surface p-5">
                <ActionForm
                  action={correctProduct}
                  submit="Guardar la corrección"
                  pendingLabel="Guardando…"
                >
                  <input type="hidden" name="productId" value={product.id} />
                  <SelectField
                    // Remounted after a correction, so it shows what is saved now.
                    key={product.category.id}
                    label="Categoría"
                    name="categoryId"
                    defaultValue={product.category.id}
                  >
                    {categories
                      .filter((category) => category.active || category.id === product.category.id)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {pathName(category.id)} ({percent(category.referral_bps)})
                        </option>
                      ))}
                  </SelectField>
                  <SelectField
                    key={product.brand?.id ?? "none"}
                    label="Marca"
                    name="brandId"
                    defaultValue={product.brand?.id ?? "none"}
                  >
                    <option value="none">Sin marca</option>
                    {brands
                      .filter(
                        (brand) =>
                          (brand.active && !brand.merged_into) || brand.id === product.brand?.id,
                      )
                      .map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                  </SelectField>
                  <TextAreaField
                    label="Motivo, para el vendedor"
                    name="note"
                    rows={2}
                    maxLength={400}
                    hint="Lo lee tal cual. Si la comisión o el IVA cambian con la categoría, el aviso se lo dice."
                  />
                </ActionForm>
              </div>
            </section>
          )}

          {product.status === "active" ? (
            <details className="max-w-xl">
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
                Retirar el producto de la tienda
              </summary>
              <div className="mt-2 rounded-lg border border-border bg-surface p-5">
                <ActionForm
                  action={takeDownProduct}
                  submit="Retirar de la tienda"
                  variant="danger"
                  pendingLabel="Retirando…"
                >
                  <input type="hidden" name="productId" value={product.id} />
                  <TextAreaField
                    label="Motivo, para el vendedor"
                    name="note"
                    rows={2}
                    maxLength={400}
                    hint="Deja de verse y de poder comprarse en el acto. Los pedidos ya hechos siguen su curso. El vendedor puede corregirlo y enviarlo de nuevo a revisión."
                  />
                </ActionForm>
              </div>
            </details>
          ) : null}

          {product.taken_down ? (
            <section aria-labelledby="volver" className="max-w-xl">
              <h2 id="volver" className="text-lg font-bold">
                Volver a publicar
              </h2>
              <div className="mt-3 rounded-lg border border-border bg-surface p-5">
                <ActionForm
                  action={restoreProduct}
                  submit="Volver a publicar"
                  pendingLabel="Publicando…"
                >
                  <input type="hidden" name="productId" value={product.id} />
                  <TextAreaField
                    label="Nota para el vendedor"
                    name="note"
                    rows={2}
                    maxLength={400}
                    hint="Por ejemplo, qué se resolvió."
                  />
                </ActionForm>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
