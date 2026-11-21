"use client";

import { SelectField, TextAreaField } from "@yuntera/ui";
import { useActionState } from "react";
import {
  type ActionState,
  cancelOrder,
  requestReturn,
  simulatePayment,
  submitReview,
} from "@/app/actions";
import { FormMessage, SubmitButton } from "./forms";

const initial: ActionState = {};

export function SimulatePaymentForm({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber: string;
}) {
  const [state, action] = useActionState(simulatePayment, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <SubmitButton pendingLabel="Registrando…">Simular pago (modo de prueba)</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CancelOrderForm({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber: string;
}) {
  const [state, action] = useActionState(cancelOrder, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <SubmitButton variant="secondary" pendingLabel="Cancelando…">
        Cancelar pedido
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ReviewForm({
  orderItemId,
  orderNumber,
}: {
  orderItemId: string;
  orderNumber: string;
}) {
  const [state, action] = useActionState(submitReview, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderItemId" value={orderItemId} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <SelectField label="Su calificación" name="rating" defaultValue={state.values?.rating ?? ""}>
        <option value="" disabled>
          Elija…
        </option>
        <option value="5">5 estrellas — Excelente</option>
        <option value="4">4 estrellas — Bueno</option>
        <option value="3">3 estrellas — Regular</option>
        <option value="2">2 estrellas — Malo</option>
        <option value="1">1 estrella — Muy malo</option>
      </SelectField>
      <TextAreaField
        label="Cuéntele a otros compradores"
        name="body"
        optional
        rows={3}
        defaultValue={state.values?.body}
        hint="Su reseña se publica con su nombre y la inicial de su apellido."
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Publicando…">
          Publicar reseña
        </SubmitButton>
      </div>
    </form>
  );
}

export function ReturnForm({
  orderItemId,
  orderNumber,
  maxQuantity,
  withdrawalOpen,
}: {
  orderItemId: string;
  orderNumber: string;
  maxQuantity: number;
  withdrawalOpen: boolean;
}) {
  const [state, action] = useActionState(requestReturn, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderItemId" value={orderItemId} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <SelectField
          label="Motivo"
          name="kind"
          defaultValue={state.values?.kind ?? (withdrawalOpen ? "withdrawal" : "")}
        >
          {withdrawalOpen ? null : (
            <option value="" disabled>
              Elija…
            </option>
          )}
          {withdrawalOpen ? (
            <option value="withdrawal">Ya no lo quiero (sin dar motivo)</option>
          ) : null}
          <option value="damaged">Llegó dañado</option>
          <option value="wrong_item">No es lo que pedí</option>
          <option value="warranty">Falló (garantía)</option>
        </SelectField>
        <SelectField label="Cantidad" name="quantity" defaultValue={state.values?.quantity ?? "1"}>
          {Array.from({ length: maxQuantity }, (_, index) => index + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>
      </div>
      <TextAreaField
        label="Detalle"
        name="reason"
        optional
        rows={2}
        defaultValue={state.values?.reason}
        hint="No hace falta si simplemente ya no lo quiere. Para daños o garantía, cuéntenos qué pasó."
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Enviando…">
          Solicitar devolución
        </SubmitButton>
      </div>
    </form>
  );
}
