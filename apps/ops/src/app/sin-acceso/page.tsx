import { buttonClass, EmptyState } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "../actions";

export const metadata: Metadata = { title: "Sin acceso" };

export default function NoAccessPage() {
  return (
    <div className="shell py-16">
      <EmptyState
        title="Su cuenta no tiene acceso a esta sección"
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/" className={buttonClass({ variant: "secondary" })}>
              Ir al resumen
            </Link>
            <form action={signOut}>
              <button type="submit" className={buttonClass({ variant: "ghost" })}>
                Salir e ingresar con otra cuenta
              </button>
            </form>
          </div>
        }
      >
        La consola es para personal de Yuntera, y cada sección para el rol que trabaja en ella. Si
        necesita acceso, pídalo a quien administra la plataforma.
      </EmptyState>
    </div>
  );
}
