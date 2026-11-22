"use client";

import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { SelectField, TextAreaField, TextField } from "@yuntera/ui";
import { useActionState } from "react";
import {
  addOffer,
  requestShopDescription,
  resumePausedOffer,
  setVariantActive,
  unpublishListing,
  withdrawOffer,
} from "@/app/seller-listing-actions";

const initial: ActionState = {};

const plainColones = (amountMinor: number) =>
  new Intl.NumberFormat("es-CR", { maximumFractionDigits: 2 }).format(amountMinor / 100);

/**
 * The shop's own offer on a variant of a product another shop created: its
 * price and how it ships. Nothing about the product itself: that is the
 * creating shop's, already reviewed.
 */
export function AddOfferForm({
  skuId,
  label,
  fitsWarehouse,
}: {
  skuId: string;
  /** Read by screen readers so each variant's form is told apart. */
  label: string;
  fitsWarehouse: boolean;
}) {
  const [state, action] = useActionState(addOffer, initial);
  const typed = state.values;
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3" aria-label={`Su oferta: ${label}`}>
      <input type="hidden" name="skuId" value={skuId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Su precio (₡, IVA incluido)"
          name="price"
          inputMode="decimal"
          defaultValue={typed?.price ?? ""}
        />
        <TextField
          label="Precio regular"
          name="listPrice"
          optional
          inputMode="decimal"
          defaultValue={typed?.listPrice ?? ""}
          hint="Solo si hay una rebaja real."
        />
        {/* Keyed on what was sent, so a form that comes back with an error keeps the choice. */}
        <SelectField
          key={typed?.fulfillment ?? "none"}
          label="Quién lo guarda y lo despacha"
          name="fulfillment"
          defaultValue={typed?.fulfillment ?? (fitsWarehouse ? "" : "seller")}
        >
          <option value="" disabled>
            Elija una opción
          </option>
          <option value="seller">Yo lo tengo y lo alisto; Yuntera lo recoge y lo entrega</option>
          {fitsWarehouse ? <option value="platform">Lo envío a la bodega de Yuntera</option> : null}
        </SelectField>
        <TextField
          label="Días hábiles para alistarlo"
          name="handlingDays"
          type="number"
          min={0}
          max={10}
          defaultValue={typed?.handlingDays ?? "1"}
          hint="Solo si usted lo despacha."
        />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Agregando…">Agregar mi oferta</SubmitButton>
      </div>
    </form>
  );
}

/** Switches one variant off, or on again. */
export function VariantToggleForm({
  productId,
  skuId,
  name,
  active,
  ownOfferPaused,
}: {
  productId: string;
  skuId: string;
  name: string;
  active: boolean;
  ownOfferPaused: boolean;
}) {
  const [state, action] = useActionState(setVariantActive, initial);
  // Switched off, or its own offer paused (shared or not, e.g. after the shop
  // that shared it stopped selling): the button brings it back.
  const bringBack = !active || ownOfferPaused;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="skuId" value={skuId} />
      <input type="hidden" name="set" value={bringBack ? "on" : "off"} />
      <div>
        <SubmitButton
          size="sm"
          variant="secondary"
          pendingLabel={bringBack ? "Volviendo a ofrecer…" : "Retirando…"}
        >
          {bringBack ? "Volver a ofrecer" : "Retirar"}
          <span className="sr-only"> la variante {name}</span>
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** Takes a published listing back to draft. The tick box makes it a deliberate act. */
export function UnpublishListingForm({ productId }: { productId: string }) {
  const [state, action] = useActionState(unpublishListing, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="productId" value={productId} />
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="confirma"
          required
          className="mt-0.5 size-5 accent-(--color-brand)"
        />
        <span>
          Entiendo que deja de aparecer en la tienda y de venderse hasta que lo aprueben de nuevo.
        </span>
      </label>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Volviendo a borrador…">
          Volver a borrador
        </SubmitButton>
      </div>
    </form>
  );
}

/** A new price and the offer back on sale, for an offer paused below the price floor. */
export function ResumeOfferForm({
  offerId,
  label,
  suggestedMinor,
  listPriceMinor,
}: {
  offerId: string;
  label: string;
  /** The lowest price that covers the fees, to start from. */
  suggestedMinor: number | null;
  listPriceMinor: number | null;
}) {
  const [state, action] = useActionState(resumePausedOffer, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3" aria-label={`Nuevo precio: ${label}`}>
      <input type="hidden" name="offerId" value={offerId} />
      {listPriceMinor ? <input type="hidden" name="listPriceMinor" value={listPriceMinor} /> : null}
      <div className="max-w-xs">
        <TextField
          label="Precio nuevo (₡, IVA incluido)"
          name="price"
          inputMode="decimal"
          defaultValue={state.values?.price ?? (suggestedMinor ? plainColones(suggestedMinor) : "")}
        />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton size="sm" pendingLabel="Guardando…">
          Guardar el precio y poner a la venta
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Asks staff to change the shop's public description, or to remove it: the
 * field may be left empty, and "Quitar la descripción" sends an empty one.
 */
export function ShopDescriptionForm({ current, max }: { current: string | null; max: number }) {
  const [state, action] = useActionState(requestShopDescription, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <TextAreaField
        label="Descripción de la tienda"
        name="description"
        rows={6}
        optional
        maxLength={max * 2}
        defaultValue={state.values?.description ?? current ?? ""}
        hint={`Hasta ${max} caracteres. Qué vende, de dónde y lo que lo distingue. Se muestra como texto, tal cual lo escribe. Déjela vacía para quitarla.`}
      />
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton pendingLabel="Enviando…">Enviar a revisión</SubmitButton>
        {current ? (
          <SubmitButton variant="secondary" name="quitar" value="1" pendingLabel="Enviando…">
            Quitar la descripción
          </SubmitButton>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The shop stops selling a product another shop created, for good: its offer
 * leaves the product page and its list. It can offer it again later from
 * "Vender uno que ya existe". The tick box makes it deliberate.
 */
export function WithdrawOfferForm({
  offerId,
  priceMinor,
  label,
}: {
  offerId: string;
  priceMinor: number;
  /** Read by screen readers so each row's form is told apart. */
  label: string;
}) {
  const [state, action] = useActionState(withdrawOffer, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-2" aria-label={`Dejar de vender: ${label}`}>
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="priceMinor" value={priceMinor} />
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="confirma"
          required
          className="mt-0.5 size-5 accent-(--color-brand)"
        />
        <span>Entiendo que mi oferta sale de la página del producto.</span>
      </label>
      <FormMessage state={state} />
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Retirando…">
          Dejar de vender este producto
        </SubmitButton>
      </div>
    </form>
  );
}
