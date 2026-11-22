"use client";

import type { ActionState } from "@yuntera/next-kit/client";
import { SelectField, TextField } from "@yuntera/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { startCardPayment, startSinpePayment } from "@/app/payment-actions";
import { FormMessage, SubmitButton } from "./forms";

const initial: ActionState = {};

/** Sends the shopper to the payment gateway's own page, where the card is typed. */
export function StartCardPaymentForm({
  orderId,
  orderNumber,
  label,
}: {
  orderId: string;
  orderNumber: string;
  label: string;
}) {
  const [state, action] = useActionState(startCardPayment, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <div>
        <SubmitButton size="lg" pendingLabel="Abriendo la página de pago…">
          {label}
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/**
 * Whose account pays the SINPE Móvil transfer. The gateway accepts only a
 * transfer from that identification for the exact amount, so it must be the
 * account the money leaves from (a relative's or a company's, if so).
 * Nothing is chosen for the shopper.
 */
export function StartSinpeForm({
  orderId,
  orderNumber,
  submit,
}: {
  orderId: string;
  orderNumber: string;
  submit: string;
}) {
  const [state, action] = useActionState(startSinpePayment, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      {/* Remounted with what was typed after a refusal: React resets the form after an action. */}
      <div key={JSON.stringify(state.values ?? null)} className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Identificación de quien paga"
          name="kind"
          defaultValue={state.values?.kind ?? ""}
        >
          <option value="" disabled>
            Elija…
          </option>
          <option value="national">Cédula de identidad</option>
          <option value="resident">DIMEX (residente)</option>
          <option value="legal_entity">Cédula jurídica (empresa)</option>
        </SelectField>
        <TextField
          label="Número de identificación"
          name="number"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={state.values?.number}
          hint="Tal como lo tiene su banco. Ejemplo: 1-1393-1919."
        />
      </div>
      <TextField
        key={`phone-${JSON.stringify(state.values ?? null)}`}
        label="Celular con SINPE Móvil desde el que paga"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        defaultValue={state.values?.phone}
        hint="8 dígitos. Solo se acepta la transferencia que salga de esa cuenta."
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton size="lg" pendingLabel="Preparando la transferencia…">
          {submit}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Redraws the page every few seconds while it waits for the gateway, for at
 * most a few minutes, and says so. The order page itself decides when to
 * stop showing it.
 */
export function AutoRefresh({
  seconds = 3,
  forMinutes = 5,
}: {
  seconds?: number;
  forMinutes?: number;
}) {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > forMinutes * 60_000) {
        clearInterval(timer);
        setStopped(true);
        return;
      }
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds, forMinutes]);
  return (
    <p className="text-sm text-ink-muted" aria-live="polite">
      {stopped
        ? "Recargue la página para ver si ya llegó la confirmación."
        : "Esta página se actualiza sola."}
    </p>
  );
}
