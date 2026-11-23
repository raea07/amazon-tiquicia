import { brand } from "@yuntera/brand";
import { buttonClass } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/product-card";
import { getMenuCategories, searchCatalog } from "@/lib/data";

/**
 * Home. Everything here is the same for every visitor, so it is read through
 * the cached catalogue functions and prerendered: the page arrives complete.
 */
export default async function HomePage() {
  const [categories, popular, madeHere] = await Promise.all([
    getMenuCategories(),
    searchCatalog({ inStockOnly: true, limit: 8 }),
    searchCatalog({ madeInCr: true, inStockOnly: true, limit: 4 }),
  ]);
  const departments = categories.filter((c) => !c.parent_slug && c.product_count > 0);

  return (
    <>
      <section className="wheel-band border-b border-border bg-celeste-50">
        <div className="shell grid gap-8 py-12 md:grid-cols-[1.2fr_1fr] md:items-center md:py-16">
          <div>
            <h1 className="text-4xl font-extrabold text-ink md:text-5xl">
              {brand.taglines["es-CR"].primary}
            </h1>
            <p className="mt-4 max-w-xl text-lg text-ink-muted">
              Compre a vendedores costarricenses y nosotros mismos se lo llevamos. Hoy entregamos al día
              siguiente en el Gran Área Metropolitana.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/buscar" className={buttonClass({ size: "lg" })}>
                Ver todos los productos
              </Link>
              <Link
                href="/c/hecho-en-cr"
                className={buttonClass({ size: "lg", variant: "secondary" })}
              >
                Hecho en Costa Rica
              </Link>
            </div>
          </div>

          <ul className="grid gap-3 text-sm">
            {[
              [
                "Entrega al día siguiente",
                "Hoy, en el GAM, si pide antes de las 2 p. m. Con nuestros propios repartidores.",
              ],
              ["Pague como prefiera", "SINPE Móvil, tarjeta o en efectivo cuando recibe."],
              [
                "Devoluciones sin enredos",
                "Tiene 8 días hábiles desde que recibe para devolver, sin dar explicaciones.",
              ],
              ["Factura electrónica", "De cada vendedor, directo a su correo."],
            ].map(([title, text]) => (
              <li key={title} className="rounded-lg border border-celeste-200 bg-surface p-4">
                <p className="font-display text-base font-bold text-ink">{title}</p>
                <p className="mt-1 text-ink-muted">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="shell flex flex-col gap-12 py-10">
        <section aria-labelledby="categorias">
          <h2 id="categorias" className="text-2xl font-bold">
            Categorías
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {departments.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/c/${category.slug}` as Route}
                  className="flex min-h-20 flex-col justify-center rounded-lg border border-border bg-surface px-4 py-3 hover:border-brand hover:bg-brand-soft"
                >
                  <span className="font-semibold text-ink">{category.name_es}</span>
                  <span className="text-xs text-ink-muted">
                    {category.product_count}{" "}
                    {category.product_count === 1 ? "producto" : "productos"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {madeHere.length > 0 ? (
          <section aria-labelledby="hecho-aqui">
            <div className="flex items-end justify-between gap-4">
              <h2 id="hecho-aqui" className="text-2xl font-bold">
                Hecho en Costa Rica
              </h2>
              <Link
                href="/c/hecho-en-cr"
                className="text-sm font-semibold text-link hover:underline"
              >
                Ver todo
              </Link>
            </div>
            <div className="mt-4">
              <ProductGrid products={madeHere} />
            </div>
          </section>
        ) : null}

        <section aria-labelledby="populares">
          <h2 id="populares" className="text-2xl font-bold">
            Lo que más se está llevando
          </h2>
          <div className="mt-4">
            <ProductGrid products={popular} />
          </div>
        </section>
      </div>
    </>
  );
}
