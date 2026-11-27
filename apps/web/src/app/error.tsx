"use client";

import { ErrorScreen, useReportError } from "@yuntera/next-kit/error-reports/pages";

/** Shown when a page fails to render. The technical detail goes to the logs, not to the shopper. */
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
      advice="Si estaba pagando, revise “Sus pedidos” antes de intentarlo otra vez: no le cobraremos dos veces."
    />
  );
}
