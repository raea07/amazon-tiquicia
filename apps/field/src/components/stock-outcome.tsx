"use client";

import { Alert } from "@yuntera/ui";
import { useEffect } from "react";

/** The address's keys that carry what the last move or correction did. */
export const OUTCOME_KEYS = [
  "movidas",
  "destino",
  "contadas",
  "diferencia",
  "sin",
  "accion",
  "nuevas",
  "producto",
] as const;

/**
 * What the last move or correction did, shown once. The action put it in the
 * address; it is taken out of the address as soon as it is shown, so a later
 * refusal (which draws the page again) or a reload never shows it next to
 * something that happened after.
 */
export function StockOutcome({
  title,
  children,
  tone = "success",
}: {
  title: string;
  children: string;
  tone?: "success" | "danger";
}) {
  // After every render: the same outcome twice in a row draws this again
  // without mounting it anew.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!OUTCOME_KEYS.some((key) => url.searchParams.has(key))) return;
    for (const key of OUTCOME_KEYS) url.searchParams.delete(key);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  });
  return (
    <Alert tone={tone} title={title}>
      {children}
    </Alert>
  );
}
