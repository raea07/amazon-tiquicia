import { getRoles } from "@yuntera/next-kit/server";
import { buttonClass, EmptyState, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Frame } from "@/components/frame";
import { signOut } from "../actions";

export const metadata: Metadata = { title: "Sin acceso" };

export default function NoAccessPage() {
  return (
    <Frame app="driver">
      <div className="shell py-12">
        <Suspense fallback={<Skeleton className="h-48" />}>
          <Explanation />
        </Suspense>
      </div>
    </Frame>
  );
}

/**
 * Says why there is no access. A driver whose account was suspended or
 * deactivated is told so plainly: their routes went back to Central, and
 * nothing of them (names, phones, addresses) is shown any more.
 */
async function Explanation() {
  const roles = await getRoles();
  const status = roles?.driver?.status;
  const leave = (
    <form action={signOut}>
      <button type="submit" className={buttonClass({ variant: "secondary" })}>
        Salir e ingresar con otra cuenta
      </button>
    </form>
  );

  if (status === "suspended" || status === "offboarded") {
    return (
      <EmptyState
        title={
          status === "suspended"
            ? "Su cuenta de repartidor está suspendida"
            : "Su cuenta de repartidor está desactivada"
        }
        action={leave}
      >
        No tiene acceso a rutas ni a los datos de las entregas. Las rutas que tenía pendientes
        volvieron a Central. Si tiene paquetes o dinero de entregas, llévelos a la bodega. Para
        saber más, hable con Central.
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Su cuenta todavía no tiene acceso" action={leave}>
      Esta aplicación es para repartidores activos y personal de bodega. Si ya lo contrataron,
      pídale a Central que active su cuenta.
    </EmptyState>
  );
}
