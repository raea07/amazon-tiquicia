"use server";

/**
 * Server Actions for the seller's payout account.
 *
 * A seller never changes where they are paid directly: this action sends a
 * request that finance approves after confirming it by phone. The checks here
 * exist to give a good message; the database validates the account number and
 * the caller again.
 */

import { checkCrIban, type IbanProblem, parsePhone } from "@yuntera/core";
import {
  type ActionState,
  attempt,
  getViewer,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { currentShop } from "@/lib/shop";

const IBAN_PROBLEM: Record<IbanProblem, string> = {
  empty: "Escriba la cuenta IBAN.",
  country: "Una cuenta IBAN de Costa Rica empieza con las letras CR.",
  characters: "Después de CR solo van números. Revise que no haya una letra O en lugar de un cero.",
  length: "La cuenta IBAN tiene 22 caracteres: CR y 20 dígitos. Revise que no falte ni sobre uno.",
  checksum:
    "Los dígitos de la cuenta no coinciden: alguno está mal escrito o cambiado de lugar. Compárela con la que le da su banco.",
};

export async function requestPayoutDetails(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await currentShop();
  if (!session) redirectTo((await getViewer()) ? "/registro" : signInPath("/cuenta"));
  const values = typed(formData, "iban", "holderName", "sinpe");

  const iban = checkCrIban(values.iban ?? "");
  if (!iban.ok) return { error: IBAN_PROBLEM[iban.problem], values };
  const holderName = (values.holderName ?? "").trim().replace(/\s+/g, " ");
  if (holderName.length < 3 || holderName.length > 160) {
    return {
      error: "Escriba el nombre completo del titular, tal como aparece en el banco.",
      values,
    };
  }
  const sinpe = (values.sinpe ?? "").trim() ? parsePhone(values.sinpe ?? "") : null;
  if ((values.sinpe ?? "").trim() && sinpe?.kind !== "mobile") {
    return {
      error: "El número de SINPE Móvil debe ser un celular de Costa Rica: 8 dígitos.",
      values,
    };
  }

  const state = await attempt(async () => {
    await (await sessionApi()).sellerRequestPayoutDetails({
      sellerId: session.shop.id,
      iban: iban.iban.value,
      holderName,
      sinpeNumber: sinpe?.e164 ?? null,
    });
    return "Solicitud enviada. La revisamos y le llamamos al teléfono registrado de la tienda para confirmarla.";
  }, values);
  if (state.ok) refresh();
  return state;
}
