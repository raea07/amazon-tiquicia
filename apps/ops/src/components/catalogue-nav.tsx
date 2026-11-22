import type { Route } from "next";
import Link from "next/link";

/** The catalogue section's pages. Each link is a full touch target and the row wraps on a phone. */
const PAGES = [
  { href: "/catalogo", label: "Productos por revisar" },
  { href: "/catalogo/productos", label: "Corregir un producto" },
  { href: "/catalogo/categorias", label: "Categorías" },
  { href: "/catalogo/marcas", label: "Marcas" },
  { href: "/catalogo/busqueda", label: "Búsqueda" },
  { href: "/catalogo/resenas", label: "Reseñas" },
  { href: "/catalogo/fotos", label: "Retirar fotos" },
] as const;

export function CatalogueNav({ current }: { current: (typeof PAGES)[number]["href"] }) {
  return (
    <nav aria-label="Catálogo" className="mb-6">
      {/* Links in a plain row, not a list: the pages below it are lists of cards. */}
      <div className="flex flex-wrap gap-2">
        {PAGES.map((page) => (
          <Link
            key={page.href}
            href={page.href as Route}
            aria-current={page.href === current ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${
              page.href === current
                ? "border-anil-900 bg-anil-900 font-semibold text-white"
                : "border-border-strong bg-surface text-ink hover:bg-surface-muted"
            }`}
          >
            {page.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
