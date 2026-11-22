"use client";

import { ORDER_STATUS_LABEL, ORDER_STATUSES, type OrderStatus } from "@yuntera/core";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { useActionState } from "react";
import { searchOrders } from "@/app/order-search-actions";

const initial: ActionState = {};

/**
 * The order search, sent by POST so that a shopper's name typed here never
 * reaches the address bar (WEB-4). The status filter goes along with it.
 */
export function OrderSearchForm({ text, status }: { text: string; status: string | null }) {
  const [state, action] = useActionState(searchOrders, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-full max-w-full flex-col gap-1 sm:w-72">
          <label htmlFor="q" className="text-sm font-semibold">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="search"
            maxLength={80}
            autoComplete="off"
            defaultValue={state.values?.q ?? text}
            placeholder="YT-100012 o nombre de quien recibe"
            className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-semibold">
            Estado
          </label>
          <select
            id="estado"
            name="estado"
            defaultValue={status ?? ""}
            className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
          >
            <option value="">Todos</option>
            {ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {ORDER_STATUS_LABEL[value as OrderStatus]["es-CR"]}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton variant="secondary" pendingLabel="Buscando…">
          Buscar pedidos
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
