import { buttonClass, EmptyState } from "@yuntera/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell py-16">
      <EmptyState
        title="No encontramos esa página"
        action={
          <Link href="/" className={buttonClass()}>
            Ir al resumen
          </Link>
        }
      >
        Puede que el enlace esté mal escrito, o que el pedido no exista.
      </EmptyState>
    </div>
  );
}
