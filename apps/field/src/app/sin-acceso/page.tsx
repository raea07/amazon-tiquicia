import { buttonClass, EmptyState } from "@yuntera/ui";
import type { Metadata } from "next";
import { Frame } from "@/components/frame";
import { signOut } from "../actions";

export const metadata: Metadata = { title: "Sin acceso" };

export default function NoAccessPage() {
  return (
    <Frame app="driver">
      <div className="shell py-12">
        <EmptyState
          title="Su cuenta todavía no tiene acceso"
          action={
            <form action={signOut}>
              <button type="submit" className={buttonClass({ variant: "secondary" })}>
                Salir e ingresar con otra cuenta
              </button>
            </form>
          }
        >
          Esta aplicación es para repartidores activos y personal de bodega. Si ya lo contrataron,
          pídale a Central que active su cuenta.
        </EmptyState>
      </div>
    </Frame>
  );
}
