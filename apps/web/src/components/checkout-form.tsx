"use client";

import type { Address } from "@yuntera/db";
import type { ActionState } from "@yuntera/next-kit/client";
import { formatPrice } from "@yuntera/ui";
import { useActionState } from "react";
import { placeOrderWithInvoice } from "@/app/invoice-actions";
import { FormMessage, SubmitButton } from "./forms";
import { InvoiceRequestFields } from "./invoice-request-fields";

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
  shippingMinor,
}: {
  addresses: Address[];
  totalMinor: number;
  codAvailable: boolean;
  idempotencyKey: string;
  /** Test and live modes: payments go through the gateway. */
  throughGateway?: boolean;
  /** The delivery fee: Yuntera's only charge to the shopper, so the only thing it invoices them. */
  shippingMinor: number;
}) {
  const [state, action] = useActionState(placeOrderWithInvoice, initial);
  const deliverable = addresses.filter((address) => address.zone_active);
  // After a refused try, what was chosen comes back; the first time, only the default address.
  const preferred =
    deliverable.find((address) => address.id === state.values?.addressId) ??
    deliverable.find((address) => address.is_default) ??
    deliverable[0];
  // A new set of inputs whenever the form comes back, so they show what was chosen
  // (the browser resets the form once its action finishes).
  const stamp = JSON.stringify(state.values ?? {});

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
                key={stamp}
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
                  key={stamp}
                  type="radio"
                  name="paymentMethod"
                  value={method.value}
                  defaultChecked={!disabled && state.values?.paymentMethod === method.value}
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

      {shippingMinor > 0 ? (
        <InvoiceRequestFields values={state.values} />
      ) : (
        <fieldset>
          <legend className="font-display text-xl font-bold">3. Facturas electrónicas</legend>
          <p className="mt-1 text-sm text-ink-muted">
            Este pedido tiene entrega gratis, así que Yuntera no le cobra nada que deba facturarle.
            Los productos los factura cada vendedor con su propio sistema de facturación
            electrónica.
          </p>
        </fieldset>
      )}

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
