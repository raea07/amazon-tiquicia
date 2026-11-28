/**
 * How fast Yuntera answers and resolves, as the shopper is told it. The
 * targets themselves live in the database (private.case_targets,
 * 20261121084700_support_cases.sql), which counts every due date; this is the
 * same table in TypeScript only so the words on screen and in messages say
 * the same numbers. service-times.test.ts keeps the three equal: this table,
 * the migration's rows and the "Response targets" table of
 * docs/06-operations/customer-service.md. The desk's hours (SERVICE_HOURS)
 * are kept equal the same way: private.desk_week in the migration, which
 * counts the working hours and days of every target, and the "Service
 * hours" table of customer-service.md.
 */

import { formatClock, weekdayName } from "./dates";
import { endSentence } from "./sentence";

export type ServiceUnit =
  | "minutes"
  | "working_hours"
  | "working_days"
  | "calendar_days"
  | "same_day";

export interface ServiceTime {
  amount: number;
  unit: ServiceUnit;
}

export interface ServiceTarget {
  kind: "complaint" | "return" | "report" | "contact";
  /** The complaint's category, the return's kind, a contact's topic, or "*". */
  topic: string;
  firstResponse: ServiceTime;
  resolution: ServiceTime;
  /** The row of customer-service.md it comes from, in that file's words. */
  situation: string;
}

const t = (amount: number, unit: ServiceUnit): ServiceTime => ({ amount, unit });

export const SERVICE_TARGETS: readonly ServiceTarget[] = [
  {
    kind: "complaint",
    topic: "*",
    firstResponse: t(1, "working_days"),
    resolution: t(5, "working_days"),
    situation: "Formal complaint",
  },
  {
    kind: "return",
    topic: "*",
    firstResponse: t(1, "working_days"),
    resolution: t(8, "calendar_days"),
    situation: "Withdrawal or return request",
  },
  {
    kind: "return",
    topic: "damaged",
    firstResponse: t(2, "working_hours"),
    resolution: t(2, "working_days"),
    situation: "Wrong, damaged or missing item",
  },
  {
    kind: "return",
    topic: "wrong_item",
    firstResponse: t(2, "working_hours"),
    resolution: t(2, "working_days"),
    situation: "Wrong, damaged or missing item",
  },
  {
    kind: "return",
    topic: "warranty",
    firstResponse: t(2, "working_hours"),
    resolution: t(2, "working_days"),
    situation: "Wrong, damaged or missing item",
  },
  {
    kind: "report",
    topic: "*",
    firstResponse: t(1, "working_days"),
    resolution: t(5, "working_days"),
    situation: "Formal complaint (reports use the same mechanism)",
  },
  {
    kind: "contact",
    topic: "delivery_today",
    firstResponse: t(15, "minutes"),
    resolution: t(1, "same_day"),
    situation: "Order out for delivery today",
  },
  {
    kind: "contact",
    topic: "delivery_problem",
    firstResponse: t(1, "same_day"),
    resolution: t(1, "same_day"),
    situation: "Delivery failed or late",
  },
  {
    kind: "contact",
    topic: "item_problem",
    firstResponse: t(2, "working_hours"),
    resolution: t(2, "working_days"),
    situation: "Wrong, damaged or missing item",
  },
  {
    kind: "contact",
    topic: "return",
    firstResponse: t(1, "working_days"),
    resolution: t(8, "calendar_days"),
    situation: "Withdrawal or return request",
  },
  {
    kind: "contact",
    topic: "payment",
    firstResponse: t(2, "working_hours"),
    resolution: t(1, "working_days"),
    situation: "Payment question",
  },
  {
    kind: "contact",
    topic: "seller",
    firstResponse: t(1, "working_days"),
    resolution: t(3, "working_days"),
    situation: "Seller question",
  },
  {
    kind: "contact",
    topic: "complaint",
    firstResponse: t(1, "working_days"),
    resolution: t(5, "working_days"),
    situation: "Formal complaint",
  },
  {
    kind: "contact",
    topic: "*",
    firstResponse: t(1, "working_days"),
    resolution: t(5, "working_days"),
    situation: "Any other question",
  },
];

/** The target of a kind of case and topic: its own row, or the kind's "*". */
export function serviceTarget(kind: ServiceTarget["kind"], topic: string): ServiceTarget {
  const own = SERVICE_TARGETS.find((x) => x.kind === kind && x.topic === topic);
  const any = SERVICE_TARGETS.find((x) => x.kind === kind && x.topic === "*");
  // Every kind has a "*" row (the test checks it).
  return (own ?? any) as ServiceTarget;
}

const WORDS: Record<Exclude<ServiceUnit, "same_day">, [string, string]> = {
  minutes: ["minuto", "minutos"],
  working_hours: ["hora hábil", "horas hábiles"],
  working_days: ["día hábil", "días hábiles"],
  calendar_days: ["día natural", "días naturales"],
};

/** "1 día hábil", "2 horas hábiles", "8 días naturales", "el mismo día". */
export function serviceTimeWords(time: ServiceTime): string {
  if (time.unit === "same_day") return "el mismo día";
  const [one, many] = WORDS[time.unit];
  return `${time.amount} ${time.amount === 1 ? one : many}`;
}

const COMPLAINT = serviceTarget("complaint", "*");
const WITHDRAWAL = serviceTarget("return", "withdrawal");

/** What the help pages and the complaint form promise about a complaint. */
export const COMPLAINT_PROMISE = `Le confirmamos que lo recibimos en un máximo de ${serviceTimeWords(COMPLAINT.firstResponse)}, con un número de referencia, y le respondemos por escrito en un máximo de ${serviceTimeWords(COMPLAINT.resolution)}. Reclamar no tiene costo.`;

/** The written answer to a complaint, for the complaint's e-mail. */
export const COMPLAINT_ANSWER_TIME = serviceTimeWords(COMPLAINT.resolution);

/** The refund of a withdrawal ("8 días naturales"), for the help pages. */
export const REFUND_TIME = serviceTimeWords(WITHDRAWAL.resolution);

/** When a return request still to be decided gets its answer. */
export function returnAnswerTime(kind: string): string {
  return serviceTimeWords(serviceTarget("return", kind).firstResponse);
}

/** What the shopper reads once a return request waits for staff. */
export function returnRequestedText(kind: string): string {
  return `Recibimos su solicitud. Le respondemos en un máximo de ${returnAnswerTime(kind)}.`;
}

/**
 * The desk's hours, Costa Rica time (owner decision D56, 27 November 2026):
 * the days it answers, 0 Sunday to 6 Saturday, each with its opening and
 * closing time. A day not listed is closed, and so is every public holiday.
 * Saturday is a working day for the targets above; the legal withdrawal and
 * warranty periods keep counting Monday to Friday.
 */
export interface ServiceDay {
  day: number;
  /** "08:00", 24-hour clock. */
  opens: string;
  closes: string;
}

export const SERVICE_HOURS: readonly ServiceDay[] = [
  { day: 1, opens: "08:00", closes: "17:00" },
  { day: 2, opens: "08:00", closes: "17:00" },
  { day: 3, opens: "08:00", closes: "17:00" },
  { day: 4, opens: "08:00", closes: "17:00" },
  { day: 5, opens: "08:00", closes: "17:00" },
  { day: 6, opens: "08:00", closes: "12:00" },
];

// «sábado» → «sábados»; «lunes» and «miércoles» stay as they are.
const plural = (day: string) => (day.endsWith("s") ? day : `${day}s`);

const clock = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return formatClock(hour as number, minute as number);
};

/**
 * «Atendemos de lunes a viernes de 8 a. m. a 5 p. m. y los sábados de 8 a. m.
 * a 12 p. m.», from SERVICE_HOURS: days in a row with the same hours are
 * one range, a day alone is said in the plural («los sábados»).
 */
export function serviceHoursText(hours: readonly ServiceDay[] = SERVICE_HOURS): string {
  const groups: ServiceDay[][] = [];
  for (const day of [...hours].sort((a, b) => a.day - b.day)) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    if (
      last &&
      prev &&
      prev.day === day.day - 1 &&
      prev.opens === day.opens &&
      prev.closes === day.closes
    ) {
      last.push(day);
    } else {
      groups.push([day]);
    }
  }
  const parts = groups.map((group) => {
    const first = group[0] as ServiceDay;
    const last = group.at(-1) as ServiceDay;
    const days =
      group.length === 1
        ? `los ${plural(weekdayName(first.day))}`
        : `de ${weekdayName(first.day)} a ${weekdayName(last.day)}`;
    return `${days} de ${clock(first.opens)} a ${clock(first.closes)}`;
  });
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
  return endSentence(`Atendemos ${list}`);
}

/** What the help pages say about the hours, the closed days and the periods. */
export const SERVICE_HOURS_TEXT = serviceHoursText();

/** The sentence after the hours on the help pages. */
export const SERVICE_DAYS_NOTE =
  "Los domingos y los feriados no atendemos. Para nuestros plazos de respuesta el sábado cuenta como día hábil; los plazos de la ley para devolver y para la garantía se cuentan de lunes a viernes.";
