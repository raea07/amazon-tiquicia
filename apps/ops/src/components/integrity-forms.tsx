import type { DeliveryCodeState } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { Alert, formatDateTime, SelectField, TextField } from "@yuntera/ui";
import { receiveReturn, receiveReturnedParcel, releaseDeliveryCode } from "@/app/integrity-actions";

/** Nothing is chosen for the person: they say how the goods arrived. */
function ConditionField({ what }: { what: "producto" | "paquete" }) {
  return (
    <SelectField label={`¿Cómo llegó el ${what}?`} name="condition" defaultValue="">
      <option value="" disabled>
        Elija…
      </option>
      <option value="resellable">En buen estado: vuelve a la venta</option>
      <option value="damaged">Dañado: no se vuelve a vender</option>
    </SelectField>
  );
}

/** An approved return: record that the goods are back before the refund. */
export function ReceiveReturnForm({ returnId }: { returnId: string }) {
  return (
    // Keyed, so the refund form that replaces it starts fresh instead of
    // inheriting this one's "done" state.
    <ActionForm
      key="receive-return"
      action={receiveReturn}
      submit="Registrar que llegó a bodega"
      pendingLabel="Registrando…"
      hideOnSuccess
    >
      <input type="hidden" name="returnId" value={returnId} />
      <ConditionField what="producto" />
      <TextField label="Nota" name="note" optional hint="Por ejemplo, quién lo recibió." />
    </ActionForm>
  );
}

/** A parcel on its way back: check it in when it arrives. */
export function ReturnedParcelForm({
  shipmentId,
  orderNumber,
}: {
  shipmentId: string;
  orderNumber: string;
}) {
  return (
    <ActionForm
      action={receiveReturnedParcel}
      submit="Recibir el paquete devuelto"
      pendingLabel="Recibiendo…"
      hideOnSuccess
    >
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <ConditionField what="paquete" />
      <TextField label="Nota" name="note" optional />
    </ActionForm>
  );
}

/** Whether the delivery code is locked, and the release when it is. Never the code. */
export function DeliveryCodePanel({
  state,
  orderId,
  orderNumber,
  canRelease,
}: {
  state: DeliveryCodeState;
  orderId: string;
  orderNumber: string;
  canRelease: boolean;
}) {
  if (!state.locked) {
    return state.wrong_attempts > 0 ? (
      <p className="mt-3 text-sm text-ink-muted">
        Intentos fallidos del código: {state.wrong_attempts} de {state.max_attempts}.
      </p>
    ) : null;
  }
  return (
    <div className="mt-4 flex flex-col gap-3">
      <Alert tone="danger" title="Código de entrega bloqueado">
        {state.locked_at ? `Desde el ${formatDateTime(state.locked_at)}, tras ` : "Tras "}
        {state.max_attempts} intentos fallidos. El repartidor no puede entregar hasta que se libere.
      </Alert>
      {canRelease ? (
        <ActionForm
          action={releaseDeliveryCode}
          submit="Liberar y dar un código nuevo"
          pendingLabel="Liberando…"
          hideOnSuccess
        >
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="orderNumber" value={orderNumber} />
          <TextField
            label="Con quién habló y qué confirmó"
            name="note"
            hint="Llame al cliente al teléfono del pedido antes de liberar. El cliente verá el código nuevo en su pedido; no se lo dicte a nadie."
          />
        </ActionForm>
      ) : (
        <p className="text-sm text-ink-muted">Lo libera Operaciones o Atención al cliente.</p>
      )}
    </div>
  );
}
