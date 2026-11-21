import { brand } from "@yuntera/brand";
import { YunteraLogo } from "@yuntera/ui";
import Link from "next/link";

/**
 * The footer carries what Costa Rican consumer law asks an online shop to keep
 * in plain sight: who operates the site, how to reach them, and where to
 * complain. The legal identity fields are placeholders until the company exists.
 */
export function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <div className="shell grid gap-8 py-10 md:grid-cols-4">
        <div className="md:col-span-2">
          <YunteraLogo size={26} />
          <p className="mt-3 max-w-sm text-sm text-ink-muted">
            {brand.taglines["es-CR"].primary} Vendedores costarricenses, entrega propia y
            devoluciones sin enredos.
          </p>
        </div>

        <nav aria-label="Ayuda">
          <h2 className="text-sm font-bold text-ink">Ayuda</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
            <li>
              <Link href="/ayuda#entregas" className="hover:text-ink hover:underline">
                Entregas y zonas
              </Link>
            </li>
            <li>
              <Link href="/ayuda#devoluciones" className="hover:text-ink hover:underline">
                Devoluciones y garantía
              </Link>
            </li>
            <li>
              <Link href="/ayuda#pagos" className="hover:text-ink hover:underline">
                Medios de pago
              </Link>
            </li>
            <li>
              <Link href="/ayuda#reclamos" className="hover:text-ink hover:underline">
                Presentar un reclamo
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Yuntera">
          <h2 className="text-sm font-bold text-ink">{brand.name}</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
            <li>
              <Link href="/ayuda#como-ordenamos" className="hover:text-ink hover:underline">
                Cómo ordenamos los resultados
              </Link>
            </li>
            <li>
              <Link href="/ayuda#terminos" className="hover:text-ink hover:underline">
                Términos y condiciones
              </Link>
            </li>
            <li>
              <Link href="/ayuda#privacidad" className="hover:text-ink hover:underline">
                Privacidad
              </Link>
            </li>
            <li>
              <Link href="/ayuda/eliminar-cuenta" className="hover:text-ink hover:underline">
                Eliminar su cuenta
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-border">
        <p className="shell py-4 text-xs text-ink-muted">
          {brand.legalName}. Cédula jurídica: pendiente de inscripción. Contacto:{" "}
          {brand.support.email}. Todos los precios están en colones e incluyen el IVA.
        </p>
      </div>
    </footer>
  );
}
