/**
 * The one helper that writes a price (design system §3 rule 5, §19.1):
 * «₡19 500», «₡17 256,64», «−₡500». The colon sign, U+202F NARROW NO-BREAK
 * SPACE between thousands, a decimal comma only when there are céntimos, the
 * real minus sign, and never U+00A0 inside an amount.
 *
 * The amount is always in colones and is written the same way in Spanish and
 * English (§19.1); only the words around it change, so `locale` is accepted
 * for symmetry with the other helpers and changes nothing.
 *
 * Today `packages/ui/src/commerce.tsx` and `packages/expo-kit/src/format.ts`
 * each define `formatPrice` as `format(money(amountMinor))`. This one gives
 * exactly the same characters for every integer amount (price.test.ts checks
 * it against `format`), so those two can re-export it without any screen
 * changing.
 */

import type { CoreLocaleInput } from "./dates";
import { format, money } from "./money";

export interface FormatPriceOptions {
  /** Accepted and ignored: colones read the same in both languages (§19.1). */
  locale?: CoreLocaleInput;
}

/**
 * Formats céntimos of colones. Refuses anything that is not a safe integer:
 * a float never becomes a price.
 */
export function formatPrice(amountMinor: number, _opts: FormatPriceOptions = {}): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`A price is a whole number of céntimos, got ${amountMinor}`);
  }
  return format(money(amountMinor, "CRC"));
}
