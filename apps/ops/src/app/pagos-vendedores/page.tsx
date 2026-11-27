import { parsePhone } from "@yuntera/core";
import { ApiError, type PayoutDetailRequest, type PayoutPreview } from "@yuntera/db";
import { ActionForm, DecisionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader, Stat } from "@yuntera/next-kit/shell";
import {
  Alert,
  Badge,
  buttonClass,
  formatDate,
  formatDateTime,
  formatPrice,
  Skeleton,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createPayoutRun, decidePayoutDetails } from "@/app/people-actions";
import { SELLER_STATUS } from "@/lib/labels";
import { groupIban, ID_TYPE, PAYOUT_BLOCK, REQUEST_STATUS } from "@/lib/people-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Pagos a vendedores" };

const shortDate = (value: string) =>
  formatDate(value, { day: "numeric", month: "long", year: "numeric" });
const phone = (value: string) => parsePhone(value)?.formatted ?? value;

export default function SellerPayoutsPage({ searchParams }: PageProps<"/pagos-vendedores">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Pagos a vendedores">
        Los cambios de cuenta bancaria que piden los vendedores, y el pago de lo que les debemos.
        Nada sale del banco desde aquí: usted hace las transferencias y registra cada una.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Payouts searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Payouts({ searchParams }: Pick<PageProps<"/pagos-vendedores">, "searchParams">) {
  await requireStaff("/pagos-vendedores", ["finance"]);
  const params = await searchParams;
  const asked = params.corte;
  const text = Array.isArray(asked) ? asked[0] : asked;
  const decided =
    params.resuelta === "aprobada" || params.resuelta === "rechazada" ? params.resuelta : null;
  const cutoff = text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;

  const api = await sessionApi();
  let cutoffRefused = false;
  const [requests, preview, runs] = await Promise.all([
    api.opsPayoutDetailRequests(null),
    api.opsPayoutPreview(cutoff).catch((error: unknown) => {
      // A date after today cannot be a cut-off; show today's instead of an error page.
      if (error instanceof ApiError && error.code === "invalid_cutoff") {
        cutoffRefused = true;
        return api.opsPayoutPreview();
      }
      throw error;
    }),
    api.opsPayoutRuns(),
  ]);
  const waiting = requests.filter((request) => request.status === "pending");
  const recent = requests.filter((request) => request.status !== "pending").slice(0, 10);

  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="cuentas">
        <h2 id="cuentas" className="text-xl font-bold">
          Cambios de cuenta por resolver ({waiting.length})
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Cambiar la cuenta de depósito es la forma más común de fraude contra un vendedor. Antes de
          aprobar, llame al teléfono que ya teníamos registrado —nunca a uno que venga en un correo
          o mensaje— y confirme la cuenta nueva dígito por dígito.
        </p>
        {decided === "aprobada" ? (
          <Alert tone="success" className="mt-3">
            Cuenta aprobada. Los próximos pagos de esa tienda van a la cuenta nueva.
          </Alert>
        ) : decided === "rechazada" ? (
          <Alert tone="success" className="mt-3">
            Solicitud rechazada. El vendedor ve el motivo que usted escribió.
          </Alert>
        ) : null}
        {waiting.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No hay cambios de cuenta por resolver.</p>
        ) : (
          <ul className="mt-4 grid gap-4 lg:grid-cols-2">
            {waiting.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </ul>
        )}
        {recent.length > 0 ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer py-3 font-semibold text-link">
              Resueltas recientemente ({recent.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {recent.map((request) => {
                const status = REQUEST_STATUS[request.status];
                return (
                  <li key={request.id} className="rounded-md border border-border bg-surface p-3">
                    <span className="font-semibold">{request.seller.trade_name}</span>{" "}
                    <Badge tone={status?.tone ?? "neutral"}>{status?.label}</Badge>
                    <span className="block text-ink-muted">
                      {request.requested.iban_masked} · {request.requested.holder_name} ·{" "}
                      {request.decided_by_name ?? "—"}
                      {request.decided_at ? `, ${formatDateTime(request.decided_at)}` : ""}
                    </span>
                    {request.note ? <span className="block">“{request.note}”</span> : null}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
      </section>

      <PreviewSection preview={preview} cutoffRefused={cutoffRefused} />

      <section aria-labelledby="corridas">
        <h2 id="corridas" className="text-xl font-bold">
          Corridas de pago
        </h2>
        <div className="mt-3">
          {runs.length === 0 ? (
            <p className="text-sm text-ink-muted">Todavía no se ha creado ninguna corrida.</p>
          ) : (
            <DataTable
              caption="Corridas de pago"
              head={["Corrida", "Fecha de corte", "Por transferir", "Pagados", "No pagados"]}
            >
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link
                      href={`/pagos-vendedores/corridas/${run.id}` as Route}
                      className="font-semibold text-link underline"
                    >
                      {run.code}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {run.created_by_name ?? "—"} · {formatDateTime(run.created_at)}
                    </p>
                  </td>
                  <td>{shortDate(run.cutoff_on)}</td>
                  <td className="tabular-nums">
                    {run.scheduled > 0 ? (
                      <>
                        {run.scheduled} · {formatPrice(run.scheduled_minor)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="tabular-nums">
                    {run.paid > 0 ? (
                      <>
                        {run.paid} · {formatPrice(run.paid_minor)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="tabular-nums">{run.failed > 0 ? run.failed : "—"}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </section>
    </div>
  );
}

function RequestCard({ request }: { request: PayoutDetailRequest }) {
  const { seller, current, requested, signals } = request;
  const status = SELLER_STATUS[seller.status];
  return (
    <li className="rounded-lg border border-border bg-surface p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold">{seller.trade_name}</h3>
        <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? seller.status}</Badge>
      </div>
      <p className="text-ink-muted">
        Lo pidió {request.requested_by_name ?? request.requested_by_email} (
        {request.requested_by_email}) · {formatDateTime(request.requested_at)}
      </p>

      <dl className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="text-ink-muted">Nombre o razón social</dt>
          <dd className="font-medium">{seller.legal_name}</dd>
          <dd className="tabular-nums">
            {ID_TYPE[seller.id_type]} {seller.id_number}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Teléfono registrado: llame a este</dt>
          <dd className="text-lg font-bold tabular-nums">{phone(seller.contact_phone)}</dd>
          <dd className="break-all text-ink-muted">{seller.contact_email}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Cuenta actual</dt>
          <dd className="font-medium tabular-nums">{current.iban_masked ?? "Sin registrar"}</dd>
          <dd>{current.holder_name ?? "—"}</dd>
          <dd className="text-ink-muted">
            SINPE Móvil: {current.sinpe_number ? phone(current.sinpe_number) : "—"}
          </dd>
        </div>
        <div className="rounded-md bg-surface-muted p-3">
          <dt className="text-ink-muted">Cuenta solicitada</dt>
          <dd className="font-bold tabular-nums">
            {requested.iban ? groupIban(requested.iban) : requested.iban_masked}
          </dd>
          <dd className="font-medium">{requested.holder_name}</dd>
          <dd className="text-ink-muted">
            SINPE Móvil: {requested.sinpe_number ? phone(requested.sinpe_number) : "ninguno"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-col gap-2">
        {signals.contact_changed_recently ? (
          <Alert tone="warning" title="El teléfono o el correo cambiaron hace poco">
            Los datos de contacto de esta tienda cambiaron en los 30 días antes de la solicitud. No
            confirme la cuenta con ese teléfono: verifique con el vendedor por otro medio que ya
            conozca, o rechace la solicitud.
          </Alert>
        ) : null}
        {signals.holder_differs ? (
          <Alert tone="warning">
            El titular de la cuenta no coincide con el nombre legal de la tienda. Pregunte por qué.
          </Alert>
        ) : null}
        {signals.used_by_other_shop ? (
          <Alert tone="warning">Otra tienda ya recibe sus pagos en esta misma cuenta.</Alert>
        ) : null}
        {signals.first_account ? (
          <Alert tone="info">Es la primera cuenta que registra esta tienda.</Alert>
        ) : null}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <DecisionForm
          action={decidePayoutDetails}
          noteLabel="Nota para el vendedor"
          noteHint="Obligatoria si rechaza: el vendedor la lee tal como usted la escriba."
          yes="Aprobar la cuenta nueva"
          no="Rechazar"
        >
          <input type="hidden" name="requestId" value={request.id} />
        </DecisionForm>
      </div>
    </li>
  );
}

function PreviewSection({
  preview,
  cutoffRefused,
}: {
  preview: PayoutPreview;
  cutoffRefused: boolean;
}) {
  return (
    <section aria-labelledby="corte">
      <h2 id="corte" className="text-xl font-bold">
        Qué se pagaría con una fecha de corte
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">
        Un vendedor puede cobrar lo que ganó en pedidos entregados hace {preview.hold_days} días o
        más: ese tiempo cubre las devoluciones. Solo se transfiere a partir de{" "}
        {formatPrice(preview.minimum_minor)}; lo que no llega espera a la siguiente corrida.
      </p>

      <form action="/pagos-vendedores" className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="corte-fecha" className="text-sm font-semibold">
            Fecha de corte
          </label>
          <input
            id="corte-fecha"
            name="corte"
            type="date"
            required
            max={preview.today}
            defaultValue={preview.cutoff_on}
            className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
          />
        </div>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Ver este corte
        </button>
      </form>
      {cutoffRefused ? (
        <Alert tone="warning" className="mt-3">
          La fecha de corte no puede ser posterior a hoy. Le mostramos el corte de hoy.
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-3" data-testid="cutoff-figures">
        <Stat
          label={`Corte del ${shortDate(preview.cutoff_on)}`}
          value={formatPrice(preview.to_pay_minor)}
          hint={
            preview.to_pay_count === 1
              ? "Para pagar a 1 tienda"
              : `Para pagar a ${preview.to_pay_count} tiendas`
          }
        />
        <Stat
          label="Entran pedidos entregados hasta"
          value={shortDate(preview.delivered_through)}
          hint={`${preview.hold_days} días de retención`}
        />
        <Stat label="Mínimo por transferencia" value={formatPrice(preview.minimum_minor)} />
      </div>

      <div className="mt-4">
        {preview.sellers.length === 0 ? (
          <p className="text-sm text-ink-muted">Ninguna tienda tiene saldo todavía.</p>
        ) : (
          <DataTable
            caption="Saldo de cada tienda en este corte"
            head={["Tienda", "Disponible", "Pendiente", "En tránsito", "Cuenta", "En este corte"]}
          >
            {preview.sellers.map((seller) => (
              <tr key={seller.seller_id}>
                <td>
                  <p className="font-semibold">{seller.trade_name}</p>
                  {seller.details_request_pending ? (
                    <p className="mt-1">
                      <Badge tone="warning">Cambio de cuenta por resolver</Badge>
                    </p>
                  ) : null}
                </td>
                <td className="font-semibold tabular-nums">
                  {formatPrice(seller.available_minor)}
                </td>
                <td className="tabular-nums">{formatPrice(seller.pending_minor)}</td>
                <td className="tabular-nums">
                  {seller.in_transit_minor ? formatPrice(seller.in_transit_minor) : "—"}
                </td>
                <td>
                  <span className="tabular-nums">{seller.iban_masked ?? "Sin cuenta"}</span>
                  <p className="text-xs text-ink-muted">{seller.holder_name ?? ""}</p>
                </td>
                <td>
                  {seller.will_pay ? (
                    <Badge tone="success">Se paga</Badge>
                  ) : (
                    <ul className="flex flex-col items-start gap-1">
                      {seller.reasons.map((reason) => (
                        <li key={reason}>
                          <Badge tone={reason === "below_minimum" ? "neutral" : "warning"}>
                            {PAYOUT_BLOCK[reason]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      <div className="mt-5 max-w-2xl">
        {preview.run ? (
          <p className="mb-3 text-sm">
            Ya existe la corrida de este corte:{" "}
            <Link
              href={`/pagos-vendedores/corridas/${preview.run.id}` as Route}
              className="font-semibold text-link underline"
            >
              abrir {preview.run.code}
            </Link>
            .
          </p>
        ) : null}
        {preview.to_pay_count > 0 ? (
          <ActionForm
            action={createPayoutRun}
            submit={
              preview.run
                ? `Agregar ${preview.to_pay_count === 1 ? "este pago" : "estos pagos"} a la corrida ${preview.run.code}`
                : "Crear la corrida de pagos"
            }
            pendingLabel="Creando…"
          >
            <input type="hidden" name="cutoff" value={preview.cutoff_on} />
            <p className="text-sm text-ink-muted">
              Al crearla, cada monto y cada cuenta quedan fijos en la lista para el banco. Todavía
              no se registra ningún pago: eso ocurre cuando usted marca cada transferencia como
              hecha.
            </p>
          </ActionForm>
        ) : (
          <p className="text-sm text-ink-muted">
            {preview.run
              ? "No hay nada más que agregar a esta corrida."
              : "Con esta fecha de corte no hay ninguna tienda por pagar."}
          </p>
        )}
      </div>
    </section>
  );
}
