import {
  type OpsReview,
  REVIEW_FILTERS,
  REVIEW_HIDE_REASONS,
  type ReviewFilter,
} from "@yuntera/db";
import { BackLink } from "@yuntera/next-kit/back-link";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import {
  Badge,
  buttonClass,
  EmptyState,
  formatDateTime,
  SelectField,
  Skeleton,
  TextField,
} from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { hideReview, showReview } from "@/app/catalogue-actions";
import { CatalogueNav } from "@/components/catalogue-nav";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { REVIEW_FILTER, REVIEW_HIDE_REASON } from "@/lib/catalogue-labels";
import { REPORT_REASON } from "@/lib/labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Reseñas" };

export default function ReviewsPage({ searchParams }: PageProps<"/catalogo/resenas">) {
  return (
    <div className="shell py-8">
      <CatalogueNav current="/catalogo/resenas" />
      <PageHeader title="Reseñas">
        Las reseñas de compras verificadas se publican todas, buenas y malas: una calificación baja
        nunca es motivo para ocultarla. Oculte solo lo que incumple las reglas. Una reseña oculta
        deja de contar en la calificación del producto, y su autor ve en su pedido que la ocultamos
        y por qué.
      </PageHeader>
      <div className="mt-6">
        <CatalogueOutcome>
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Reviews searchParams={searchParams} />
          </Suspense>
        </CatalogueOutcome>
      </div>
    </div>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hrefFor(filter: ReviewFilter, page = 1): Route {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filtro", filter);
  if (page > 1) params.set("pagina", String(page));
  const text = params.toString();
  return (text ? `/catalogo/resenas?${text}` : "/catalogo/resenas") as Route;
}

async function Reviews({ searchParams }: Pick<PageProps<"/catalogo/resenas">, "searchParams">) {
  await requireStaff("/catalogo/resenas", ["catalog"]);
  const params = await searchParams;
  const filter = REVIEW_FILTERS.find((key) => key === one(params.filtro)) ?? "all";
  const reviewId = one(params.resena);
  const single = reviewId && UUID.test(reviewId) ? reviewId : null;
  const pageNumber = Math.min(
    Math.max(Number.parseInt(one(params.pagina) ?? "1", 10) || 1, 1),
    2000,
  );

  const api = await sessionApi();
  const page = await api.opsReviews(single ? "all" : filter, single, (pageNumber - 1) * 50);
  const pages = Math.max(1, Math.ceil(page.total / page.page_size));

  return (
    <div className="flex flex-col gap-5">
      {single ? (
        <BackLink href="/catalogo/resenas">Todas las reseñas</BackLink>
      ) : (
        <nav aria-label="Filtrar reseñas">
          <ul className="flex flex-wrap gap-2 text-sm">
            {REVIEW_FILTERS.map((key) => (
              <li key={key}>
                <Link
                  href={hrefFor(key)}
                  aria-current={key === filter ? "true" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 ${
                    key === filter
                      ? "bg-anil-900 font-semibold text-white"
                      : "border border-border-strong bg-surface text-ink hover:bg-surface-muted"
                  }`}
                >
                  {REVIEW_FILTER[key]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <p className="text-sm text-ink-muted" aria-live="polite">
        {page.total === 1 ? "1 reseña" : `${page.total.toLocaleString("es-CR")} reseñas`}
        {pages > 1 ? ` · página ${pageNumber} de ${pages}` : ""}
      </p>

      {page.reviews.length === 0 ? (
        <EmptyState
          title={single ? "No encontramos esa reseña" : "No hay reseñas con este filtro"}
          action={
            filter !== "all" || single ? (
              <Link href="/catalogo/resenas" className={buttonClass({ variant: "secondary" })}>
                Ver todas las reseñas
              </Link>
            ) : undefined
          }
        >
          {single ? "Puede que ya no exista." : "Pruebe con otro filtro."}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {page.reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </ul>
      )}

      {pages > 1 && !single ? (
        <nav aria-label="Páginas de reseñas" className="flex items-center justify-center gap-3">
          {pageNumber > 1 ? (
            <Link
              href={hrefFor(filter, pageNumber - 1)}
              className={buttonClass({ variant: "secondary" })}
            >
              Anterior
            </Link>
          ) : null}
          {pageNumber < pages ? (
            <Link
              href={hrefFor(filter, pageNumber + 1)}
              className={buttonClass({ variant: "secondary" })}
            >
              Siguiente
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

/** Nothing is chosen for staff: they say why. */
function ReasonField() {
  return (
    <SelectField label="Motivo" name="reason" defaultValue="">
      <option value="" disabled>
        Elija…
      </option>
      {REVIEW_HIDE_REASONS.map((key) => (
        <option key={key} value={key}>
          {REVIEW_HIDE_REASON[key]}
        </option>
      ))}
    </SelectField>
  );
}

function ReviewCard({ review }: { review: OpsReview }) {
  const shop = process.env.NEXT_PUBLIC_SHOP_URL ?? "";
  return (
    <li className="rounded-lg border border-border bg-surface p-5 text-sm" data-review={review.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{review.rating} de 5 estrellas</span>
        {review.hidden ? (
          <Badge tone="warning">Oculta</Badge>
        ) : (
          <Badge tone="success">Publicada</Badge>
        )}
        {review.open_reports > 0 ? (
          <Badge tone="danger">
            {review.open_reports === 1
              ? "1 reporte abierto"
              : `${review.open_reports} reportes abiertos`}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-ink-muted">
        <a
          href={`${shop}/p/${review.product_slug}`}
          className="text-link underline"
          target="_blank"
          rel="noreferrer"
        >
          {review.product_title}
        </a>{" "}
        · {review.seller_name ?? "Vendedor"} · {review.author} · {formatDateTime(review.created_at)}
      </p>
      {review.title ? <p className="mt-2 font-semibold">{review.title}</p> : null}
      {review.body ? <p className="mt-1 break-words">{review.body}</p> : null}
      {review.report_reasons.length > 0 ? (
        <p className="mt-2 text-ink-muted">
          Reportada por:{" "}
          {review.report_reasons
            .map((reason) => REPORT_REASON[reason as keyof typeof REPORT_REASON] ?? reason)
            .join(", ")}
        </p>
      ) : null}
      {review.hidden ? (
        <p className="mt-2 text-warning">
          Oculta: {REVIEW_HIDE_REASON[review.hidden_reason ?? "rules"]}
          {review.hidden_at ? ` · desde el ${formatDateTime(review.hidden_at)}` : ""}
        </p>
      ) : null}

      {review.seller_reply ? (
        <div className="mt-3 rounded-md bg-surface-muted p-3">
          <p>
            <span className="font-semibold">Respuesta del vendedor: </span>
            {review.seller_reply}
          </p>
          {review.reply_hidden ? (
            <p className="mt-1 text-warning">
              Respuesta oculta: {REVIEW_HIDE_REASON[review.reply_hidden_reason ?? "rules"]}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
        {review.hidden ? (
          <CatalogueForm action={showReview} submit="Mostrar la reseña de nuevo" size="sm">
            <input type="hidden" name="reviewId" value={review.id} />
            <p className="text-ink-muted">Vuelve a la página del producto y a su calificación.</p>
          </CatalogueForm>
        ) : (
          <details>
            <summary
              className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link"
              data-testid="review-hide"
            >
              Ocultar la reseña
            </summary>
            <div className="mt-2">
              <CatalogueForm
                action={hideReview}
                submit="Ocultar la reseña"
                variant="danger"
                size="sm"
                pendingLabel="Ocultando…"
              >
                <input type="hidden" name="reviewId" value={review.id} />
                <input type="hidden" name="part" value="review" />
                <ReasonField />
                <TextField
                  label="Nota interna"
                  name="note"
                  optional
                  maxLength={500}
                  autoComplete="off"
                  hint="Queda en el registro. El autor ve solo el motivo."
                />
                {review.open_reports > 0 ? (
                  <p className="text-ink-muted">
                    Los reportes abiertos de esta reseña se cierran como atendidos.
                  </p>
                ) : null}
              </CatalogueForm>
            </div>
          </details>
        )}

        {review.seller_reply ? (
          review.reply_hidden ? (
            <CatalogueForm
              action={showReview}
              submit="Mostrar la respuesta del vendedor"
              size="sm"
              variant="secondary"
            >
              <input type="hidden" name="reviewId" value={review.id} />
              <input type="hidden" name="part" value="reply" />
            </CatalogueForm>
          ) : (
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
                Ocultar solo la respuesta del vendedor
              </summary>
              <div className="mt-2">
                <CatalogueForm
                  action={hideReview}
                  submit="Ocultar la respuesta"
                  variant="danger"
                  size="sm"
                  pendingLabel="Ocultando…"
                >
                  <input type="hidden" name="reviewId" value={review.id} />
                  <input type="hidden" name="part" value="reply" />
                  <ReasonField />
                  <TextField
                    label="Nota interna"
                    name="note"
                    optional
                    maxLength={500}
                    autoComplete="off"
                  />
                  <p className="text-ink-muted">La reseña y la calificación no cambian.</p>
                </CatalogueForm>
              </div>
            </details>
          )
        ) : null}
      </div>
    </li>
  );
}
