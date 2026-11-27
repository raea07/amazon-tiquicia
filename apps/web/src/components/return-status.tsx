import type { MyOrderReturn } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { formatPrice } from "@yuntera/ui";
import { withdrawReturn } from "@/app/return-actions";

const KIND: Record<MyOrderReturn["kind"], string> = {
  withdrawal: "Devolución",
  warranty: "Garantía",
  damaged: "Reclamo por producto dañado",
  wrong_item: "Reclamo por producto equivocado",
};

/** What happens next, in the shopper's words, for each step of a return. */
function nextStep(item: MyOrderReturn): string {
  switch (item.status) {
    case "requested":
      return "Recibimos su solicitud. Le respondemos en un máximo de 2 días hábiles.";
    case "approved":
      return "Aprobada. Le contactaremos para recoger el producto, sin costo para usted. Téngalo listo y completo; cuando llegue a nuestra bodega le reembolsamos por el mismo medio de pago.";
    case "received":
      return "Ya recibimos el producto. Estamos registrando su reembolso por el mismo medio de pago.";
    case "refunded":
      return item.refund_minor
        ? `Reembolsada: le devolvimos ${formatPrice(item.refund_minor)} por el mismo medio de pago.`
        : "Reembolsada por el mismo medio de pago.";
    case "rejected":
      if (item.withdrawn_at) return "Retirada: usted retiró esta solicitud.";
      return item.resolution_note ? `Cerrada: ${item.resolution_note}` : "Cerrada.";
  }
}

/** The shopper's returns on one line of their order, and what each is waiting for. */
export function ReturnStatusList({
  returns,
  orderNumber,
}: {
  returns: MyOrderReturn[];
  orderNumber: string;
}) {
  if (returns.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {returns.map((item) => (
        <li key={item.id} className="rounded-md bg-surface-muted p-3" data-testid="return-request">
          <p className="font-semibold">
            {KIND[item.kind]} de {item.quantity} {item.quantity === 1 ? "unidad" : "unidades"}
          </p>
          <p className="mt-1">{nextStep(item)}</p>
          {item.can_withdraw ? (
            <details className="mt-2">
              <summary
                className="flex min-h-11 cursor-pointer items-center font-semibold text-link"
                data-testid="return-withdraw"
              >
                ¿La abrió por error? Retirar la solicitud
              </summary>
              <div className="mt-2">
                <ActionForm
                  action={withdrawReturn}
                  submit="Retirar la solicitud"
                  pendingLabel="Retirando…"
                  variant="secondary"
                  size="sm"
                  hideOnSuccess
                >
                  <input type="hidden" name="returnId" value={item.id} />
                  <input type="hidden" name="orderNumber" value={orderNumber} />
                  <p className="text-ink-muted">
                    La cerramos sin cambios en su pedido. Mientras no la revisemos, puede retirarla
                    y, si después lo necesita, pedir la devolución de nuevo.
                  </p>
                </ActionForm>
              </div>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
