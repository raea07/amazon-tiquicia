import { parsePhone } from "@yuntera/core";
import type { ShopChangeKind, ShopChangeRequest, ShopDetails } from "@yuntera/db";
import { DecisionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, Badge, formatDateTime, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { decideShopChange } from "@/app/shop-change-actions";
import { SELLER_STATUS } from "@/lib/labels";
import { ID_TYPE, REQUEST_STATUS } from "@/lib/people-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Cambios de tienda" };

const phone = (value: string | null | undefined) =>
  value ? (parsePhone(value)?.formatted ?? value) : "—";

const KIND: Record<ShopChangeKind, string> = {
  shop_name: "Nombre de la tienda",
  fiscal: "Datos fiscales",
  contact: "Correo y teléfono",
  description: "Descripción de la tienda",
};

const NAME_PROBLEM = {
  shop_name_invalid: "El nombre tiene caracteres que no se aceptan.",
  shop_name_reserved: "El nombre parece de Yuntera o de su servicio al cliente.",
  shop_name_taken: "Otra tienda activa ya usa ese nombre.",
} as const;

export default function ShopChangesPage({ searchParams }: PageProps<"/cambios-tienda">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Cambios de tienda">
        Lo que los vendedores piden cambiar de su tienda: el nombre y la descripción que ven los
        compradores (lo decide operaciones), los datos fiscales (operaciones) y el correo y teléfono
        de contacto (finanzas, porque es el teléfono con que confirma los cambios de cuenta). Nada
        cambia hasta que alguien lo aprueba aquí.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Queue searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Queue({ searchParams }: Pick<PageProps<"/cambios-tienda">, "searchParams">) {
  await requireStaff("/cambios-tienda", ["ops", "finance"]);
  const params = await searchParams;
  const decided =
    params.resuelta === "aprobada" || params.resuelta === "rechazada" ? params.resuelta : null;
  const requests = await (await sessionApi()).opsShopChangeRequests(null);
  const waiting = requests.filter((request) => request.status === "pending");
  const recent = requests.filter((request) => request.status !== "pending").slice(0, 10);

  return (
    <section aria-labelledby="por-resolver">
      <h2 id="por-resolver" className="text-xl font-bold">
        Por resolver ({waiting.length})
      </h2>
      {decided === "aprobada" ? (
        <Alert tone="success" className="mt-3">
          Cambio aprobado. Ya se ve en la tienda.
        </Alert>
      ) : decided === "rechazada" ? (
        <Alert tone="success" className="mt-3">
          Solicitud rechazada. El vendedor ve el motivo que usted escribió.
        </Alert>
      ) : null}
      {waiting.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No hay cambios por resolver.</p>
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
                  <span className="font-semibold">{request.seller.trade_name}</span> ·{" "}
                  {KIND[request.kind]}{" "}
                  <Badge tone={status?.tone ?? "neutral"}>{status?.label}</Badge>
                  <span className="block text-ink-muted">
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
  );
}

/** The fields of one kind, as a definition list: what there is, or what is asked. */
function Details({ kind, details }: { kind: ShopChangeKind; details: ShopDetails | null }) {
  if (!details) return <dd>—</dd>;
  if (kind === "shop_name") return <dd className="font-bold break-words">{details.trade_name}</dd>;
  if (kind === "description") {
    // The seller's text, shown as text with its line breaks: markup in it is never rendered.
    return (
      <dd className="whitespace-pre-line break-words">
        {details.description ?? <span className="text-ink-muted">Sin descripción</span>}
      </dd>
    );
  }
  if (kind === "contact") {
    return (
      <>
        <dd className="font-bold tabular-nums">{phone(details.contact_phone)}</dd>
        <dd className="break-all">{details.contact_email}</dd>
      </>
    );
  }
  return (
    <>
      <dd className="font-medium">
        Régimen {details.tax_regime === "simplificado" ? "simplificado" : "general"}
      </dd>
      <dd className="break-words">{details.fiscal_address}</dd>
      <dd className="text-ink-muted">
        Código postal {details.postal_code ?? "—"} · Actividad{" "}
        {details.economic_activity_code ?? "—"}
      </dd>
    </>
  );
}

function RequestCard({ request }: { request: ShopChangeRequest }) {
  const { seller, signals } = request;
  const status = SELLER_STATUS[seller.status];
  return (
    <li className="rounded-lg border border-border bg-surface p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold break-words">{seller.trade_name}</h3>
        <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? seller.status}</Badge>
      </div>
      <p className="font-semibold">{KIND[request.kind]}</p>
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
        </div>
        <div>
          <dt className="text-ink-muted">Ahora</dt>
          <Details kind={request.kind} details={request.current} />
        </div>
        <div className="rounded-md bg-surface-muted p-3">
          <dt className="text-ink-muted">Lo que pide</dt>
          <Details kind={request.kind} details={request.proposed} />
        </div>
      </dl>

      <div className="mt-4 flex flex-col gap-2">
        {signals.name_problem ? (
          <Alert tone="warning" title="Este nombre no se puede aprobar ahora">
            {NAME_PROBLEM[signals.name_problem]}
          </Alert>
        ) : null}
        {request.kind === "contact" ? (
          signals.payout_request_open ? (
            <Alert tone="warning" title="Primero, el cambio de cuenta bancaria">
              Esta tienda también tiene un cambio de cuenta bancaria en revisión, que se confirma
              llamando al teléfono actual. Resuélvalo primero en Pagos a vendedores; mientras tanto
              este cambio solo se puede rechazar.
            </Alert>
          ) : (
            <Alert tone="info">
              Confirme el cambio llamando al teléfono registrado, no al nuevo.
            </Alert>
          )
        ) : null}
        {request.kind === "fiscal" ? (
          <Alert tone="info">
            Verifique los datos nuevos en el registro de Hacienda antes de aprobar.
          </Alert>
        ) : null}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        {request.can_decide ? (
          <DecisionForm
            action={decideShopChange}
            noteLabel="Nota para el vendedor"
            noteHint="Obligatoria si rechaza: el vendedor la lee tal como usted la escriba."
            yes="Aprobar el cambio"
            no="Rechazar"
          >
            <input type="hidden" name="requestId" value={request.id} />
          </DecisionForm>
        ) : (
          <p className="text-ink-muted">
            Usted pidió este cambio o pertenece a esta tienda, así que lo decide otra persona del
            equipo.
          </p>
        )}
      </div>
    </li>
  );
}
