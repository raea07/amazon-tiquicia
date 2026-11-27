import { statusLabels } from "@yuntera/core";
import type { SellerPayouts } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader, Stat } from "@yuntera/next-kit/shell";
import {
  Alert,
  Badge,
  EmptyState,
  formatDate,
  formatPrice,
  Skeleton,
  type Tone,
} from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FeeInvoices } from "@/components/fee-invoices";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Pagos" };

const METHOD: Record<string, string> = {
  card: "Tarjeta",
  sinpe_movil: "SINPE Móvil",
  cash_on_delivery: "Contra entrega",
  bank_transfer: "Transferencia",
};

const PAYOUT_STATUS: Record<
  SellerPayouts["payouts"][number]["status"],
  { label: string; tone: Tone }
> = statusLabels("payouts", "seller", { scheduled: "info", paid: "success", failed: "danger" });

const day = (value: string) => formatDate(value, { day: "numeric", month: "long" });
const dayWithYear = (value: string) =>
  formatDate(value, { day: "numeric", month: "short", year: "numeric" });

export default function PayoutsPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Pagos">
        Lo que le debemos, cuándo se lo pagamos y cada venta con todos sus cargos.
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
  const api = await sessionApi();
  const [money, statements] = await Promise.all([
    api.sellerPayouts(shop.id),
    api.sellerStatements(shop.id, 100),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="saldo">
        <h2 id="saldo" className="sr-only">
          Su saldo
        </h2>
        <div className="grid gap-3 sm:grid-cols-3" data-testid="balances">
          <Stat
            label="Disponible"
            value={formatPrice(money.available_minor)}
            hint={`De pedidos entregados hasta el ${day(money.delivered_through)}, menos devoluciones y lo ya pagado.`}
          />
          <Stat
            label="Pendiente"
            value={formatPrice(money.pending_minor)}
            hint={`Ventas todavía en camino o entregadas hace menos de ${money.hold_days} días.`}
          />
          <Stat
            label="En tránsito"
            value={formatPrice(money.in_transit_minor)}
            hint="Pagos que ya programamos y van hacia su cuenta."
          />
        </div>
        <p className="mt-3 text-sm">
          En total le debemos{" "}
          <span className="font-semibold tabular-nums">{formatPrice(money.payable_minor)}</span>: la
          suma de los tres montos.
        </p>
        <Notices money={money} />
      </section>

      <section aria-labelledby="cuando" className="max-w-3xl">
        <h2 id="cuando" className="text-xl font-bold">
          Cuándo le pagamos
        </h2>
        <p className="mt-2 text-sm">
          Cada venta queda disponible {money.hold_days} días después de que entregamos el pedido. En
          ese plazo el comprador todavía puede devolverlo, y así no tenemos que pedirle a usted
          dinero de vuelta. Cuando lo disponible llega a {formatPrice(money.minimum_minor)}, se lo
          transferimos a su cuenta {money.account.iban_masked ?? "bancaria"} en la siguiente corrida
          de pagos.
        </p>
        {money.releases.length > 0 || money.awaiting_delivery_minor !== 0 ? (
          <>
            <h3 className="mt-4 font-semibold">Su saldo pendiente, por fecha</h3>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {money.releases.map((release) => (
                <li
                  key={release.on}
                  className="flex justify-between gap-4 border-b border-border py-1.5"
                >
                  <span>Disponible desde el {day(release.on)}</span>
                  <span className="tabular-nums">{formatPrice(release.amount_minor)}</span>
                </li>
              ))}
              {money.awaiting_delivery_minor !== 0 ? (
                <li className="flex justify-between gap-4 py-1.5">
                  <span>
                    De pedidos que aún no entregamos ({money.hold_days} días después de la entrega)
                  </span>
                  <span className="tabular-nums">{formatPrice(money.awaiting_delivery_minor)}</span>
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
      </section>

      <section aria-labelledby="historial">
        <h2 id="historial" className="text-xl font-bold">
          Pagos que le hemos hecho
        </h2>
        <div className="mt-3">
          {money.payouts.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Todavía no le hemos hecho ningún pago. El primero aparece aquí con el comprobante del
              banco.
            </p>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {money.payouts.map((payout) => {
                const status = PAYOUT_STATUS[payout.status];
                return (
                  <li
                    key={payout.id}
                    className="rounded-lg border border-border bg-surface p-4 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-display text-xl font-bold tabular-nums">
                        {formatPrice(payout.amount_minor)}
                      </p>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      <div>
                        <dt className="text-ink-muted">Corte</dt>
                        <dd>{payout.cutoff_on ? dayWithYear(payout.cutoff_on) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Cuenta</dt>
                        <dd className="tabular-nums">{payout.iban_masked ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Detalle en su banco</dt>
                        <dd>{payout.reference ?? "—"}</dd>
                      </div>
                      {payout.status === "paid" ? (
                        <div>
                          <dt className="text-ink-muted">Comprobante</dt>
                          <dd>
                            {payout.bank_reference}
                            {payout.paid_at ? ` · ${dayWithYear(payout.paid_at)}` : ""}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {payout.status === "failed" ? (
                      <p className="mt-2">
                        <span className="font-semibold">Qué pasó:</span>{" "}
                        {payout.failure_reason ?? "El banco no completó la transferencia."} El monto
                        volvió a su saldo disponible.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

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

      <Suspense fallback={<Skeleton className="h-40" />}>
        <FeeInvoices shopId={shop.id} />
      </Suspense>
    </div>
  );
}

/** What, if anything, stands between this shop and its next payout. */
function Notices({ money }: { money: SellerPayouts }) {
  const blocked = new Set(money.blocked_by);
  return (
    <div className="mt-4 flex max-w-3xl flex-col gap-2">
      {blocked.has("no_bank_details") ? (
        <Alert tone="warning" title="Falta su cuenta bancaria">
          No podemos pagarle hasta tener una cuenta aprobada.{" "}
          <Link href="/cuenta" className="font-semibold underline">
            Regístrela en Cuenta
          </Link>
          .
        </Alert>
      ) : null}
      {blocked.has("invalid_bank_details") ? (
        <Alert tone="warning" title="Su cuenta bancaria no es válida">
          La cuenta IBAN que tenemos registrada no pasa la revisión de sus dígitos, así que no
          podemos transferirle.{" "}
          <Link href="/cuenta" className="font-semibold underline">
            Solicite el cambio de cuenta en Cuenta
          </Link>{" "}
          con la cuenta correcta.
        </Alert>
      ) : null}
      {blocked.has("shop_suspended") ? (
        <Alert tone="warning" title="Sus pagos están retenidos">
          Su tienda está suspendida o todavía en verificación. Su saldo se conserva y se paga cuando
          la tienda vuelva a estar activa.
        </Alert>
      ) : null}
      {blocked.has("below_minimum") && money.available_minor > 0 ? (
        <Alert tone="info">
          Lo disponible todavía no llega a {formatPrice(money.minimum_minor)}, el mínimo para una
          transferencia. Se acumula y se paga en cuanto lo alcance.
        </Alert>
      ) : null}
      {money.available_minor < 0 ? (
        <Alert tone="info">
          Su saldo disponible está en negativo por devoluciones posteriores a un pago. Se compensa
          solo con sus próximas ventas; no tiene que hacer nada.
        </Alert>
      ) : null}
    </div>
  );
}
