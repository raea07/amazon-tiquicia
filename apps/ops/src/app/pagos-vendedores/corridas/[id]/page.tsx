import { ApiError, type PayoutRun } from "@yuntera/db";
import { BackLink } from "@yuntera/next-kit/back-link";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { Stat } from "@yuntera/next-kit/shell";
import {
  Alert,
  Badge,
  buttonClass,
  formatDate,
  formatDateTime,
  formatPrice,
  Skeleton,
  TextAreaField,
  TextField,
} from "@yuntera/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { markPayoutFailed, markPayoutPaid } from "@/app/people-actions";
import { groupIban, PAYOUT_STATUS } from "@/lib/people-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Corrida de pagos" };

type Payout = PayoutRun["payouts"][number];

export default function PayoutRunPage({ params }: PageProps<"/pagos-vendedores/corridas/[id]">) {
  return (
    <div className="shell py-8">
      <BackLink href="/pagos-vendedores">Pagos a vendedores</BackLink>
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Run params={params} />
        </Suspense>
      </div>
    </div>
  );
}

const total = (payouts: Payout[]) => payouts.reduce((sum, payout) => sum + payout.amount_minor, 0);

async function Run({ params }: Pick<PageProps<"/pagos-vendedores/corridas/[id]">, "params">) {
  const { id } = await params;
  await requireStaff(`/pagos-vendedores/corridas/${id}`, ["finance"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { run, payouts } = await (await sessionApi()).opsPayoutRun(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "payout_run_not_found") notFound();
    throw error;
  });
  const scheduled = payouts.filter((payout) => payout.status === "scheduled");
  const paid = payouts.filter((payout) => payout.status === "paid");
  const failed = payouts.filter((payout) => payout.status === "failed");

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold">Corrida {run.code}</h1>
        <p className="mt-1 text-ink-muted">
          Corte del {formatDate(run.cutoff_on, { day: "numeric", month: "long", year: "numeric" })}{" "}
          · creada por {run.created_by_name ?? "—"} el {formatDateTime(run.created_at)}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3" data-testid="run-figures">
        <Stat
          label="Por transferir"
          value={formatPrice(total(scheduled))}
          hint={scheduled.length === 1 ? "1 pago" : `${scheduled.length} pagos`}
          tone={scheduled.length > 0 ? "warning" : undefined}
        />
        <Stat
          label="Pagado"
          value={formatPrice(total(paid))}
          hint={paid.length === 1 ? "1 pago" : `${paid.length} pagos`}
        />
        <Stat
          label="No se pagó"
          value={String(failed.length)}
          hint="Vuelven a estar disponibles para otra corrida"
        />
      </div>

      <section aria-labelledby="pasos" className="max-w-3xl">
        <h2 id="pasos" className="text-xl font-bold">
          Cómo pagar esta corrida
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>Descargue la lista y haga cada transferencia en el banco.</li>
          <li>
            Copie el “detalle” tal cual en la descripción de la transferencia: así el vendedor la
            reconoce.
          </li>
          <li>Registre aquí cada transferencia hecha, con el comprobante que da el banco.</li>
          <li>Si el banco rechaza o devuelve una, márquela como no pagada y explique por qué.</li>
        </ol>
        {scheduled.length > 0 ? (
          <p className="mt-4">
            {/* A plain link on purpose: this is a file download, not a page to prefetch. */}
            <a
              href={`/pagos-vendedores/corridas/${run.id}/transferencias`}
              download
              className={buttonClass({ variant: "secondary" })}
            >
              Descargar la lista para el banco (CSV)
            </a>
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            No queda ninguna transferencia por hacer en esta corrida.
          </p>
        )}
      </section>

      <section aria-labelledby="pagos">
        <h2 id="pagos" className="text-xl font-bold">
          Pagos ({payouts.length})
        </h2>
        <ul className="mt-3 grid gap-4 lg:grid-cols-2">
          {[...scheduled, ...paid, ...failed].map((payout) => (
            <PayoutCard key={payout.id} payout={payout} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function FailForm({ payout, returned }: { payout: Payout; returned: boolean }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer py-3 font-semibold text-link" data-testid="payout-failed">
        {returned ? "El banco devolvió esta transferencia" : "No se pudo pagar"}
      </summary>
      <div className="mt-3">
        <ActionForm
          action={markPayoutFailed}
          submit="Marcar como no pagado"
          variant="danger"
          size="sm"
          pendingLabel="Guardando…"
        >
          <input type="hidden" name="payoutId" value={payout.id} />
          <TextAreaField
            label="Motivo"
            name="note"
            rows={2}
            hint="Lo lee el vendedor. Por ejemplo: “El banco rechazó la cuenta: está cerrada”."
          />
        </ActionForm>
      </div>
    </details>
  );
}

function PayoutCard({ payout }: { payout: Payout }) {
  const status = PAYOUT_STATUS[payout.status];
  return (
    <li className="rounded-lg border border-border bg-surface p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold">{payout.trade_name}</h3>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">
        {formatPrice(payout.amount_minor)}
      </p>

      <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-ink-muted">Cuenta IBAN</dt>
          <dd className="font-semibold tabular-nums">{groupIban(payout.iban)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Titular</dt>
          <dd className="font-medium">{payout.holder_name}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Detalle de la transferencia</dt>
          <dd className="font-medium">{payout.reference}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-ink-muted">Vendedor registrado</dt>
          <dd>
            {payout.legal_name} · {payout.id_number}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
        {payout.account_changed ? (
          <Alert tone="warning" title="La cuenta de esta tienda cambió">
            Este pago quedó programado a la cuenta anterior. Si ya no debe usarse, márquelo como no
            pagado y vuelva a crear la corrida de este corte: el pago nuevo sale a la cuenta
            aprobada.
          </Alert>
        ) : null}
        {payout.status === "scheduled" ? (
          <>
            <ActionForm
              action={markPayoutPaid}
              submit="Registrar como pagado"
              size="sm"
              pendingLabel="Registrando…"
            >
              <input type="hidden" name="payoutId" value={payout.id} />
              <TextField
                label="Comprobante del banco"
                name="bankReference"
                maxLength={60}
                autoComplete="off"
                hint="El número de referencia de la transferencia ya hecha."
              />
            </ActionForm>
            <FailForm payout={payout} returned={false} />
          </>
        ) : null}
        {payout.status === "paid" ? (
          <>
            <p>
              Comprobante <span className="font-semibold">{payout.bank_reference}</span>
              {payout.paid_at ? ` · registrado el ${formatDateTime(payout.paid_at)}` : ""}
            </p>
            <FailForm payout={payout} returned />
          </>
        ) : null}
        {payout.status === "failed" ? (
          <p>
            <span className="font-semibold">Motivo:</span> {payout.failure_reason ?? "—"}
            {payout.failed_at ? (
              <span className="block text-ink-muted">
                Registrado el {formatDateTime(payout.failed_at)}
                {payout.bank_reference ? ` · comprobante original ${payout.bank_reference}` : ""}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}
