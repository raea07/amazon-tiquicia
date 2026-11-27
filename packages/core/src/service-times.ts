/**
 * How fast Yuntera answers and resolves, as the shopper is told it. The
 * targets themselves live in the database (private.case_targets,
 * 20261121084700_support_cases.sql), which counts every due date; this is the
 * same table in TypeScript only so the words on screen and in messages say
 * the same numbers. service-times.test.ts keeps the three equal: this table,
 * the migration's rows and the "Response targets" table of
 * docs/06-operations/customer-service.md.
 */

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
