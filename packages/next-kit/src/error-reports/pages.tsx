"use client";

/**
 * What a person sees when a page breaks, the same in the four websites.
 *
 * `ErrorScreen` is the body of each website's error pages: `app/error.tsx`
 * (a page failed and the website around it still works) and
 * `app/global-error.tsx` (the website's frame itself failed, so the page
 * brings its own <html> and <body>). It says that something failed, that the
 * team was told (only when this build reports errors, so it is never
 * untrue), and what to do next. It never shows a code or a stack.
 */
import { Button, buttonClass, EmptyState } from "@yuntera/ui";
import { type ReactNode, useEffect } from "react";
import { fontClassName } from "../fonts";
import { reportError, reportsErrors } from "./client";

/**
 * The page `app/global-error.tsx` shows: it replaces the website's own frame,
 * so it brings the document, the fonts and, through the website's import of
 * its globals.css, the styles.
 */
export function GlobalErrorDocument({
  error,
  reset,
  advice,
}: {
  error: unknown;
  reset?: () => void;
  advice: ReactNode;
}) {
  useReportError(error);
  return (
    <html lang="es-CR" className={fontClassName}>
      <body className="flex min-h-dvh flex-col antialiased">
        <main id="contenido" className="flex-1">
          <ErrorScreen advice={advice} onRetry={reset} />
        </main>
      </body>
    </html>
  );
}

/** Reports an error an error page caught, once per error. */
export function useReportError(error: unknown) {
  useEffect(() => {
    reportError(error);
  }, [error]);
}

export const ERROR_TITLE = "Algo falló de nuestro lado";
export const TEAM_TOLD = "Ya le avisamos al equipo de Yuntera.";

export function ErrorScreen({
  advice,
  onRetry,
  home = true,
  told = reportsErrors(),
}: {
  /** What to do next, in this website's words. */
  advice: ReactNode;
  onRetry?: () => void;
  /** Offer a way back to the start (a plain link, which works even when the website's frame did not). */
  home?: boolean;
  told?: boolean;
}) {
  return (
    <div className="shell py-16">
      <EmptyState
        title={ERROR_TITLE}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            {onRetry ? <Button onClick={onRetry}>Intentar de nuevo</Button> : null}
            {home ? (
              // A plain link on purpose: it reloads the website from the start.
              <a href="/" className={buttonClass({ variant: "secondary" })}>
                Volver al inicio
              </a>
            ) : null}
          </div>
        }
      >
        {told ? `No es culpa suya. ${TEAM_TOLD} ` : "No es culpa suya. "}
        {advice}
      </EmptyState>
    </div>
  );
}
