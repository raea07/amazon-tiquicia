/**
 * Delivery promise: the date shown next to "Llega…" on a product page and
 * committed to at checkout.
 *
 * A promise is a commitment the operation is measured against, so the
 * calculation is conservative and explicit: order cutoff, handling time,
 * transit time, working days and public holidays. Capacity limits are applied
 * by the caller (a zone/day that is full is passed in `closedDates`).
 *
 * Costa Rica keeps UTC−6 all year (no daylight saving), which lets this module
 * do exact local-date arithmetic without a timezone database.
 */

export const CR_UTC_OFFSET_HOURS = -6;

/** A calendar date in Costa Rica, as YYYY-MM-DD. */
export type LocalDate = string;

export interface LocalDateTime {
  date: LocalDate;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

export function toCostaRicaTime(instant: Date): LocalDateTime {
  const shifted = new Date(instant.getTime() + CR_UTC_OFFSET_HOURS * 3_600_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * The Costa Rica date and hour of an instant, as "YYYY-MM-DDTHH": the only
 * part of the clock a delivery promise depends on (a zone's cutoff is a whole
 * hour, `cutoff_hour`, and a day ends at midnight). Two instants with the same
 * key get the same promise from the same data, so a cached answer that
 * carries a promise and is keyed by this is never served after the hour it
 * was computed for (apps/web/src/lib/data.ts, the product page).
 */
export function promiseHour(instant: Date): string {
  const local = toCostaRicaTime(instant);
  return `${local.date}T${String(local.hour).padStart(2, "0")}`;
}

const parse = (d: LocalDate) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date: ${d}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
};

export function addDays(d: LocalDate, days: number): LocalDate {
  const date = parse(d);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const weekdayOf = (d: LocalDate) => parse(d).getUTCDay();

export const daysBetween = (from: LocalDate, to: LocalDate) =>
  Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);

/** Easter Sunday (Gregorian), by the anonymous/Meeus algorithm. */
export function easterSunday(year: number): LocalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Statutory holidays on their calendar dates. Costa Rican law has at times
 * moved some holidays to the nearest Monday; the operations calendar in the
 * database is authoritative and this function only seeds it.
 */
export function costaRicaHolidays(year: number): LocalDate[] {
  const easter = easterSunday(year);
  const fixed = [
    "01-01",
    "04-11",
    "05-01",
    "07-25",
    "08-02",
    "08-15",
    "08-31",
    "09-15",
    "12-01",
    "12-25",
  ];
  return [...fixed.map((md) => `${year}-${md}`), addDays(easter, -3), addDays(easter, -2)].sort();
}

export interface ZoneService {
  zoneId: string;
  /** Orders placed before this local hour start processing the same day. */
  cutoffHour: number;
  /** Weekdays on which the origin processes orders (0 = Sunday). */
  processingWeekdays: readonly number[];
  /** Weekdays on which deliveries run in this zone. */
  deliveryWeekdays: readonly number[];
  /** Delivery days after dispatch: [fastest, slowest]. 0 = same day as dispatch. */
  transitDays: readonly [number, number];
}

/** Launch service levels. Tuned by operations; stored per zone in the database. */
export const SERVICE_PRESETS = {
  gamCore: {
    zoneId: "gam-core",
    cutoffHour: 14,
    processingWeekdays: [1, 2, 3, 4, 5, 6],
    deliveryWeekdays: [1, 2, 3, 4, 5, 6],
    transitDays: [1, 1],
  },
  gamExtended: {
    zoneId: "gam-extended",
    cutoffHour: 12,
    processingWeekdays: [1, 2, 3, 4, 5, 6],
    deliveryWeekdays: [1, 2, 3, 4, 5, 6],
    transitDays: [1, 2],
  },
  national: {
    zoneId: "national",
    cutoffHour: 12,
    processingWeekdays: [1, 2, 3, 4, 5],
    deliveryWeekdays: [1, 2, 3, 4, 5],
    transitDays: [2, 5],
  },
} as const satisfies Record<string, ZoneService>;

export interface PromiseInput {
  now: Date;
  zone: ZoneService;
  /** Working days the origin needs before dispatch. 0 for stock in a platform warehouse. */
  handlingDays: number;
  holidays?: readonly LocalDate[];
  /** Delivery dates with no remaining capacity in this zone. */
  closedDates?: readonly LocalDate[];
}

export interface DeliveryPromise {
  /** Date the order must leave the origin to keep the promise. */
  dispatchDate: LocalDate;
  earliest: LocalDate;
  latest: LocalDate;
  /** Calendar days from today to `latest`; what ranking and offer selection consume. */
  promiseDays: number;
  /** True when the order was placed before today's cutoff on a processing day. */
  madeCutoff: boolean;
}

export function computeDeliveryPromise(input: PromiseInput): DeliveryPromise {
  const { zone, handlingDays } = input;
  if (!Number.isInteger(handlingDays) || handlingDays < 0) {
    throw new RangeError("handlingDays must be a non-negative integer");
  }
  if (zone.processingWeekdays.length === 0 || zone.deliveryWeekdays.length === 0) {
    throw new RangeError(`Zone ${zone.zoneId} has no service days`);
  }

  const holidays = new Set(input.holidays ?? []);
  const closed = new Set(input.closedDates ?? []);
  const local = toCostaRicaTime(input.now);

  const isProcessingDay = (d: LocalDate) =>
    zone.processingWeekdays.includes(weekdayOf(d)) && !holidays.has(d);
  const isDeliveryDay = (d: LocalDate) =>
    zone.deliveryWeekdays.includes(weekdayOf(d)) && !holidays.has(d) && !closed.has(d);

  const nextMatching = (from: LocalDate, test: (d: LocalDate) => boolean): LocalDate => {
    let d = from;
    // A year of look-ahead is a guard against a misconfigured calendar, not a real case.
    for (let i = 0; i < 366; i++) {
      if (test(d)) return d;
      d = addDays(d, 1);
    }
    throw new RangeError(`No service day found within a year for zone ${zone.zoneId}`);
  };

  const madeCutoff = isProcessingDay(local.date) && local.hour < zone.cutoffHour;
  // The day processing starts.
  let dispatchDate = nextMatching(
    madeCutoff ? local.date : addDays(local.date, 1),
    isProcessingDay,
  );
  // Handling time is counted in processing days.
  for (let i = 0; i < handlingDays; i++) {
    dispatchDate = nextMatching(addDays(dispatchDate, 1), isProcessingDay);
  }

  const advance = (from: LocalDate, deliveryDays: number): LocalDate => {
    let d = from;
    let left = deliveryDays;
    if (left === 0) return nextMatching(d, isDeliveryDay);
    while (left > 0) {
      d = nextMatching(addDays(d, 1), isDeliveryDay);
      left--;
    }
    return d;
  };

  const earliest = advance(dispatchDate, zone.transitDays[0]);
  const latest = advance(dispatchDate, zone.transitDays[1]);

  return {
    dispatchDate,
    earliest,
    latest,
    promiseDays: daysBetween(local.date, latest),
    madeCutoff,
  };
}

/** Human wording for a promise, in the locale's terms. */
export function describePromise(
  promise: DeliveryPromise,
  now: Date,
  locale: "es-CR" | "en" = "es-CR",
): string {
  const today = toCostaRicaTime(now).date;
  const es = locale === "es-CR";
  const dayName = (d: LocalDate) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(parse(d));
  const relative = (d: LocalDate): string | null => {
    const diff = daysBetween(today, d);
    if (diff === 0) return es ? "hoy" : "today";
    if (diff === 1) return es ? "mañana" : "tomorrow";
    return null;
  };

  if (promise.earliest === promise.latest) {
    const rel = relative(promise.latest);
    return es
      ? `Llega ${rel ?? `el ${dayName(promise.latest)}`}`
      : `Arrives ${rel ?? dayName(promise.latest)}`;
  }
  return es
    ? `Llega entre el ${dayName(promise.earliest)} y el ${dayName(promise.latest)}`
    : `Arrives between ${dayName(promise.earliest)} and ${dayName(promise.latest)}`;
}
