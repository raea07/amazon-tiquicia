"use client";

import type { Address } from "@yuntera/db";
import type { ActionState } from "@yuntera/next-kit/client";
import { formatPrice } from "@yuntera/ui";
import { useActionState } from "react";
import { placeOrder } from "@/app/actions";
import { FormMessage, SubmitButton } from "./forms";

const initial: ActionState = {};

const METHODS = [
  {
    value: "sinpe_movil",
    title: "SINPE Móvil",
    text: "Le damos el número y un código de referencia. Preparamos el pedido al recibir la transferencia.",
  },
  {
    value: "card",
    title: "Tarjeta de crédito o débito",
    text: "Los datos de la tarjeta se ingresan en la página segura del procesador de pagos; nosotros nunca los vemos.",
  },
  {
    value: "cash_on_delivery",
    title: "Efectivo contra entrega",
    text: "Paga el monto exacto al repartidor cuando recibe.",
  },
] as const;

/** With the payment gateway, SINPE Móvil is matched to the order by who pays, not by a code. */
const GATEWAY_TEXT: Partial<Record<(typeof METHODS)[number]["value"], string>> = {
  sinpe_movil:
    "En el paso siguiente nos indica la identificación y el celular de quien paga, y le damos el número. El pedido se confirma solo al llegar la transferencia.",
  card: "En el paso siguiente pasa a la página segura de ONVO, nuestro procesador de pagos; nosotros nunca vemos los datos de la tarjeta.",
};

/** Many banks let a person send at most ₡100 000 a day by SINPE Móvil. */
const SINPE_DAILY_LIMIT_MINOR = 10_000_000;

/**
 * The last step of a purchase: choose where and how, see the total, confirm.
 * Nothing is pre-selected except the shopper's own default address — in
 * particular no payment method and no extras — so every choice is theirs.
 */
export function CheckoutForm({
  addresses,
  totalMinor,
  codAvailable,
  idempotencyKey,
  throughGateway = false,
}: {
  addresses: Address[];
  totalMinor: number;
  codAvailable: boolean;
  idempotencyKey: string;
  /** Test and live modes: payments go through the gateway. */
  throughGateway?: boolean;
}) {
  const [state, action] = useActionState(placeOrder, initial);
  const deliverable = addresses.filter((address) => address.zone_active);
  const preferred = deliverable.find((address) => address.is_default) ?? deliverable[0];

  return (
    <form action={action} className="flex flex-col gap-8">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedTotalMinor" value={totalMinor} />

      <fieldset>
        <legend className="font-display text-xl font-bold">1. ¿Dónde lo entregamos?</legend>
        <div className="mt-3 flex flex-col gap-2">
          {addresses.map((address) => (
            <label
              key={address.id}
              className={`flex cursor-pointer gap-3 rounded-lg border p-4 has-checked:border-brand has-checked:bg-brand-soft ${
                address.zone_active
                  ? "border-border bg-surface"
                  : "border-border bg-surface-muted opacity-70"
              }`}
            >
              <input
                type="radio"
                name="addressId"
                value={address.id}
                defaultChecked={address.id === preferred?.id}
                disabled={!address.zone_active}
                required
                className="mt-1 size-5 accent-(--color-brand)"
              />
              <span className="text-sm">
                <span className="block font-semibold">
                  {address.label ? `${address.label} · ` : ""}
                  {address.recipient_name}
                </span>
                <span className="block text-ink-muted">
                  {address.senas}. {address.district}, {address.canton}.
                </span>
                {address.zone_active ? null : (
                  <span className="mt-1 block font-medium text-warning">
                    Todavía no entregamos en esta zona.
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-display text-xl font-bold">2. ¿Cómo desea pagar?</legend>
        <div className="mt-3 flex flex-col gap-2">
          {METHODS.map((method) => {
            const disabled = method.value === "cash_on_delivery" && !codAvailable;
            return (
              <label
                key={method.value}
                className={`flex cursor-pointer gap-3 rounded-lg border border-border bg-surface p-4 has-checked:border-brand has-checked:bg-brand-soft ${
                  disabled ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={method.value}
                  disabled={disabled}
                  required
                  className="mt-1 size-5 accent-(--color-brand)"
                />
                <span className="text-sm">
                  <span className="block font-semibold">{method.title}</span>
                  <span className="block text-ink-muted">
                    {disabled
                      ? "No disponible para pedidos de este monto."
                      : ((throughGateway ? GATEWAY_TEXT[method.value] : undefined) ?? method.text)}
                  </span>
                  {method.value === "sinpe_movil" && totalMinor > SINPE_DAILY_LIMIT_MINOR ? (
                    <span className="mt-1 block font-medium text-warning">
                      Muchos bancos permiten enviar hasta {formatPrice(SINPE_DAILY_LIMIT_MINOR)} al
                      día por SINPE Móvil. Si su límite es menor, pague con tarjeta.
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <FormMessage state={state} />

      <div className="flex flex-col gap-3">
        <SubmitButton size="lg" block pendingLabel="Confirmando su pedido…">
          Confirmar pedido por {formatPrice(totalMinor)}
        </SubmitButton>
        <p className="text-xs text-ink-muted">
          Al confirmar acepta los términos y condiciones. Puede devolver su compra hasta 8 días
          hábiles después de recibirla, sin dar explicaciones, y le reembolsamos por el mismo medio
          de pago.
        </p>
      </div>
    </form>
  );
}
