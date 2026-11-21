"use client";

import type { ListingContent } from "@yuntera/db";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { SelectField, TextAreaField, TextField } from "@yuntera/ui";
import { useActionState } from "react";
import { archiveListing, updateListing, withdrawListingEdit } from "@/app/listing-actions";
import type { CategoryOption } from "@/components/listing-form";

const initial: ActionState = {};

/**
 * Edits what a listing says and the package it ships in. Price and stock are
 * changed from the list of products and the inventory, with no review.
 *
 * `published` decides what sending means: a published listing stays as it is
 * and the change goes to review; anything else is changed in place and can be
 * saved without sending.
 */
export function ListingEditForm({
  productId,
  content,
  categories,
  published,
}: {
  productId: string;
  /** What the fields start with: the listing, or the seller's last proposal. */
  content: ListingContent;
  categories: CategoryOption[];
  published: boolean;
}) {
  const [state, action] = useActionState(updateListing, initial);
  const groups = [...new Set(categories.map((category) => category.group))];
  const typed = state.values;

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="skuId" value={content.sku_id} />

      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-xl font-bold">El producto</legend>
        <TextField
          label="Título"
          name="title"
          defaultValue={typed?.title ?? content.title}
          maxLength={200}
          hint="Marca, qué es y la característica principal."
        />
        {/* React resets the form after each submission, and a select goes back to
            the option it was first drawn with: a new defaultValue does not move it.
            Keying it on the value sent draws it afresh, so a form that comes back
            with an error keeps the category the seller chose. */}
        <SelectField
          key={typed?.categorySlug ?? content.category_slug}
          label="Categoría"
          name="categorySlug"
          defaultValue={typed?.categorySlug ?? content.category_slug}
          hint="La comisión depende de la categoría. Si la cambia, la nueva comisión aplica a las ventas siguientes."
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {categories
                .filter((category) => category.group === group)
                .map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </SelectField>
        <TextAreaField
          label="Características"
          name="bullets"
          optional
          rows={4}
          defaultValue={typed?.bullets ?? content.bullet_points.join("\n")}
          hint="Una por línea, hasta 8. Lo que alguien necesita saber antes de comprar."
        />
        <TextAreaField
          label="Descripción"
          name="description"
          optional
          rows={5}
          defaultValue={typed?.description ?? content.description ?? ""}
          hint="Sea exacto: lo que usted describe aquí es lo que el comprador tiene derecho a recibir."
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-xl font-bold">Paquete</legend>
        <p className="text-sm text-ink-muted">
          Ya empacado para envío, no solo el producto. El tamaño decide la tarifa de bodega.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <TextField
            label="Peso (g)"
            name="weightGrams"
            type="number"
            min={1}
            max={30000}
            defaultValue={typed?.weightGrams ?? content.weight_grams}
          />
          <TextField
            label="Largo (cm)"
            name="lengthCm"
            type="number"
            min={0.1}
            max={200}
            step="0.1"
            defaultValue={typed?.lengthCm ?? content.length_cm}
          />
          <TextField
            label="Ancho (cm)"
            name="widthCm"
            type="number"
            min={0.1}
            max={200}
            step="0.1"
            defaultValue={typed?.widthCm ?? content.width_cm}
          />
          <TextField
            label="Alto (cm)"
            name="heightCm"
            type="number"
            min={0.1}
            max={200}
            step="0.1"
            defaultValue={typed?.heightCm ?? content.height_cm}
          />
        </div>
      </fieldset>

      <FormMessage state={state} />
      <div className="flex flex-wrap gap-3">
        {published ? (
          <SubmitButton size="lg" pendingLabel="Enviando…">
            Enviar cambios a revisión
          </SubmitButton>
        ) : (
          <>
            <SubmitButton size="lg" pendingLabel="Enviando…">
              Guardar y enviar a revisión
            </SubmitButton>
            <SubmitButton
              size="lg"
              variant="secondary"
              name="intent"
              value="draft"
              pendingLabel="Guardando…"
            >
              Guardar sin enviar
            </SubmitButton>
          </>
        )}
      </div>
      <p className="text-sm text-ink-muted">
        {published
          ? "Revisamos los cambios normalmente en un día hábil. Mientras tanto su publicación sigue a la venta exactamente como está."
          : "Mientras no esté publicado puede cambiarlo las veces que quiera."}
      </p>
    </form>
  );
}

/** Takes back a change that is still waiting for review. */
export function WithdrawEditForm({ productId }: { productId: string }) {
  const [state, action] = useActionState(withdrawListingEdit, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="productId" value={productId} />
      <FormMessage state={state} />
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Retirando…">
          Retirar el cambio
        </SubmitButton>
      </div>
    </form>
  );
}

/** Takes the product out of the shop. The tick box makes it a deliberate act. */
export function ArchiveListingForm({ productId }: { productId: string }) {
  const [state, action] = useActionState(archiveListing, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="productId" value={productId} />
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="confirma"
          required
          className="mt-0.5 size-5 accent-(--color-brand)"
        />
        <span>Entiendo que el producto deja de aparecer en la tienda y de venderse.</span>
      </label>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="danger" pendingLabel="Archivando…">
          Archivar producto
        </SubmitButton>
      </div>
    </form>
  );
}
