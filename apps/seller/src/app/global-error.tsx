"use client";

import { appThemeColor, light } from "@yuntera/brand";
import { GlobalErrorDocument } from "@yuntera/next-kit/error-reports/pages";
import "./globals.css";

/** Shown when the website's frame itself fails. Never a code or a stack. */
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
      app="seller"
      themeColor={light[appThemeColor.seller]}
      advice="Si acaba de guardar un cambio, revise si quedó aplicado antes de repetirlo."
    />
  );
}
