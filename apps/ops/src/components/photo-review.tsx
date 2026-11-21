import type { OpsPhotoReview, ProductPhoto } from "@yuntera/db";
import { ActionForm, DecisionForm } from "@yuntera/next-kit/client";
import { Badge, TextAreaField } from "@yuntera/ui";
import { rejectPhoto, retryPhotoPublishing, reviewPhotoChange } from "@/app/photo-actions";

/** A row of photos as catalogue staff review them. */
export function PhotoStrip({
  photos,
  previews,
  label,
  rejectable = false,
  removing = [],
}: {
  photos: ProductPhoto[];
  previews: Map<string, string>;
  label: string;
  /** Offer to reject each waiting photo on its own. */
  rejectable?: boolean;
  /** Photos that leave the shop if the change is approved. */
  removing?: string[];
}) {
  if (photos.length === 0) {
    return <p className="text-sm text-ink-muted">{label}: ninguna foto.</p>;
  }
  return (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      <ol className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => {
          const preview = previews.get(photo.photo_id);
          return (
            <li
              key={photo.photo_id}
              className="flex flex-col gap-2 rounded-md border border-border p-2 text-sm"
              data-review-photo={photo.photo_id}
            >
              {preview ? (
                // biome-ignore lint/performance/noImgElement: a 400 px copy shown through a short-lived link
                <img
                  src={preview}
                  alt={photo.alt ?? ""}
                  width={160}
                  height={160}
                  className="aspect-square w-full rounded border border-border bg-arena-100 object-contain"
                />
              ) : (
                <div className="aspect-square w-full rounded border border-border bg-arena-100" />
              )}
              <p className="flex flex-wrap items-center gap-1">
                <span className="font-semibold">{index + 1}.</span>
                {photo.state === "pending" ? <Badge tone="warning">Nueva</Badge> : null}
                {removing.includes(photo.photo_id) ? <Badge tone="danger">Se quita</Badge> : null}
              </p>
              <p className="text-ink-muted">
                <span className="sr-only">Texto alternativo: </span>
                {photo.alt ?? photo.live_alt}
              </p>
              {rejectable && photo.state === "pending" ? (
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-link underline">
                    Rechazar esta foto
                  </summary>
                  <ActionForm
                    action={rejectPhoto}
                    submit="Rechazar foto"
                    variant="secondary"
                    size="sm"
                  >
                    <input type="hidden" name="photoId" value={photo.photo_id} />
                    <TextAreaField
                      label="Motivo"
                      name="note"
                      rows={2}
                      hint="El vendedor lo lee tal cual: diga qué debe corregir."
                    />
                  </ActionForm>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A published listing's photo change: what the shop shows, what it would show. */
export function PhotoChangeReview({
  item,
  previews,
}: {
  item: OpsPhotoReview;
  previews: Map<string, string>;
}) {
  const staying = new Set(item.after.map((photo) => photo.photo_id));
  const removing = item.before.filter((photo) => !staying.has(photo.photo_id));
  return (
    <article
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 text-sm"
      data-photo-change={item.product_id}
    >
      <p>
        <Badge tone="info">Cambio de fotos de un producto publicado</Badge>
      </p>
      <h3 className="text-lg font-bold">{item.title}</h3>
      <p className="text-ink-muted">{item.seller_name}</p>
      <PhotoStrip
        photos={item.before}
        previews={previews}
        label="Ahora en la tienda"
        removing={removing.map((photo) => photo.photo_id)}
      />
      <PhotoStrip photos={item.after} previews={previews} label="Propuesta" rejectable />
      <div className="border-t border-border pt-4">
        <DecisionForm
          action={reviewPhotoChange}
          noteLabel="Motivo"
          noteHint="Obligatorio si lo rechaza. Si solo una foto tiene un problema, recházela a ella y apruebe el resto."
          yes="Aprobar fotos"
          no="Rechazar cambio de fotos"
        >
          <input type="hidden" name="productId" value={item.product_id} />
          <input type="hidden" name="revision" value={item.revision} />
        </DecisionForm>
      </div>
    </article>
  );
}

/** Approved photos whose files did not reach the public bucket. */
export function PhotoPublishRetry({ item }: { item: OpsPhotoReview }) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 text-sm">
      <h3 className="text-lg font-bold">{item.title}</h3>
      <p className="text-ink-muted">
        {item.unpublished === 1
          ? "Una foto aprobada todavía no se ve en la tienda"
          : `${item.unpublished} fotos aprobadas todavía no se ven en la tienda`}
        : no se terminaron de copiar a la tienda.
      </p>
      <ActionForm action={retryPhotoPublishing} submit="Publicar fotos" size="sm">
        <input type="hidden" name="productId" value={item.product_id} />
      </ActionForm>
    </article>
  );
}
