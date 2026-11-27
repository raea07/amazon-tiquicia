"use client";

import { COMPLAINT_CATEGORIES, COMPLAINT_DESCRIPTION_MAX } from "@yuntera/core";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { SelectField, TextAreaField, TextField } from "@yuntera/ui";
import Link from "next/link";
import { useActionState } from "react";
import { fileComplaint } from "@/app/complaint-actions";

const initial: ActionState = {};

/** The free complaint form; `orderNumber` comes from the order page's link. */
export function ComplaintForm({ orderNumber }: { orderNumber: string | null }) {
  const [state, action] = useActionState(fileComplaint, initial);
  if (state.ok) {
    return (
      <div className="flex flex-col gap-4" data-testid="complaint-filed">
        <FormMessage state={state} />
        <p className="text-sm">
          <Link href="/cuenta/casos" className="font-semibold text-link underline">
            Ver sus consultas
          </Link>
        </p>
      </div>
    );
  }
  return (
    // Keyed by what was sent, so the fields come back with it after a refusal.
    <form key={JSON.stringify(state.values ?? {})} action={action} className="flex flex-col gap-4">
      <SelectField
        label="¿De qué trata su reclamo?"
        name="category"
        defaultValue={state.values?.category ?? ""}
      >
        <option value="" disabled>
          Elija una opción
        </option>
        {COMPLAINT_CATEGORIES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Número de pedido"
        name="orderNumber"
        optional
        autoCapitalize="characters"
        maxLength={20}
        defaultValue={state.values?.orderNumber ?? orderNumber ?? ""}
        hint="Si el reclamo es sobre un pedido, por ejemplo YT-100123. Lo ve en «Sus pedidos»."
      />
      <TextAreaField
        label="Qué pasó"
        name="description"
        rows={6}
        maxLength={COMPLAINT_DESCRIPTION_MAX}
        defaultValue={state.values?.description}
        hint="Cuéntenos qué pasó y qué espera de nosotros. De 10 a 4000 caracteres. No escriba su código de entrega ni datos de tarjetas."
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Enviando…">Enviar el reclamo</SubmitButton>
      </div>
    </form>
  );
}
