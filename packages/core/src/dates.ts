/**
 * Dates and times as people read them (design system §10.4, §19.2 and §3
 * rule 8), in Spanish and English, always on the Costa Rica clock.
 *
 * - `formatTime`: «6:33 p. m.», «2 p. m.» / «6:33 pm», «2 pm». The parts of a
 *   time are joined by U+00A0 NO-BREAK SPACE so a time never breaks across
 *   two lines.
 * - `formatDay`, short form (tables, lists, history): «hoy», «ayer»,
 *   «mañana»; otherwise «viernes 27»; with the month when the date is not in
 *   the current month («miércoles 2 de diciembre»); with the year only when
 *   it is not the current year. A time follows after a comma: «ayer, 6:33 p. m.».
 * - `formatDay`, long form (sentences, arrival dates, documents): «viernes 27
 *   de noviembre», no comma; with `year`: «domingo 1 de noviembre de 2026»;
 *   with `relative`, a relative word leads: «mañana, miércoles 25 de noviembre».
 *
 * Weekdays and months are never abbreviated. The names are written here
 * rather than taken from `Intl`, so the web, the server and the phone apps
 * (whose JavaScript engine may carry no full locale data) write the same
 * characters. The calendar is the one in promise.ts (Costa Rica keeps UTC−6
 * all year): there is no second one.
 */

import { daysBetween, type LocalDate, toCostaRicaTime, weekdayOf } from "./promise";

/** The languages the helpers in this package write. "es-CR" is read as "es". */
export type CoreLocale = "es" | "en";
export type CoreLocaleInput = CoreLocale | "es-CR";

export const NBSP = " ";

export function coreLocale(locale: CoreLocaleInput | undefined): CoreLocale {
  return locale === "en" ? "en" : "es";
}

const WEEKDAYS: Record<CoreLocale, readonly string[]> = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

const MONTHS: Record<CoreLocale, readonly string[]> = {
  es: [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
};

const RELATIVE: Record<CoreLocale, { yesterday: string; today: string; tomorrow: string }> = {
  es: { yesterday: "ayer", today: "hoy", tomorrow: "mañana" },
  en: { yesterday: "yesterday", today: "today", tomorrow: "tomorrow" },
};

/** A moment (Date or ISO timestamp) or a Costa Rica calendar date (YYYY-MM-DD). */
export type DayInput = Date | string;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toInstant(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Not a date: ${String(value)}`);
  return date;
}

/** The Costa Rica calendar date of a value, and whether it carries a time. */
function localDateOf(value: DayInput): { date: LocalDate; instant: Date | null } {
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    // Validates the date (2026-02-30 is refused).
    weekdayOf(value);
    const check = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== value) {
      throw new RangeError(`Not a calendar date: ${value}`);
    }
    return { date: value, instant: null };
  }
  const instant = toInstant(value);
  return { date: toCostaRicaTime(instant).date, instant };
}

const parts = (date: LocalDate) => ({
  year: Number(date.slice(0, 4)),
  month: Number(date.slice(5, 7)),
  day: Number(date.slice(8, 10)),
  weekday: weekdayOf(date),
});

/**
 * The time of a moment on the Costa Rica clock. Whole hours drop the minutes
 * («2 p. m.»); midnight is «12 a. m.» and noon «12 p. m.». Every space inside
 * is U+00A0.
 */
export function formatTime(value: Date | string, opts: { locale?: CoreLocaleInput } = {}): string {
  const locale = coreLocale(opts.locale);
  const local = toCostaRicaTime(toInstant(value));
  return clockText(local.hour, local.minute, locale);
}

/** «2 p. m.» for an hour of the day (0–23) and minute, as formatTime writes it. */
export function formatClock(
  hour: number,
  minute = 0,
  opts: { locale?: CoreLocaleInput } = {},
): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Not an hour of the day: ${hour}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`Not a minute: ${minute}`);
  }
  return clockText(hour, minute, coreLocale(opts.locale));
}

function clockText(hour: number, minute: number, locale: CoreLocale): string {
  const pm = hour >= 12;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const digits = minute === 0 ? `${h12}` : `${h12}:${String(minute).padStart(2, "0")}`;
  if (locale === "en") return `${digits}${NBSP}${pm ? "pm" : "am"}`;
  return `${digits}${NBSP}${pm ? "p." : "a."}${NBSP}m.`;
}

export type FormatDayOptions = {
  locale?: CoreLocaleInput;
  /** Adds the time after a comma («ayer, 6:33 p. m.»). Ignored for a YYYY-MM-DD date. */
  time?: boolean;
} & (
  | {
      /** Short form (the default): tables, lists, history. */
      form?: "short";
      /** The moment that decides «hoy», «ayer», «mañana», the month and the year. */
      now: Date;
    }
  | {
      /** Long form: sentences, arrival dates, documents. */
      form: "long";
      /** Adds the year («domingo 1 de noviembre de 2026»): on documents. */
      year?: boolean;
      /** Leads with «hoy», «mañana» or «ayer» when it applies («mañana, miércoles 25 de noviembre»). */
      relative?: boolean;
      /** Needed with `relative`. */
      now?: Date;
    }
);

/** The day of a moment or a calendar date, as §10.4 writes it. */
export function formatDay(value: DayInput, opts: FormatDayOptions): string {
  const locale = coreLocale(opts.locale);
  const { date, instant } = localDateOf(value);
  const time = opts.time && instant ? `, ${formatTime(instant, { locale })}` : "";

  if (opts.form === "long") {
    const long = longDay(date, locale, opts.year === true);
    if (!opts.relative) return long + time;
    if (!opts.now) throw new RangeError("formatDay: `relative` needs `now`");
    const word = relativeWord(date, toCostaRicaTime(opts.now).date, locale);
    return (word ? `${word}, ${long}` : long) + time;
  }

  const today = toCostaRicaTime(opts.now).date;
  const word = relativeWord(date, today, locale);
  if (word) return word + time;
  const p = parts(date);
  const t = parts(today);
  const weekday = WEEKDAYS[locale][p.weekday] as string;
  const month = MONTHS[locale][p.month - 1] as string;
  let text: string;
  if (p.year !== t.year) {
    text =
      locale === "en"
        ? `${weekday} ${p.day} ${month} ${p.year}`
        : `${weekday} ${p.day} de ${month} de ${p.year}`;
  } else if (p.month !== t.month) {
    text = locale === "en" ? `${weekday} ${p.day} ${month}` : `${weekday} ${p.day} de ${month}`;
  } else {
    text = `${weekday} ${p.day}`;
  }
  return text + time;
}

function longDay(date: LocalDate, locale: CoreLocale, withYear: boolean): string {
  const p = parts(date);
  const weekday = WEEKDAYS[locale][p.weekday] as string;
  const month = MONTHS[locale][p.month - 1] as string;
  if (locale === "en") return `${weekday} ${p.day} ${month}${withYear ? ` ${p.year}` : ""}`;
  return `${weekday} ${p.day} de ${month}${withYear ? ` de ${p.year}` : ""}`;
}

function relativeWord(date: LocalDate, today: LocalDate, locale: CoreLocale): string | null {
  const diff = daysBetween(today, date);
  if (diff === 0) return RELATIVE[locale].today;
  if (diff === 1) return RELATIVE[locale].tomorrow;
  if (diff === -1) return RELATIVE[locale].yesterday;
  return null;
}
