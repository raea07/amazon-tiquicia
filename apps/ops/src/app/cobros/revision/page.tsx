import { ORDER_STATUS_LABEL } from "@yuntera/core";
import type { PaymentReview } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import {
  Badge,
  formatDateTime,
  formatPrice,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { resolvePaymentReview } from "@/app/payment-actions";
import { PaymentNav } from "@/components/payment-nav";
import { REFUND_STATUS, REVIEW_KIND } from "@/lib/payment-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Cobros por revisar" };

export default function ReviewsPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Cobros por revisar">
        Dinero que el procesador recibió y que no se aplicó a ningún pedido, porque no coincidía. No
        cambia nada hasta que usted decida.
      </PageHeader>
      <PaymentNav current="/cobros/revision" />
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Reviews />
        </Suspense>
      </div>
    </div>
  );
}

async function Reviews() {
  await requireStaff("/cobros/revision", ["finance"]);
  const api = await sessionApi();
  const [open, all] = await Promise.all([
    api.opsPaymentReviews(true),
    api.opsPaymentReviews(false),
  ]);
  const settled = all
    .filter((review) => !["open", "refunding"].includes(review.status))
    .slice(0, 20);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="abiertos">
        <h2 id="abiertos" className="text-xl font-bold">
          Por decidir ({open.filter((review) => review.status === "open").length})
        </h2>
        <ul className="mt-1 max-w-3xl list-disc pl-5 text-sm text-ink-muted">
          <li>
            <strong>Aplicar al pedido</strong>: el dinero es el pago de ese pedido, que todavía lo
            espera, por el mismo monto.
          </li>
          <li>
            <strong>Aplicar a otro pedido</strong>: por ejemplo, alguien pagó desde la cuenta de un
            familiar. El pedido debe esperar el pago por el mismo monto.
          </li>
          <li>
            <strong>Devolver</strong>: se devuelve al cliente por el procesador, o por transferencia
            si no hay un pago al que devolverlo.
          </li>
          <li>
            <strong>Cerrar con nota</strong>: ya se resolvió por otro lado (por ejemplo, en el panel
            del procesador).
          </li>
        </ul>
        {open.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">No hay nada por revisar.</p>
        ) : (
          <ul className="mt-4 grid gap-4 lg:grid-cols-2">
            {open.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 ? (
        <section aria-labelledby="resueltos">
          <h2 id="resueltos" className="text-xl font-bold">
            Resueltos recientemente
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {settled.map((review) => (
              <li key={review.id} className="rounded-md border border-border bg-surface p-3">
                <span className="font-semibold">{REVIEW_KIND[review.kind].label}</span> ·{" "}
                {review.amount_minor === null ? "" : formatPrice(review.amount_minor)} ·{" "}
                {RESOLUTION[review.status] ?? review.status}
                {review.resolved_order_number ? ` (${review.resolved_order_number})` : ""}
                {review.resolution_note ? (
                  <span className="block text-ink-muted">“{review.resolution_note}”</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

const RESOLUTION: Record<string, string> = {
  accepted: "aplicado a su pedido",
  attached: "aplicado a otro pedido",
  refunded: "devuelto",
  dismissed: "cerrado con nota",
};

function ReviewCard({ review }: { review: PaymentReview }) {
  const kind = REVIEW_KIND[review.kind];
  return (
    <li
      className="rounded-lg border border-warning bg-surface p-5 text-sm"
      data-testid="payment-review"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">{kind.label}</h3>
        <span className="font-semibold tabular-nums">
          {review.amount_minor === null ? "—" : formatPrice(review.amount_minor)}
          {review.currency && review.currency !== "CRC" ? ` (${review.currency})` : ""}
        </span>
      </div>
      <p className="mt-1 text-ink-muted">{kind.text}</p>
      {review.detail ? <p className="mt-1">{review.detail}</p> : null}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-ink-muted">Recibido</dt>
        <dd>{formatDateTime(review.created_at)}</dd>
        <dt className="text-ink-muted">Pedido</dt>
        <dd>
          {review.order_number ? (
            <Link href={`/pedidos/${review.order_number}` as Route} className="text-link underline">
              {review.order_number}
            </Link>
          ) : (
            "Ninguno"
          )}
          {review.order_status ? ` · ${ORDER_STATUS_LABEL[review.order_status]["es-CR"]}` : ""}
        </dd>
        <dt className="text-ink-muted">Referencia</dt>
        <dd className="break-all">{review.payment_reference ?? "—"}</dd>
      </dl>
      {review.status === "refunding" ? (
        <p className="mt-3">
          Devolución en curso:{" "}
          <Badge tone={REFUND_STATUS[review.refund?.status ?? "requested"].tone}>
            {REFUND_STATUS[review.refund?.status ?? "requested"].label}
          </Badge>
        </p>
      ) : (
        <div className="mt-4">
          <ActionForm
            action={resolvePaymentReview}
            submit="Guardar decisión"
            pendingLabel="Guardando…"
            hideOnSuccess
          >
            <input type="hidden" name="reviewId" value={review.id} />
            <SelectField label="¿Qué hacer?" name="resolution" defaultValue="">
              <option value="" disabled>
                Elija…
              </option>
              {review.can_accept ? (
                <option value="accept">Aplicar al pedido {review.order_number}</option>
              ) : null}
              {review.can_attach ? <option value="attach">Aplicar a otro pedido</option> : null}
              {review.can_refund ? <option value="refund">Devolver al cliente</option> : null}
              <option value="dismiss">Cerrar con nota</option>
            </SelectField>
            {review.can_attach ? (
              <TextField
                label="Pedido al que corresponde"
                name="orderNumber"
                optional
                placeholder="YT-100123"
                hint="Solo para «Aplicar a otro pedido»."
              />
            ) : null}
            <TextAreaField
              label="Nota"
              name="note"
              rows={2}
              hint="Qué comprobó y con quién habló. Queda con el movimiento."
            />
          </ActionForm>
        </div>
      )}
    </li>
  );
}
