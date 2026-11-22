import { PHOTO_BUCKETS } from "@yuntera/core";
import type { OpsLogoReview } from "@yuntera/db";
import { ActionForm, DecisionForm } from "@yuntera/next-kit/client";
import { sessionApi, sessionClient } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { ShopLogo } from "@yuntera/next-kit/shop-logo";
import { Alert, Badge, EmptyState, formatDateTime, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { retryLogoPublishing, reviewLogo } from "@/app/logo-actions";
import { CatalogueNav } from "@/components/catalogue-nav";
import { SELLER_STATUS } from "@/lib/labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Logotipos por revisar" };

/**
 * Shops' logos waiting for a decision, reviewed like product photos: the
 * largest copy is shown, the one the public sizes are made from. Approving
 * publishes it at once; rejecting needs a reason the seller reads.
 */
export default function LogoReviewPage() {
  return (
    <div className="shell py-8">
      <CatalogueNav current="/catalogo/logotipos" />
      <PageHeader title="Logotipos por revisar">
        El logotipo aparece junto al nombre de la tienda en sus productos y en su página. Revise que
        sea de la tienda, que no use la marca de otra empresa ni de Yuntera y que no muestre datos
        personales.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Queue />
        </Suspense>
      </div>
    </div>
  );
}

async function Queue() {
  await requireStaff("/catalogo/logotipos", ["catalog"]);
  const logos = await (await sessionApi()).opsLogosForReview();
  const waiting = logos.filter((logo) => logo.kind === "review");
  const toPublish = logos.filter((logo) => logo.kind === "publish");
  // Staff may sign links to waiting files; 15 minutes is enough to look.
  const previews = new Map<string, string>();
  if (waiting.length > 0) {
    const { data } = await (await sessionClient()).storage
      .from(PHOTO_BUCKETS.pending)
      .createSignedUrls(
        waiting.map((logo) => logo.review_path),
        15 * 60,
      );
    for (const signed of data ?? []) {
      const logo = waiting.find((item) => item.review_path === signed.path);
      if (logo && signed.signedUrl) previews.set(logo.logo_id, signed.signedUrl);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="por-revisar">
        <h2 id="por-revisar" className="text-xl font-bold">
          Por revisar ({waiting.length})
        </h2>
        <div className="mt-4">
          {waiting.length === 0 ? (
            <EmptyState title="No hay logotipos por revisar">La cola está al día.</EmptyState>
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2">
              {waiting.map((logo) => (
                <LogoCard key={logo.logo_id} logo={logo} preview={previews.get(logo.logo_id)} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {toPublish.length > 0 ? (
        <section aria-labelledby="por-publicar">
          <h2 id="por-publicar" className="text-xl font-bold">
            Aprobados sin publicar ({toPublish.length})
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Sus archivos no llegaron a la tienda. Intente publicarlos otra vez.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {toPublish.map((logo) => (
              <li
                key={logo.logo_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 text-sm"
              >
                <span className="font-semibold">{logo.seller_name}</span>
                <ActionForm
                  action={retryLogoPublishing}
                  submit="Publicar"
                  pendingLabel="Publicando…"
                  variant="secondary"
                  size="sm"
                  hideOnSuccess
                >
                  <input type="hidden" name="logoId" value={logo.logo_id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function LogoCard({ logo, preview }: { logo: OpsLogoReview; preview: string | undefined }) {
  const status = SELLER_STATUS[logo.seller_status];
  return (
    <li className="rounded-lg border border-border bg-surface p-5 text-sm">
      <h3 className="text-lg font-bold break-words">{logo.seller_name}</h3>
      <p className="mt-1 text-ink-muted">
        <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? logo.seller_status}</Badge> ·
        enviado {formatDateTime(logo.created_at)}
        {logo.width && logo.height ? ` · ${logo.width} × ${logo.height} px` : ""}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <figure>
          {preview ? (
            // biome-ignore lint/performance/noImgElement: a private file behind a short signed link
            <img
              src={preview}
              alt={`Logotipo nuevo de ${logo.seller_name}`}
              width={160}
              height={160}
              className="size-40 rounded-md border border-border bg-surface object-contain"
            />
          ) : (
            <span className="inline-flex size-40 items-center justify-center rounded-md border border-border text-ink-muted">
              Sin vista previa
            </span>
          )}
          <figcaption className="mt-1 text-xs text-ink-muted">Nuevo</figcaption>
        </figure>
        <figure>
          <ShopLogo logo={logo.current_logo} name={logo.seller_name} size={64} />
          <figcaption className="mt-1 text-xs text-ink-muted">Actual</figcaption>
        </figure>
      </div>
      {logo.files_changed ? (
        <Alert tone="warning" className="mt-3">
          Sus archivos cambiaron después de enviarlo: si lo aprueba, se rechaza solo.
        </Alert>
      ) : null}
      <div className="mt-4 border-t border-border pt-4">
        {logo.own_shop ? (
          <p className="text-ink-muted">
            Usted pertenece a esta tienda, así que otra persona del equipo debe decidir.
          </p>
        ) : (
          <DecisionForm
            action={reviewLogo}
            noteLabel="Motivo"
            noteHint="Obligatorio si lo rechaza. La tienda lo lee tal cual: diga qué debe corregir."
            yes="Aprobar y publicar"
            no="Rechazar"
          >
            <input type="hidden" name="logoId" value={logo.logo_id} />
          </DecisionForm>
        )}
      </div>
    </li>
  );
}
