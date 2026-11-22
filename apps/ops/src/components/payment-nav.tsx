import { buttonClass } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";

const LINKS = [
  { href: "/cobros", label: "Día y pagos" },
  { href: "/cobros/revision", label: "Por revisar" },
  { href: "/cobros/reembolsos", label: "Reembolsos" },
  { href: "/cobros/ajustes", label: "Modo y comisiones" },
] as const;

/** The four pages of Cobros, with the current one marked (not by colour alone). */
export function PaymentNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav aria-label="Cobros" className="mt-4 flex flex-wrap gap-2">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href as Route}
          aria-current={link.href === current ? "page" : undefined}
          className={buttonClass({
            variant: link.href === current ? "primary" : "secondary",
            size: "sm",
          })}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
