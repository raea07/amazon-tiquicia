"use client";

import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { SelectField, TextAreaField, TextField } from "@yuntera/ui";
import { useActionState } from "react";
import { reportContent } from "@/app/report-actions";

const initial: ActionState = {};

const REASONS = [
  ["illegal_product", "Es ilegal venderlo"],
  ["counterfeit", "Es falsificado"],
  ["unsafe", "Es peligroso"],
  ["misleading", "La información es engañosa"],
  ["intellectual_property", "Usa una marca, fotos o textos ajenos"],
  ["abuse", "Tiene contenido ofensivo"],
  ["other", "Otro problema"],
] as const;

export function ReportForm({
  targetType,
  targetId,
  signedIn,
}: {
  targetType: "product" | "review" | "seller";
  targetId: string;
  signedIn: boolean;
}) {
  const [state, action] = useActionState(reportContent, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    // Keyed by what was sent, so the fields come back with it after a refusal.
    <form key={JSON.stringify(state.values ?? {})} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />
      <SelectField
        label="¿Qué problema tiene?"
        name="reason"
        defaultValue={state.values?.reason ?? ""}
      >
        <option value="" disabled>
          Elija una opción
        </option>
        {REASONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        label="Detalles"
        name="details"
        rows={4}
        maxLength={2000}
        optional
        defaultValue={state.values?.details}
        hint="Lo que nos ayude a revisarlo: qué vio y dónde. Hasta 2000 caracteres."
      />
      <TextField
        label="Su correo"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        maxLength={254}
        optional={signedIn}
        defaultValue={state.values?.email}
        hint="Solo para escribirle sobre este reporte si necesitamos más datos. No le enviamos mensajes automáticos."
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Enviando…">Enviar el reporte</SubmitButton>
      </div>
    </form>
  );
}
