import { buttonClass, EmptyState } from "@yuntera/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell py-16">
      <EmptyState
        title="No encontramos esa pantalla"
        action={
          <Link href="/" className={buttonClass()}>
            Volver al inicio
          </Link>
        }
      >
        Puede que la parada o el paquete ya no estén asignados a usted.
      </EmptyState>
    </div>
  );
}
