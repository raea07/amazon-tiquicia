import { describe, expect, it } from "vitest";
import { formatDay } from "./dates";
import {
  computeDeliveryPromise,
  costaRicaHolidays,
  daysBetween,
  SERVICE_PRESETS,
  toCostaRicaTime,
  type ZoneService,
} from "./promise";
import { deliveryStripSentence, STRIP_DEFAULT_PLACE, type StripPlace } from "./strip";

/** Builds an instant from a Costa Rican wall-clock time (UTC−6, no DST). */
const cr = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hour + 6, minute));
};

const HOLIDAYS = [...costaRicaHolidays(2026), ...costaRicaHolidays(2027)];

const strip = (
  now: Date,
  zone: ZoneService = SERVICE_PRESETS.gamCore,
  opts: { place?: StripPlace; locale?: "es" | "en" } = {},
) => {
  const locale = opts.locale ?? "es";
  const promise = computeDeliveryPromise({ now, zone, handlingDays: 0, holidays: HOLIDAYS });
  return deliveryStripSentence({
    promise,
    now,
    cutoffHour: zone.cutoffHour,
    place: opts.place ?? STRIP_DEFAULT_PLACE[locale],
    locale,
  });
};

const show = (text: string) => text.replaceAll(" ", "⍽").replaceAll(" ", "⎵");
const same = (actual: string, expected: string) => {
  expect(show(actual)).toBe(show(expected));
  expect([...actual].map((c) => c.codePointAt(0))).toEqual(
    [...expected].map((c) => c.codePointAt(0)),
  );
};
const TWO_PM = "2 p. m.";

describe("the delivery strip sentence (§5.5)", () => {
  it("before the cut-off, arriving tomorrow: the drawn sentence", () => {
    // Friday 27 November 2026, 10 a.m.: leaves today, arrives Saturday.
    const s = strip(cr("2026-11-27", 10));
    same(s.order, `Pida hoy antes de las ${TWO_PM}`);
    same(s.arrival, "y le llega mañana, en el GAM.");
    same(s.sentence, `Pida hoy antes de las ${TWO_PM} y le llega mañana, en el GAM.`);
    same(s.ownDrivers, "Con nuestros propios repartidores.");

    const en = strip(cr("2026-11-27", 10), SERVICE_PRESETS.gamCore, { locale: "en" });
    same(en.sentence, "Order today before 2 pm and it arrives tomorrow, in the GAM.");
    same(en.ownDrivers, "With our own drivers.");
  });

  it("with a place the shopper chose, names the day in full after «mañana»", () => {
    const now = cr("2026-11-24", 10); // Tuesday
    same(
      strip(now, SERVICE_PRESETS.gamCore, { place: { kind: "chosen", name: "San Pedro" } })
        .sentence,
      `Pida hoy antes de las ${TWO_PM} y le llega mañana, miércoles 25 de noviembre, en San Pedro.`,
    );
    same(
      strip(now, SERVICE_PRESETS.gamCore, {
        place: { kind: "chosen", name: "San Pedro" },
        locale: "en",
      }).sentence,
      "Order today before 2 pm and it arrives tomorrow, Wednesday 25 November, in San Pedro.",
    );
  });

  it("before the cut-off on a Saturday: names Monday, not «mañana»", () => {
    const s = strip(cr("2026-11-28", 10));
    same(
      s.sentence,
      `Pida hoy antes de las ${TWO_PM} y le llega el lunes 30 de noviembre, en el GAM.`,
    );
    same(
      strip(cr("2026-11-28", 10), SERVICE_PRESETS.gamCore, { locale: "en" }).sentence,
      "Order today before 2 pm and it arrives on Monday 30 November, in the GAM.",
    );
  });

  it("before the cut-off on the day before a holiday: skips the holiday", () => {
    // Monday 30 November 2026; Tuesday 1 December is a holiday.
    same(
      strip(cr("2026-11-30", 10)).sentence,
      `Pida hoy antes de las ${TWO_PM} y le llega el miércoles 2 de diciembre, en el GAM.`,
    );
  });

  it("after the cut-off: «Pida hoy y le llega el lunes 30 de noviembre»", () => {
    same(
      strip(cr("2026-11-27", 15)).sentence,
      "Pida hoy y le llega el lunes 30 de noviembre, en el GAM.",
    );
    same(
      strip(cr("2026-11-27", 15), SERVICE_PRESETS.gamCore, { locale: "en" }).sentence,
      "Order today and it arrives on Monday 30 November, in the GAM.",
    );
    // At 2 p.m. sharp the cut-off has passed.
    same(strip(cr("2026-11-27", 14)).order, "Pida hoy");
    same(strip(cr("2026-11-27", 13, 59)).order, `Pida hoy antes de las ${TWO_PM}`);
  });

  it("on a Sunday (no processing): the next real delivery day", () => {
    // Sunday 29 November: leaves Monday 30, Tuesday 1 December is a holiday.
    same(
      strip(cr("2026-11-29", 10)).sentence,
      "Pida hoy y le llega el miércoles 2 de diciembre, en el GAM.",
    );
  });

  it("on 31 December: skips New Year's Day", () => {
    same(
      strip(cr("2026-12-31", 10)).sentence,
      `Pida hoy antes de las ${TWO_PM} y le llega el sábado 2 de enero, en el GAM.`,
    );
  });

  it("on 1 January (a holiday): «Pida hoy», arriving Monday 4", () => {
    same(
      strip(cr("2027-01-01", 10)).sentence,
      "Pida hoy y le llega el lunes 4 de enero, en el GAM.",
    );
    same(
      strip(cr("2027-01-01", 10), SERVICE_PRESETS.gamCore, { locale: "en" }).sentence,
      "Order today and it arrives on Monday 4 January, in the GAM.",
    );
  });

  it("in Holy Week: skips Holy Thursday and Good Friday", () => {
    // Wednesday 24 March 2027; Easter is 28 March, so 25 and 26 are holidays.
    same(
      strip(cr("2027-03-24", 10)).sentence,
      `Pida hoy antes de las ${TWO_PM} y le llega el sábado 27 de marzo, en el GAM.`,
    );
    // Holy Thursday itself: no processing until Saturday, arriving Monday.
    same(
      strip(cr("2027-03-25", 10)).sentence,
      "Pida hoy y le llega el lunes 29 de marzo, en el GAM.",
    );
  });

  it("a zone with a range of days names both ends", () => {
    const place: StripPlace = { kind: "chosen", name: "Limón" };
    // Monday 30 November, national zone: cut-off at noon, 2 to 5 delivery days.
    same(
      strip(cr("2026-11-30", 10), SERVICE_PRESETS.national, { place }).sentence,
      "Pida hoy antes de las 12 p. m. y le llega entre el jueves 3 de diciembre y el martes 8 de diciembre, en Limón.",
    );
    same(
      strip(cr("2026-11-30", 10), SERVICE_PRESETS.national, { place, locale: "en" }).sentence,
      "Order today before 12 pm and it arrives between Thursday 3 December and Tuesday 8 December, in Limón.",
    );
  });

  it("a range that starts tomorrow says «entre mañana y …»", () => {
    const place: StripPlace = { kind: "chosen", name: "Cartago" };
    same(
      strip(cr("2026-11-27", 10), SERVICE_PRESETS.gamExtended, { place }).sentence,
      "Pida hoy antes de las 12 p. m. y le llega entre mañana y el lunes 30 de noviembre, en Cartago.",
    );
    same(
      strip(cr("2026-11-27", 10), SERVICE_PRESETS.gamExtended, { place, locale: "en" }).sentence,
      "Order today before 12 pm and it arrives between tomorrow and Monday 30 November, in Cartago.",
    );
  });

  it("says «antes de la 1 p. m.» for a one o'clock cut-off", () => {
    const zone = { ...SERVICE_PRESETS.gamCore, cutoffHour: 13 };
    same(strip(cr("2026-11-27", 10), zone).order, "Pida hoy antes de la 1 p. m.");
    same(strip(cr("2026-11-27", 10), zone, { locale: "en" }).order, "Order today before 1 pm");
  });

  it("never gives «hoy» to the delivery", () => {
    const zone: ZoneService = { ...SERVICE_PRESETS.gamCore, transitDays: [0, 0] };
    same(strip(cr("2026-11-27", 10), zone).arrival, "y le llega el mismo día, en el GAM.");
    same(
      strip(cr("2026-11-27", 10), zone, { locale: "en" }).arrival,
      "and it arrives the same day, in the GAM.",
    );
  });

  it("says only the last day for a range that starts on the day of dispatch", () => {
    const zone: ZoneService = { ...SERVICE_PRESETS.gamCore, transitDays: [0, 1] };
    same(
      strip(cr("2026-11-27", 8), zone).sentence,
      `Pida hoy antes de las ${TWO_PM} y le llega a más tardar el sábado 28 de noviembre, en el GAM.`,
    );
    same(
      strip(cr("2026-11-27", 8), zone, { locale: "en" }).sentence,
      "Order today before 2 pm and it arrives by Saturday 28 November, in the GAM.",
    );
    const place: StripPlace = { kind: "chosen", name: "San Pedro" };
    same(
      strip(cr("2026-11-27", 8), zone, { place }).arrival,
      "y le llega a más tardar el sábado 28 de noviembre, en San Pedro.",
    );
    // A later range end, after the weekend: still only the last day.
    const wide: ZoneService = { ...SERVICE_PRESETS.gamCore, transitDays: [0, 2] };
    same(
      strip(cr("2026-11-27", 8), wide).arrival,
      "y le llega a más tardar el lunes 30 de noviembre, en el GAM.",
    );
  });

  it("accepts a cut-off at midnight, which the zones table allows: never «antes de»", () => {
    const zone: ZoneService = { ...SERVICE_PRESETS.gamCore, cutoffHour: 0 };
    const s = strip(cr("2026-11-27", 8), zone);
    same(s.order, "Pida hoy");
    same(s.sentence, "Pida hoy y le llega el lunes 30 de noviembre, en el GAM.");
    same(
      strip(cr("2026-11-27", 8), zone, { locale: "en" }).sentence,
      "Order today and it arrives on Monday 30 November, in the GAM.",
    );
  });

  it("refuses a promise that was not computed for this moment", () => {
    const zone = SERVICE_PRESETS.gamCore;
    const morning = computeDeliveryPromise({ now: cr("2026-11-27", 10), zone, handlingDays: 0 });
    expect(() =>
      deliveryStripSentence({
        promise: morning,
        now: cr("2026-11-27", 15),
        cutoffHour: zone.cutoffHour,
        place: STRIP_DEFAULT_PLACE.es,
      }),
    ).toThrow(RangeError);
    expect(() =>
      deliveryStripSentence({
        promise: morning,
        now: cr("2026-11-25", 10),
        cutoffHour: zone.cutoffHour,
        place: STRIP_DEFAULT_PLACE.es,
      }),
    ).toThrow(RangeError);
    expect(() =>
      deliveryStripSentence({
        promise: morning,
        now: cr("2026-11-27", 10),
        cutoffHour: 24,
        place: STRIP_DEFAULT_PLACE.es,
      }),
    ).toThrow(RangeError);
    expect(() =>
      deliveryStripSentence({
        promise: morning,
        now: cr("2026-11-27", 10),
        cutoffHour: -1,
        place: STRIP_DEFAULT_PLACE.es,
      }),
    ).toThrow(RangeError);
  });

  // Every 11th hour for 400 days: 11 and 24 share no factor, so every hour of
  // the day comes up, on every weekday, across New Year and Holy Week 2027.
  it("never names a day the promise does not give, at every hour of the day for a year", () => {
    const zones: ZoneService[] = Object.values(SERVICE_PRESETS);
    for (let h = 0; h < 24 * 400; h += 11) {
      const now = new Date(Date.UTC(2026, 10, 1, 0) + h * 3_600_000);
      const today = toCostaRicaTime(now).date;
      for (const zone of zones) {
        for (const handlingDays of [0, 1]) {
          const promise = computeDeliveryPromise({ now, zone, handlingDays, holidays: HOLIDAYS });
          const { sentence, order } = deliveryStripSentence({
            promise,
            now,
            cutoffHour: zone.cutoffHour,
            place: STRIP_DEFAULT_PLACE.es,
          });
          // The cut-off is offered only when the promise made it.
          expect(order.includes("antes de")).toBe(promise.madeCutoff);
          // The last day promised is always named, as a date or as «mañana».
          const latest = formatDay(promise.latest, { form: "long" });
          if (daysBetween(today, promise.latest) === 1 && promise.earliest === promise.latest) {
            expect(sentence).toContain("y le llega mañana,");
          } else {
            expect(sentence).toContain(`el ${latest},`);
          }
          // No other day than the promise's appears in the sentence.
          const named = [...sentence.matchAll(/(\p{L}+ \d+ de \p{L}+)/gu)].map((m) => m[1]);
          const allowed = new Set([
            formatDay(promise.earliest, { form: "long" }),
            formatDay(promise.latest, { form: "long" }),
          ]);
          for (const day of named) expect(allowed.has(day as string)).toBe(true);
        }
      }
    }
  }, 30_000);
});
