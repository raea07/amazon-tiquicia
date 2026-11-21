import { EmptyState, LinkButton } from "@yuntera/expo-kit/ui";
import { Stack } from "expo-router";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "No encontrado" }} />
      <EmptyState
        title="No encontramos esa página"
        action={<LinkButton href="/">Ir al inicio</LinkButton>}
      >
        Puede que el enlace esté mal escrito o que el producto ya no esté a la venta.
      </EmptyState>
    </>
  );
}
