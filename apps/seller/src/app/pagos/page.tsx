import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader, Stat } from "@yuntera/next-kit/shell";
import { EmptyState, formatDate, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getOverview, requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Pagos" };

const METHOD: Record<string, string> = {
  card: "Tarjeta",
  sinpe_movil: "SINPE Móvil",
  cash_on_delivery: "Contra entrega",
  bank_transfer: "Transferencia",
};

export default function PayoutsPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Pagos">
        Cada venta con todos sus cargos, y lo que le debemos en este momento.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Payouts />
        </Suspense>
      </div>
    </div>
  );
}

async function Payouts() {
  const { shop } = await requireShop("/pagos");
  const [overview, statements] = await Promise.all([
    getOverview(shop.id),
    (await sessionApi()).sellerStatements(shop.id, 100),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Por cobrar"
          value={formatPrice(overview.payable_minor)}
          hint="Ventas cobradas menos cargos, menos devoluciones, menos lo ya pagado."
        />
        <Stat
          label="Cuenta de depósito"
          value={overview.account.payout_iban_masked ?? "Sin registrar"}
          hint={overview.account.payout_holder_name ?? "Agréguela para poder recibir sus pagos."}
          tone={overview.account.payout_iban_masked ? undefined : "warning"}
        />
      </div>

      <section aria-labelledby="detalle">
        <h2 id="detalle" className="text-xl font-bold">
          Detalle por pedido
        </h2>
        <div className="mt-3">
          {statements.length === 0 ? (
            <EmptyState title="Aún no hay ventas cobradas">
              Una venta aparece aquí cuando el pago del comprador queda confirmado.
            </EmptyState>
          ) : (
            <DataTable
              caption="Detalle de cargos por pedido"
              head={[
                "Pedido",
                "Venta",
                "Comisión",
                "Bodega",
                "Cobro",
                "IVA de cargos",
                "Usted recibe",
              ]}
            >
              {statements.map((row) => (
                <tr key={row.order_number}>
                  <td>
                    <p className="font-semibold">{row.order_number}</p>
                    <p className="text-xs text-ink-muted">
                      {formatDate(row.placed_at, { day: "numeric", month: "short" })} ·{" "}
                      {METHOD[row.payment_method] ?? row.payment_method}
                    </p>
                  </td>
                  <td className="tabular-nums">{formatPrice(row.items_gross_minor)}</td>
                  <td className="tabular-nums">− {formatPrice(row.referral_fee_minor)}</td>
                  <td className="tabular-nums">
                    {row.fulfillment_fee_minor
                      ? `− ${formatPrice(row.fulfillment_fee_minor)}`
                      : "—"}
                  </td>
                  <td className="tabular-nums">− {formatPrice(row.payment_fee_minor)}</td>
                  <td className="tabular-nums">− {formatPrice(row.fees_tax_minor)}</td>
                  <td className="font-semibold tabular-nums">{formatPrice(row.payout_minor)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
        <p className="mt-3 max-w-3xl text-sm text-ink-muted">
          “Cobro” es lo que cobra el medio de pago que eligió el comprador; lo trasladamos sin
          recargo. Los cargos llevan 13 % de IVA y se los facturamos electrónicamente. El IVA de sus
          productos ya está dentro del precio de venta: usted lo recibe aquí y lo declara.
        </p>
      </section>
    </div>
  );
}
