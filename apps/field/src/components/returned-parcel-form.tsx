"use client";

import { ActionForm } from "@yuntera/next-kit/client";
import { SelectField, TextField } from "@yuntera/ui";
import { checkInReturnedParcel } from "@/app/returns-actions";

/** Checks in one parcel that came back. Nothing is chosen for the worker. */
export function ReturnedParcelCheckIn({ shipmentId }: { shipmentId: string }) {
  return (
    <ActionForm
      action={checkInReturnedParcel}
      submit="Recibir el paquete devuelto"
      pendingLabel="Recibiendo…"
      hideOnSuccess
    >
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <SelectField label="¿Cómo llegó el paquete?" name="condition" defaultValue="">
        <option value="" disabled>
          Elija…
        </option>
        <option value="resellable">En buen estado: vuelve a la venta</option>
        <option value="damaged">Dañado: no se vuelve a vender</option>
      </SelectField>
      <TextField label="Nota" name="note" optional hint="Por ejemplo, si la caja venía abierta." />
    </ActionForm>
  );
}
