import type { Route } from "next";
import Link from "next/link";

/** The operations section's pages. Each link is a full touch target and the row wraps on a phone. */
const PAGES = [
  { href: "/operacion", label: "Zonas de entrega", admin: false },
  { href: "/operacion/distritos", label: "Distritos", admin: false },
  { href: "/operacion/feriados", label: "Feriados", admin: false },
  { href: "/operacion/cierres", label: "Cierres de zona", admin: false },
  { href: "/operacion/ubicaciones", label: "Ubicaciones de bodega", admin: false },
  { href: "/operacion/rutas", label: "Rutas detenidas", admin: false },
  { href: "/operacion/ajustes", label: "Ajustes de la plataforma", admin: true },
] as const;

export type OperationsPage = (typeof PAGES)[number]["href"];

/** `admin`: the viewer is an administrator, who also sees the platform settings. */
export function OperationsNav({ current, admin }: { current: OperationsPage; admin: boolean }) {
  return (
    <nav aria-label="Operación" className="mb-6">
      {/* Links in a plain row, not a list: the pages below it are lists of cards. */}
      <div className="flex flex-wrap gap-2">
        {PAGES.filter((page) => admin || !page.admin).map((page) => (
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
