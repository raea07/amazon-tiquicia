import type { NotificationRow } from "@yuntera/db";
import { Badge, formatDateTime } from "@yuntera/ui";
import {
  audienceOf,
  CHANNEL,
  failureOf,
  NOTIFICATION_STATUS,
  SKIP_REASON,
  TEMPLATE,
} from "@/lib/notification-labels";

/** One message: who, which channel, which template, and where it stands. Never its content. */
export function NotificationLine({ row }: { row: NotificationRow }) {
  const status = NOTIFICATION_STATUS[row.status] ?? { label: row.status, tone: "neutral" as const };
  const when = row.delivered_at ?? row.sent_at ?? row.created_at;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <span>
        <span className="font-semibold">{TEMPLATE[row.template] ?? row.template}</span>
        <span className="ml-2 text-ink-muted">
          {CHANNEL[row.channel] ?? row.channel} · {audienceOf(row)}
        </span>
        <span className="block text-xs text-ink-muted">
          {formatDateTime(when)}
          {row.attempts > 1 ? ` · ${row.attempts} intentos` : ""}
          {row.skip_reason ? ` · ${SKIP_REASON[row.skip_reason] ?? "no aplicaba"}` : ""}
          {row.status === "dead" || row.status === "failed"
            ? ` · ${failureOf(row.error_code)}`
            : ""}
        </span>
      </span>
      <Badge tone={status.tone}>{status.label}</Badge>
    </div>
  );
}
