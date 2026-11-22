"use client";

import { PHOTO_RULES } from "@yuntera/core";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { Alert } from "@yuntera/ui";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";
import { finishLogoUpload, removeLogo, startLogoUpload, withdrawLogo } from "@/app/logo-actions";
import { PhotoProblemError, PROBLEM_MESSAGE, preparePhoto, put } from "@/lib/photo-client";

const initial: ActionState = {};

/** A focus ring on a label that holds a hidden file input. */
const FOCUS =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";

/**
 * Choosing a new logo. The picture is checked and resized in the browser (the
 * same three sizes as a product photo, without what the original file
 * carried), uploaded straight to the private bucket, and sent for review.
 */
export function LogoUploader({ hasWaiting }: { hasWaiting: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({});
  const [progress, setProgress] = useState<number | null>(null);
  const hintId = useId();

  const choose = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setState({});
    setProgress(0);
    try {
      const prepared = await preparePhoto(file);
      const started = await startLogoUpload();
      if ("error" in started) {
        setState({ error: started.error });
        return;
      }
      const { target } = started;
      const total = prepared.files.reduce((sum, f) => sum + f.blob.size, 0);
      let done = 0;
      for (const rendition of prepared.files) {
        const upload = target.uploads.find((u) => u.size === rendition.size);
        if (!upload) {
          setState({ error: "No pudimos preparar la subida del logotipo." });
          return;
        }
        await put(upload.url, rendition.blob, target.contentType, (fraction) =>
          setProgress((done + fraction * rendition.blob.size) / total),
        );
        done += rendition.blob.size;
      }
      const finished = await finishLogoUpload({
        logoId: target.logoId,
        width: prepared.width,
        height: prepared.height,
      });
      setState(finished);
      if (finished.ok) router.refresh();
    } catch (error) {
      setState({
        error:
          error instanceof PhotoProblemError
            ? `La imagen ${PROBLEM_MESSAGE[error.problem]}.`
            : error instanceof Error
              ? error.message
              : "No pudimos guardar el logotipo.",
      });
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p id={hintId} className="text-sm text-ink-muted">
        Una imagen JPG, PNG o WebP de al menos {PHOTO_RULES.minEdge} píxeles por lado, idealmente
        cuadrada. La revisamos antes de mostrarla.
        {hasWaiting ? " Si sube otra, reemplaza la que espera revisión." : ""}
      </p>
      <label
        className={`inline-flex min-h-11 w-fit cursor-pointer items-center rounded-md border border-border-strong bg-surface px-4 font-semibold hover:bg-surface-muted ${FOCUS}`}
      >
        {progress === null ? "Elegir una imagen" : `Subiendo… ${Math.round(progress * 100)} %`}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-describedby={hintId}
          disabled={progress !== null}
          data-testid="logo-file"
          onChange={(event) => {
            void choose(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {state.ok ? <Alert tone="success">{state.ok}</Alert> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </div>
  );
}

/** Takes back the logo that waits for review. */
export function WithdrawLogoForm() {
  const [state, action] = useActionState(withdrawLogo, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Retirando…">
          Retirar el logotipo en revisión
        </SubmitButton>
      </div>
    </form>
  );
}

/** Stops showing the current logo. */
export function RemoveLogoForm() {
  const [state, action] = useActionState(removeLogo, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="confirma"
          required
          className="mt-0.5 size-5 accent-(--color-brand)"
        />
        <span>Quiero que la tienda deje de mostrar el logotipo.</span>
      </label>
      <FormMessage state={state} />
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Quitando…">
          Quitar el logotipo
        </SubmitButton>
      </div>
    </form>
  );
}
