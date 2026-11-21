"use client";

import { Button, EmptyState } from "@yuntera/ui";

/** Shown when a page fails to render. The technical detail goes to the logs, not to the screen. */
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
        No es culpa suya. Si acaba de guardar un cambio, revise si quedó aplicado antes de
        repetirlo.
      </EmptyState>
    </div>
  );
}
