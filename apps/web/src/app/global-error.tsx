"use client";

import { appThemeColor, light } from "@yuntera/brand";
import { GlobalErrorDocument } from "@yuntera/next-kit/error-reports/pages";
import "./globals.css";

/** Shown when the shop's frame itself fails. Never a code or a stack. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <GlobalErrorDocument
      error={error}
      retry={retry}
      app="shop"
      themeColor={light[appThemeColor.web]}
      advice="Si estaba pagando, revise “Sus pedidos” antes de intentarlo otra vez: no le cobraremos dos veces."
    />
  );
}
