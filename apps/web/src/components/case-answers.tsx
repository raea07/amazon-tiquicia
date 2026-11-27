import { MY_CASE_KIND, myCaseStatusWord } from "@yuntera/core";
import type { MyCase } from "@yuntera/db";
import { Badge, formatDate, formatDateTime } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";

/**
 * The shopper's cases with the answers staff wrote to them (my_cases): in
 * the account and on an order's page. Text a person wrote is shown as text.
 */
export function CaseAnswers({ cases, showOrder }: { cases: MyCase[]; showOrder: boolean }) {
  return (
    <ul className="flex flex-col gap-4" data-testid="case-answers">
      {cases.map((item) => (
        <li
          key={item.id}
          className="rounded-lg border border-border bg-surface p-5 text-sm"
          data-testid="case-answer"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              {MY_CASE_KIND[item.kind] ?? "Consulta"} {item.reference}
            </p>
            <Badge tone={item.status === "closed" ? "success" : "info"}>
              {myCaseStatusWord(item)}
            </Badge>
          </div>
          <p className="mt-1 text-ink-muted">
            Desde el {formatDate(item.created_at, { day: "numeric", month: "long" })}
            {showOrder && item.order_number ? (
              <>
                {" · pedido "}
                <Link
                  href={`/pedidos/${item.order_number}` as Route}
                  className="text-link underline"
                >
                  {item.order_number}
                </Link>
              </>
            ) : null}
            {item.status === "open"
              ? ` · le respondemos a más tardar el ${formatDate(item.answer_due_on)}`
              : ""}
          </p>
          {item.answers.length === 0 ? (
            <p className="mt-3 text-ink-muted">
              Todavía no hay respuesta. Le avisamos cuando la haya.
            </p>
          ) : (
            <ol className="mt-3 flex flex-col gap-3">
              {item.answers.map((answer) => (
                <li key={answer.created_at} className="rounded-md bg-surface-muted p-3">
                  <p className="text-xs text-ink-muted">
                    Respuesta de {answer.author ?? "Yuntera"} · {formatDateTime(answer.created_at)}
                  </p>
                  <p className="mt-1 whitespace-pre-line break-words">{answer.body}</p>
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}
