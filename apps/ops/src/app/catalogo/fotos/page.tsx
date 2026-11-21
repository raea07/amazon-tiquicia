import { ApiError, type OpsProductPhotos } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { messageOf, photoPreviews, sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, Badge, buttonClass, Skeleton, TextAreaField } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { takeDownPhoto } from "@/app/photo-actions";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Retirar fotos" };

export default function TakeDownPhotosPage({ searchParams }: PageProps<"/catalogo/fotos">) {
  return (
    <div className="shell py-8">
      <p className="text-sm">
        <Link href="/catalogo" className="inline-flex min-h-11 items-center text-link underline">
          ← Productos por revisar
        </Link>
      </p>
      <PageHeader title="Retirar fotos de un producto">
        Para una foto que no debe mostrarse aunque ya esté aprobada: de otra persona o marca,
        ofensiva o con datos personales. Se quita de la tienda y de los pedidos en el acto y sus
        archivos se borran. El vendedor ve el motivo que usted escriba.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <TakeDown searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The short name of a product from what staff paste: its address in the shop, or the name itself. */
function slugOf(text: string): string {
  const trimmed = text.trim();
  const fromAddress = /\/p\/([a-z0-9-]+)/i.exec(trimmed)?.[1];
  return (fromAddress ?? trimmed).toLowerCase().slice(0, 200);
}

async function TakeDown({ searchParams }: Pick<PageProps<"/catalogo/fotos">, "searchParams">) {
  await requireStaff("/catalogo/fotos", ["catalog"]);
  const text = (one((await searchParams).producto) ?? "").trim().slice(0, 300);
  let listing: OpsProductPhotos | null = null;
  let problem: string | null = null;
  if (text) {
    try {
      listing = await (await sessionApi()).opsProductPhotos(slugOf(text));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      problem = messageOf(error);
    }
  }
  const previews = listing ? await photoPreviews(listing.photos, { size: 800 }) : new Map();

  return (
    <div className="flex flex-col gap-6">
      <form action="/catalogo/fotos" className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="producto" className="text-sm font-semibold">
            Dirección del producto en la tienda
          </label>
          <input
            id="producto"
            name="producto"
            type="search"
            defaultValue={text}
            placeholder="https://…/p/licuadora-de-vaso-de-vidrio"
            className="min-h-11 w-96 max-w-full rounded-md border border-border-strong bg-surface px-3"
          />
        </div>
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Buscar el producto
        </button>
      </form>

      {problem ? <Alert tone="danger">{problem}</Alert> : null}

      {listing ? (
        <section aria-labelledby="producto-fotos" className="flex flex-col gap-4">
          <div>
            <h2 id="producto-fotos" className="text-xl font-bold">
              {listing.title}
            </h2>
            <p className="text-sm text-ink-muted">{listing.seller_name}</p>
          </div>
          {listing.photos.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-5 text-sm text-ink-muted">
              Este producto no tiene fotos aprobadas ni en revisión.
            </p>
          ) : (
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listing.photos.map((photo) => {
                const preview = previews.get(photo.photo_id);
                return (
                  <li
                    key={photo.photo_id}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 text-sm"
                    data-takedown-photo={photo.photo_id}
                  >
                    {preview ? (
                      // biome-ignore lint/performance/noImgElement: the photo's own stored copy
                      <img
                        src={preview}
                        alt={photo.live_alt ?? photo.alt ?? ""}
                        width={240}
                        height={240}
                        className="aspect-square w-full rounded border border-border bg-arena-100 object-contain"
                      />
                    ) : (
                      <div className="aspect-square w-full rounded border border-border bg-arena-100" />
                    )}
                    <p>
                      {photo.published ? (
                        <Badge tone="success">En la tienda</Badge>
                      ) : photo.state === "approved" ? (
                        <Badge tone="info">Aprobada, aún no publicada</Badge>
                      ) : (
                        <Badge tone="warning">En revisión</Badge>
                      )}
                    </p>
                    <p className="text-ink-muted">
                      <span className="sr-only">Texto alternativo: </span>
                      {photo.live_alt ?? photo.alt}
                    </p>
                    <ActionForm
                      action={takeDownPhoto}
                      submit="Retirar esta foto"
                      variant="secondary"
                      size="sm"
                    >
                      <input type="hidden" name="photoId" value={photo.photo_id} />
                      <TextAreaField
                        label="Motivo"
                        name="note"
                        rows={2}
                        hint="El vendedor lo lee tal cual: diga por qué no puede mostrarse."
                      />
                    </ActionForm>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}
