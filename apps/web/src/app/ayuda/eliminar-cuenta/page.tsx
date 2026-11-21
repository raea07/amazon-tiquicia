import { brand } from "@yuntera/brand";
import { DeletionTerms } from "@yuntera/next-kit/account";
import { buttonClass } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Eliminar su cuenta",
  description:
    "Cómo eliminar su cuenta de Yuntera, qué datos borramos y qué registros debemos conservar por ley.",
};

/**
 * The public page about deleting an account. Both app stores ask for a web
 * address where anyone, signed in or not, can learn how to request deletion
 * and what is kept; this is it, for all four apps. Static: no session needed.
 */
export default function DeletionHelpPage() {
  return (
    <div className="shell max-w-3xl py-8">
      <h1 className="text-3xl font-bold">Eliminar su cuenta de Yuntera</h1>
      <p className="mt-3 text-ink-muted">
        Vale para la tienda y para las aplicaciones de vendedores, repartidores y bodega: es la
        misma cuenta.
      </p>

      <section aria-labelledby="como" className="mt-8">
        <h2 id="como" className="text-2xl font-bold">
          Cómo hacerlo
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Ingrese a su cuenta, en la web o en la aplicación.</li>
          <li>
            Abra <strong>Su cuenta</strong> y, al final, <strong>Eliminar mi cuenta</strong>.
          </li>
          <li>Lea qué se borra, escriba su contraseña y confirme.</li>
        </ol>
        <p className="mt-3">
          La eliminación es inmediata: al terminar, su sesión se cierra en todos sus aparatos.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/cuenta/eliminar" className={buttonClass()}>
            Eliminar mi cuenta
          </Link>
          <Link href="/recuperar" className={buttonClass({ variant: "secondary" })}>
            Olvidé mi contraseña
          </Link>
        </div>
        <p className="mt-4 text-sm text-ink-muted">
          Si no puede ingresar ni recuperar el acceso a su correo, escríbanos a{" "}
          {brand.support.email} desde la dirección de su cuenta y lo hacemos por usted en un plazo
          de 10 días hábiles. No hay ningún costo.
        </p>
      </section>

      <section aria-labelledby="cuando-no" className="mt-8">
        <h2 id="cuando-no" className="text-2xl font-bold">
          Cuándo hay que esperar
        </h2>
        <p className="mt-3">
          No podemos eliminar una cuenta mientras tenga algo pendiente que la necesita. La pantalla
          le dice cuál es y qué hacer:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Un pedido en camino, una devolución, un reembolso o un reclamo sin cerrar.</li>
          <li>Una tienda con inventario, pedidos sin entregar o dinero pendiente.</li>
          <li>
            Un puesto de repartidor, de bodega o de personal de Yuntera: primero lo retira una
            persona administradora.
          </li>
        </ul>
      </section>

      <section aria-labelledby="que" className="mt-8">
        <DeletionTerms />
      </section>
    </div>
  );
}
