import { describe, expect, it } from "vitest";
import {
  addDays,
  computeDeliveryPromise,
  costaRicaHolidays,
  daysBetween,
  describePromise,
  easterSunday,
  promiseHour,
  SERVICE_PRESETS,
  toCostaRicaTime,
  weekdayOf,
} from "./promise";

/** Builds an instant from a Costa Rican wall-clock time (UTC−6, no DST). */
const crTime = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hour + 6, minute));
};

describe("local time", () => {
  it("converts instants to Costa Rican wall-clock time", () => {
    // 03:30 UTC on the 5th is 21:30 on the 4th in Costa Rica.
    expect(toCostaRicaTime(new Date("2026-03-05T03:30:00Z"))).toEqual({
      date: "2026-03-04",
      hour: 21,
      minute: 30,
      weekday: 3,
    });
  });

  it("does date arithmetic across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-23", "2026-11-30")).toBe(7);
    expect(weekdayOf("2026-11-23")).toBe(1); // Monday
    expect(() => addDays("23/11/2026", 1)).toThrow(RangeError);
  });
});

describe("holidays", () => {
  it("computes Easter", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });

  it("lists the statutory holidays including Holy Thursday and Good Friday", () => {
    const h = costaRicaHolidays(2026);
    expect(h).toHaveLength(12);
    expect(h).toContain("2026-04-02"); // Jueves Santo
    expect(h).toContain("2026-04-03"); // Viernes Santo
    expect(h).toContain("2026-09-15");
    expect(h).toContain("2026-12-25");
    expect([...h].sort()).toEqual(h);
  });
});

describe("delivery promise", () => {
  const zone = SERVICE_PRESETS.gamCore;

  it("promises next day when ordered before the cutoff", () => {
    // Monday 23 Nov 2026, 10:00.
    const p = computeDeliveryPromise({ now: crTime("2026-11-23", 10), zone, handlingDays: 0 });
    expect(p).toEqual({
      dispatchDate: "2026-11-23",
      earliest: "2026-11-24",
      latest: "2026-11-24",
      promiseDays: 1,
      madeCutoff: true,
    });
  });

  it("rolls to the following day after the cutoff", () => {
    const p = computeDeliveryPromise({ now: crTime("2026-11-23", 14), zone, handlingDays: 0 });
    expect(p.madeCutoff).toBe(false);
    expect(p.dispatchDate).toBe("2026-11-24");
    expect(p.latest).toBe("2026-11-25");
    expect(p.promiseDays).toBe(2);
  });

  it("skips Sunday, when the GAM service does not run", () => {
    // Saturday 28 Nov 2026 at 15:00: after cutoff → dispatch Monday → deliver Tuesday.
    const p = computeDeliveryPromise({ now: crTime("2026-11-28", 15), zone, handlingDays: 0 });
    expect(p.dispatchDate).toBe("2026-11-30");
    expect(p.latest).toBe("2026-12-01");
  });

  it("skips public holidays for both processing and delivery", () => {
    // Wed 1 Apr 2026 before cutoff; Thu 2 and Fri 3 are Semana Santa holidays.
    const p = computeDeliveryPromise({
      now: crTime("2026-04-01", 9),
      zone,
      handlingDays: 0,
      holidays: costaRicaHolidays(2026),
    });
    expect(p.dispatchDate).toBe("2026-04-01");
    expect(p.latest).toBe("2026-04-04"); // Saturday
  });

  it("counts seller handling time in processing days", () => {
    // Friday 27 Nov 10:00, 2 handling days: Fri → Sat → Mon dispatch, Tue delivery.
    const p = computeDeliveryPromise({ now: crTime("2026-11-27", 10), zone, handlingDays: 2 });
    expect(p.dispatchDate).toBe("2026-11-30");
    expect(p.latest).toBe("2026-12-01");
  });

  it("gives a window where transit time varies", () => {
    const p = computeDeliveryPromise({
      now: crTime("2026-11-23", 9),
      zone: SERVICE_PRESETS.national,
      handlingDays: 0,
    });
    expect(p.earliest).toBe("2026-11-25");
    expect(p.latest).toBe("2026-11-30"); // 5 weekday delivery days, skipping the weekend
    expect(daysBetween(p.earliest, p.latest)).toBeGreaterThan(0);
  });

  it("moves past delivery days that are at capacity", () => {
    const p = computeDeliveryPromise({
      now: crTime("2026-11-23", 10),
      zone,
      handlingDays: 0,
      closedDates: ["2026-11-24"],
    });
    expect(p.latest).toBe("2026-11-25");
  });

  it("uses the Costa Rican date, not the UTC date, around midnight", () => {
    // 23:30 Monday in Costa Rica is already Tuesday in UTC.
    const p = computeDeliveryPromise({ now: crTime("2026-11-23", 23, 30), zone, handlingDays: 0 });
    expect(p.dispatchDate).toBe("2026-11-24");
    expect(p.promiseDays).toBe(2);
  });

  it("never promises a date before dispatch, for a year of order times", () => {
    const holidays = [...costaRicaHolidays(2026), ...costaRicaHolidays(2027)];
    for (const preset of Object.values(SERVICE_PRESETS)) {
      for (let day = 0; day < 365; day += 3) {
        for (const hour of [0, 11, 13, 17]) {
          const now = crTime(addDays("2026-01-01", day), hour);
          const p = computeDeliveryPromise({ now, zone: preset, handlingDays: day % 3, holidays });
          const today = toCostaRicaTime(now).date;
          expect(daysBetween(today, p.dispatchDate)).toBeGreaterThanOrEqual(0);
          expect(daysBetween(p.dispatchDate, p.earliest)).toBeGreaterThanOrEqual(0);
          expect(daysBetween(p.earliest, p.latest)).toBeGreaterThanOrEqual(0);
          expect(holidays).not.toContain(p.latest);
          expect(preset.deliveryWeekdays).toContain(weekdayOf(p.latest));
        }
      }
    }
  });

  it("rejects invalid configuration", () => {
    expect(() => computeDeliveryPromise({ now: new Date(), zone, handlingDays: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      computeDeliveryPromise({
        now: new Date(),
        zone: { ...zone, deliveryWeekdays: [] },
        handlingDays: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe("promise wording", () => {
  const zone = SERVICE_PRESETS.gamCore;

  it("says mañana for next-day delivery", () => {
    const now = crTime("2026-11-23", 10);
    const p = computeDeliveryPromise({ now, zone, handlingDays: 0 });
    expect(describePromise(p, now)).toBe("Llega mañana");
    expect(describePromise(p, now, "en")).toBe("Arrives tomorrow");
  });

  it("names the day when it is further out", () => {
    const now = crTime("2026-11-28", 15);
    const p = computeDeliveryPromise({ now, zone, handlingDays: 0 });
    expect(describePromise(p, now)).toBe("Llega el martes, 1 de diciembre");
  });

  it("gives a range for a delivery window", () => {
    const now = crTime("2026-11-23", 9);
    const p = computeDeliveryPromise({ now, zone: SERVICE_PRESETS.national, handlingDays: 0 });
    expect(describePromise(p, now)).toBe(
      "Llega entre el miércoles, 25 de noviembre y el lunes, 30 de noviembre",
    );
  });
});

describe("the hour a promise holds for", () => {
  it("is the Costa Rica date and hour", () => {
    expect(promiseHour(crTime("2026-11-24", 13, 59))).toBe("2026-11-24T13");
    expect(promiseHour(crTime("2026-11-24", 14, 0))).toBe("2026-11-24T14");
    expect(promiseHour(crTime("2026-11-24", 0, 0))).toBe("2026-11-24T00");
    expect(promiseHour(crTime("2026-11-23", 23, 59))).toBe("2026-11-23T23");
  });

  it("changes whenever the promise can change with the clock alone", () => {
    // Every hour of two weeks, every zone, with and without handling days:
    // two instants with the same key always get the same promise, so a
    // cache keyed by it never serves a promise past its hour.
    const start = crTime("2026-11-23", 0, 0).getTime();
    for (const zone of Object.values(SERVICE_PRESETS)) {
      for (const handlingDays of [0, 2]) {
        for (let hour = 0; hour < 14 * 24; hour++) {
          const first = new Date(start + hour * 3_600_000);
          const last = new Date(first.getTime() + 3_599_999);
          expect(promiseHour(last)).toBe(promiseHour(first));
          expect(computeDeliveryPromise({ now: last, zone, handlingDays })).toEqual(
            computeDeliveryPromise({ now: first, zone, handlingDays }),
          );
        }
      }
    }
  });
});
