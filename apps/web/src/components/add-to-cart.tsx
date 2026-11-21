"use client";

import type { ActionState } from "@yuntera/next-kit/client";
import { useActionState } from "react";
import { addToCart } from "@/app/actions";
import { FormMessage, SubmitButton } from "./forms";

const initial: ActionState = {};

/**
 * Quantity + the two purchase buttons. It is an ordinary form posting to a
 * Server Action, so it works before (or without) JavaScript; with it, the
 * result appears in place.
 */
export function AddToCart({ offerId, available }: { offerId: string; available: number }) {
  const [state, action] = useActionState(addToCart, initial);
  const max = Math.min(available, 10);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="offerId" value={offerId} />
      <div className="flex items-center gap-3">
        <label htmlFor={`cantidad-${offerId}`} className="text-sm font-semibold">
          Cantidad
        </label>
        <select
          id={`cantidad-${offerId}`}
          name="quantity"
          defaultValue="1"
          className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
        >
          {Array.from({ length: max }, (_, index) => index + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <SubmitButton block size="lg" name="intent" value="add" pendingLabel="Agregando…">
        Agregar al carrito
      </SubmitButton>
      <SubmitButton block variant="secondary" name="intent" value="buy" pendingLabel="Un momento…">
        Comprar ahora
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
