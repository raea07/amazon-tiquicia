import { ORDER_STATUS_LABEL, type OrderStatus } from "@yuntera/core";
import { ApiError, type CaseDetail, type SavedReply } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { Badge, formatDate, formatDateTime, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  AssignCaseForm,
  CaseAnswerForm,
  CaseNoteForm,
  RecordContactForm,
  ReopenCaseForm,
} from "@/components/case-forms";
import {
  CASE_CHANNEL_IN_SENTENCE,
  CASE_CLOCK,
  CASE_KIND,
  CASE_ROLES,
  caseTopic,
  deadline,
  entryLabel,
  timeLeft,
} from "@/lib/case-labels";
import { RETURN_STATUS } from "@/lib/labels";
import { canSee, requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Caso" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CasePage({ params }: PageProps<"/casos/[id]">) {
  return (
    <div className="shell py-8">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Case params={params} />
      </Suspense>
    </div>
  );
}

async function Case({ params }: Pick<PageProps<"/casos/[id]">, "params">) {
  const { id } = await params;
  const staff = await requireStaff(`/casos/${id}`, CASE_ROLES);
  if (!UUID.test(id)) notFound();
  const api = await sessionApi();
  let item: CaseDetail;
  try {
    item = await api.opsCase(id);
  } catch (error) {
    // A case the role does not handle reads as one that does not exist.
    if (error instanceof ApiError && error.code === "case_not_found") notFound();
    throw error;
  }
  const replies: SavedReply[] =
    item.can.answer && canSee(staff.staff_role, ["support"]) ? await api.opsSavedReplies() : [];
  await connection();
  const now = Date.now();
  const clock = CASE_CLOCK[item.clock];
  const left = timeLeft(item, now);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-8">
        <header>
          <p className="text-sm text-ink-muted">
            <Link href="/casos" className="inline-flex min-h-11 items-center text-link underline">
              Volver a Casos
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">
              {CASE_KIND[item.kind] ?? item.kind} {item.reference}
            </h1>
            <Badge tone={clock.tone}>{clock.label}</Badge>
          </div>
          <p className="mt-1 text-ink-muted">
            {caseTopic(item)} · llegó por {CASE_CHANNEL_IN_SENTENCE[item.channel] ?? item.channel}{" "}
            el {formatDateTime(item.created_at)}
          </p>
          {left ? (
            <p className={item.clock === "overdue" ? "mt-1 font-semibold text-danger" : "mt-1"}>
              {left}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-ink-muted">
            Primera respuesta a más tardar {deadline(item.first_response_due_at)}
            {item.first_response_at
              ? ` (respondido ${formatDateTime(item.first_response_at)})`
              : ""}
            {" · "}resolver a más tardar {deadline(item.due_at)}
          </p>
          <p className="mt-1 text-sm">
            {item.assignee
              ? item.assigned_to_me
                ? "Usted atiende este caso."
                : `Lo atiende ${item.assignee}.`
              : "Nadie lo ha tomado todavía."}
          </p>
        </header>

        <section aria-labelledby="pedido-cliente">
          <h2 id="pedido-cliente" className="text-xl font-bold">
            Lo que pidió
          </h2>
          <div className="mt-3 rounded-lg border border-border bg-surface p-5 text-sm">
            {item.request.title ? (
              <p className="font-semibold">
                {item.request.quantity} × {item.request.title}
                {item.request.status
                  ? ` · ${RETURN_STATUS[item.request.status]?.label ?? item.request.status}`
                  : ""}
              </p>
            ) : null}
            {item.request.refund_due_on ? (
              <p className="text-ink-muted">
                Reembolso a más tardar el {formatDate(item.request.refund_due_on)}
              </p>
            ) : null}
            {item.request.text ? (
              <p className="mt-2 whitespace-pre-line break-words rounded-md bg-surface-muted p-3">
                {item.request.text}
              </p>
            ) : (
              <p className="mt-2 text-ink-muted">Sin texto.</p>
            )}
            {item.kind !== "contact" ? (
              <p className="mt-3 text-ink-muted">
                {item.kind === "report"
                  ? "El reporte se resuelve en Atención; aquí quedan las notas y las respuestas."
                  : item.kind === "return"
                    ? "La devolución se decide y se reembolsa en Atención; aquí quedan las notas y las respuestas."
                    : "También puede responderlo en Atención: la respuesta queda en este caso."}{" "}
                <Link href="/atencion" className="text-link underline">
                  Ir a Atención
                </Link>
              </p>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="historial">
          <h2 id="historial" className="text-xl font-bold">
            Historial
          </h2>
          <ol className="mt-3 flex flex-col gap-3 border-l-2 border-border pl-4 text-sm">
            {item.entries.map((entry) => (
              <li key={entry.id} data-testid={`case-entry-${entry.kind}`}>
                <p>
                  <span className="font-medium">
                    {entryLabel(entry.kind, entry.body, item.kind)}
                  </span>
                  {entry.kind === "note" ? (
                    <span className="ml-2 text-xs text-ink-muted">(el cliente no la ve)</span>
                  ) : null}
                  <span className="ml-2 text-ink-muted">
                    {entry.author ? `${entry.author} · ` : ""}
                    {formatDateTime(entry.created_at)}
                  </span>
                </p>
                {entry.body && (entry.kind === "note" || entry.kind === "answer") ? (
                  <p
                    className={`mt-1 whitespace-pre-line break-words rounded-md p-3 ${
                      entry.kind === "note" ? "bg-surface-muted" : "border border-border bg-surface"
                    }`}
                  >
                    {entry.body}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        {item.can.answer ? (
          <section aria-labelledby="responder">
            <h2 id="responder" className="text-xl font-bold">
              Responder al cliente
            </h2>
            <div className="mt-3 rounded-lg border border-border bg-surface p-5">
              <CaseAnswerForm caseId={item.id} replies={replies} canClose={item.can.close} />
            </div>
          </section>
        ) : null}

        {item.can.note ? (
          <section aria-labelledby="nota">
            <h2 id="nota" className="text-xl font-bold">
              Nota interna
            </h2>
            <div className="mt-3 rounded-lg border border-border bg-surface p-5">
              <CaseNoteForm caseId={item.id} />
            </div>
          </section>
        ) : null}
      </div>

      <aside aria-label="Pedido y cliente" className="flex h-fit flex-col gap-5">
        {item.can.assign || item.can.reopen ? (
          <div className="rounded-lg border border-border bg-surface p-5">
            {item.can.assign ? <AssignCaseForm caseId={item.id} /> : null}
            {item.can.reopen ? <ReopenCaseForm caseId={item.id} /> : null}
          </div>
        ) : null}

        {item.order ? (
          <div className="rounded-lg border border-border bg-surface p-5 text-sm">
            <h2 className="text-base font-bold">Pedido</h2>
            <p className="mt-2">
              <Link
                href={`/pedidos/${item.order.order_number}` as Route}
                className="inline-flex min-h-11 items-center font-semibold text-link underline"
              >
                Pedido {item.order.order_number}
              </Link>
            </p>
            <p className="text-ink-muted">
              {ORDER_STATUS_LABEL[item.order.status as OrderStatus]?.["es-CR"] ?? item.order.status}{" "}
              · {item.order.item_count} {item.order.item_count === 1 ? "producto" : "productos"} ·{" "}
              {formatPrice(item.order.total_minor)}
            </p>
            <p className="text-ink-muted">Realizado el {formatDateTime(item.order.placed_at)}</p>
          </div>
        ) : null}

        {item.customer ? (
          <div className="rounded-lg border border-border bg-surface p-5 text-sm">
            <h2 className="text-base font-bold">Cliente</h2>
            <p className="mt-2">
              {item.customer.first_name ?? "Sin nombre"}
              {item.customer.district ? ` · ${item.customer.district}` : ""}
            </p>
            {item.can.customer ? (
              <p>
                <Link
                  href={`/clientes/${item.customer.id}` as Route}
                  className="inline-flex min-h-11 items-center text-link underline"
                >
                  Ver el cliente: pedidos, devoluciones y casos
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        {canSee(staff.staff_role, ["support"]) && (item.order || item.customer) ? (
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-bold">Registrar un contacto</h2>
            <p className="mt-1 mb-3 text-sm text-ink-muted">
              Si la persona escribió por WhatsApp, llamó o mandó un correo, regístrelo como un caso
              nuevo{item.order ? " de este pedido" : " de este cliente"}.
            </p>
            {item.order ? (
              <RecordContactForm orderNumber={item.order.order_number} />
            ) : (
              <RecordContactForm userId={item.customer?.id} />
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
