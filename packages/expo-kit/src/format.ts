/**
 * Prices and dates for display, the way the web shows them
 * (`packages/ui/src/commerce.tsx`); `format.test.ts` compares the two.
 */

import { format, money } from "@yuntera/core";

/** ₡12 500 — always through `format()` in packages/core, never by hand. */
export const formatPrice = (amountMinor: number) => format(money(amountMinor));

/** Dates as people say them in Costa Rica: "lunes 23 de noviembre" (the web's formatDate). */
export function formatDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" },
): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("es-CR", {
    ...options,
    timeZone: dateOnly ? "UTC" : "America/Costa_Rica",
  }).format(new Date(dateOnly ? `${value}T00:00:00Z` : value));
}

export const formatDateTime = (value: string) =>
  formatDate(value, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
