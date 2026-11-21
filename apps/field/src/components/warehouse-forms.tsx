"use client";

import type { WmsShipment } from "@yuntera/db";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { SelectField, TextField } from "@yuntera/ui";
import { useActionState } from "react";
import { confirmPick, packShipment, receiveLine } from "@/app/actions";

const initial: ActionState = {};
type Task = WmsShipment["tasks"][number];

/**
 * Confirms one line of a pick list. The worker scans (or types) the product's
 * code; a hand scanner types into the focused field like a keyboard. The code
 * is checked on the server against the line, so the wrong product cannot be
 * confirmed by accident.
 */
export function PickForm({ shipmentId, task }: { shipmentId: string; task: Task }) {
  const [state, action] = useActionState(confirmPick, initial);
  const remaining = task.quantity - task.picked_quantity;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <input type="hidden" name="taskId" value={task.task_id} />
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <TextField
          label="Escanee el producto"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          defaultValue={state.values?.code}
          optional
          hint="Código de barras o el código YT de la etiqueta."
        />
        <TextField
          label="Tomó"
          name="quantity"
          type="number"
          min={0}
          max={task.quantity}
          defaultValue={state.values?.quantity ?? String(task.quantity)}
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Confirmando…">
        {remaining === task.quantity ? "Confirmar línea" : "Corregir cantidad"}
      </SubmitButton>
      <p className="text-xs text-ink-muted">
        Si no hay suficientes en la ubicación, escriba cuántas tomó (puede ser 0). La línea queda
        como faltante y Central la resuelve.
      </p>
    </form>
  );
}

export function PackForm({ shipment }: { shipment: WmsShipment }) {
  const [state, action] = useActionState(packShipment, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="shipmentId" value={shipment.shipment_id} />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Peso real (gramos)"
          name="weightGrams"
          type="number"
          min={1}
          max={30000}
          defaultValue={state.values?.weightGrams ?? String(shipment.expected_weight_grams)}
          hint={`Esperado: ${shipment.expected_weight_grams} g`}
        />
        <TextField
          label="Bultos"
          name="packageCount"
          type="number"
          min={1}
          max={20}
          defaultValue={state.values?.packageCount ?? "1"}
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton size="lg" block pendingLabel="Guardando…">
        Empacado
      </SubmitButton>
    </form>
  );
}

export function ReceiveForm({
  lineId,
  pending,
  locations,
  label,
}: {
  lineId: string;
  pending: number;
  locations: Array<{ id: string; code: string }>;
  label: string;
}) {
  const [state, action] = useActionState(receiveLine, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="inboundLineId" value={lineId} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[6rem_6rem_1fr]">
        <TextField
          label="Buenas"
          aria-label={`Unidades buenas de ${label}`}
          name="good"
          type="number"
          min={0}
          defaultValue={state.values?.good ?? String(pending)}
        />
        <TextField
          label="Dañadas"
          aria-label={`Unidades dañadas de ${label}`}
          name="damaged"
          type="number"
          min={0}
          defaultValue={state.values?.damaged ?? "0"}
        />
        <SelectField label="Guardar en" name="locationId" className="col-span-2 sm:col-span-1">
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code}
            </option>
          ))}
        </SelectField>
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Guardando…">
          Registrar recepción
        </SubmitButton>
      </div>
    </form>
  );
}
