"use client";

import { CR_IBAN_LENGTH, checkCrIban, normalizeIban, parsePhone } from "@yuntera/core";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { TextField } from "@yuntera/ui";
import { useActionState, useState } from "react";
import { requestPayoutDetails } from "@/app/payout-actions";

const initial: ActionState = {};

/**
 * What to say about the account number while it is being typed. A number that
 * is simply not finished yet gets a neutral count; a number that can no longer
 * become valid gets the reason, so it is fixed before the form is sent.
 */
function ibanFeedback(input: string): { hint?: string; error?: string } {
  const result = checkCrIban(input);
  if (result.ok) return { hint: `Cuenta válida: ${result.iban.formatted}` };
  const typed = normalizeIban(input);
  switch (result.problem) {
    case "empty":
      return { hint: "Empieza con CR y tiene 22 caracteres. Puede escribirla con espacios." };
    case "country":
      // "C" alone is on its way to "CR"; anything else is not a Costa Rican account.
      return typed === "C"
        ? { hint: "Empieza con CR y tiene 22 caracteres." }
        : { error: "Una cuenta IBAN de Costa Rica empieza con las letras CR." };
    case "characters":
      return {
        error:
          "Después de CR solo van números. Revise que no haya una letra O en lugar de un cero.",
      };
    case "length":
      return typed.length < CR_IBAN_LENGTH
        ? { hint: `Lleva ${typed.length} de ${CR_IBAN_LENGTH} caracteres.` }
        : { error: `Sobran caracteres: tiene ${typed.length} y deben ser ${CR_IBAN_LENGTH}.` };
    case "checksum":
      return {
        error:
          "Los dígitos no coinciden: alguno está mal escrito o cambiado de lugar. Compárela con la que le da su banco.",
      };
  }
}

/** Asks for a new payout account. Nothing changes until finance approves it. */
export function PayoutDetailsForm({
  hasAccount,
  currentSinpe,
}: {
  hasAccount: boolean;
  /** The SINPE Móvil number on file, offered again so it is not lost by accident. */
  currentSinpe: string | null;
}) {
  const [state, action] = useActionState(requestPayoutDetails, initial);
  const [iban, setIban] = useState(state.values?.iban ?? "");
  const [sinpe, setSinpe] = useState(
    state.values?.sinpe ?? (currentSinpe ? (parsePhone(currentSinpe)?.formatted ?? "") : ""),
  );
  const feedback = ibanFeedback(iban);
  const parsedSinpe = sinpe.trim() ? parsePhone(sinpe) : null;
  if (state.ok) return <FormMessage state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4">
      <TextField
        label="Cuenta IBAN nueva"
        name="iban"
        value={iban}
        onChange={(event) => setIban(event.target.value)}
        placeholder="CR00 0000 0000 0000 0000 00"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        hint={feedback.hint}
        error={feedback.error}
      />
      <TextField
        label="A nombre de"
        name="holderName"
        defaultValue={state.values?.holderName}
        maxLength={160}
        autoComplete="off"
        hint="El titular de la cuenta, tal como aparece en el banco. Debe ser quien vende."
      />
      <TextField
        label="SINPE Móvil"
        name="sinpe"
        type="tel"
        inputMode="tel"
        optional
        value={sinpe}
        onChange={(event) => setSinpe(event.target.value)}
        placeholder="8888-1234"
        hint={
          parsedSinpe?.kind === "mobile"
            ? `Lo guardamos como ${parsedSinpe.formatted}.`
            : "El celular con el que su negocio cobra por SINPE Móvil. Déjelo vacío si no tiene."
        }
      />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Enviando…">
          {hasAccount ? "Pedir el cambio de cuenta" : "Enviar mi cuenta para revisión"}
        </SubmitButton>
      </div>
    </form>
  );
}
