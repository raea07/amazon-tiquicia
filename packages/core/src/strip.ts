/**
 * The one sentence of the delivery strip (design system §5.5), computed from
 * the delivery promise of promise.ts, so the strip never promises a day the
 * promise does not give.
 *
 * Order first, then the result; «hoy» belongs to the order, never to the
 * delivery:
 *
 * - before the cut-off, arriving tomorrow:
 *   «Pida hoy antes de las 2 p. m. y le llega mañana, en el GAM.»
 *   and, with a place the shopper chose, the long date after «mañana»:
 *   «… y le llega mañana, miércoles 25 de noviembre, en San Pedro.»
 * - before the cut-off, arriving on a later day (a Saturday whose next day is
 *   Sunday, the day before a holiday):
 *   «Pida hoy antes de las 2 p. m. y le llega el lunes 30 de noviembre, en el GAM.»
 * - after the cut-off or on a day without processing:
 *   «Pida hoy y le llega el lunes 30 de noviembre, en el GAM.»
 * - a zone with a range of days:
 *   «Pida hoy antes de las 12 p. m. y le llega entre el miércoles 2 de
 *   diciembre y el lunes 7 de diciembre, en Limón.»
 * - a range that starts on the day of dispatch names only its last day,
 *   because «hoy» belongs to the order (wording chosen here, not drawn in
 *   §5.5): «Pida hoy antes de las 2 p. m. y le llega a más tardar el sábado
 *   28 de noviembre, en el GAM.» / «… and it arrives by Saturday 28 November, …»
 *
 * The time is the zone's cut-off written by formatClock (U+00A0 inside); the
 * dates are written by formatDay in the long form.
 */

import { type CoreLocaleInput, coreLocale, formatClock, formatDay } from "./dates";
import { type DeliveryPromise, daysBetween, toCostaRicaTime } from "./promise";

/** Where the strip says the parcel arrives, already in the screen's language. */
export type StripPlace =
  /** The zone the shop assumes before the shopper chooses («el GAM» / «the GAM»). */
  | { kind: "zone"; name: string }
  /** The place the shopper chose («San Pedro»): the date is written in full. */
  | { kind: "chosen"; name: string };

/** The zone the strip names before a shopper chooses one. */
export const STRIP_DEFAULT_PLACE = {
  es: { kind: "zone", name: "el GAM" },
  en: { kind: "zone", name: "the GAM" },
} as const satisfies Record<"es" | "en", StripPlace>;

export interface DeliveryStripInput {
  /** The promise computed for `now` (computeDeliveryPromise with the same instant). */
  promise: DeliveryPromise;
  /** The moment the promise was computed for. */
  now: Date;
  /** The zone's cut-off hour (ZoneService.cutoffHour; zones.cutoff_hour in the database). */
  cutoffHour: number;
  place: StripPlace;
  locale?: CoreLocaleInput;
}

export interface DeliveryStripSentence {
  /** The order part, set in bold: «Pida hoy antes de las 2 p. m.» or «Pida hoy». */
  order: string;
  /** The result: «y le llega mañana, en el GAM.» */
  arrival: string;
  /** The two together, as one sentence. */
  sentence: string;
  /** Added from 900 px: «Con nuestros propios repartidores.» */
  ownDrivers: string;
}

const WORDS = {
  es: {
    orderToday: "Pida hoy",
    before: (hour: number, time: string) => `antes de ${hour % 12 === 1 ? "la" : "las"} ${time}`,
    arrives: "y le llega",
    on: (day: string) => `el ${day}`,
    the: (day: string) => `el ${day}`,
    between: (a: string, b: string) => `entre ${a} y ${b}`,
    by: (day: string) => `a más tardar el ${day}`,
    in: (place: string) => `en ${place}`,
    ownDrivers: "Con nuestros propios repartidores.",
  },
  en: {
    orderToday: "Order today",
    before: (_hour: number, time: string) => `before ${time}`,
    arrives: "and it arrives",
    on: (day: string) => `on ${day}`,
    the: (day: string) => day,
    between: (a: string, b: string) => `between ${a} and ${b}`,
    by: (day: string) => `by ${day}`,
    in: (place: string) => `in ${place}`,
    ownDrivers: "With our own drivers.",
  },
} as const;

// «hoy» belongs to the order, never to the delivery (§5.5): a zone that
// delivers on the day of dispatch says «el mismo día».
const RELATIVE = {
  es: { today: "el mismo día", tomorrow: "mañana" },
  en: { today: "the same day", tomorrow: "tomorrow" },
} as const;

/** The sentence of the delivery strip, in Spanish or English. */
export function deliveryStripSentence(input: DeliveryStripInput): DeliveryStripSentence {
  const locale = coreLocale(input.locale);
  const words = WORDS[locale];
  const { promise, now, cutoffHour, place } = input;
  const local = toCostaRicaTime(now);
  const today = local.date;

  // zones.cutoff_hour allows 0 to 23. With 0 no moment is before the cut-off,
  // so the promise never makes it and the sentence is always «Pida hoy …».
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23) {
    throw new RangeError(`Not a cut-off hour: ${cutoffHour}`);
  }
  // The promise must be the one computed for this moment and zone; anything
  // else could make the strip promise a day the calculation did not give.
  if (promise.madeCutoff && local.hour >= cutoffHour) {
    throw new RangeError("The promise made the cut-off, but `now` is after the cut-off hour");
  }
  if (
    daysBetween(today, promise.earliest) < 0 ||
    daysBetween(promise.earliest, promise.latest) < 0
  ) {
    throw new RangeError("The promise's dates are not on or after `now`");
  }
  if (daysBetween(today, promise.latest) !== promise.promiseDays) {
    throw new RangeError("The promise was computed for another day than `now`");
  }

  const order = promise.madeCutoff
    ? `${words.orderToday} ${words.before(cutoffHour, formatClock(cutoffHour, 0, { locale }))}`
    : words.orderToday;

  const long = (date: string) => formatDay(date, { form: "long", locale });
  /** «mañana» (with the date in full for a chosen place) or «el lunes 30 de noviembre». */
  const oneDay = (date: string, inRange: boolean): string => {
    const diff = daysBetween(today, date);
    if (diff === 0 || diff === 1) {
      const word = diff === 0 ? RELATIVE[locale].today : RELATIVE[locale].tomorrow;
      return place.kind === "chosen" && !inRange ? `${word}, ${long(date)}` : word;
    }
    return inRange ? words.the(long(date)) : words.on(long(date));
  };

  // A range that starts on the day of dispatch would need «hoy» or «el mismo
  // día» as its first end, which reads badly; it names only its last day.
  const when =
    promise.earliest === promise.latest
      ? oneDay(promise.latest, false)
      : daysBetween(today, promise.earliest) === 0
        ? words.by(long(promise.latest))
        : words.between(oneDay(promise.earliest, true), words.the(long(promise.latest)));

  const arrival = `${words.arrives} ${when}, ${words.in(place.name)}.`;
  return {
    order,
    arrival,
    sentence: `${order} ${arrival}`,
    ownDrivers: words.ownDrivers,
  };
}
