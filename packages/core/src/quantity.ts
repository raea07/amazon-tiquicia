/**
 * A number with its unit or counted word (design system §3 rule 8): «340 g»,
 * «1,8 L», «12 %», «3 unidades», «24 horas», «8 días hábiles». The number and
 * what follows are joined by U+00A0 NO-BREAK SPACE, so they never break
 * across two lines; thousands are grouped with U+202F, as money is.
 *
 * Plurals follow the same rule in Spanish and English: exactly 1 is singular,
 * everything else (0, 1,5, 2 …) plural.
 */

import { type CoreLocaleInput, coreLocale, NBSP } from "./dates";

const NNBSP = " ";

/** Units written as symbols; the same in both languages. */
export const QUANTITY_UNITS = ["g", "kg", "ml", "L", "cm", "mm", "m", "km", "W", "%"] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

/** Counted nouns, singular and plural, in Spanish and English. */
export const COUNTED_NOUNS = {
  unit: { es: ["unidad", "unidades"], en: ["unit", "units"] },
  item: { es: ["artículo", "artículos"], en: ["item", "items"] },
  product: { es: ["producto", "productos"], en: ["product", "products"] },
  order: { es: ["pedido", "pedidos"], en: ["order", "orders"] },
  parcel: { es: ["paquete", "paquetes"], en: ["parcel", "parcels"] },
  stop: { es: ["parada", "paradas"], en: ["stop", "stops"] },
  photo: { es: ["foto", "fotos"], en: ["photo", "photos"] },
  review: { es: ["reseña", "reseñas"], en: ["review", "reviews"] },
  attempt: { es: ["intento", "intentos"], en: ["attempt", "attempts"] },
  time: { es: ["vez", "veces"], en: ["time", "times"] },
  minute: { es: ["minuto", "minutos"], en: ["minute", "minutes"] },
  hour: { es: ["hora", "horas"], en: ["hour", "hours"] },
  day: { es: ["día", "días"], en: ["day", "days"] },
  workingDay: { es: ["día hábil", "días hábiles"], en: ["working day", "working days"] },
  week: { es: ["semana", "semanas"], en: ["week", "weeks"] },
  month: { es: ["mes", "meses"], en: ["month", "months"] },
  year: { es: ["año", "años"], en: ["year", "years"] },
} as const satisfies Record<string, Record<"es" | "en", readonly [string, string]>>;
export type CountedNoun = keyof typeof COUNTED_NOUNS;

/** A noun not in the list, already in the screen's language. */
export interface CustomNoun {
  one: string;
  other: string;
}

export interface FormatQuantityOptions {
  locale?: CoreLocaleInput;
  /** Most decimals shown (rounded half away from zero); trailing zeros are dropped. Default 2. */
  maxDecimals?: number;
}

/** Writes a number in the locale's marks: «1,8» / «1.8», «12 500» with U+202F, «−3». */
export function formatNumber(n: number, opts: FormatQuantityOptions = {}): string {
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite number: ${n}`);
  const locale = coreLocale(opts.locale);
  const maxDecimals = opts.maxDecimals ?? 2;
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 6) {
    throw new RangeError(`maxDecimals must be an integer from 0 to 6, got ${maxDecimals}`);
  }
  const factor = 10 ** maxDecimals;
  // Rounds on the decimal text, not on binary artefacts (1.005 → 1.01).
  const scaled = Math.round(Math.abs(n) * factor + 1e-9 * factor);
  const whole = Math.floor(scaled / factor);
  const fraction = (scaled % factor).toString().padStart(maxDecimals, "0").replace(/0+$/, "");
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  const mark = locale === "en" ? "." : ",";
  const body = fraction ? `${wholeText}${mark}${fraction}` : wholeText;
  return n < 0 && scaled !== 0 ? `−${body}` : body;
}

/**
 * «340 g», «3 unidades», «1 unidad», «8 días hábiles», «12 %»; in English
 * «340 g», «3 units», «8 working days», «12 %».
 */
export function formatQuantity(
  n: number,
  unit: QuantityUnit | CountedNoun | CustomNoun,
  opts: FormatQuantityOptions = {},
): string {
  const locale = coreLocale(opts.locale);
  const number = formatNumber(n, opts);
  let word: string;
  if (typeof unit === "object") {
    word = n === 1 ? unit.one : unit.other;
  } else if ((QUANTITY_UNITS as readonly string[]).includes(unit)) {
    word = unit;
  } else if (unit in COUNTED_NOUNS) {
    const forms = COUNTED_NOUNS[unit as CountedNoun][locale];
    word = n === 1 ? forms[0] : forms[1];
  } else {
    throw new RangeError(`Not a unit or counted noun: ${String(unit)}`);
  }
  // Inside a counted noun of two words («días hábiles») the space stays
  // ordinary: only the number and the word after it are kept together.
  return `${number}${NBSP}${word}`;
}
