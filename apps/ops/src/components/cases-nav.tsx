import type { Route } from "next";
import Link from "next/link";

/** The Casos section's pages. Each link is a full touch target and the row wraps on a phone. */
const PAGES = [
  { href: "/casos", label: "Abiertos", support: false },
  { href: "/casos?estado=cerrados", label: "Cerrados", support: false },
  { href: "/casos/respuestas", label: "Respuestas guardadas", support: true },
  { href: "/casos/informe", label: "Informe del mes", support: true },
] as const;

export type CasesPage = (typeof PAGES)[number]["href"];

/** `support`: the viewer works in support (or is an administrator) and sees its pages too. */
export function CasesNav({ current, support }: { current: CasesPage; support: boolean }) {
  return (
    <nav aria-label="Casos" className="mb-6">
      <div className="flex flex-wrap gap-2">
        {PAGES.filter((page) => support || !page.support).map((page) => (
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
