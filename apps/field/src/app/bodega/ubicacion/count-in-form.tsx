"use client";

import type { CountCandidate } from "@yuntera/db";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { SelectField, TextField } from "@yuntera/ui";
import { useActionState, useState } from "react";
import { countIntoLocation } from "./count-in-actions";

const initial: ActionState = {};
const units = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;

/**
 * The count of one product the location does not list: the shop the units
 * belong to (asked only when more than one shop keeps the product in this
 * warehouse, and never chosen for the worker), how many and why. Stays on
 * the page after a refusal with what was typed, even when the refusal is
 * that the product is now listed here (then its words say where to count).
 */
export function CountInForm({
  location,
  product,
  closed = false,
}: {
  location: { id: string; code: string };
  product: CountCandidate;
  /** The location takes no counts now (switched off): the form stays only to show its refusal. */
  closed?: boolean;
}) {
  const [state, action] = useActionState(countIntoLocation, initial);
  const [quantity, setQuantity] = useState(state.values?.quantity ?? "");
  const shops = product.shops.filter((shop) => shop.stock_record);
  const open = closed ? [] : shops.filter((shop) => !shop.listed);
  // Once refused, the form stays as it was typed, so the refusal is read next to it.
  const offered = state.error ? shops : open;
  if (offered.length === 0) return null;
  const kept = state.values?.sellerId ?? "";
  const chosen = offered.some((shop) => shop.seller_id === kept) ? kept : "";
  const only = offered.length === 1 ? offered[0] : undefined;
  const typedNumber = /^\d{1,6}$/.test(quantity.trim()) ? Number(quantity.trim()) : null;
  const name = `${product.title}${product.variant_name ? ` (${product.variant_name})` : ""}`;
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="count-in-form">
      <input type="hidden" name="locationId" value={location.id} />
      <input type="hidden" name="locationCode" value={location.code} />
      <input type="hidden" name="skuId" value={product.sku_id} />
      <input type="hidden" name="skuCode" value={product.sku_code} />
      {only ? (
        <>
          <input type="hidden" name="sellerId" value={only.seller_id} />
          <p className="text-sm">
            Unidades de <span className="font-semibold">{only.seller_name}</span>.
          </p>
        </>
      ) : (
        <SelectField
          label="¿De qué tienda son?"
          aria-label={`De qué tienda son las unidades de ${name}`}
          name="sellerId"
          defaultValue={chosen}
          key={`${chosen}:${offered.map((shop) => shop.seller_id).join(",")}`}
          hint="Mire la etiqueta de la tienda en el producto o en su caja."
        >
          <option value="">Elija la tienda…</option>
          {offered.map((shop) => (
            <option key={shop.seller_id} value={shop.seller_id}>
              {shop.seller_name}
            </option>
          ))}
        </SelectField>
      )}
      <TextField
        label="Unidades que contó en el estante"
        aria-label={`Unidades que contó de ${name}`}
        name="quantity"
        type="number"
        inputMode="numeric"
        min={1}
        max={10_000}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        hint="Desde 1 hasta 10 000."
      />
      <TextField
        label="Motivo"
        aria-label={`Motivo del conteo de ${name}`}
        name="note"
        maxLength={500}
        defaultValue={state.values?.note}
        hint="Al menos 5 letras, por ejemplo «estaban detrás de otra caja». La tienda ve este motivo en su historial de inventario."
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Sumando…">
          {typedNumber && typedNumber > 0
            ? `Sumar ${units(typedNumber)} a ${location.code}`
            : `Sumar las unidades a ${location.code}`}
        </SubmitButton>
      </div>
    </form>
  );
}
