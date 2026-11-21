"use client";

import type { DriverStop } from "@yuntera/db";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { formatPrice, SelectField, TextField } from "@yuntera/ui";
import { useActionState } from "react";
import { completeStop, failStop } from "@/app/actions";
import { PositionFields } from "./position";

const initial: ActionState = {};

/**
 * Handing a parcel over. The customer reads their 4-digit code from their
 * order; the driver types it here and the server checks it. The driver's phone
 * never knows the code, so a parcel cannot be marked delivered without the
 * customer.
 */
export function DeliverForm({ stop }: { stop: DriverStop }) {
  const [state, action] = useActionState(completeStop, initial);
  const cash = stop.cod_amount_minor > 0;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="stopId" value={stop.stop_id} />
      <input type="hidden" name="expectsCash" value={cash ? "1" : "0"} />
      <PositionFields />
      {cash ? (
        <TextField
          label={`Efectivo recibido (debe ser ${formatPrice(stop.cod_amount_minor)})`}
          name="collected"
          inputMode="decimal"
          defaultValue={state.values?.collected}
          hint="Cuente el dinero antes de entregar el paquete."
        />
      ) : null}
      <TextField
        label="Nombre de quien recibe"
        name="recipientName"
        autoComplete="off"
        defaultValue={state.values?.recipientName}
      />
      <TextField
        label="Código de entrega del cliente"
        name="pin"
        inputMode="numeric"
        pattern="[0-9]{4}"
        maxLength={4}
        autoComplete="off"
        hint="4 dígitos. El cliente lo ve en su pedido; pídaselo con el paquete ya en sus manos."
        className="[&_input]:text-center [&_input]:font-display [&_input]:text-2xl [&_input]:tracking-[0.5em]"
      />
      <FormMessage state={state} />
      <SubmitButton size="lg" block pendingLabel="Verificando el código…">
        Entregar
      </SubmitButton>
    </form>
  );
}

export function FailForm({ stopId }: { stopId: string }) {
  const [state, action] = useActionState(failStop, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="stopId" value={stopId} />
      <PositionFields />
      <SelectField label="¿Qué pasó?" name="reason" defaultValue="">
        <option value="" disabled>
          Elija…
        </option>
        <option value="nobody_home">No había nadie</option>
        <option value="wrong_address">La dirección está mal</option>
        <option value="refused">No quisieron recibirlo</option>
        <option value="cannot_pay">No tenían el efectivo completo</option>
        <option value="unsafe">No era seguro entregar</option>
        <option value="damaged">El paquete se dañó</option>
        <option value="other">Otro motivo</option>
      </SelectField>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" block pendingLabel="Guardando…">
        Registrar que no se entregó
      </SubmitButton>
    </form>
  );
}
