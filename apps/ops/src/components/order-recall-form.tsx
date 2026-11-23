import { TextAreaField } from "@yuntera/ui";
import { recallShipment } from "@/app/order-followups-actions";
import { CatalogueForm } from "@/components/catalogue-outcome";

/**
 * Stops a packed parcel before it leaves (ops_recall_shipment), behind a
 * confirmation that names the order and says what happens to the money.
 * `money` is that sentence, worked out by the page from the order.
 */
export function RecallShipmentForm({
  shipmentId,
  trackingCode,
  orderNumber,
  onRoute,
  money,
  paid,
}: {
  shipmentId: string;
  trackingCode: string;
  orderNumber: string;
  /** It is planned on a route that has not started: its stop is removed too. */
  onRoute: boolean;
  money: string;
  /** Money was paid, so receiving it refunds something. */
  paid: boolean;
}) {
  return (
    <details>
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
        Detener el paquete {trackingCode}
      </summary>
      <div className="mt-2 max-w-xl">
        <CatalogueForm
          action={recallShipment}
          submit="Detener y devolver a los estantes"
          variant="danger"
          size="sm"
        >
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <input type="hidden" name="orderNumber" value={orderNumber} />
          <input type="hidden" name="paid" value={paid ? "1" : "0"} />
          <TextAreaField
            label="Por qué se detiene"
            name="reason"
            rows={2}
            maxLength={300}
            hint="Queda en el historial del pedido para el equipo; el cliente no lo ve."
          />
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="confirm"
              className="mt-0.5 size-5 accent-(--color-brand)"
            />
            <span>
              Confirmo: el paquete {trackingCode} del pedido {orderNumber} no sale
              {onRoute ? ", se quita de su ruta" : ""} y vuelve a los estantes. {money}
            </span>
          </label>
        </CatalogueForm>
      </div>
    </details>
  );
}
