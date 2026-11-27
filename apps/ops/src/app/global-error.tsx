"use client";

import { GlobalErrorDocument } from "@yuntera/next-kit/error-reports/pages";
import "./globals.css";

/** Shown when the website's frame itself fails. Never a code or a stack. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <GlobalErrorDocument
      error={error}
      reset={reset}
      advice="Si acaba de guardar un cambio, revise si quedó aplicado antes de repetirlo."
    />
  );
}
