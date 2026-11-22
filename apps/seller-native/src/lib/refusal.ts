/**
 * What a seller is told when the database refuses a listing or a price.
 * Every refusal reads as packages/db's Spanish message (the kit's messageOf);
 * a price below the fees also says the lowest price the database would
 * accept, which it sends with the refusal, as the web's seller centre does
 * (`apps/seller/src/app/actions.ts`, updateOffer). Pure, so it is tested
 * without React Native.
 */

import { format, money } from "@yuntera/core";
import { ApiError } from "@yuntera/db";

export function withPriceFloor(error: unknown, message: string): string {
  if (!(error instanceof ApiError) || error.code !== "price_below_fees" || !error.detail) {
    return message;
  }
  const minimum = Number(error.detail);
  if (!Number.isSafeInteger(minimum) || minimum <= 0) return message;
  return `${message} El precio mínimo para este producto es ${format(money(minimum))}.`;
}
