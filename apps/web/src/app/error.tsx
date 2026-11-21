"use client";

import { Button, EmptyState } from "@yuntera/ui";

/** Shown when a page fails to render. The technical detail goes to the logs, not to the shopper. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="shell py-16">
      <EmptyState
        title="Algo salió mal de nuestro lado"
        action={<Button onClick={reset}>Intentar de nuevo</Button>}
      >
        No es culpa suya. Si estaba pagando, revise “Sus pedidos” antes de intentarlo otra vez: no
        le cobraremos dos veces.
      </EmptyState>
    </div>
  );
}
