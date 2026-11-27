import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPLAINT_PROMISE,
  REFUND_TIME,
  returnRequestedText,
  SERVICE_TARGETS,
  type ServiceTime,
  serviceTarget,
  serviceTimeWords,
} from "./service-times";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, ROOT)), "utf8");

/** The rows the support desk's migration inserts into private.case_targets. */
function migrationTargets() {
  const sql = read("supabase/migrations/20261121084700_support_cases.sql");
  const block = /insert into private\.case_targets[\s\S]*?values([\s\S]*?);\n/.exec(sql)?.[1] ?? "";
  const rows = [
    ...block.matchAll(/\('(\w+)', '([\w*]+)', (\d+), '(\w+)', (\d+), '(\w+)', '([^']+)'\)/g),
  ];
  return rows.map((m) => ({
    kind: m[1],
    topic: m[2],
    firstResponse: { amount: Number(m[3]), unit: m[4] },
    resolution: { amount: Number(m[5]), unit: m[6] },
    situation: m[7],
  }));
}

/** The "Response targets" table of customer-service.md: situation → [first, resolution]. */
function documentTargets(): Map<string, [string, string]> {
  const md = read("docs/06-operations/customer-service.md");
  const section = md.split("## Response targets")[1]?.split("\n## ")[0] ?? "";
  const out = new Map<string, [string, string]>();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 5 || cells[1] === "Situation" || /^-+$/.test(cells[1] ?? "")) continue;
    out.set(cells[1] as string, [cells[2] as string, cells[3] as string]);
  }
  return out;
}

/** How customer-service.md writes a time ("2 working hours", "Same day"). */
function inEnglish(time: ServiceTime): RegExp {
  const one = {
    minutes: "minute",
    working_hours: "working hour",
    working_days: "working day",
    calendar_days: "calendar day",
  };
  if (time.unit === "same_day") return /same day/i;
  const word = one[time.unit];
  return new RegExp(`\\b${time.amount} ${word}${time.amount === 1 ? "" : "s"}\\b`, "i");
}

describe("service targets", () => {
  it("are the rows of private.case_targets, one for one", () => {
    expect(migrationTargets()).toEqual(
      SERVICE_TARGETS.map((x) => ({
        kind: x.kind,
        topic: x.topic,
        firstResponse: x.firstResponse,
        resolution: x.resolution,
        situation: x.situation,
      })),
    );
  });

  it("say what customer-service.md says, for every situation it names", () => {
    const doc = documentTargets();
    expect(doc.size).toBeGreaterThanOrEqual(7);
    for (const target of SERVICE_TARGETS) {
      const situation = target.situation.replace(/ \(.*\)$/, "");
      const row = [...doc.entries()].find(([name]) => name.startsWith(situation));
      expect(row, `customer-service.md has a row for ${situation}`).toBeDefined();
      const [first, resolution] = (row as [string, [string, string]])[1];
      expect(first, `${target.kind}/${target.topic} first response`).toMatch(
        inEnglish(target.firstResponse),
      );
      expect(resolution, `${target.kind}/${target.topic} resolution`).toMatch(
        inEnglish(target.resolution),
      );
    }
  });

  it("give every kind a row for any other topic", () => {
    for (const kind of ["complaint", "return", "report", "contact"] as const) {
      expect(serviceTarget(kind, "nada").topic).toBe("*");
    }
    expect(serviceTarget("return", "damaged").firstResponse).toEqual({
      amount: 2,
      unit: "working_hours",
    });
  });
});

describe("the words shoppers read", () => {
  it("name each time plainly", () => {
    expect(serviceTimeWords({ amount: 1, unit: "working_days" })).toBe("1 día hábil");
    expect(serviceTimeWords({ amount: 5, unit: "working_days" })).toBe("5 días hábiles");
    expect(serviceTimeWords({ amount: 2, unit: "working_hours" })).toBe("2 horas hábiles");
    expect(serviceTimeWords({ amount: 8, unit: "calendar_days" })).toBe("8 días naturales");
    expect(serviceTimeWords({ amount: 1, unit: "same_day" })).toBe("el mismo día");
  });

  it("promise a complaint's acknowledgement and answer, and a return's answer and refund", () => {
    expect(COMPLAINT_PROMISE).toBe(
      "Le confirmamos que lo recibimos en un máximo de 1 día hábil, con un número de referencia, y le respondemos por escrito en un máximo de 5 días hábiles. Reclamar no tiene costo.",
    );
    expect(REFUND_TIME).toBe("8 días naturales");
    expect(returnRequestedText("damaged")).toBe(
      "Recibimos su solicitud. Le respondemos en un máximo de 2 horas hábiles.",
    );
    expect(returnRequestedText("withdrawal")).toBe(
      "Recibimos su solicitud. Le respondemos en un máximo de 1 día hábil.",
    );
  });
});

describe("the frozen store build (3f251c3)", () => {
  // Its return screens say "Le respondemos en un máximo de 2 días hábiles"
  // for a request staff must decide (damaged, wrong item, warranty). It cannot
  // be changed, so it must never promise less time than the target in force.
  it("never promises an answer sooner than the target", () => {
    for (const kind of ["damaged", "wrong_item", "warranty"]) {
      const target = serviceTarget("return", kind).firstResponse;
      // 2 working hours is less than 2 working days: the old words promise more time.
      expect(
        target.unit === "working_hours" || (target.unit === "working_days" && target.amount <= 2),
      ).toBe(true);
    }
  });
});
