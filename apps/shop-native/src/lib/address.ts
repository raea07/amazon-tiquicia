import { parsePhone } from "@yuntera/core";
import type { SaveAddressInput } from "@yuntera/db";
import { isPostalCode } from "./cart";

export interface AddressDraft {
  recipientName: string;
  phone: string;
  postalCode: string;
  senas: string;
  pin: { lat: number; lng: number; plusCode: string } | null;
}

/**
 * The website's checks on a new address (apps/web/src/app/actions.ts,
 * `addressSchema`), with its words, in the order the form shows the fields.
 * Returns the input for the API or the first problem to show.
 */
export function validateAddress(
  draft: AddressDraft,
): { input: SaveAddressInput; error?: undefined } | { error: string; input?: undefined } {
  const recipientName = draft.recipientName.trim();
  if (recipientName.length < 3 || recipientName.length > 120) {
    return { error: "Escriba el nombre completo de quien recibe." };
  }
  const phone = parsePhone(draft.phone.trim());
  if (!phone) return { error: "Escriba un teléfono costarricense de 8 dígitos." };
  if (!isPostalCode(draft.postalCode))
    return { error: "Elija la provincia, el cantón y el distrito." };
  const senas = draft.senas.trim();
  if (senas.length < 15) {
    return { error: "Agregue más detalle a las señas: referencias, color de la casa, portón." };
  }
  if (senas.length > 500)
    return { error: "Las señas son muy largas. Resúmalas en 500 caracteres." };
  const pin = draft.pin;
  if (!pin || pin.lat < 8 || pin.lat > 11.25 || pin.lng < -86 || pin.lng > -82.5) {
    return {
      error: "Marque la ubicación de entrega: use su ubicación actual o escriba su código Plus.",
    };
  }
  return {
    input: {
      recipientName,
      phone: phone.e164,
      postalCode: draft.postalCode,
      senas,
      lat: pin.lat,
      lng: pin.lng,
      plusCode: pin.plusCode || null,
      label: null,
      makeDefault: true,
    },
  };
}

/** The profile form's checks, as the website's `updateProfile`. */
export function validateProfile(input: {
  fullName: string;
  phone: string;
}): { fullName: string; phone: string | null; error?: undefined } | { error: string } {
  const fullName = input.fullName.trim();
  if (fullName.length < 3) return { error: "Escriba su nombre completo." };
  const raw = input.phone.trim();
  if (!raw) return { fullName, phone: null };
  const phone = parsePhone(raw);
  if (!phone) return { error: "Escriba un teléfono costarricense de 8 dígitos." };
  return { fullName, phone: phone.e164 };
}
