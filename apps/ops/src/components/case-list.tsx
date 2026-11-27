import type { CaseRow } from "@yuntera/db";
import { Badge, formatDateTime } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";
import { CASE_CHANNEL, CASE_CLOCK, CASE_KIND, caseTopic, timeLeft } from "@/lib/case-labels";

/**
 * Cases as cards (they wrap on a phone): type, topic, order number, the
 * customer's first name, the target and the time left, and the clock in
 * words ("Vence pronto", "Atrasado"), never colour alone.
 */
export function CaseList({ cases, now }: { cases: CaseRow[]; now: number }) {
  return (
    <ul className="grid gap-4 lg:grid-cols-2" data-testid="case-list">
      {cases.map((item) => {
        const clock = CASE_CLOCK[item.clock];
        const left = timeLeft(item, now);
        return (
          <li
            key={item.id}
            className="rounded-lg border border-border bg-surface p-5 text-sm"
            data-testid="case-row"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/casos/${item.id}` as Route}
                className="inline-flex min-h-11 items-center font-semibold text-link underline"
              >
                {CASE_KIND[item.kind] ?? item.kind}: {caseTopic(item)}
              </Link>
              <Badge tone={clock.tone}>{clock.label}</Badge>
            </div>
            <p className="text-ink-muted">
              {item.customer ?? "Cliente"}
              {item.order_number ? ` · pedido ${item.order_number}` : ""} ·{" "}
              {CASE_CHANNEL[item.channel] ?? item.channel} · {formatDateTime(item.created_at)}
            </p>
            {left ? (
              <p className={item.clock === "overdue" ? "mt-1 font-semibold text-danger" : "mt-1"}>
                {left}
              </p>
            ) : null}
            <p className="mt-1 text-ink-muted">
              {item.assignee
                ? item.assigned_to_me
                  ? "Lo atiende usted"
                  : `Lo atiende ${item.assignee}`
                : "Sin asignar"}
              {item.reopened_count === 1
                ? " · reabierto una vez"
                : item.reopened_count > 1
                  ? ` · reabierto ${item.reopened_count} veces`
                  : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
