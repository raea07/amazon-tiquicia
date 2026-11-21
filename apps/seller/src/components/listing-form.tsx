"use client";

import {
  computeSellerStatement,
  DEFAULT_FEE_SCHEDULE,
  money,
  OversizeItemError,
  type PaymentMethod,
  parseColones,
} from "@yuntera/core";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { Alert, formatPrice, SelectField, TextAreaField, TextField } from "@yuntera/ui";
import { useActionState, useState } from "react";
import { createListing } from "@/app/actions";

const initial: ActionState = {};

export interface CategoryOption {
  slug: string;
  name: string;
  /** Name of the top-level category this one belongs to, for grouping. */
  group: string;
  /** Slug of that top-level category: commission is set per top-level category. */
  top: string;
}

/** Size tiers of the warehouse fee, as a person would call them. */
const TIER_LABEL: Record<string, string> = {
  sobre: "tipo sobre",
  pequeno: "pequeño",
  mediano: "mediano",
  grande: "grande",
};

const METHOD_LABEL: Record<Exclude<PaymentMethod, "bank_transfer">, string> = {
  sinpe_movil: "SINPE Móvil",
  card: "Tarjeta",
  cash_on_delivery: "Efectivo contra entrega",
};

/**
 * New product. The fields that decide what the seller earns (price, category,
 * who ships, weight and size) are tracked so the form can show, before
 * anything is saved, every charge and what is left.
 */
export function ListingForm({ categories }: { categories: CategoryOption[] }) {
  const [state, action] = useActionState(createListing, initial);
  const [form, setForm] = useState({
    price: "",
    categorySlug: "",
    fulfillment: "platform",
    weightGrams: "",
    lengthCm: "",
    widthCm: "",
    heightCm: "",
  });
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [name]: event.target.value }));

  const groups = [...new Set(categories.map((category) => category.group))];

  return (
    <form action={action} className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-4">
          <legend className="font-display text-xl font-bold">1. El producto</legend>
          <TextField
            label="Título"
            name="title"
            defaultValue={state.values?.title}
            maxLength={200}
            hint="Marca, qué es y la característica principal. Ejemplo: “Licuadora Volcán 600 W vaso de vidrio 1,5 L”."
          />
          <SelectField
            label="Categoría"
            name="categorySlug"
            value={form.categorySlug}
            onChange={set("categorySlug")}
          >
            <option value="">Elija…</option>
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
            defaultValue={state.values?.bullets}
            hint="Una por línea, hasta 8. Lo que alguien necesita saber antes de comprar."
          />
          <TextAreaField
            label="Descripción"
            name="description"
            optional
            rows={4}
            defaultValue={state.values?.description}
            hint="Sea exacto: lo que usted describe aquí es lo que el comprador tiene derecho a recibir."
          />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="font-display text-xl font-bold">2. Precio</legend>
          <TextField
            label="Precio de venta (₡)"
            name="price"
            inputMode="decimal"
            value={form.price}
            onChange={set("price")}
            placeholder="12 500"
            hint="El precio final que paga el comprador, con el IVA incluido."
            className="max-w-xs"
          />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="font-display text-xl font-bold">3. Entrega</legend>
          <div className="flex flex-col gap-2">
            {(
              [
                [
                  "platform",
                  "Yuntera almacena y despacha",
                  "Usted envía su inventario a nuestra bodega. Nosotros lo guardamos, empacamos y entregamos al día siguiente.",
                ],
                [
                  "seller",
                  "Usted despacha, Yuntera entrega",
                  "Usted guarda el inventario y empaca cada pedido. Nuestro repartidor pasa a recogerlo y lo entrega.",
                ],
              ] as const
            ).map(([value, title, text]) => (
              <label
                key={value}
                className="flex cursor-pointer gap-3 rounded-lg border border-border bg-surface p-4 has-checked:border-brand has-checked:bg-brand-soft"
              >
                <input
                  type="radio"
                  name="fulfillment"
                  value={value}
                  checked={form.fulfillment === value}
                  onChange={set("fulfillment")}
                  className="mt-1 size-5 accent-(--color-brand)"
                />
                <span className="text-sm">
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-ink-muted">{text}</span>
                </span>
              </label>
            ))}
          </div>
          {form.fulfillment === "seller" ? (
            <TextField
              label="Días hábiles para alistar un pedido"
              name="handlingDays"
              type="number"
              min={0}
              max={10}
              defaultValue={state.values?.handlingDays ?? "1"}
              hint="Cuenta para la fecha de entrega que le prometemos al comprador. Prometa lo que puede cumplir."
              className="max-w-xs"
            />
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="font-display text-xl font-bold">4. Paquete</legend>
          <p className="text-sm text-ink-muted">Ya empacado para envío, no solo el producto.</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <TextField
              label="Peso (g)"
              name="weightGrams"
              type="number"
              min={1}
              max={30000}
              value={form.weightGrams}
              onChange={set("weightGrams")}
            />
            <TextField
              label="Largo (cm)"
              name="lengthCm"
              type="number"
              min={0.1}
              max={200}
              step="0.1"
              value={form.lengthCm}
              onChange={set("lengthCm")}
            />
            <TextField
              label="Ancho (cm)"
              name="widthCm"
              type="number"
              min={0.1}
              max={200}
              step="0.1"
              value={form.widthCm}
              onChange={set("widthCm")}
            />
            <TextField
              label="Alto (cm)"
              name="heightCm"
              type="number"
              min={0.1}
              max={200}
              step="0.1"
              value={form.heightCm}
              onChange={set("heightCm")}
            />
          </div>
        </fieldset>

        <FormMessage state={state} />
        <div className="flex flex-wrap gap-3">
          <SubmitButton size="lg" pendingLabel="Enviando…">
            Enviar a revisión
          </SubmitButton>
          <SubmitButton
            size="lg"
            variant="secondary"
            name="intent"
            value="draft"
            pendingLabel="Guardando…"
          >
            Guardar como borrador
          </SubmitButton>
        </div>
        <p className="text-sm text-ink-muted">
          Revisamos cada producto nuevo antes de publicarlo, normalmente en un día hábil. Las fotos
          se agregan después de crear el producto.
        </p>
      </div>

      <FeePreview
        priceText={form.price}
        topCategory={
          categories.find((category) => category.slug === form.categorySlug)?.top ?? null
        }
        byPlatform={form.fulfillment === "platform"}
        weightGrams={Number(form.weightGrams)}
        longestSideCm={Math.max(Number(form.lengthCm), Number(form.widthCm), Number(form.heightCm))}
      />
    </form>
  );
}

/** What the seller keeps from one sale, itemised. Uses the same code that computes real statements. */
function FeePreview({
  priceText,
  topCategory,
  byPlatform,
  weightGrams,
  longestSideCm,
}: {
  priceText: string;
  topCategory: string | null;
  byPlatform: boolean;
  weightGrams: number;
  longestSideCm: number;
}) {
  const [method, setMethod] = useState<keyof typeof METHOD_LABEL>("sinpe_movil");
  const priceMinor = parseColones(priceText);
  const sized = weightGrams > 0 && longestSideCm > 0;
  const ready = Boolean(priceMinor && topCategory && (!byPlatform || sized));

  let statement: ReturnType<typeof computeSellerStatement> | null = null;
  let oversize = false;
  if (ready && priceMinor && topCategory) {
    try {
      statement = computeSellerStatement({
        lines: [
          {
            lineId: "preview",
            categorySlug: topCategory,
            unitGross: money(priceMinor),
            quantity: 1,
            fulfilledByPlatform: byPlatform,
            weightGrams: sized ? weightGrams : 1,
            longestSideCm: sized ? longestSideCm : 1,
          },
        ],
        paymentMethod: method,
      });
    } catch (error) {
      if (error instanceof OversizeItemError) oversize = true;
      else throw error;
    }
  }
  const line = statement?.lines[0];

  return (
    <aside
      aria-label="Lo que usted recibe"
      className="h-fit rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-32"
    >
      <h2 className="text-lg font-bold">Lo que usted recibe por venta</h2>
      {oversize ? (
        <Alert tone="warning" className="mt-3">
          Este paquete es más grande de lo que nuestra bodega maneja. Elija “Usted despacha”.
        </Alert>
      ) : statement && line ? (
        <>
          <dl className="mt-4 space-y-2 text-sm" aria-live="polite">
            <Row label="Precio de venta" value={formatPrice(statement.itemsGross.amountMinor)} />
            <Row
              label={`Comisión (${(line.referralBps / 100).toLocaleString("es-CR")} %)`}
              value={`− ${formatPrice(statement.referralFee.amountMinor)}`}
            />
            {byPlatform ? (
              <Row
                label={`Bodega y despacho (paquete ${TIER_LABEL[line.fulfillmentTierId ?? ""] ?? ""})`}
                value={`− ${formatPrice(statement.fulfillmentFee.amountMinor)}`}
              />
            ) : null}
            <Row
              label="Costo de cobro"
              value={`− ${formatPrice(statement.paymentFee.amountMinor)}`}
            />
            <Row
              label={`IVA sobre los cargos (${DEFAULT_FEE_SCHEDULE.feeTaxBps / 100} %)`}
              value={`− ${formatPrice(statement.feesTax.amountMinor)}`}
            />
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
              <dt>Usted recibe</dt>
              <dd className="tabular-nums">{formatPrice(statement.payout.amountMinor)}</dd>
            </div>
          </dl>
          <SelectField
            label="Si el comprador paga con"
            value={method}
            onChange={(event) => setMethod(event.target.value as keyof typeof METHOD_LABEL)}
            className="mt-4"
          >
            {Object.entries(METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">
          Escriba el precio, la categoría{byPlatform ? ", el peso y las medidas" : ""} para ver cada
          cargo y lo que le queda.
        </p>
      )}
      <p className="mt-4 text-xs text-ink-muted">
        Estimación para una unidad, con la tarifa vigente. El costo de cobro es lo que cobra el
        medio de pago y se traslada sin recargo. El IVA del producto ya está dentro de su precio y
        usted lo declara.
      </p>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}
