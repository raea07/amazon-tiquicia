"use client";

import type { WmsLocationItem } from "@yuntera/db";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { SelectField, TextField } from "@yuntera/ui";
import { useActionState, useState } from "react";
import { correctCount, moveStock } from "@/app/stock-actions";

const initial: ActionState = {};
const units = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;
const label = (item: WmsLocationItem) =>
  `${item.title}${item.variant_name ? ` (${item.variant_name})` : ""}`;

interface Shelf {
  id: string;
  code: string;
}

interface Here extends Shelf {
  warehouseId: string;
}

function Ids({ location, item }: { location: Here; item: WmsLocationItem }) {
  return (
    <>
      <input type="hidden" name="warehouseId" value={location.warehouseId} />
      <input type="hidden" name="skuCode" value={item.sku_code} />
      <input type="hidden" name="locationId" value={location.id} />
      <input type="hidden" name="locationCode" value={location.code} />
      <input type="hidden" name="skuId" value={item.sku_id} />
      <input type="hidden" name="sellerId" value={item.seller_id} />
    </>
  );
}

/**
 * Moves free units of one shop's product to another shelf of this warehouse.
 * Nothing is chosen for the worker: the target and the quantity are typed.
 */
export function MoveForm({
  location,
  item,
  targets,
}: {
  location: Here;
  item: WmsLocationItem;
  targets: Shelf[];
}) {
  const [state, action] = useActionState(moveStock, initial);
  // A shelf kept from a refused try is chosen again only while it is still
  // offered: one switched off meanwhile leaves the choice empty, never
  // another shelf the worker did not choose.
  const kept = state.values?.toLocationId ?? "";
  const chosen = targets.some((target) => target.id === kept) ? kept : "";
  if (targets.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No hay otro estante activo en esta bodega adonde moverlo. Pida a operaciones que active o
        cree uno.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <Ids location={location} item={item} />
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <TextField
          label="Unidades"
          aria-label={`Unidades a mover de ${label(item)}`}
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          defaultValue={state.values?.quantity}
          hint={`Libres: ${item.free}`}
        />
        <SelectField
          label="Mover a"
          aria-label={`Mover ${label(item)} a`}
          name="toLocationId"
          defaultValue={chosen}
          key={`${chosen}:${targets.map((target) => target.id).join(",")}`}
        >
          {/* Not disabled: when the chosen shelf leaves the list, the browser
              falls back to this empty choice rather than the first shelf. */}
          <option value="">Elija el estante…</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.code}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField
        label="Nota"
        aria-label={`Nota del movimiento de ${label(item)}`}
        name="note"
        optional
        maxLength={200}
        defaultValue={state.values?.note}
        hint="Por ejemplo, «para vaciar el estante»."
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Moviendo…">
          Mover las unidades
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * A cycle count: the worker types what is really on the shelf and sees the
 * difference with what is recorded before confirming. The number the screen
 * showed goes with it, so a shelf that changed meanwhile is counted again.
 */
export function CountForm({ location, item }: { location: Here; item: WmsLocationItem }) {
  const [state, action] = useActionState(correctCount, initial);
  const [counted, setCounted] = useState(state.values?.counted ?? "");
  const typed = counted.trim();
  const number = /^\d{1,6}$/.test(typed) ? Number(typed) : null;
  const delta = number === null ? null : number - item.on_shelf;
  return (
    <form action={action} className="flex flex-col gap-3">
      <Ids location={location} item={item} />
      <input type="hidden" name="expected" value={item.on_shelf} />
      <TextField
        label="Unidades que contó en el estante"
        aria-label={`Unidades que contó de ${label(item)}`}
        name="counted"
        type="number"
        inputMode="numeric"
        min={0}
        value={counted}
        onChange={(event) => setCounted(event.target.value)}
        hint={
          item.promised > 0
            ? `Registradas: ${item.on_shelf}. No puede dejar menos de ${item.promised}: esas unidades esperan a pedidos.`
            : `Registradas: ${item.on_shelf}.`
        }
      />
      <p className="text-sm" aria-live="polite" data-testid="count-difference">
        {delta === null
          ? "Escriba lo que contó para ver la diferencia."
          : delta === 0
            ? "Coincide con lo registrado: no hay nada que corregir."
            : `Diferencia: ${delta > 0 ? "+" : "−"}${units(Math.abs(delta))} (${delta > 0 ? "sobran" : "faltan"}). Quedarán ${units(number ?? 0)}.`}
      </p>
      <TextField
        label="Motivo"
        aria-label={`Motivo de la corrección de ${label(item)}`}
        name="note"
        maxLength={500}
        defaultValue={state.values?.note}
        hint="Al menos 5 letras. La tienda ve este motivo en su historial de inventario."
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Corrigiendo…">
          {delta && number !== null ? `Corregir a ${units(number)}` : "Corregir la cantidad"}
        </SubmitButton>
      </div>
    </form>
  );
}
