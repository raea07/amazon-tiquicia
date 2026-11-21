"use client";

import type { District } from "@yuntera/db";
import { type ActionState, DistrictPicker, PinPicker } from "@yuntera/next-kit/client";
import { TextAreaField, TextField } from "@yuntera/ui";
import { useActionState } from "react";
import { saveAddress } from "@/app/actions";
import { FormMessage, SubmitButton } from "./forms";

const initial: ActionState = {};

/**
 * A delivery address the Costa Rican way.
 *
 * There is no street-and-number system to rely on, so the address has three
 * parts: the district, the "señas" a neighbour would give, and an exact point.
 * The point is what the driver navigates to.
 */
export function AddressForm({
  districts,
  defaultName,
  defaultPostalCode,
  returnTo,
}: {
  districts: District[];
  defaultName?: string | null;
  defaultPostalCode?: string;
  returnTo: string;
}) {
  const [state, action] = useActionState(saveAddress, initial);
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="siguiente" value={returnTo} />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nombre de quien recibe"
          name="recipientName"
          autoComplete="name"
          defaultValue={state.values?.recipientName ?? defaultName ?? ""}
        />
        <TextField
          label="Teléfono"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="8888-1234"
          defaultValue={state.values?.phone}
          hint="El repartidor llama o escribe a este número si no encuentra la casa."
        />
      </div>

      <DistrictPicker districts={districts} defaultPostalCode={defaultPostalCode} />

      <TextAreaField
        label="Señas"
        name="senas"
        rows={3}
        defaultValue={state.values?.senas}
        placeholder="De la iglesia 200 metros al sur y 50 al este, casa esquinera con portón negro"
        hint="Como se las daría a un vecino: referencias, color de la casa, portón, número de apartamento."
      />

      <PinPicker
        legend="Ubicación exacta de la entrega"
        explanation="Las señas ayudan al repartidor; el punto en el mapa es lo que lo lleva hasta su puerta."
        emptyHint="Si pide para otra casa, abra ese lugar en Google Maps y copie el código Plus que aparece."
      />

      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Guardando…">Guardar dirección</SubmitButton>
      </div>
    </form>
  );
}
