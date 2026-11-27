"use client";

import { ErrorScreen, useReportError } from "@yuntera/next-kit/error-reports/pages";

/** Shown when a page fails to render. The technical detail goes to the logs, not to the screen. */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const told = useReportError(error);
  return (
    <ErrorScreen
      onRetry={retry}
      told={told}
      advice="Si acaba de guardar un cambio, revise si quedó aplicado antes de repetirlo."
    />
  );
}
