import { sessionApi } from "@yuntera/next-kit/server";
import { touchLinkClass } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { RecordContactForm } from "@/components/case-forms";
import { CaseList } from "@/components/case-list";

/**
 * The staff order page's cases: the order's complaints, returns and recorded
 * contacts (those the viewer's role reads), the way to the customer view,
 * and, for support, "Registrar un contacto" against this order.
 */
export async function OrderCases({
  orderNumber,
  canRecord,
}: {
  orderNumber: string;
  canRecord: boolean;
}) {
  const { customer_id, cases } = await (await sessionApi()).opsOrderCases(orderNumber);
  await connection();
  const now = Date.now();
  return (
    <div className="mt-3 flex flex-col gap-4">
      <p className="text-sm">
        <Link href={`/clientes/${customer_id}` as Route} className={touchLinkClass()}>
          Ver el cliente: sus pedidos, devoluciones y casos
        </Link>
      </p>
      {cases.length === 0 ? (
        <p className="text-sm text-ink-muted">Este pedido no tiene casos.</p>
      ) : (
        <CaseList cases={cases} now={now} />
      )}
      {canRecord ? (
        <details
          className="rounded-lg border border-border bg-surface p-5"
          data-testid="record-contact"
        >
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
            Registrar un contacto
          </summary>
          <p className="mt-1 mb-3 text-sm text-ink-muted">
            Si el cliente escribió por WhatsApp, llamó o mandó un correo sobre este pedido,
            regístrelo aquí como un caso, con un resumen.
          </p>
          <RecordContactForm orderNumber={orderNumber} />
        </details>
      ) : null}
    </div>
  );
}
