"use client";

import { PHOTO_RULES, statusWordMap } from "@yuntera/core";
import type { ProductPhoto } from "@yuntera/db";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { Alert, Badge, Button, buttonClass, TextField, type Tone } from "@yuntera/ui";
import { useActionState, useId, useRef, useState } from "react";
import { removePhoto, savePhotos, withdrawPhotoChanges } from "@/app/photo-actions";
import {
  PhotoProblemError,
  PROBLEM_MESSAGE,
  type PreparedPhoto,
  preparePhoto,
  uploadPhoto,
} from "@/lib/photo-client";

/** A focus ring on a label that holds a hidden file input. */
const FOCUS =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";

const ALT_HINT =
  "Describa lo que se ve, como se lo contaría a alguien que no puede ver la foto. Ejemplo: «Licuadora con vaso de vidrio, vista de frente». No hace falta escribir «foto de».";

export interface QueuedPhoto extends PreparedPhoto {
  /** Which chosen file it came from, to notice the same file chosen twice. */
  source: string;
  alt: string;
  progress: number | null;
  error: string | null;
}

// Name and size: a phone names every camera picture alike, but no two weigh the same.
const sourceOf = (file: File) => `${file.name}:${file.size}`;

/**
 * Choosing photos: from the files on the device or, on a phone, the camera.
 * Each chosen photo is checked and resized at once, so a problem is reported
 * before anything is sent. The chosen photos wait here, each with its text.
 */
export function PhotoQueue({
  items,
  onChange,
  room,
  busy,
}: {
  items: QueuedPhoto[];
  onChange: (update: (items: QueuedPhoto[]) => QueuedPhoto[]) => void;
  /** How many more photos the listing can take. */
  room: number;
  busy: boolean;
}) {
  const files = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const free = room - items.length;
  const hintId = useId();

  const choose = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setPreparing(true);
    const found: string[] = [];
    const ready: QueuedPhoto[] = [];
    // The same file chosen again (same name and size) is not added twice.
    const seen = new Set(items.map((item) => item.source));
    for (const file of Array.from(list)) {
      const source = sourceOf(file);
      if (seen.has(source)) {
        found.push(`«${file.name}» ya está en la lista, así que no la agregamos otra vez.`);
        continue;
      }
      if (ready.length >= free) {
        found.push(`«${file.name}» no se agregó: ${PROBLEM_MESSAGE.too_many}.`);
        continue;
      }
      seen.add(source);
      try {
        const photo = await preparePhoto(file);
        ready.push({ ...photo, source, alt: "", progress: null, error: null });
      } catch (error) {
        const problem = error instanceof PhotoProblemError ? error.problem : "unreadable";
        found.push(`«${file.name}» ${PROBLEM_MESSAGE[problem]}.`);
      }
    }
    setProblems(found);
    onChange((current) => [...current, ...ready]);
    setPreparing(false);
    for (const input of [files.current, camera.current]) if (input) input.value = "";
  };

  const update = (key: string, patch: Partial<QueuedPhoto>) =>
    onChange((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={buttonClass({
            variant: "secondary",
            // The input inside is what has the focus; show it on the button.
            className: `${FOCUS}${
              free <= 0 || busy || preparing ? " pointer-events-none opacity-55" : " cursor-pointer"
            }`,
          })}
        >
          Elegir fotos
          <input
            ref={files}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            disabled={free <= 0 || busy || preparing}
            aria-describedby={hintId}
            onChange={(event) => void choose(event.target.files)}
          />
        </label>
        {/* Phones and tablets also offer the camera directly. */}
        <label
          className={buttonClass({
            variant: "secondary",
            className: `hidden pointer-coarse:inline-flex${FOCUS}${
              free <= 0 || busy || preparing ? " pointer-events-none opacity-55" : " cursor-pointer"
            }`,
          })}
        >
          Tomar una foto
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={free <= 0 || busy || preparing}
            onChange={(event) => void choose(event.target.files)}
          />
        </label>
        {preparing ? (
          <span role="status" className="text-sm text-ink-muted">
            Preparando las fotos…
          </span>
        ) : null}
      </div>
      <p id={hintId} className="text-sm text-ink-muted">
        JPG, PNG o WebP, de al menos {PHOTO_RULES.minEdge} píxeles por lado. Hasta{" "}
        {PHOTO_RULES.maxPhotos} fotos por producto
        {room < PHOTO_RULES.maxPhotos ? `; le quedan ${Math.max(0, room)}` : ""}. Antes de subirlas,
        su navegador las achica y les quita los datos ocultos, como el lugar donde se tomaron.
        Muestre solo el producto que vende, sin logotipos de otras marcas.
      </p>

      {problems.length > 0 ? (
        <Alert tone="danger" title="Algunas fotos no se pudieron agregar">
          <ul className="list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {items.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((item, index) => (
            <li
              key={item.key}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
              data-queued-photo
            >
              <div className="flex gap-3">
                {/* biome-ignore lint/performance/noImgElement: a local preview of a file not yet uploaded */}
                <img
                  src={item.preview}
                  alt=""
                  width={96}
                  height={96}
                  className="size-24 shrink-0 rounded-md border border-border bg-arena-100 object-contain"
                />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-semibold">{item.name}</p>
                  <p className="text-ink-muted">
                    {item.width} × {item.height} píxeles, lista para subir
                  </p>
                  {item.progress !== null ? (
                    <label className="mt-2 block">
                      <span className="sr-only">Avance de la subida de {item.name}</span>
                      <progress
                        max={1}
                        value={item.progress}
                        className="h-2 w-full accent-(--color-brand)"
                      />
                    </label>
                  ) : null}
                </div>
              </div>
              <TextField
                label={`Texto alternativo de la foto nueva ${index + 1}`}
                value={item.alt}
                maxLength={PHOTO_RULES.altMax}
                disabled={busy}
                hint={ALT_HINT}
                error={item.error}
                // Checked when the photos are sent, with a message that says what to write;
                // the browser's own "required" would stop the listing form without saying why.
                required={false}
                aria-required="true"
                onChange={(event) => update(item.key, { alt: event.target.value, error: null })}
              />
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    URL.revokeObjectURL(item.preview);
                    onChange((current) => current.filter((other) => other.key !== item.key));
                  }}
                >
                  No subir esta foto
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Marks queued photos without acceptable text. True when every one has it. */
export function checkQueuedText(
  onChange: (update: (items: QueuedPhoto[]) => QueuedPhoto[]) => void,
  items: QueuedPhoto[],
): boolean {
  const short = (alt: string) => alt.replace(/\s+/g, " ").trim().length < PHOTO_RULES.altMin;
  if (!items.some((item) => short(item.alt))) return true;
  onChange((current) =>
    current.map((item) =>
      short(item.alt)
        ? {
            ...item,
            error: `Describa la foto con al menos ${PHOTO_RULES.altMin} caracteres.`,
          }
        : item,
    ),
  );
  return false;
}

/** Uploads every queued photo in turn. Answers how many failed, and why. */
export async function uploadQueue(
  productId: string,
  items: QueuedPhoto[],
  onChange: (update: (items: QueuedPhoto[]) => QueuedPhoto[]) => void,
): Promise<string[]> {
  const failures: string[] = [];
  for (const item of items) {
    const set = (patch: Partial<QueuedPhoto>) =>
      onChange((current) =>
        current.map((other) => (other.key === item.key ? { ...other, ...patch } : other)),
      );
    set({ progress: 0, error: null });
    const result = await uploadPhoto(productId, item, item.alt, (progress) => set({ progress }));
    if (result.error) {
      failures.push(`«${item.name}»: ${result.error}`);
      set({ progress: null });
    } else {
      URL.revokeObjectURL(item.preview);
      onChange((current) => current.filter((other) => other.key !== item.key));
    }
  }
  return failures;
}

export interface ManagedPhoto extends ProductPhoto {
  /** Where the browser can show it: a short-lived link, or its public address. */
  preview: string | null;
}

// The photo's own states read packages/core's words; the other three are
// sentences about the listing around the photo.
const PHOTO = statusWordMap("product_photos", "seller");
const STATE = {
  pending: { label: PHOTO.pending, tone: "warning" },
  draft: { label: "Se revisa con el producto", tone: "info" },
  approved: { label: PHOTO.approved, tone: "success" },
  publishing: { label: "Aprobada; se está publicando", tone: "info" },
  leaving: { label: "Se quitará al aprobarse el cambio", tone: "warning" },
  rejected: { label: PHOTO.rejected, tone: "danger" },
} satisfies Record<string, { label: string; tone: Tone }>;

function stateOf(photo: ProductPhoto, listingStatus: string) {
  if (photo.state === "rejected") return STATE.rejected;
  if (photo.remove_requested) return STATE.leaving;
  if (photo.state === "approved") return photo.published ? STATE.approved : STATE.publishing;
  return listingStatus === "draft" || listingStatus === "rejected" ? STATE.draft : STATE.pending;
}

/**
 * A listing's photos: the order and text the seller wants, what each one's
 * state is, new photos, and what is waiting for review.
 */
export function PhotoManager({
  productId,
  status,
  photos,
  leaving,
  rejected,
  changeWaiting,
}: {
  productId: string;
  status: string;
  photos: ManagedPhoto[];
  leaving: ManagedPhoto[];
  rejected: ManagedPhoto[];
  changeWaiting: boolean;
}) {
  const fromServer = () =>
    photos.map((photo) => ({ photoId: photo.photo_id, alt: photo.alt ?? "" }));
  const [order, setOrder] = useState(fromServer);
  // When the page brings a new list (a photo was added, removed or decided),
  // take it, but keep the text the seller typed and has not saved yet for the
  // photos that are still there.
  const source = photos.map((photo) => `${photo.photo_id}:${photo.alt ?? ""}`).join("|");
  const [seen, setSeen] = useState({ source, photos });
  if (seen.source !== source) {
    const savedBefore = new Map(seen.photos.map((photo) => [photo.photo_id, photo.alt ?? ""]));
    const typed = new Map(
      order
        .filter(
          (item) => savedBefore.has(item.photoId) && item.alt !== savedBefore.get(item.photoId),
        )
        .map((item) => [item.photoId, item.alt]),
    );
    setSeen({ source, photos });
    setOrder(
      photos.map((photo) => ({
        photoId: photo.photo_id,
        alt: typed.get(photo.photo_id) ?? photo.alt ?? "",
      })),
    );
  }
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionState>({});
  const byId = new Map(photos.map((photo) => [photo.photo_id, photo]));
  const dirty =
    order.length !== photos.length ||
    order.some(
      (item, index) =>
        item.photoId !== photos[index]?.photo_id || item.alt !== (photos[index]?.alt ?? ""),
    );
  const room = PHOTO_RULES.maxPhotos - photos.length;
  const published = status === "active";

  const run = async (work: () => Promise<ActionState>) => {
    setBusy(true);
    setMessage({});
    try {
      setMessage(await work());
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, by: number) =>
    setOrder((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + by, 0, item);
      return next;
    });

  const upload = () =>
    run(async () => {
      if (!checkQueuedText(setQueue, queue)) {
        return { error: "Escriba el texto alternativo de cada foto nueva antes de subirla." };
      }
      const failures = await uploadQueue(productId, queue, setQueue);
      if (failures.length > 0) {
        return { error: `No se subieron todas las fotos. ${failures.join(" ")}` };
      }
      return {
        ok: published
          ? "Fotos subidas. Las revisamos antes de mostrarlas; mientras tanto la tienda muestra las fotos aprobadas."
          : "Fotos subidas. Se revisan junto con el producto.",
      };
    });

  return (
    <section
      aria-labelledby="fotos"
      className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5"
    >
      <div>
        <h2 id="fotos" className="text-lg font-bold">
          Fotos
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {published
            ? "Agregar, quitar o reordenar fotos de un producto publicado pasa por revisión. Mientras tanto la tienda sigue mostrando las fotos aprobadas."
            : status === "pending_review"
              ? "Las fotos se revisan junto con el producto. Si las cambia ahora, el producto vuelve a borrador y tendrá que enviarlo a revisión otra vez."
              : "Las fotos se revisan junto con el producto. La primera es la que se ve en las listas y búsquedas."}
        </p>
      </div>

      {changeWaiting ? (
        <Alert tone="warning" title="Sus cambios de fotos están en revisión">
          <span className="block">
            Los compradores siguen viendo las fotos aprobadas hasta que revisemos el cambio.
          </span>
          <div className="mt-3">
            <WithdrawPhotosForm productId={productId} />
          </div>
        </Alert>
      ) : null}

      {photos.length === 0 && queue.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-strong p-4 text-sm text-ink-muted">
          Este producto todavía no tiene fotos. En la tienda se ve un recuadro vacío en su lugar.
        </p>
      ) : null}

      {order.length > 0 ? (
        <ol className="flex flex-col gap-3" aria-label="Fotos del producto, en orden">
          {order.map((item, index) => {
            const photo = byId.get(item.photoId);
            if (!photo) return null;
            const state = stateOf(photo, status);
            return (
              <li
                key={item.photoId}
                className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row"
                data-photo={photo.photo_id}
              >
                <div className="flex shrink-0 gap-3 sm:flex-col">
                  {photo.preview ? (
                    // biome-ignore lint/performance/noImgElement: a 400 px copy made before upload
                    <img
                      src={photo.preview}
                      alt=""
                      width={112}
                      height={112}
                      className="size-28 rounded-md border border-border bg-arena-100 object-contain"
                    />
                  ) : (
                    <div className="size-28 rounded-md border border-border bg-arena-100" />
                  )}
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="font-semibold">Foto {index + 1}</span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <TextField
                    label={`Texto alternativo de la foto ${index + 1}`}
                    value={item.alt}
                    maxLength={PHOTO_RULES.altMax}
                    disabled={busy}
                    hint={index === 0 ? ALT_HINT : undefined}
                    onChange={(event) =>
                      setOrder((current) =>
                        current.map((other) =>
                          other.photoId === item.photoId
                            ? { ...other, alt: event.target.value }
                            : other,
                        ),
                      )
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy || index === 0}
                      aria-label={`Antes: mover la foto ${index + 1} un lugar antes`}
                      onClick={() => move(index, -1)}
                    >
                      ↑ Antes
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy || index === order.length - 1}
                      aria-label={`Después: mover la foto ${index + 1} un lugar después`}
                      onClick={() => move(index, 1)}
                    >
                      ↓ Después
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => removePhoto(productId, photo.photo_id))}
                    >
                      Quitar la foto {index + 1}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {dirty ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy}
            onClick={() => run(() => savePhotos({ productId, items: order }))}
          >
            Guardar orden y textos
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setOrder(fromServer())}>
            Deshacer
          </Button>
        </div>
      ) : null}

      {leaving.length > 0 ? (
        <div className="text-sm">
          <h3 className="font-semibold">Se quitarán cuando aprobemos el cambio</h3>
          <ul className="mt-2 flex flex-wrap gap-3">
            {leaving.map((photo) => (
              <li key={photo.photo_id} className="flex items-center gap-2" data-leaving-photo>
                {photo.preview ? (
                  // biome-ignore lint/performance/noImgElement: a 400 px copy made before upload
                  <img
                    src={photo.preview}
                    alt=""
                    width={56}
                    height={56}
                    className="size-14 rounded-md border border-border object-contain"
                  />
                ) : null}
                <span>{photo.live_alt}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rejected.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Fotos que no aprobamos</h3>
          <ul className="flex flex-col gap-3">
            {rejected.map((photo) => (
              <li key={photo.photo_id} data-rejected-photo>
                <Alert tone="danger" title={`Rechazada: «${photo.alt ?? "foto sin texto"}»`}>
                  <span className="block">Motivo: {photo.rejection_reason}</span>
                  <span className="mt-1 block">
                    Suba otra foto que corrija esto. Esta ya no se muestra en ningún lado.
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    disabled={busy}
                    onClick={() => run(() => removePhoto(productId, photo.photo_id))}
                  >
                    Quitar de la lista
                  </Button>
                </Alert>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="font-semibold">Agregar fotos</h3>
        <PhotoQueue items={queue} onChange={setQueue} room={room} busy={busy} />
        {queue.length > 0 ? (
          <div>
            <Button disabled={busy} aria-busy={busy} onClick={upload}>
              {busy
                ? "Subiendo…"
                : queue.length === 1
                  ? "Subir la foto"
                  : `Subir ${queue.length} fotos`}
            </Button>
          </div>
        ) : null}
      </div>

      <div aria-live="polite">
        <FormMessage state={message} />
      </div>
    </section>
  );
}

function WithdrawPhotosForm({ productId }: { productId: string }) {
  const [state, action] = useActionState(withdrawPhotoChanges, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="productId" value={productId} />
      <FormMessage state={state} />
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Retirando…">
          Retirar mis cambios de fotos
        </SubmitButton>
      </div>
    </form>
  );
}
