/**
 * docs/06-operations/notifications.md says who gets what. This keeps it true:
 * its table must match the planner in the migration (who, which template,
 * which channels), and every template it names must exist on those channels.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { channelsOf, TEMPLATE_NAMES } from "./templates/catalog.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const migration = readdirSync(`${root}supabase/migrations`)
  .filter((file) => file.endsWith("_notifications.sql"))
  .map((file) => readFileSync(`${root}supabase/migrations/${file}`, "utf8"))
  .join("\n");
const doc = readFileSync(`${root}docs/06-operations/notifications.md`, "utf8");

type Row = string; // "topic|template|channel,channel"

function fromSql(): Row[] {
  const start = migration.indexOf("create or replace function private.notify_plan_event");
  const body = migration.slice(start, migration.indexOf("$$;", start));
  const rows: Row[] = [];
  const segments = body.split(/\n\s+when '([a-z_.]+)' then/).slice(1);
  for (let i = 0; i < segments.length; i += 2) {
    const topic = segments[i] ?? "";
    const code = segments[i + 1] ?? "";
    for (const call of code.matchAll(/private\.notify_(person|shop|team|add)\(([\s\S]*?)\);/g)) {
      const [, kind, args = ""] = call;
      const templates = [...args.matchAll(/'([a-z_]+)'/g)]
        .map((m) => m[1] ?? "")
        .filter((name) => TEMPLATE_NAMES.includes(name));
      const channels =
        kind === "team"
          ? ["email"]
          : kind === "add"
            ? [/'(email|push|whatsapp|sms)'/.exec(args)?.[1] ?? "?"]
            : [...(/array\[([^\]]*)\]/.exec(args)?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map(
                (m) => m[1] ?? "",
              );
      for (const template of templates)
        rows.push(`${topic}|${template}|${[...channels].sort().join(",")}`);
    }
  }
  return [...new Set(rows)].sort();
}

function fromDoc(): Row[] {
  const table = doc.slice(
    doc.indexOf("<!-- BEGIN notification-table -->"),
    doc.indexOf("<!-- END notification-table -->"),
  );
  return table
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      const topic = cells[1]?.replace(/`/g, "") ?? "";
      const template = cells[2]?.replace(/`/g, "") ?? "";
      const channels = [...(cells[4] ?? "").matchAll(/`([a-z]+)`/g)].map((m) => m[1] ?? "").sort();
      return `${topic}|${template}|${channels.join(",")}`;
    })
    .sort();
}

describe("the operations document", () => {
  it("lists exactly what the planner sends", () => {
    const sql = fromSql();
    expect(sql.length).toBeGreaterThan(20);
    expect(fromDoc()).toEqual(sql);
  });

  it("names only templates that exist, on channels they can render", () => {
    for (const row of fromDoc()) {
      const [, template = "", channels = ""] = row.split("|");
      expect(TEMPLATE_NAMES, template).toContain(template);
      for (const channel of channels.split(",")) {
        expect(channelsOf(template), `${template} on ${channel}`).toContain(channel);
      }
    }
  });
});
