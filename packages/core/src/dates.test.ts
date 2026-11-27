import { describe, expect, it } from "vitest";
import { formatClock, formatDay, formatTime } from "./dates";

/** Builds an instant from a Costa Rican wall-clock time (UTC−6, no DST). */
const cr = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hour + 6, minute));
};

/** Makes U+00A0 visible, so a failing test shows where an ordinary space slipped in. */
const show = (text: string) => text.replaceAll(" ", "⍽").replaceAll(" ", "⎵");

/** Compares character by character, with every no-break space made visible. */
const same = (actual: string, expected: string) => {
  expect(show(actual)).toBe(show(expected));
  expect([...actual].map((c) => c.codePointAt(0))).toEqual(
    [...expected].map((c) => c.codePointAt(0)),
  );
};

const NOW = cr("2026-11-27", 10); // Friday 27 November 2026, 10 a.m. in Costa Rica

describe("formatTime (§3 rule 8, §19.2)", () => {
  it("writes «6:33 p. m.» with U+00A0 between every part", () => {
    same(formatTime(cr("2026-11-27", 18, 33)), "6:33 p. m.");
    same(formatTime(cr("2026-11-27", 18, 33), { locale: "en" }), "6:33 pm");
  });

  it("writes «6:33 a. m.» likewise", () => {
    same(formatTime(cr("2026-11-27", 6, 33)), "6:33 a. m.");
    same(formatTime(cr("2026-11-27", 6, 33), { locale: "en" }), "6:33 am");
  });

  it("drops the minutes of a whole hour: «2 p. m.»", () => {
    same(formatTime(cr("2026-11-27", 14)), "2 p. m.");
    same(formatTime(cr("2026-11-27", 14), { locale: "en" }), "2 pm");
  });

  it("writes noon and midnight on the twelve-hour clock", () => {
    same(formatTime(cr("2026-11-27", 12)), "12 p. m.");
    same(formatTime(cr("2026-11-27", 0, 5)), "12:05 a. m.");
    same(formatTime(cr("2026-11-27", 0, 5), { locale: "en" }), "12:05 am");
  });

  it("reads the Costa Rica clock, whatever the instant's zone", () => {
    // 00:33 UTC on the 28th is 6:33 p.m. on the 27th in Costa Rica.
    same(formatTime("2026-11-28T00:33:00Z"), "6:33 p. m.");
    same(formatTime(new Date("2026-11-28T00:33:00Z")), "6:33 p. m.");
  });

  it("reads es-CR as Spanish", () => {
    same(formatTime(cr("2026-11-27", 9, 5), { locale: "es-CR" }), "9:05 a. m.");
  });

  it("refuses what is not a moment", () => {
    expect(() => formatTime("ayer")).toThrow(RangeError);
  });

  it("formatClock writes a cut-off hour the same way", () => {
    same(formatClock(14), "2 p. m.");
    same(formatClock(13), "1 p. m.");
    same(formatClock(9, 30, { locale: "en" }), "9:30 am");
    expect(() => formatClock(24)).toThrow(RangeError);
    expect(() => formatClock(10, 60)).toThrow(RangeError);
  });
});

describe("formatDay, short form (§10.4, §19.2)", () => {
  it("says «hoy», «ayer» and «mañana»", () => {
    same(formatDay(cr("2026-11-27", 8), { now: NOW }), "hoy");
    same(formatDay(cr("2026-11-26", 8), { now: NOW }), "ayer");
    same(formatDay(cr("2026-11-28", 8), { now: NOW }), "mañana");
    same(formatDay(cr("2026-11-27", 8), { now: NOW, locale: "en" }), "today");
    same(formatDay(cr("2026-11-26", 8), { now: NOW, locale: "en" }), "yesterday");
    same(formatDay(cr("2026-11-28", 8), { now: NOW, locale: "en" }), "tomorrow");
  });

  it("writes the weekday in full and the day within the month: «viernes 27»", () => {
    const seenOn24 = cr("2026-11-24", 9);
    same(formatDay(cr("2026-11-27", 8), { now: seenOn24 }), "viernes 27");
    same(formatDay(cr("2026-11-27", 8), { now: seenOn24, locale: "en" }), "Friday 27");
    same(formatDay(cr("2026-11-20", 8), { now: NOW }), "viernes 20");
  });

  it("adds the month when the date is not in the current month: «miércoles 2 de diciembre»", () => {
    const seenOn24 = cr("2026-11-24", 9);
    same(formatDay(cr("2026-12-02", 8), { now: seenOn24 }), "miércoles 2 de diciembre");
    same(formatDay(cr("2026-12-02", 8), { now: seenOn24, locale: "en" }), "Wednesday 2 December");
    same(formatDay("2026-10-31", { now: NOW }), "sábado 31 de octubre");
  });

  it("adds the year only when it is not the current year", () => {
    same(formatDay("2027-01-08", { now: NOW }), "viernes 8 de enero de 2027");
    same(formatDay("2027-01-08", { now: NOW, locale: "en" }), "Friday 8 January 2027");
    same(formatDay("2025-11-27", { now: NOW }), "jueves 27 de noviembre de 2025");
  });

  it("keeps the relative word across the turn of a year", () => {
    const newYear = cr("2027-01-01", 9);
    same(formatDay(cr("2026-12-31", 20), { now: newYear }), "ayer");
  });

  it("puts the time after a comma: «ayer, 6:33 p. m.»", () => {
    same(formatDay(cr("2026-11-26", 18, 33), { now: NOW, time: true }), "ayer, 6:33 p. m.");
    same(
      formatDay(cr("2026-11-26", 18, 33), { now: NOW, time: true, locale: "en" }),
      "yesterday, 6:33 pm",
    );
    same(formatDay(cr("2026-11-23", 18, 34), { now: NOW, time: true }), "lunes 23, 6:34 p. m.");
  });

  it("takes the day from the Costa Rica clock", () => {
    // 03:30 UTC on the 28th is 9:30 p.m. on the 27th in Costa Rica: still today.
    same(formatDay("2026-11-28T03:30:00Z", { now: NOW, time: true }), "hoy, 9:30 p. m.");
  });

  it("leaves the time out for a calendar date", () => {
    same(formatDay("2026-11-28", { now: NOW, time: true }), "mañana");
  });

  it("never abbreviates a weekday or a month", () => {
    const words = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const day = new Date(Date.UTC(2026, 0, 1 + i, 18));
      for (const locale of ["es", "en"] as const) {
        for (const w of formatDay(day, { now: NOW, locale, form: "long", year: true }).split(" ")) {
          words.add(w);
        }
      }
    }
    for (const short of ["mié", "nov", "dic", "sáb", "Wed", "Nov", "Dec", "Sat"]) {
      expect(words.has(short)).toBe(false);
      expect(words.has(`${short}.`)).toBe(false);
    }
  });

  it("refuses a date that does not exist", () => {
    expect(() => formatDay("2026-02-30", { now: NOW })).toThrow(RangeError);
    expect(() => formatDay("mañana", { now: NOW })).toThrow(RangeError);
  });
});

describe("formatDay, long form (§10.4, §19.2)", () => {
  it("writes the weekday, the day, «de» and the month, with no comma", () => {
    same(formatDay(cr("2026-11-27", 10), { form: "long" }), "viernes 27 de noviembre");
    same(formatDay(cr("2026-11-27", 10), { form: "long", locale: "en" }), "Friday 27 November");
  });

  it("adds the year on documents", () => {
    same(formatDay("2026-11-01", { form: "long", year: true }), "domingo 1 de noviembre de 2026");
    same(
      formatDay("2026-11-01", { form: "long", year: true, locale: "en" }),
      "Sunday 1 November 2026",
    );
  });

  it("puts a time after a comma", () => {
    same(
      formatDay(cr("2026-11-23", 18, 34), { form: "long", year: true, time: true }),
      "lunes 23 de noviembre de 2026, 6:34 p. m.",
    );
    same(
      formatDay(cr("2026-11-23", 18, 34), { form: "long", year: true, time: true, locale: "en" }),
      "Monday 23 November 2026, 6:34 pm",
    );
  });

  it("may lead with a relative word: «mañana, miércoles 25 de noviembre»", () => {
    const seenOn24 = cr("2026-11-24", 9);
    same(
      formatDay("2026-11-25", { form: "long", relative: true, now: seenOn24 }),
      "mañana, miércoles 25 de noviembre",
    );
    same(
      formatDay("2026-11-25", { form: "long", relative: true, now: seenOn24, locale: "en" }),
      "tomorrow, Wednesday 25 November",
    );
    same(
      formatDay("2026-11-27", { form: "long", relative: true, now: NOW }),
      "hoy, viernes 27 de noviembre",
    );
    // No relative word applies: the long form alone.
    same(
      formatDay("2026-11-30", { form: "long", relative: true, now: NOW }),
      "lunes 30 de noviembre",
    );
  });

  it("needs `now` for a relative word", () => {
    expect(() => formatDay("2026-11-25", { form: "long", relative: true })).toThrow(RangeError);
  });
});
